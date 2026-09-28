import { useCallback, useLayoutEffect, useRef, type RefObject } from "react"

import type { Command } from "@roo-code/types"
import { mentionRegexGlobal, commandRegexGlobal } from "@roo-code/core/browser"

const MARK_OPEN = '<mark class="mention-context-textarea-highlight">'

/**
 * HTML for the layer behind the composer textarea: the same text, HTML-escaped, with every mention and
 * every known slash command wrapped in a highlight mark. A trailing newline is doubled so the layer is as
 * tall as the textarea, which shows an empty last line there.
 */
function highlightComposerText(text: string, commands: Command[] | undefined): string {
	// Helper function to check if a command is valid
	const isValidCommand = (commandName: string): boolean => {
		return commands?.some((cmd) => cmd.name === commandName) || false
	}

	// Process the text to highlight mentions and valid commands
	const processedText = text
		.replace(/\n$/, "\n\n")
		.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
		.replace(mentionRegexGlobal, `${MARK_OPEN}$&</mark>`)

	// Custom replacement for commands - only highlight valid ones
	return processedText.replace(commandRegexGlobal, (match, commandName) => {
		// Only highlight if the command exists in the valid commands list
		if (isValidCommand(commandName)) {
			const commandPart = `/${commandName}`
			// Keep a leading space outside the mark and highlight only the command part
			return match.startsWith(" ") ? ` ${MARK_OPEN}${commandPart}</mark>` : `${MARK_OPEN}${commandPart}</mark>`
		}
		return match // Return unhighlighted if command is not valid
	})
}

/**
 * Keeps the highlight layer (a div stacked behind the transparent-text textarea) in step with the
 * textarea: same text with marks, same scroll offsets. `updateHighlights` is also called by the
 * textarea's change and scroll handlers, the layout effect covers value changes from outside.
 */
export function useHighlightLayer(
	textAreaRef: RefObject<HTMLTextAreaElement | null>,
	inputValue: string,
	commands: Command[] | undefined,
) {
	const highlightLayerRef = useRef<HTMLDivElement>(null)

	const updateHighlights = useCallback(() => {
		if (!textAreaRef.current || !highlightLayerRef.current) return

		highlightLayerRef.current.innerHTML = highlightComposerText(textAreaRef.current.value, commands)

		highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
		highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
	}, [commands, textAreaRef])

	useLayoutEffect(() => {
		updateHighlights()
	}, [inputValue, updateHighlights])

	return { highlightLayerRef, updateHighlights }
}
