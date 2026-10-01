import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect } from "react-use"

import type { AudioType, ClineAsk, ClineMessage, ClineSayTool, HistoryItem } from "@roo-code/types"

import { findLast } from "@roo-code/core/browser"

import { isTaskBusy as deriveTaskBusy } from "./taskBusy"

type Translate = (key: string) => string

/**
 * What an approval button does, independent of its translated label (§2.6):
 * the tooltip (and any shortcut hint) is picked from this kind via a lookup
 * table, not by comparing translated strings.
 */
export type AskButtonKind =
	| "retry"
	| "startNewTask"
	| "proceedAnyways"
	| "save"
	| "reject"
	| "approve"
	| "read-batch.approve"
	| "read-batch.deny"
	| "list-batch.approve"
	| "list-batch.deny"
	| "edit-batch.approve"
	| "edit-batch.deny"
	| "runCommand"
	| "proceedWhileRunning"
	| "killCommand"
	| "resumeTask"
	| "terminate"
	| "completeSubtaskAndReturn"

interface AskButtonsOptions {
	messages: ClineMessage[]
	/** `messages` without the task message, with API requests and command sequences combined. */
	modifiedMessages: ClineMessage[]
	currentTaskItem: HistoryItem | undefined
	messageQueueLength: number
	playSound: (audioType: AudioType) => void
	t: Translate
}

const hasCompletionResult = (messages: ClineMessage[]) =>
	messages.some((msg) => msg.ask === "completion_result" || msg.say === "completion_result")

/**
 * The ask state machine: the last message decides which ask the extension is
 * waiting for (`clineAsk`), the two approval button texts (plus their kinds,
 * which drive tooltips), whether they are enabled, and whether the text area
 * may send.
 */
export function useAskButtons({
	messages,
	modifiedMessages,
	currentTaskItem,
	messageQueueLength,
	playSound,
	t,
}: AskButtonsOptions) {
	const [sendingDisabled, setSendingDisabled] = useState(false)
	// We need to hold on to the ask because useEffect > lastMessage will always
	// let us know when an ask comes in and handle it, but by the time
	// handleMessage is called, the last message might not be the ask anymore
	// (it could be a say that followed).
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [primaryButtonKind, setPrimaryButtonKind] = useState<AskButtonKind | undefined>(undefined)
	const [secondaryButtonKind, setSecondaryButtonKind] = useState<AskButtonKind | undefined>(undefined)

	// Text and kind always change together (§2.6).
	const setPrimaryButton = useCallback(
		(kind: AskButtonKind | undefined, textKey: string | undefined) => {
			setPrimaryButtonText(textKey === undefined ? undefined : t(textKey))
			setPrimaryButtonKind(kind)
		},
		[t],
	)
	const setSecondaryButton = useCallback(
		(kind: AskButtonKind | undefined, textKey: string | undefined) => {
			setSecondaryButtonText(textKey === undefined ? undefined : t(textKey))
			setSecondaryButtonKind(kind)
		},
		[t],
	)

	const clineAskRef = useRef(clineAsk)
	useEffect(() => {
		clineAskRef.current = clineAsk
	}, [clineAsk])

	// UI layout depends on the last 2 messages (since it relies on the content
	// of these messages, we are deep comparing) i.e. the button state after
	// hitting button sets enableButtons to false,  and this effect otherwise
	// would have to true again even if messages didn't change.
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	// Suppresses the celebration sound when a completed task is reopened from
	// history. Rehydration replaces clineMessages with the saved conversation,
	// whose last message is the original completion_result ask, so the
	// useDeepCompareEffect below would otherwise replay the celebration sound
	// on every rehydration. We track the task id and last-message ts observed
	// on the PREVIOUS effect run: a completion_result is only "new" when the
	// task didn't just switch AND the last-message ts advanced (i.e. messages
	// genuinely progressed within the same task, rather than being loaded
	// wholesale from history).
	const prevTaskIdRef = useRef<string | undefined>(undefined)
	const prevLastMessageTsRef = useRef<number | undefined>(undefined)

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			// Track whether this effect run is a continuation of the same task
			// (task id unchanged from the previous run) and whether the last
			// message advanced. Used below to distinguish a genuinely new
			// completion_result from one loaded wholesale by rehydration.
			const taskId = currentTaskItem?.id
			const taskJustSwitched = taskId !== prevTaskIdRef.current
			const lastMessageAdvanced = lastMessage.ts !== prevLastMessageTsRef.current
			prevTaskIdRef.current = taskId
			prevLastMessageTsRef.current = lastMessage.ts
			const isPartial = lastMessage.partial === true

			switch (lastMessage.type) {
				case "ask":
					// Skip button setup when the ask was already resolved by the backend
					// before the state snapshot reached the webview. isAnswered:true is
					// stamped on the message atomically with addToClineMessages, so the
					// webview never needs to show -- and then clear -- approval buttons.
					if (lastMessage.isAnswered) {
						break
					}
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButton("retry", "chat:retry.title")
							setSecondaryButton("startNewTask", "chat:startNewTask.title")
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButton("proceedAnyways", "chat:proceedAnyways.title")
							setSecondaryButton("startNewTask", "chat:startNewTask.title")
							break
						case "followup":
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButton(undefined, undefined)
							setSecondaryButton(undefined, undefined)
							break
						case "tool": {
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
									if (tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
										setPrimaryButton("edit-batch.approve", "chat:edit-batch.approve.title")
										setSecondaryButton("edit-batch.deny", "chat:edit-batch.deny.title")
									} else {
										setPrimaryButton("save", "chat:save.title")
										setSecondaryButton("reject", "chat:reject.title")
									}
									break
								case "generateImage":
									setPrimaryButton("save", "chat:save.title")
									setSecondaryButton("reject", "chat:reject.title")
									break
								case "finishTask":
									setPrimaryButton("completeSubtaskAndReturn", "chat:completeSubtaskAndReturn")
									setSecondaryButton(undefined, undefined)
									break
								case "readFile":
									if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
										setPrimaryButton("read-batch.approve", "chat:read-batch.approve.title")
										setSecondaryButton("read-batch.deny", "chat:read-batch.deny.title")
									} else {
										setPrimaryButton("approve", "chat:approve.title")
										setSecondaryButton("reject", "chat:reject.title")
									}
									break
								case "listFilesTopLevel":
								case "listFilesRecursive":
									if (tool.batchDirs && Array.isArray(tool.batchDirs)) {
										setPrimaryButton("list-batch.approve", "chat:list-batch.approve.title")
										setSecondaryButton("list-batch.deny", "chat:list-batch.deny.title")
									} else {
										setPrimaryButton("approve", "chat:approve.title")
										setSecondaryButton("reject", "chat:reject.title")
									}
									break
								default:
									setPrimaryButton("approve", "chat:approve.title")
									setSecondaryButton("reject", "chat:reject.title")
									break
							}
							break
						}
						case "command":
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButton("runCommand", "chat:runCommand.title")
							setSecondaryButton("reject", "chat:reject.title")
							break
						case "command_output":
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButton("proceedWhileRunning", "chat:proceedWhileRunning.title")
							setSecondaryButton("killCommand", "chat:killCommand.title")
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButton("approve", "chat:approve.title")
							setSecondaryButton("reject", "chat:reject.title")
							break
						case "completion_result": {
							// Extension waiting for feedback, but we can just present a new task button.
							// Only play the celebration sound when this completion_result is genuinely
							// new: the task did not just switch (we were already observing it) AND the
							// last-message ts advanced within that task (messages progressed rather
							// than being loaded wholesale from history). When a completed task is
							// reopened from history, its saved clineMessages already end in the
							// original completion_result ask; either the task id changes (different
							// task) or the messages are replaced in one shot (ts jumps from the
							// previous task's last message to the reopened task's completion_result),
							// so taskJustSwitched || !lastMessageAdvanced covers both rehydration
							// shapes and suppresses the spurious sound.
							const isNewCompletion = !taskJustSwitched && lastMessageAdvanced
							if (!isPartial && messageQueueLength === 0 && isNewCompletion) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButton("startNewTask", "chat:startNewTask.title")
							setSecondaryButton(undefined, undefined)
							break
						}
						case "resume_task":
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							// For completed subtasks, show "Start New Task" instead of "Resume"
							// A subtask is considered completed if:
							// - It has a parentTaskId AND
							// - Its messages contain a completion_result (either ask or say)
							if (currentTaskItem?.parentTaskId && hasCompletionResult(messages)) {
								setPrimaryButton("startNewTask", "chat:startNewTask.title")
								setSecondaryButton(undefined, undefined)
							} else {
								setPrimaryButton("resumeTask", "chat:resumeTask.title")
								setSecondaryButton("terminate", "chat:terminate.title")
							}
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButton("startNewTask", "chat:startNewTask.title")
							setSecondaryButton(undefined, undefined)
							break
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
						case "api_req_rate_limit_wait":
							setSendingDisabled(true)
							break
						case "api_req_started":
							// Clear button state when a new API request starts
							// This fixes buttons persisting when the task continues
							setSendingDisabled(true)
							// Note: Do NOT clear selectedImages here. This handler fires
							// every time the backend starts an API call, which would wipe
							// images the user has pasted while the chat is in progress.
							// Images are already cleared in the appropriate user-action
							// handlers (handleSendMessage, handlePrimaryButtonClick, etc.).
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButton(undefined, undefined)
							setSecondaryButton(undefined, undefined)
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
	useEffect(() => {
		if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
			if (hasCompletionResult(messages)) {
				setPrimaryButton("startNewTask", "chat:startNewTask.title")
				setSecondaryButton(undefined, undefined)
			}
		}
	}, [clineAsk, currentTaskItem?.parentTaskId, messages, setPrimaryButton, setSecondaryButton])

	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButton(undefined, undefined)
			setSecondaryButton(undefined, undefined)
		}
	}, [messages.length, setPrimaryButton, setSecondaryButton])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(
				modifiedMessages,
				(message: ClineMessage) => message.say === "api_req_started",
			)

			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	// ts of the ask the user answered from this view (an approval button or a
	// typed reply). Until the host sends the next message that ask is still
	// the last one, yet the task is already working again, so it must not
	// read as "waiting on the user".
	const [answeredAskTs, setAnsweredAskTs] = useState<number | undefined>(undefined)
	const lastMessageRef = useRef(lastMessage)
	useEffect(() => {
		lastMessageRef.current = lastMessage
	}, [lastMessage])

	const markLastAskAnswered = useCallback(() => {
		const last = lastMessageRef.current
		if (last?.type === "ask") {
			setAnsweredAskTs(last.ts)
		}
	}, [])

	// The composer's stop button follows this, not isStreaming: a running
	// command, an MCP call or a retry countdown is work the user may stop too.
	const isTaskBusy = useMemo(
		() => deriveTaskBusy(lastMessage, isStreaming, answeredAskTs),
		[lastMessage, isStreaming, answeredAskTs],
	)

	// Resets the approval button UI to its hidden/disabled state after the
	// user answered through a button (or the host invoked one).
	const clearApprovalButtons = useCallback(() => {
		markLastAskAnswered()
		setSendingDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		setPrimaryButton(undefined, undefined)
		setSecondaryButton(undefined, undefined)
	}, [markLastAskAnswered, setPrimaryButton, setSecondaryButton])

	return {
		clineAsk,
		clineAskRef,
		setClineAsk,
		enableButtons,
		setEnableButtons,
		primaryButtonText,
		primaryButtonKind,
		secondaryButtonText,
		secondaryButtonKind,
		sendingDisabled,
		setSendingDisabled,
		isStreaming,
		isTaskBusy,
		markLastAskAnswered,
		clearApprovalButtons,
	}
}
