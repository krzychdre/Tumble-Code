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
 * The draft follows every keystroke and is replaced only when `value` changes. `onCommit` runs on
 * blur when the text differs from `value`, like the native `change` event.
 */
export function useTextDraft(value: string, onCommit?: (text: string) => void) {
	const [draft, setDraft] = React.useState(value)
	const [shownValue, setShownValue] = React.useState(value)
	if (value !== shownValue) {
		setShownValue(value)
		setDraft(value)
	}

	return {
		value: draft,
		onChange: (event: React.ChangeEvent<TextControl>) => setDraft(event.target.value),
		onBlur: (event: React.FocusEvent<TextControl>) => {
			if (onCommit && event.target.value !== value) onCommit(event.target.value)
		},
	}
}
