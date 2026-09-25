// Deleting and editing chat messages, with or without restoring a checkpoint.

import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { t } from "../../../i18n"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { saveTaskMessages } from "../../task-persistence"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"
import { type HandlerContext, resolveIncomingImages } from "./context"
import type { MessageHandlerMap } from "./types"

type CurrentTask = NonNullable<ReturnType<HandlerContext["provider"]["getCurrentTask"]>>

/**
 * Shared utility to find message indices based on timestamp.
 * When multiple messages share the same timestamp (e.g., after condense),
 * this function prefers non-summary messages to ensure user operations
 * target the intended message rather than the summary.
 */
const findMessageIndices = (messageTs: number, currentCline: any) => {
	// Find the exact message by timestamp, not the first one after a cutoff
	const messageIndex = currentCline.clineMessages.findIndex((msg: ClineMessage) => msg.ts === messageTs)

	// Find all matching API messages by timestamp
	const allApiMatches = currentCline.apiConversationHistory
		.map((msg: ApiMessage, idx: number) => ({ msg, idx }))
		.filter(({ msg }: { msg: ApiMessage }) => msg.ts === messageTs)

	// Prefer non-summary message if multiple matches exist (handles timestamp collision after condense)
	const preferred = allApiMatches.find(({ msg }: { msg: ApiMessage }) => !msg.isSummary) || allApiMatches[0]
	const apiConversationHistoryIndex = preferred?.idx ?? -1

	return { messageIndex, apiConversationHistoryIndex }
}

/**
 * Fallback: find first API history index at or after a timestamp.
 * Used when the exact user message isn't present in apiConversationHistory (e.g., after condense).
 */
const findFirstApiIndexAtOrAfter = (ts: number, currentCline: any) => {
	if (typeof ts !== "number") return -1
	return currentCline.apiConversationHistory.findIndex(
		(msg: ApiMessage) => typeof msg?.ts === "number" && (msg.ts as number) >= ts,
	)
}

/** The first checkpoint saved after the given message, which restoring rewinds to. */
const findNextCheckpoint = (currentCline: CurrentTask, messageTs: number) =>
	currentCline.clineMessages.filter((msg) => msg.say === "checkpoint_saved" && msg.ts > messageTs)[0]

/**
 * Removes the message at `rewindTs` and everything after it while keeping the
 * checkpoint associations of the messages before `keepBeforeIndex`, saves the
 * messages and refreshes the webview. Shared by delete and edit confirm.
 */
const rewindKeepingCheckpoints = async (
	ctx: HandlerContext,
	currentCline: CurrentTask,
	keepBeforeIndex: number,
	rewindTs: number | undefined,
): Promise<void> => {
	const { provider } = ctx

	// Store checkpoints from messages that will be preserved
	const preservedCheckpoints = new Map<number, any>()
	for (let i = 0; i < keepBeforeIndex; i++) {
		const msg = currentCline.clineMessages[i]
		if (msg?.checkpoint && msg.ts) {
			preservedCheckpoints.set(msg.ts, msg.checkpoint)
		}
	}

	// Delete the message and all subsequent messages using MessageManager
	if (rewindTs) {
		await currentCline.messageManager.rewindToTimestamp(rewindTs, { includeTargetMessage: false })
	}

	// Restore checkpoint associations for preserved messages
	for (const [ts, checkpoint] of preservedCheckpoints) {
		const msgIndex = currentCline.clineMessages.findIndex((msg) => msg.ts === ts)
		if (msgIndex !== -1) {
			currentCline.clineMessages[msgIndex].checkpoint = checkpoint
		}
	}

	// Save the updated messages with restored checkpoints
	await saveTaskMessages({
		messages: currentCline.clineMessages,
		taskId: currentCline.taskId,
		globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
	})

	// Update the UI to reflect the deletion
	await provider.postStateToWebview()
}

/**
 * Handles message deletion operations with user confirmation
 */
const handleDeleteOperation = async (ctx: HandlerContext, messageTs: number): Promise<void> => {
	const { provider } = ctx
	// Check if there's a checkpoint before this message
	const currentCline = provider.getCurrentTask()
	let hasCheckpoint = false

	if (!currentCline) {
		await vscode.window.showErrorMessage(t("common:errors.message.no_active_task_to_delete"))
		return
	}

	const { messageIndex } = findMessageIndices(messageTs, currentCline)

	if (messageIndex !== -1) {
		// Find the last checkpoint before this message
		hasCheckpoint = findNextCheckpoint(currentCline, messageTs) !== undefined
	}

	// Send message to webview to show delete confirmation dialog
	await provider.postMessageToWebview({
		type: "showDeleteMessageDialog",
		messageTs,
		hasCheckpoint,
	})
}

/**
 * Handles confirmed message deletion from webview dialog
 */
const handleDeleteMessageConfirm = async (
	ctx: HandlerContext,
	messageTs: number,
	restoreCheckpoint?: boolean,
): Promise<void> => {
	const { provider } = ctx
	const currentCline = provider.getCurrentTask()
	if (!currentCline) {
		console.error("[handleDeleteMessageConfirm] No current cline available")
		return
	}

	const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(messageTs, currentCline)
	// Determine API truncation index with timestamp fallback if exact match not found
	let apiIndexToUse = apiConversationHistoryIndex
	const tsThreshold = currentCline.clineMessages[messageIndex]?.ts
	if (apiIndexToUse === -1 && typeof tsThreshold === "number") {
		apiIndexToUse = findFirstApiIndexAtOrAfter(tsThreshold, currentCline)
	}

	if (messageIndex === -1) {
		await vscode.window.showErrorMessage(t("common:errors.message.message_not_found", { messageTs }))
		return
	}

	try {
		const targetMessage = currentCline.clineMessages[messageIndex]

		// If checkpoint restoration is requested, find and restore to the last checkpoint before this message
		if (restoreCheckpoint) {
			// Find the last checkpoint before this message
			const nextCheckpoint = findNextCheckpoint(currentCline, messageTs)

			if (nextCheckpoint && nextCheckpoint.text) {
				await handleCheckpointRestoreOperation({
					provider,
					currentCline,
					messageTs: targetMessage.ts!,
					messageIndex,
					checkpoint: { hash: nextCheckpoint.text },
					operation: "delete",
				})
			} else {
				// No checkpoint found before this message
				console.log("[handleDeleteMessageConfirm] No checkpoint found before message")
				vscode.window.showWarningMessage("No checkpoint found before this message")
			}
		} else {
			// For non-checkpoint deletes, preserve checkpoint associations for remaining messages.
			// targetMessage.ts equals the (non-zero) messageTs, so the rewind always runs.
			await rewindKeepingCheckpoints(ctx, currentCline, messageIndex, targetMessage.ts!)
		}
	} catch (error) {
		console.error("Error in delete message:", error)
		vscode.window.showErrorMessage(
			t("common:errors.message.error_deleting_message", {
				error: error instanceof Error ? error.message : String(error),
			}),
		)
	}
}

/**
 * Handles message editing operations with user confirmation
 */
const handleEditOperation = async (
	ctx: HandlerContext,
	messageTs: number,
	editedContent: string,
	images?: string[],
): Promise<void> => {
	const { provider } = ctx
	// Check if there's a checkpoint before this message
	const currentCline = provider.getCurrentTask()
	let hasCheckpoint = false
	if (currentCline) {
		const { messageIndex } = findMessageIndices(messageTs, currentCline)
		if (messageIndex !== -1) {
			// Find the last checkpoint before this message
			hasCheckpoint = findNextCheckpoint(currentCline, messageTs) !== undefined
		} else {
			console.log("[webviewMessageHandler] Edit - Message not found in clineMessages!")
		}
	} else {
		console.log("[webviewMessageHandler] Edit - No currentCline available!")
	}

	// Send message to webview to show edit confirmation dialog
	await provider.postMessageToWebview({
		type: "showEditMessageDialog",
		messageTs,
		text: editedContent,
		hasCheckpoint,
		images,
	})
}

/**
 * Handles confirmed message editing from webview dialog
 */
const handleEditMessageConfirm = async (
	ctx: HandlerContext,
	messageTs: number,
	editedContent: string,
	restoreCheckpoint?: boolean,
	images?: string[],
): Promise<void> => {
	const { provider } = ctx
	const currentCline = provider.getCurrentTask()
	if (!currentCline) {
		console.error("[handleEditMessageConfirm] No current cline available")
		return
	}

	// Use findMessageIndices to find messages based on timestamp
	const { messageIndex, apiConversationHistoryIndex } = findMessageIndices(messageTs, currentCline)

	if (messageIndex === -1) {
		const errorMessage = t("common:errors.message.message_not_found", { messageTs })
		console.error("[handleEditMessageConfirm]", errorMessage)
		await vscode.window.showErrorMessage(errorMessage)
		return
	}

	try {
		const targetMessage = currentCline.clineMessages[messageIndex]

		// If checkpoint restoration is requested, find and restore to the last checkpoint before this message
		if (restoreCheckpoint) {
			// Find the last checkpoint before this message
			const nextCheckpoint = findNextCheckpoint(currentCline, messageTs)

			if (nextCheckpoint && nextCheckpoint.text) {
				await handleCheckpointRestoreOperation({
					provider,
					currentCline,
					messageTs: targetMessage.ts!,
					messageIndex,
					checkpoint: { hash: nextCheckpoint.text },
					operation: "edit",
					editData: {
						editedContent,
						images,
						apiConversationHistoryIndex,
					},
				})
				// The task will be cancelled and reinitialized by checkpointRestore
				// The pending edit will be processed in the reinitialized task
				return
			} else {
				// No checkpoint found before this message
				console.log("[handleEditMessageConfirm] No checkpoint found before message")
				vscode.window.showWarningMessage("No checkpoint found before this message")
				// Continue with non-checkpoint edit
			}
		}

		// For non-checkpoint edits, remove the ORIGINAL user message being edited and all subsequent messages
		// Determine the correct starting index to delete from (prefer the last preceding user_feedback message)
		let deleteFromMessageIndex = messageIndex
		let deleteFromApiIndex = apiConversationHistoryIndex

		// Find the nearest preceding user message to ensure we replace the original, not just the assistant reply
		for (let i = messageIndex; i >= 0; i--) {
			const m = currentCline.clineMessages[i]
			if (m?.say === "user_feedback") {
				deleteFromMessageIndex = i
				// Align API history truncation to the same user message timestamp if present
				const userTs = m.ts
				if (typeof userTs === "number") {
					const apiIdx = currentCline.apiConversationHistory.findIndex((am: ApiMessage) => am.ts === userTs)
					if (apiIdx !== -1) {
						deleteFromApiIndex = apiIdx
					}
				}
				break
			}
		}

		// Timestamp fallback for API history when exact user message isn't present
		if (deleteFromApiIndex === -1) {
			const tsThresholdForEdit = currentCline.clineMessages[deleteFromMessageIndex]?.ts
			if (typeof tsThresholdForEdit === "number") {
				deleteFromApiIndex = findFirstApiIndexAtOrAfter(tsThresholdForEdit, currentCline)
			}
		}

		// Delete the original (user) message and all subsequent messages, keeping earlier checkpoints
		await rewindKeepingCheckpoints(
			ctx,
			currentCline,
			deleteFromMessageIndex,
			currentCline.clineMessages[deleteFromMessageIndex]?.ts,
		)

		await currentCline.submitUserMessage(editedContent, images)
	} catch (error) {
		console.error("Error in edit message:", error)
		vscode.window.showErrorMessage(
			t("common:errors.message.error_editing_message", {
				error: error instanceof Error ? error.message : String(error),
			}),
		)
	}
}

/**
 * Handles message modification operations (delete or edit) with confirmation dialog
 * @param messageTs Timestamp of the message to operate on
 * @param operation Type of operation ('delete' or 'edit')
 * @param editedContent New content for edit operations
 * @returns Promise<void>
 */
const handleMessageModificationsOperation = async (
	ctx: HandlerContext,
	messageTs: number,
	operation: "delete" | "edit",
	editedContent?: string,
	images?: string[],
): Promise<void> => {
	if (operation === "delete") {
		await handleDeleteOperation(ctx, messageTs)
	} else if (operation === "edit" && editedContent) {
		await handleEditOperation(ctx, messageTs, editedContent, images)
	}
}

export const messageEditsHandlers: MessageHandlerMap = {
	deleteMessage: async (ctx, message) => {
		const { provider } = ctx
		if (!provider.getCurrentTask()) {
			await vscode.window.showErrorMessage(t("common:errors.message.no_active_task_to_delete"))
			return
		}

		if (typeof message.value !== "number" || !message.value) {
			await vscode.window.showErrorMessage(t("common:errors.message.invalid_timestamp_for_deletion"))
			return
		}

		await handleMessageModificationsOperation(ctx, message.value, "delete")
	},

	submitEditedMessage: async (ctx, message) => {
		const { provider } = ctx
		if (
			provider.getCurrentTask() &&
			typeof message.value === "number" &&
			message.value &&
			message.editedMessageContent
		) {
			await handleMessageModificationsOperation(
				ctx,
				message.value,
				"edit",
				message.editedMessageContent,
				message.images,
			)
		}
	},

	deleteMessageConfirm: async (ctx, message) => {
		if (!message.messageTs) {
			await vscode.window.showErrorMessage(t("common:errors.message.cannot_delete_missing_timestamp"))
			return
		}

		if (typeof message.messageTs !== "number") {
			await vscode.window.showErrorMessage(t("common:errors.message.cannot_delete_invalid_timestamp"))
			return
		}

		await handleDeleteMessageConfirm(ctx, message.messageTs, message.restoreCheckpoint)
	},

	editMessageConfirm: async (ctx, message) => {
		if (message.messageTs && message.text) {
			const resolved = await resolveIncomingImages(ctx, { text: message.text, images: message.images })
			await handleEditMessageConfirm(
				ctx,
				message.messageTs,
				resolved.text,
				message.restoreCheckpoint,
				resolved.images,
			)
		}
	},
}
