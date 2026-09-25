import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ClineMessage, ProviderNameWithRetired, SuggestionItem } from "@roo-code/types"
import { hasUsableAnswer, isRetiredProvider, isTextResponseAsk, suggestionModeToSwitch } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import type { useAskButtons } from "./useAskButtons"

type AskButtons = ReturnType<typeof useAskButtons>

interface ChatComposerOptions {
	ask: AskButtons
	messages: ClineMessage[]
	taskTs: number | undefined
	apiProvider: ProviderNameWithRetired | undefined
	parentTaskId: string | undefined
	messageQueueLength: number
	isProfileDisabled: boolean
	alwaysAllowModeSwitch: boolean | undefined
	clearSubagents: () => void
	switchToMode: (modeSlug: string) => void
}

const hasCompletionResult = (messages: ClineMessage[]) =>
	messages.some((msg) => msg.ask === "completion_result" || msg.say === "completion_result")

/**
 * The text area's content (text and images) and everything that sends it:
 * a new task, an answer to the pending ask, a queued message, the approval
 * buttons, a follow-up suggestion, and the Enter shortcut (`acceptInput`).
 */
export function useChatComposer({
	ask,
	messages,
	taskTs,
	apiProvider,
	parentTaskId,
	messageQueueLength,
	isProfileDisabled,
	alwaysAllowModeSwitch,
	clearSubagents,
	switchToMode,
}: ChatComposerOptions) {
	const {
		clineAsk,
		clineAskRef,
		setClineAsk,
		enableButtons,
		setEnableButtons,
		primaryButtonText,
		sendingDisabled,
		setSendingDisabled,
		isStreaming,
		clearApprovalButtons,
	} = ask

	const [inputValue, setInputValue] = useState("")
	const inputValueRef = useRef(inputValue)
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(null)
	// Show a WarningRow when the user sends a message with a retired provider.
	const [showRetiredProviderWarning, setShowRetiredProviderWarning] = useState(false)

	// When the provider changes, clear the retired-provider warning.
	useEffect(() => {
		setShowRetiredProviderWarning(false)
	}, [apiProvider])

	const messagesRef = useRef(messages)
	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Keep inputValueRef in sync with inputValue state
	useEffect(() => {
		inputValueRef.current = inputValue
	}, [inputValue])

	// A new task has no answered follow-up yet.
	useEffect(() => {
		setCurrentFollowUpTs(null)
	}, [taskTs])

	// Compute whether auto-approval is paused (user is typing in a followup)
	const isFollowUpAutoApprovalPaused = useMemo(() => {
		return !!(inputValue && inputValue.trim().length > 0 && clineAsk === "followup")
	}, [inputValue, clineAsk])

	// Cancel auto-approval timeout when user starts typing
	useEffect(() => {
		// Only send cancel if there's actual input (user is typing)
		// and we have a pending follow-up question
		if (isFollowUpAutoApprovalPaused) {
			vscode.postMessage({ type: "cancelAutoApproval" })
		}
	}, [isFollowUpAutoApprovalPaused])

	const markFollowUpAsAnswered = useCallback(() => {
		const lastFollowUpMessage = messagesRef.current.findLast((msg: ClineMessage) => msg.ask === "followup")
		if (lastFollowUpMessage) {
			setCurrentFollowUpTs(lastFollowUpMessage.ts)
		}
	}, [])

	const handleChatReset = useCallback(() => {
		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setSendingDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.

		// Belt-and-suspenders: subagents belong to a specific task. The
		// backend's `subagentsUpdated: []` broadcast on task reset already
		// drives this via the message handler, but an explicit clear protects
		// against any future path that forgets to broadcast, so a new task
		// never inherits the previous task's subagent panel.
		clearSubagents()
	}, [clearSubagents, setSendingDisabled, setClineAsk, setEnableButtons])

	/**
	 * Handles sending messages to the extension
	 * @param text - The message text to send
	 * @param images - Array of image data URLs to send with the message
	 */
	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				// Intercept when the active provider is retired: show a
				// WarningRow instead of sending anything to the backend.
				if (apiProvider && isRetiredProvider(apiProvider)) {
					setShowRetiredProviderWarning(true)
					return
				}

				// Queue message if:
				// - Task is busy (sendingDisabled)
				// - API request in progress (isStreaming)
				// - Queue has items (preserve message order during drain)
				// - Command is running (command_output) - user's message should be queued for AI, not sent to terminal
				if (
					sendingDisabled ||
					isStreaming ||
					messageQueueLength > 0 ||
					clineAskRef.current === "command_output"
				) {
					try {
						console.log("queueMessage", text, images)
						vscode.postMessage({ type: "queueMessage", text, images })
						setInputValue("")
						setSelectedImages([])
					} catch (error) {
						console.error(
							`Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					return
				}

				if (messagesRef.current.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAskRef.current) {
					if (clineAskRef.current === "followup") {
						markFollowUpAsAnswered()
					}

					// Feedback on a tool, a command or a completion, a follow-up
					// answer, a resume; no other ask enables the text field.
					if (isTextResponseAsk(clineAskRef.current)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "messageResponse",
							text,
							images,
						})
					}
				} else {
					// This is a new message in an ongoing task.
					vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
				}

				handleChatReset()
			}
		},
		[
			handleChatReset,
			markFollowUpAsAnswered,
			sendingDisabled,
			isStreaming,
			messageQueueLength,
			apiProvider,
			clineAskRef,
		], // messagesRef is stable
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => {
		setShowRetiredProviderWarning(false)
		vscode.postMessage({ type: "clearTask" })
	}, [])

	// Handle stop button click from textarea
	const handleStopTask = useCallback(() => {
		vscode.postMessage({ type: "cancelTask" })
	}, [])

	// Handle enqueue button click from textarea
	const handleEnqueueCurrentMessage = useCallback(() => {
		const text = inputValue.trim()
		if (text || selectedImages.length > 0) {
			vscode.postMessage({
				type: "queueMessage",
				text,
				images: selectedImages,
			})
			setInputValue("")
			setSelectedImages([])
		}
	}, [inputValue, selectedImages])

	// This logic depends on the ask state machine (useAskButtons) to set
	// clineAsk, after which buttons are shown and we then send an askResponse
	// to the extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "use_mcp_server":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					break
				case "resume_task":
					// For completed subtasks (tasks with a parentTaskId and a completion_result),
					// start a new task instead of resuming since the subtask is done
					if (parentTaskId && hasCompletionResult(messagesRef.current)) {
						startNewTask()
					} else {
						// Only send text/images if they exist
						if (trimmedInput || (images && images.length > 0)) {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "yesButtonClicked",
								text: trimmedInput,
								images: images,
							})
							// Clear input state after sending
							setInputValue("")
							setSelectedImages([])
						} else {
							vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
						}
					}
					break
				case "completion_result":
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
					break
			}

			clearApprovalButtons()
		},
		[clineAsk, startNewTask, parentTaskId, clearApprovalButtons],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
					}
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
					break
			}
			clearApprovalButtons()
		},
		[clineAsk, startNewTask, isStreaming, clearApprovalButtons],
	)

	const handleSuggestionClick = useCallback(
		(suggestion: SuggestionItem, event?: React.MouseEvent) => {
			// A suggestion without a usable answer (blank, missing or non-string) must not
			// reach the input: an undefined value crashes the text area.
			if (!hasUsableAnswer(suggestion)) {
				return
			}
			const answer = suggestion.answer

			// Mark the current follow-up question as answered when a suggestion is clicked
			if (clineAsk === "followup" && !event?.shiftKey) {
				markFollowUpAsAnswered()
			}

			// A manual click (event exists) always switches to the suggestion's
			// mode, an auto-approved one only when mode switches are allowed.
			const mode = suggestionModeToSwitch(suggestion, { manual: !!event, alwaysAllowModeSwitch })
			if (mode) {
				// Switch mode without waiting
				switchToMode(mode)
			}

			if (event?.shiftKey) {
				// Always append to existing text, don't overwrite
				setInputValue((currentValue: string) => {
					return currentValue !== "" ? `${currentValue} \n${answer}` : answer
				})
			} else {
				// Don't clear the input value when sending a follow-up choice
				// The message should be sent but the text area should preserve what the user typed
				const preservedInput = inputValueRef.current
				handleSendMessage(answer, [])
				// Restore the input value after sending
				setInputValue(preservedInput)
			}
		},
		[handleSendMessage, switchToMode, alwaysAllowModeSwitch, clineAsk, markFollowUpAsAnswered],
	)

	// The Enter shortcut from outside the text area (ChatViewRef.acceptInput).
	const acceptInput = () => {
		const hasInput = inputValue.trim() || selectedImages.length > 0

		// Special case: during command_output, queue the message instead of
		// triggering the primary button action (which would lose the message)
		if (clineAskRef.current === "command_output" && hasInput) {
			vscode.postMessage({ type: "queueMessage", text: inputValue.trim(), images: selectedImages })
			setInputValue("")
			setSelectedImages([])
			return
		}

		if (enableButtons && primaryButtonText) {
			handlePrimaryButtonClick(inputValue, selectedImages)
		} else if (!sendingDisabled && !isProfileDisabled && hasInput) {
			handleSendMessage(inputValue, selectedImages)
		}
	}

	return {
		inputValue,
		setInputValue,
		selectedImages,
		setSelectedImages,
		currentFollowUpTs,
		isFollowUpAutoApprovalPaused,
		showRetiredProviderWarning,
		handleChatReset,
		handleSendMessage,
		handleSetChatBoxMessage,
		startNewTask,
		handleStopTask,
		handleEnqueueCurrentMessage,
		handlePrimaryButtonClick,
		handleSecondaryButtonClick,
		handleSuggestionClick,
		acceptInput,
	}
}
