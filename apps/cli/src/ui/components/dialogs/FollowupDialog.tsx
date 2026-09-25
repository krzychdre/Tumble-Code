import { memo, useMemo } from "react"
import { Box, Text } from "ink"

import { firstUsableSuggestion, type UsableSuggestion } from "@roo-code/types"

import * as theme from "../../theme.js"
import SelectList, { type SelectItem } from "../primitives/SelectList.js"
import type { PendingAsk } from "../../types.js"

export interface FollowupDialogProps {
	/** The pending followup ask (type "followup") with suggestions */
	ask: PendingAsk
	/** Called with the suggestion (answer and mode) the user selects */
	onSelect: (suggestion: UsableSuggestion) => void
	/** Called when the user picks "Type my own answer…" — reveals InputArea */
	onCustomInput: () => void
	/** Countdown seconds until auto-select of the first suggestion; null = inactive */
	countdownSeconds: number | null
	/** When false, the dialog ignores all input (default true) */
	isActive?: boolean
}

/** Sentinel value for the "Type my own answer…" option. */
const CUSTOM_VALUE = "__CUSTOM__"

/**
 * Permission-bordered followup question dialog for `ask_followup_question`.
 *
 * Renders a round-bordered box in `theme.permission` with the question as
 * the title, a numbered SelectList of suggestions plus a trailing
 * "Type my own answer…" option, and a dim countdown line at the bottom
 * when `countdownSeconds` is not null.
 *
 * The countdown is driven by the existing `useFollowupCountdown` hook
 * (App wires it); this component only displays the current value.
 * Any arrow-key navigation cancels the countdown (also wired in App).
 */
function FollowupDialog({ ask, onSelect, onCustomInput, countdownSeconds, isActive = true }: FollowupDialogProps) {
	// ask.content already holds the question (the transcript reducer parsed the ask).
	const question = ask.content
	const suggestions = useMemo(() => ask.suggestions ?? [], [ask.suggestions])

	// Items are keyed by position: two suggestions may share an answer and
	// differ only in their mode.
	const items: SelectItem[] = useMemo(() => {
		const list: SelectItem[] = suggestions.map((s, index) => ({
			label: s.answer,
			description: s.mode ? `→ ${s.mode} mode` : undefined,
			value: String(index),
		}))
		list.push({ label: "Type my own answer…", value: CUSTOM_VALUE })
		return list
	}, [suggestions])

	const handleSelect = (value: string) => {
		if (value === CUSTOM_VALUE) {
			onCustomInput()
			return
		}

		const suggestion = suggestions[Number(value)]
		if (suggestion?.answer.trim()) {
			onSelect(suggestion)
		}
	}

	const firstSuggestion = firstUsableSuggestion(ask.suggestions)?.answer ?? ""

	return (
		<Box borderStyle="round" borderColor={theme.permission} paddingX={1} flexDirection="column">
			<Text bold color={theme.permission}>
				{question}
			</Text>
			<SelectList items={items} onSelect={handleSelect} isActive={isActive} numbered={true} />
			{countdownSeconds !== null && firstSuggestion.length > 0 && (
				<Text dimColor>
					Auto-selecting "{firstSuggestion}" in {countdownSeconds}s — press any key to cancel
				</Text>
			)}
		</Box>
	)
}

export default memo(FollowupDialog)
