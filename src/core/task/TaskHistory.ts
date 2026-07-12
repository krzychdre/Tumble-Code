import { Anthropic } from "@anthropic-ai/sdk"
import EventEmitter from "events"
import pWaitFor from "p-wait-for"

import {
	type ApiMessage,
	readApiMessages,
	readTaskMessages,
	saveApiMessages,
	saveTaskMessages,
	taskMetadata,
} from "../task-persistence"

import {
	type ClineMessage,
	type HistoryItem,
	RooCodeEventName,
	TelemetryEventName,
	type ProviderSettings,
	type TokenUsage,
	type ToolUsage,
	getModelId,
	getApiProtocol,
	isRetiredProvider,
} from "@roo-code/types"

import { CloudService } from "@roo-code/cloud"

import { type ApiHandler } from "../../api"

import { getEffectiveApiHistory } from "../condense"

import { validateAndFixToolResultIds } from "./validateToolResultIds"

import { defaultModeSlug } from "../../shared/modes"

import { type ClineProvider } from "../webview/ClineProvider"

import {
	type MessageContent,
	buildThinkingBlock,
	buildReasoningBlock,
	buildEncryptedReasoningBlock,
	buildThoughtSignatureBlock,
	insertBlockBeforeContent,
	insertBlockAfterContent,
	convertOrphanedToolResultsToText,
} from "./TaskHistory.helpers"

export interface TaskHistoryAccess {
	// Core identifiers
	taskId: string
	globalStoragePath: string

	// Mutable state arrays
	apiConversationHistory: ApiMessage[]
	clineMessages: ClineMessage[]

	// API handler access (for addToApiConversationHistory)
	api: ApiHandler
	apiConfiguration: ProviderSettings

	// Pending tool results state (for flushPendingToolResultsToHistory)
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[]
	assistantMessageSavedToHistory: boolean
	abort: boolean

	// Provider reference
	providerRef: WeakRef<ClineProvider>

	// Cloud sync tracking
	cloudSyncedMessageTimestamps: Set<number>

	// Task metadata (for saveClineMessages)
	rootTaskId: string | undefined
	parentTaskId: string | undefined
	taskNumber: number
	cwd: string
	_taskMode: string | undefined
	_taskApiConfigName: string | undefined
	taskApiConfigReady: Promise<void>
	initialStatus: "active" | "delegated" | "completed" | undefined

	// Token usage (for saveClineMessages)
	toolUsage: ToolUsage
	debouncedEmitTokenUsage: (tokenUsage: TokenUsage, toolUsage: ToolUsage) => void

	// Event emission
	emit: EventEmitter["emit"]

	// Callback for operations needing full Task context
	restoreTodoListForTask: () => void

	// Background tasks must not appear in or be resumable from task history.
	isBackground: boolean
}

export class TaskHistory {
	constructor(private readonly access: TaskHistoryAccess) {}

	// API Conversation History

	async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
		return readApiMessages({ taskId: this.access.taskId, globalStoragePath: this.access.globalStoragePath })
	}

	async addToApiConversationHistory(message: Anthropic.MessageParam, reasoning?: string) {
		const messageWithTs: ApiMessage =
			message.role === "assistant"
				? this.processAssistantMessage(message, reasoning)
				: this.processUserMessage(message)

		this.access.apiConversationHistory.push(messageWithTs)
		await this.saveApiConversationHistory()
	}

	/**
	 * Build the assistant message with reasoning/thinking/encrypted blocks
	 * and thought signature blocks inserted into the content array.
	 */
	private processAssistantMessage(message: Anthropic.MessageParam, reasoning?: string): ApiMessage {
		// Capture the encrypted_content / thought signatures from the provider
		// (e.g., OpenAI Responses API, Google GenAI) if present.
		const handler = this.access.api as ApiHandler & {
			getResponseId?: () => string | undefined
			getEncryptedContent?: () => { encrypted_content: string; id?: string } | undefined
			getThoughtSignature?: () => string | undefined
			getSummary?: () => any[] | undefined
			getReasoningDetails?: () => any[] | undefined
		}

		const responseId = handler.getResponseId?.()
		const reasoningData = handler.getEncryptedContent?.()
		const thoughtSignature = handler.getThoughtSignature?.()
		const reasoningSummary = handler.getSummary?.()
		const reasoningDetails = handler.getReasoningDetails?.()

		// Only Anthropic's API expects/validates the special `thinking` content block signature.
		// Other providers use different signature semantics and require round-tripping
		// the signature in their own format.
		const modelId = getModelId(this.access.apiConfiguration)
		const apiProvider = this.access.apiConfiguration.apiProvider
		const apiProtocol = getApiProtocol(
			apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
			modelId,
		)
		const isAnthropicProtocol = apiProtocol === "anthropic"

		// Start from the original assistant message
		const messageWithTs: any = {
			...message,
			...(responseId ? { id: responseId } : {}),
			ts: Date.now(),
		}

		// Store reasoning_details array if present (for models like Gemini 3)
		if (reasoningDetails) {
			messageWithTs.reasoning_details = reasoningDetails
		}

		// Store reasoning: Anthropic thinking (with signature), plain text (most providers),
		// or encrypted (OpenAI Native). Skip if reasoning_details already contains the reasoning
		// (to avoid duplication).
		let content: MessageContent = messageWithTs.content

		if (isAnthropicProtocol && reasoning && thoughtSignature && !reasoningDetails) {
			// Anthropic provider with extended thinking: Store as proper `thinking` block.
			// This format passes through anthropic-filter.ts and is properly round-tripped
			// for interleaved thinking with tool use (required by Anthropic API).
			content = insertBlockBeforeContent(buildThinkingBlock(reasoning, thoughtSignature), content)
		} else if (reasoning && !reasoningDetails) {
			// Other providers (non-Anthropic): Store as generic reasoning block.
			content = insertBlockBeforeContent(
				buildReasoningBlock(reasoning, reasoningSummary ?? ([] as any[])),
				content,
			)
		} else if (reasoningData?.encrypted_content) {
			// OpenAI Native encrypted reasoning
			content = insertBlockBeforeContent(
				buildEncryptedReasoningBlock(reasoningData.encrypted_content, reasoningData.id),
				content,
			)
		}

		// For non-Anthropic providers (e.g., Gemini 3), persist the thought signature as its own
		// content block so converters can attach it back to the correct provider-specific fields.
		// Note: For Anthropic extended thinking, the signature is already included in the thinking block above.
		if (thoughtSignature && !isAnthropicProtocol) {
			content = insertBlockAfterContent(buildThoughtSignatureBlock(thoughtSignature), content)
		}

		messageWithTs.content = content
		return messageWithTs as ApiMessage
	}

	/**
	 * Build the user message, validating tool_result IDs and converting
	 * orphaned tool_results to text content when the previous effective
	 * message is not an assistant message.
	 */
	private processUserMessage(message: Anthropic.MessageParam): ApiMessage {
		// For user messages, validate tool_result IDs ONLY when the immediately previous *effective*
		// message is an assistant message.
		//
		// If the previous effective message is also a user message (e.g., summary + a new user message),
		// validating against any earlier assistant message can incorrectly inject placeholder tool_results.
		const effectiveHistoryForValidation = getEffectiveApiHistory(this.access.apiConversationHistory)
		const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
		const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []

		// If the previous effective message is NOT an assistant, convert tool_result blocks to text blocks.
		// This prevents orphaned tool_results from being filtered out by getEffectiveApiHistory.
		// This can happen when condensing occurs after the assistant sends tool_uses but before
		// the user responds - the tool_use blocks get condensed away, leaving orphaned tool_results.
		const messageToAdd = convertOrphanedToolResultsToText(message, lastEffective?.role)

		const validatedMessage = validateAndFixToolResultIds(messageToAdd, historyForValidation)
		return { ...validatedMessage, ts: Date.now() }
	}

	async overwriteApiConversationHistory(newHistory: ApiMessage[]) {
		this.access.apiConversationHistory = newHistory
		await this.saveApiConversationHistory()
	}

	/**
	 * Flush any pending tool results to the API conversation history.
	 *
	 * This is critical when the task is about to be
	 * delegated (e.g., via new_task). Before delegation, if other tools were
	 * called in the same turn before new_task, their tool_result blocks are
	 * accumulated in `userMessageContent` but haven't been saved to the API
	 * history yet. If we don't flush them before the parent is disposed,
	 * the API conversation will be incomplete and cause 400 errors when
	 * the parent resumes (missing tool_result for tool_use blocks).
	 *
	 * NOTE: The assistant message is typically already in history by the time
	 * tools execute (added in recursivelyMakeClineRequests after streaming completes).
	 * So we usually only need to flush the pending user message with tool_results.
	 */
	async flushPendingToolResultsToHistory(): Promise<boolean> {
		// Only flush if there's actually pending content to save
		if (this.access.userMessageContent.length === 0) {
			return true
		}

		await this.waitForAssistantMessage()

		// If task was aborted while waiting, don't flush
		if (this.access.abort) {
			return false
		}

		const userMessage = this.buildUserMessageWithToolResults()
		if (!userMessage) {
			return true
		}

		this.access.apiConversationHistory.push(userMessage as ApiMessage)

		const saved = await this.saveApiConversationHistory()

		if (saved) {
			// Clear the pending content since it's now saved
			this.access.userMessageContent = []
		} else {
			this.handleFlushFailure()
		}

		return saved
	}

	/**
	 * Wait for the assistant message to be saved to API history first.
	 * Without this, tool_result blocks would appear BEFORE tool_use blocks in the
	 * conversation history, causing API errors like:
	 * "unexpected `tool_use_id` found in `tool_result` blocks"
	 */
	private async waitForAssistantMessage(): Promise<void> {
		if (this.access.assistantMessageSavedToHistory) {
			return
		}

		await pWaitFor(() => this.access.assistantMessageSavedToHistory || this.access.abort, {
			interval: 50,
			timeout: 30_000, // 30 second timeout as safety net
		}).catch(() => {
			// If timeout or abort, log and proceed anyway to avoid hanging
			console.warn(
				`[Task#${this.access.taskId}] flushPendingToolResultsToHistory: timed out waiting for assistant message to be saved`,
			)
		})
	}

	/**
	 * Construct the user message from pending tool results, validating
	 * tool_result IDs against the effective API history.
	 * Returns null if there are no pending results to build from.
	 */
	private buildUserMessageWithToolResults(): (Anthropic.MessageParam & { ts: number }) | null {
		// Re-check in case content was cleared while waiting
		if (this.access.userMessageContent.length === 0) {
			return null
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: this.access.userMessageContent,
		}

		// Validate and fix tool_result IDs when the previous *effective* message is an assistant message.
		const effectiveHistoryForValidation = getEffectiveApiHistory(this.access.apiConversationHistory)
		const lastEffective = effectiveHistoryForValidation[effectiveHistoryForValidation.length - 1]
		const historyForValidation = lastEffective?.role === "assistant" ? effectiveHistoryForValidation : []
		const validatedMessage = validateAndFixToolResultIds(userMessage, historyForValidation)

		return { ...validatedMessage, ts: Date.now() }
	}

	/**
	 * Handle a save failure during flush: retain pending content in memory
	 * and log a warning.
	 */
	private handleFlushFailure(): void {
		console.warn(
			`[Task#${this.access.taskId}] flushPendingToolResultsToHistory: save failed, retaining pending tool results in memory`,
		)
	}

	async saveApiConversationHistory(): Promise<boolean> {
		try {
			await saveApiMessages({
				messages: structuredClone(this.access.apiConversationHistory),
				taskId: this.access.taskId,
				globalStoragePath: this.access.globalStoragePath,
			})
			return true
		} catch (error) {
			console.error("Failed to save API conversation history:", error)
			return false
		}
	}

	/**
	 * Public wrapper to retry saving the API conversation history.
	 * Uses exponential backoff: up to 3 attempts with delays of 100 ms, 500 ms, 1500 ms.
	 * Used by delegation flow when flushPendingToolResultsToHistory reports failure.
	 */
	async retrySaveApiConversationHistory(): Promise<boolean> {
		const delays = [100, 500, 1500]

		for (let attempt = 0; attempt < delays.length; attempt++) {
			await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]))
			console.warn(
				`[Task#${this.access.taskId}] retrySaveApiConversationHistory: retry attempt ${attempt + 1}/${delays.length}`,
			)

			const success = await this.saveApiConversationHistory()

			if (success) {
				return true
			}
		}

		return false
	}

	// Cline Messages

	async getSavedClineMessages(): Promise<ClineMessage[]> {
		return readTaskMessages({ taskId: this.access.taskId, globalStoragePath: this.access.globalStoragePath })
	}

	async addToClineMessages(message: ClineMessage) {
		this.access.clineMessages.push(message)
		const provider = this.access.providerRef.deref()
		if (!this.access.isBackground) {
			// Avoid resending large, mostly-static fields (notably taskHistory) on every chat message update.
			// taskHistory is maintained in-memory in the webview and updated via taskHistoryItemUpdated.
			await provider?.postStateToWebviewWithoutTaskHistory()
		} else if (provider?.subagentRegistry.isWatched(this.access.taskId)) {
			// A background task's messages never ride the state push (state
			// carries only the CURRENT task's messages). Stream new messages
			// to a subscribed subagent tail instead; unwatched background
			// tasks post nothing.
			await provider.postMessageToWebview({
				type: "messageUpdated",
				sourceTaskId: this.access.taskId,
				clineMessage: message,
			})
		}
		this.access.emit(RooCodeEventName.Message, { action: "created", message })
		await this.saveClineMessages()

		const shouldCaptureMessage = message.partial !== true && CloudService.isEnabled()

		if (shouldCaptureMessage) {
			CloudService.instance.captureEvent({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: { taskId: this.access.taskId, message },
			})
			// Track that this message has been synced to cloud
			this.access.cloudSyncedMessageTimestamps.add(message.ts)
		}
	}

	async overwriteClineMessages(newMessages: ClineMessage[]) {
		this.access.clineMessages = newMessages
		this.access.restoreTodoListForTask()

		// Push the new message set to the webview *before* persisting. On task
		// resume the chat view depends on this state push to render the loaded
		// conversation; without it the user only ever sees the trailing
		// resume_task ask added later by ask(), and tab-switching to chat shows
		// an empty (or stale) message list.
		await this.access.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()

		await this.saveClineMessages()

		// When overwriting messages (e.g., during task resume), repopulate the cloud sync tracking Set
		// with timestamps from all non-partial messages to prevent re-syncing previously synced messages
		this.access.cloudSyncedMessageTimestamps.clear()
		for (const msg of newMessages) {
			if (msg.partial !== true) {
				this.access.cloudSyncedMessageTimestamps.add(msg.ts)
			}
		}
	}

	async updateClineMessage(message: ClineMessage) {
		const provider = this.access.providerRef.deref()
		// Tag every update with its source task so the webview can route it:
		// current task → main chat, watched subagent → its live tail. Unwatched
		// background tasks post nothing (previously their updates leaked to the
		// webview and were dropped there by timestamp mismatch).
		if (!this.access.isBackground || provider?.subagentRegistry.isWatched(this.access.taskId)) {
			await provider?.postMessageToWebview({
				type: "messageUpdated",
				sourceTaskId: this.access.taskId,
				clineMessage: message,
			})
		}
		this.access.emit(RooCodeEventName.Message, { action: "updated", message })

		// Check if we should sync to cloud and haven't already synced this message
		const shouldCaptureMessage = message.partial !== true && CloudService.isEnabled()
		const hasNotBeenSynced = !this.access.cloudSyncedMessageTimestamps.has(message.ts)

		if (shouldCaptureMessage && hasNotBeenSynced) {
			CloudService.instance.captureEvent({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: { taskId: this.access.taskId, message },
			})
			// Track that this message has been synced to cloud
			this.access.cloudSyncedMessageTimestamps.add(message.ts)
		}
	}

	async saveClineMessages(): Promise<boolean> {
		try {
			// Guard: if the in-memory array is empty but the on-disk file already
			// holds messages, persisting now would wipe a real conversation and
			// poison the history-item title with "No messages". This can happen
			// when abortTask fires during the brief window where startTask has
			// reset clineMessages but the first say() has not yet replenished it,
			// or when a provider error tears the task down before reconstruction.
			if (this.access.clineMessages.length === 0) {
				const persisted = await readTaskMessages({
					taskId: this.access.taskId,
					globalStoragePath: this.access.globalStoragePath,
				})
				if (persisted.length > 0) {
					return true
				}
			}

			await saveTaskMessages({
				messages: structuredClone(this.access.clineMessages),
				taskId: this.access.taskId,
				globalStoragePath: this.access.globalStoragePath,
			})

			const historyItem = await this.emitTokenUsageUpdate()
			if (!this.access.isBackground) {
				await this.updateProviderTaskHistory(historyItem)
			}

			return true
		} catch (error) {
			console.error("Failed to save Roo messages:", error)
			return false
		}
	}

	/**
	 * Compute and emit token/tool usage updates using the debounced function.
	 * Awaits taskApiConfigReady if the API config name is not yet set,
	 * then computes taskMetadata and calls debouncedEmitTokenUsage.
	 * Returns the historyItem for the provider to update its task history.
	 */
	private async emitTokenUsageUpdate(): Promise<HistoryItem> {
		if (this.access._taskApiConfigName === undefined) {
			await this.access.taskApiConfigReady
		}

		const { historyItem, tokenUsage } = await taskMetadata({
			taskId: this.access.taskId,
			rootTaskId: this.access.rootTaskId,
			parentTaskId: this.access.parentTaskId,
			taskNumber: this.access.taskNumber,
			messages: this.access.clineMessages,
			globalStoragePath: this.access.globalStoragePath,
			workspace: this.access.cwd,
			mode: this.access._taskMode || defaultModeSlug, // Use the task's own mode, not the current provider mode.
			apiConfigName: this.access._taskApiConfigName, // Use the task's own provider profile, not the current provider profile.
			initialStatus: this.access.initialStatus,
		})

		// Emit token/tool usage updates using debounced function
		// The debounce with maxWait ensures:
		// - Immediate first emit (leading: true)
		// - At most one emit per interval during rapid updates (maxWait)
		// - Final state is emitted when updates stop (trailing: true)
		this.access.debouncedEmitTokenUsage(tokenUsage, this.access.toolUsage)

		return historyItem
	}

	/**
	 * Update the provider's task history by pushing the latest history item.
	 */
	private async updateProviderTaskHistory(historyItem: HistoryItem): Promise<void> {
		await this.access.providerRef.deref()?.updateTaskHistory(historyItem)
	}

	findMessageByTimestamp(ts: number): ClineMessage | undefined {
		for (let i = this.access.clineMessages.length - 1; i >= 0; i--) {
			if (this.access.clineMessages[i].ts === ts) {
				return this.access.clineMessages[i]
			}
		}

		return undefined
	}
}
