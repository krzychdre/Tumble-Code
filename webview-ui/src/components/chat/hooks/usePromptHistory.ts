import { ClineMessage, HistoryItem } from "@tumble-code/types"
import { useCallback, useMemo, useState } from "react"

import { useExtensionSelector } from "@src/context/ExtensionStateContext"

// Maximum number of prompts to keep in history for memory management
const MAX_PROMPT_HISTORY_SIZE = 100

const sameStrings = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i])

const samePrompts = (a: string[] | undefined, b: string[] | undefined) =>
	a === b || (a !== undefined && b !== undefined && sameStrings(a, b))

/** The user's prompts in the open task, newest first; undefined when no task is open. */
export function taskPromptsOf(clineMessages: ClineMessage[]): string[] | undefined {
	if (!clineMessages.length) {
		return undefined
	}
	return clineMessages
		.filter((message) => message.type === "say" && message.say === "user_feedback" && message.text?.trim())
		.map((message) => message.text!)
		.slice(-MAX_PROMPT_HISTORY_SIZE)
		.reverse()
}

/**
 * The open task's prompts. The host sends a new clineMessages array on every
 * streamed token; the prompts stay equal, so the caller does not re-render.
 */
export function useTaskPrompts(): string[] | undefined {
	return useExtensionSelector((s) => taskPromptsOf(s.clineMessages), samePrompts)
}

interface UsePromptHistoryProps {
	taskPrompts: string[] | undefined
	taskHistory: HistoryItem[] | undefined
	cwd: string | undefined
	inputValue: string
	setInputValue: (value: string) => void
}

export interface UsePromptHistoryReturn {
	historyIndex: number
	setHistoryIndex: (index: number) => void
	tempInput: string
	setTempInput: (input: string) => void
	promptHistory: string[]
	handleHistoryNavigation: (
		event: React.KeyboardEvent<HTMLTextAreaElement>,
		showContextMenu: boolean,
		isComposing: boolean,
	) => boolean
	resetHistoryNavigation: () => void
	resetOnInputChange: () => void
}

export const usePromptHistory = ({
	taskPrompts,
	taskHistory,
	cwd,
	inputValue,
	setInputValue,
}: UsePromptHistoryProps): UsePromptHistoryReturn => {
	// Prompt history navigation state
	const [historyIndex, setHistoryIndex] = useState(-1)
	const [tempInput, setTempInput] = useState("")

	// The open task's prompts; task history only when no task is open.
	const filteredPromptHistory = useMemo(() => {
		if (taskPrompts) {
			return taskPrompts
		}

		// Fall back to task history only when starting fresh (no active conversation)
		if (!taskHistory?.length || !cwd) {
			return []
		}

		// Extract user prompts from task history for the current workspace only
		return taskHistory
			.filter((item) => item.task?.trim() && (!item.workspace || item.workspace === cwd))
			.map((item) => item.task)
			.slice(0, MAX_PROMPT_HISTORY_SIZE)
	}, [taskPrompts, taskHistory, cwd])

	// filteredPromptHistory can be a new array with the same prompts (a state
	// push resends taskHistory). Keep the previous array (and the navigation position) unless the
	// prompts really changed: a new user prompt or another task. Adjusting state
	// during render avoids the extra commit an effect would cause.
	const [promptHistory, setPromptHistory] = useState<string[]>(filteredPromptHistory)
	if (promptHistory !== filteredPromptHistory && !sameStrings(promptHistory, filteredPromptHistory)) {
		setPromptHistory(filteredPromptHistory)
		// Reset navigation state when the history content changes
		setHistoryIndex(-1)
		setTempInput("")
	}

	// Reset history navigation when user types (but not when we're setting it programmatically)
	const resetOnInputChange = useCallback(() => {
		if (historyIndex !== -1) {
			setHistoryIndex(-1)
			setTempInput("")
		}
	}, [historyIndex])

	// Helper to set cursor position after React renders
	const setCursorPosition = useCallback(
		(textarea: HTMLTextAreaElement, position: number | "start" | "end", length?: number) => {
			setTimeout(() => {
				if (position === "start") {
					textarea.setSelectionRange(0, 0)
				} else if (position === "end") {
					const len = length ?? textarea.value.length
					textarea.setSelectionRange(len, len)
				} else {
					textarea.setSelectionRange(position, position)
				}
			}, 0)
		},
		[],
	)

	// Helper to navigate to a specific history entry
	const navigateToHistory = useCallback(
		(newIndex: number, textarea: HTMLTextAreaElement, cursorPos: "start" | "end" = "start"): boolean => {
			if (newIndex < 0 || newIndex >= promptHistory.length) return false

			const historicalPrompt = promptHistory[newIndex]
			if (!historicalPrompt) return false

			setHistoryIndex(newIndex)
			setInputValue(historicalPrompt)
			setCursorPosition(textarea, cursorPos, historicalPrompt.length)

			return true
		},
		[promptHistory, setInputValue, setCursorPosition],
	)

	// Helper to return to current input
	const returnToCurrentInput = useCallback(
		(textarea: HTMLTextAreaElement, cursorPos: "start" | "end" = "end") => {
			setHistoryIndex(-1)
			setInputValue(tempInput)
			setCursorPosition(textarea, cursorPos, tempInput.length)
		},
		[tempInput, setInputValue, setCursorPosition],
	)

	const handleHistoryNavigation = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>, showContextMenu: boolean, isComposing: boolean): boolean => {
			// Handle prompt history navigation
			if (!showContextMenu && promptHistory.length > 0 && !isComposing) {
				const textarea = event.currentTarget
				const { selectionStart, selectionEnd, value } = textarea
				const hasSelection = selectionStart !== selectionEnd
				const isAtBeginning = selectionStart === 0 && selectionEnd === 0
				const isAtEnd = selectionStart === value.length && selectionEnd === value.length

				// Handle smart navigation
				if (!hasSelection) {
					// Only navigate history with UP if cursor is at the very beginning
					if (event.key === "ArrowUp" && isAtBeginning) {
						event.preventDefault()
						// Save current input if starting navigation
						if (historyIndex === -1) {
							setTempInput(inputValue)
						}
						return navigateToHistory(historyIndex + 1, textarea, "start")
					}

					// Handle DOWN arrow - only in history navigation mode
					if (event.key === "ArrowDown" && historyIndex >= 0 && (isAtBeginning || isAtEnd)) {
						event.preventDefault()

						if (historyIndex > 0) {
							// Keep cursor position consistent with where we started
							return navigateToHistory(historyIndex - 1, textarea, isAtBeginning ? "start" : "end")
						} else if (historyIndex === 0) {
							returnToCurrentInput(textarea, isAtBeginning ? "start" : "end")
							return true
						}
					}
				}
			}
			return false
		},
		[promptHistory, historyIndex, inputValue, navigateToHistory, returnToCurrentInput],
	)

	const resetHistoryNavigation = useCallback(() => {
		setHistoryIndex(-1)
		setTempInput("")
	}, [])

	return {
		historyIndex,
		setHistoryIndex,
		tempInput,
		setTempInput,
		promptHistory,
		handleHistoryNavigation,
		resetHistoryNavigation,
		resetOnInputChange,
	}
}
