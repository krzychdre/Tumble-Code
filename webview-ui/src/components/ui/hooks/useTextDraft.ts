import * as React from "react"

type TextControl = HTMLInputElement | HTMLTextAreaElement

/**
 * The text a field shows while the user edits it, for fields whose stored value is not simply the
 * typed text:
 *
 * - a field that parses what is typed (a number) shows the typed text, not the parsed value, so an
 *   intermediate state ("", "0.", a number below the minimum) can still be typed;
 * - a field that saves only when it is left (`onCommit`) shows the typed text until then.
 *
 * The draft follows every keystroke and is replaced only when `value` changes. `onCommit` runs like
 * the native `change` event: once per edit, when the field is left or Enter is pressed in a
 * single-line field, and only when the text differs from `value`.
 */
export function useTextDraft(value: string, onCommit?: (text: string) => void) {
	const [draft, setDraft] = React.useState(value)
	const [shownValue, setShownValue] = React.useState(value)
	// The text last handed to onCommit, so leaving after Enter does not commit the same edit twice.
	const committed = React.useRef<string | undefined>(undefined)
	if (value !== shownValue) {
		setShownValue(value)
		setDraft(value)
	}

	const commit = (text: string) => {
		if (!onCommit || text === value || text === committed.current) return
		committed.current = text
		onCommit(text)
	}

	return {
		value: draft,
		onChange: (event: React.ChangeEvent<TextControl>) => {
			committed.current = undefined
			setDraft(event.target.value)
		},
		onBlur: (event: React.FocusEvent<TextControl>) => commit(event.target.value),
		onKeyDown: (event: React.KeyboardEvent<TextControl>) => {
			if (event.key === "Enter" && event.currentTarget instanceof HTMLInputElement) {
				commit(event.currentTarget.value)
			}
		},
	}
}
