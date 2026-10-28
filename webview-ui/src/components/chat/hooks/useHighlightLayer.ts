import { useCallback, useLayoutEffect, useRef, type RefObject } from "react"

import type { Command } from "@tumble-code/types"
import { mentionRegexGlobal, commandRegexGlobal } from "@tumble-code/core/browser"

const MARK_CLASS = "mention-context-textarea-highlight"

/**
 * The parts of the composer text to highlight: every mention and every known
 * slash command (without the whitespace before it), in order, not overlapping.
 */
function highlightRanges(text: string, commands: Command[] | undefined): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = []
	for (const match of text.matchAll(mentionRegexGlobal)) {
		ranges.push({ start: match.index, end: match.index + match[0].length })
	}
	const mentions = [...ranges]
	for (const match of text.matchAll(commandRegexGlobal)) {
		const commandName = match[1]
		// Only commands the user has are highlighted.
		if (!commands?.some((cmd) => cmd.name === commandName)) {
			continue
		}
		const end = match.index + match[0].length
		const start = end - commandName.length - 1
		if (!mentions.some((mention) => start < mention.end && mention.start < end)) {
			ranges.push({ start, end })
		}
	}
	return ranges.sort((a, b) => a.start - b.start)
}

/**
 * Fills the layer behind the composer textarea with the same text, every
 * mention and known slash command wrapped in a highlight mark. The text goes
 * in as text nodes, never as HTML, so nothing typed or pasted becomes markup.
 * A trailing newline is doubled so the layer is as tall as the textarea, which
 * shows an empty last line there.
 */
function renderHighlights(layer: HTMLElement, text: string, commands: Command[] | undefined): void {
	const doc = layer.ownerDocument
	const nodes: Node[] = []
	let position = 0
	for (const { start, end } of highlightRanges(text, commands)) {
		if (start > position) {
			nodes.push(doc.createTextNode(text.slice(position, start)))
		}
		const mark = doc.createElement("mark")
		mark.className = MARK_CLASS
		mark.textContent = text.slice(start, end)
		nodes.push(mark)
		position = end
	}
	const rest = text.slice(position) + (text.endsWith("\n") ? "\n" : "")
	if (rest) {
		nodes.push(doc.createTextNode(rest))
	}
	layer.replaceChildren(...nodes)
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

		renderHighlights(highlightLayerRef.current, textAreaRef.current.value, commands)

		highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
		highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
	}, [commands, textAreaRef])

	useLayoutEffect(() => {
		updateHighlights()
	}, [inputValue, updateHighlights])

	return { highlightLayerRef, updateHighlights }
}
