import { memo, useMemo } from "react"
import { Box, Text } from "ink"

import { firstUsableSuggestion } from "@roo-code/types"

import * as theme from "../../theme.js"
import SelectList, { type SelectItem } from "../primitives/SelectList.js"
import type { PendingAsk } from "../../types.js"

export interface FollowupDialogProps {
	/** The pending followup ask (type "followup") with suggestions */
	ask: PendingAsk
	/** Called when the user selects a suggestion answer */
	onSelect: (answer: string) => void
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
 * Parse the question text from a followup ask.
 * The ask.content may be a JSON string with a `question` field, or plain text.
 */
function parseQuestion(content: string): string {
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>
		if (typeof parsed.question === "string" && parsed.question.length > 0) {
			return parsed.question
		}
	} catch {
		// not JSON
	}
	return content
}

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
	const question = useMemo(() => parseQuestion(ask.content), [ask.content])

	const items: SelectItem[] = useMemo(() => {
		const suggestions = ask.suggestions ?? []
		const list: SelectItem[] = suggestions.map((s) => ({
			label: s.answer,
			description: s.mode ? `→ ${s.mode} mode` : undefined,
			value: s.answer,
		}))
		list.push({ label: "Type my own answer…", value: CUSTOM_VALUE })
		return list
	}, [ask.suggestions])

	const handleSelect = (value: string) => {
		if (value === CUSTOM_VALUE) {
			onCustomInput()
		} else if (value.trim()) {
			onSelect(value)
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
