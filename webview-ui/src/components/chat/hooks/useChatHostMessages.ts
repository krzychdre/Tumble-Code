import type React from "react"
import { useCallback, useEffect, useState } from "react"

import type { AudioType, ClineMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { appendImages } from "@src/utils/imageUtils"
import { useExtensionMessage, type ExtensionMessageOf } from "@src/utils/extensionBus"
import { vscode } from "@src/utils/vscode"

import type { useAskButtons } from "./useAskButtons"
import type { useChatComposer } from "./useChatComposer"

export const MAX_IMAGES_PER_MESSAGE = 20 // This is the Anthropic limit.

// The host messages ChatView handles; the bus delivers only these.
const CHAT_VIEW_MESSAGE_TYPES = [
	"action",
	"selectedImages",
	"invoke",
	"condenseTaskContextStarted",
	"condenseTaskContextResponse",
	"checkpointInitWarning",
	"interactionRequired",
	"taskCompletedOffScreen",
	"taskWithAggregatedCosts",
] as const

type ChatViewMessage = ExtensionMessageOf<(typeof CHAT_VIEW_MESSAGE_TYPES)[number]>

type CheckpointWarningState = { type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number }

type AggregatedCosts = { totalCost: number; ownCost: number; childrenCost: number }

interface ChatHostMessagesOptions {
	ask: ReturnType<typeof useAskButtons>
	composer: ReturnType<typeof useChatComposer>
	isHidden: boolean
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
	playSound: (audioType: AudioType) => void
	/** The task message (the first message); a new object on every state push. */
	task: ClineMessage | undefined
	currentTaskItem: HistoryItem | undefined
	/** The live parallel subagents (all tasks); their costs move the aggregate of the task that fanned out. */
	subagents: SubagentSummary[] | undefined
	/** Inputs of the "clear the checkpoint warning" effect. */
	modifiedMessagesLength: number
}

/**
 * The messages the extension host sends to the chat (invoke, focus, picked
 * images, context condensing, checkpoint warnings, sounds, subtask costs) and
 * the state only they drive.
 */
export function useChatHostMessages({
	ask,
	composer,
	isHidden,
	textAreaRef,
	playSound,
	task,
	currentTaskItem,
	subagents,
	modifiedMessagesLength,
}: ChatHostMessagesOptions) {
	const { sendingDisabled, setSendingDisabled, enableButtons, isStreaming } = ask
	const {
		setSelectedImages,
		handleChatReset,
		handleSendMessage,
		handleSetChatBoxMessage,
		handlePrimaryButtonClick,
		handleSecondaryButtonClick,
	} = composer

	const [isCondensing, setIsCondensing] = useState<boolean>(false)
	const [checkpointWarning, setCheckpointWarning] = useState<CheckpointWarningState | undefined>(undefined)
	const [aggregatedCostsMap, setAggregatedCostsMap] = useState<Map<string, AggregatedCosts>>(new Map())

	const taskTs = task?.ts

	// A task switch ends any condensing shown for the previous task.
	useEffect(() => {
		setIsCondensing(false)
	}, [taskTs])

	// Request aggregated costs when the task changes and has subtasks or
	// parallel subagents. While its subagents run, their costs and statuses
	// change without the task item changing: the key re-requests then.
	const currentTaskId = currentTaskItem?.id
	const currentTaskChildIds = currentTaskItem?.childIds
	const currentTaskParallelChildIds = currentTaskItem?.parallelChildIds
	const subagentsKey = (subagents ?? [])
		.filter((subagent) => subagent.parentTaskId === currentTaskId)
		.map((subagent) => `${subagent.taskId}:${subagent.status}:${subagent.totalCost}`)
		.join("|")
	useEffect(() => {
		if (taskTs && (currentTaskChildIds?.length || currentTaskParallelChildIds?.length || subagentsKey)) {
			vscode.postMessage({
				type: "getTaskWithAggregatedCosts",
				text: currentTaskId,
			})
		}
	}, [taskTs, currentTaskId, currentTaskChildIds, currentTaskParallelChildIds, subagentsKey])

	const handleMessage = (message: ChatViewMessage) => {
		switch (message.type) {
			case "action":
				switch (message.action!) {
					case "didBecomeVisible":
						if (!isHidden && !sendingDisabled && !enableButtons) {
							textAreaRef.current?.focus()
						}
						break
					case "focusInput":
						textAreaRef.current?.focus()
						break
				}
				break
			case "selectedImages":
				// Only handle selectedImages if it's not for editing context
				// When context is "edit", ChatRow will handle the images
				if (message.context !== "edit") {
					setSelectedImages((prevImages: string[]) =>
						appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
					)
				}
				break
			case "invoke":
				switch (message.invoke!) {
					case "newChat":
						handleChatReset()
						break
					case "sendMessage":
						handleSendMessage(message.text ?? "", message.images ?? [])
						break
					case "setChatBoxMessage":
						handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
						break
					case "primaryButtonClick":
						handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
						break
					case "secondaryButtonClick":
						handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
						break
				}
				break
			case "condenseTaskContextStarted":
				// Handle both manual and automatic condensation start
				// We don't check the task ID because:
				// 1. There can only be one active task at a time
				// 2. Task switching resets isCondensing to false (see the taskTs effect above)
				// 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
				if (message.text) {
					setIsCondensing(true)
					// Note: sendingDisabled is only set for manual condensation via handleCondenseContext
					// Automatic condensation doesn't disable sending since the task is already running
				}
				break
			case "condenseTaskContextResponse":
				// Same reasoning as above - we trust this is for the current task
				if (message.text) {
					if (isCondensing && sendingDisabled) {
						setSendingDisabled(false)
					}
					setIsCondensing(false)
				}
				break
			case "checkpointInitWarning":
				setCheckpointWarning(message.checkpointWarning)
				break
			case "interactionRequired":
				playSound("notification")
				break
			case "taskCompletedOffScreen":
				// A task the user left finished; its completion ask never reaches this view.
				playSound("celebration")
				break
			case "taskWithAggregatedCosts":
				if (message.text && message.aggregatedCosts) {
					const taskId = message.text
					const costs = message.aggregatedCosts
					setAggregatedCostsMap((prev) => {
						const newMap = new Map(prev)
						newMap.set(taskId, costs)
						return newMap
					})
				}
				break
		}
	}

	useExtensionMessage(CHAT_VIEW_MESSAGE_TYPES, handleMessage)

	// Effect to clear checkpoint warning when messages appear or task changes
	useEffect(() => {
		if (isHidden || !task) {
			setCheckpointWarning(undefined)
		}
	}, [modifiedMessagesLength, isStreaming, isHidden, task])

	// The header's "condense context" button. Stable identity while tokens
	// stream (P1): the two flags only change on condense/send boundaries, so
	// memoizing on them keeps the identity stable across streamed tokens.
	const handleCondenseContext = useCallback(
		(taskId: string) => {
			if (isCondensing || sendingDisabled) {
				return
			}
			setIsCondensing(true)
			setSendingDisabled(true)
			vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId })
		},
		[isCondensing, sendingDisabled, setSendingDisabled],
	)

	return { isCondensing, checkpointWarning, aggregatedCostsMap, handleCondenseContext }
}
