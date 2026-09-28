import { Box, Text, useInput } from "ink"

import * as theme from "../../theme.js"
import type { ReverseSearchState } from "../../utils/reverseSearch.js"

export interface ReverseSearchPromptProps {
	state: ReverseSearchState
	/** The entry `state.matchIndex` points at, or null. */
	match: string | null
	onType: (text: string) => void
	onBackspace: () => void
	onOlder: () => void
	onAccept: () => void
	onCancel: () => void
}

/** Ctrl+R as ink reports it, and in the kitty keyboard protocol (CSI 114;5u). */
export function isReverseSearchKey(input: string, key: { ctrl: boolean }): boolean {
	return (key.ctrl && input === "r") || input.endsWith("[114;5u")
}

/**
 * The prompt line while Ctrl+R searches the input history (UI plan §4), in
 * bash's words: `(reverse-i-search)'query': match`. It owns the keys meanwhile:
 * typing and Backspace edit the query, Ctrl+R goes to an older match, Enter,
 * Tab or Right put the match into the prompt, Escape or Ctrl+G cancel.
 *
 * The callbacks update state with functional updates (see AutocompleteInput),
 * so keystrokes that arrive faster than React re-renders still build on each
 * other.
 */
export function ReverseSearchPrompt(props: ReverseSearchPromptProps) {
	useInput((input, key) => {
		const handlers = props

		if (isReverseSearchKey(input, key)) {
			handlers.onOlder()
			return
		}

		if (key.escape || (key.ctrl && input === "g")) {
			handlers.onCancel()
			return
		}

		if (key.return || key.tab || key.rightArrow) {
			handlers.onAccept()
			return
		}

		if (key.backspace || key.delete) {
			handlers.onBackspace()
			return
		}

		// Ctrl+C belongs to the App (exit); other control keys do nothing here.
		if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow) {
			return
		}

		if (input) {
			handlers.onType(input.replace(/[\r\n]+/g, " "))
		}
	})

	const { state, match } = props
	const label = state.failed ? "(failing reverse-i-search)" : "(reverse-i-search)"

	return (
		<Box>
			<Text wrap="truncate-end">
				<Text dimColor>{label}</Text>
				<Text color={theme.brand}>{`'${state.query}'`}</Text>
				<Text dimColor>: </Text>
				<Text>{match ? match.replace(/\n/g, " ⏎ ") : ""}</Text>
			</Text>
		</Box>
	)
}
