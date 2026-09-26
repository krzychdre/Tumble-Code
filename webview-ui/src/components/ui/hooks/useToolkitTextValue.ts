import * as React from "react"

type TextControl = HTMLInputElement | HTMLTextAreaElement

/**
 * The value handling that ThemedTextField and ThemedTextArea share with the
 * deprecated toolkit's text controls they replace:
 *
 * - `draft` is what the control shows. It follows every keystroke and is
 *   replaced only when the `value` prop changes. (The toolkit's React wrapper
 *   wrote `value` into the element on every re-render, so a re-render while
 *   typing into a field that saves on `change` put the old text back.)
 * - `onChange` is the native `change` event (the field was left, or Enter was
 *   pressed, after an edit), not React's per-keystroke onChange. Per-keystroke
 *   reports go through `onInput`.
 * - The caret starts at the end of the text, as after the toolkit set it
 *   through `value`, so Tab lands after the text.
 *
 * Returns the draft, a React onChange that keeps the draft in step, a ref
 * callback to put on the control (it also fills the forwarded `ref`) and the
 * control element once mounted.
 */
export function useToolkitTextValue<T extends TextControl>(
	value: string | undefined,
	onChange: ((event: Event) => void) | undefined,
	ref: React.ForwardedRef<T>,
) {
	const [draft, setDraft] = React.useState(value ?? "")
	const [shownValue, setShownValue] = React.useState(value)
	if (value !== shownValue) {
		setShownValue(value)
		setDraft(value ?? "")
	}

	const onChangeRef = React.useRef(onChange)
	React.useEffect(() => {
		onChangeRef.current = onChange
	}, [onChange])

	const [element, setElement] = React.useState<T | null>(null)
	React.useEffect(() => {
		if (!element) return
		try {
			element.setSelectionRange(element.value.length, element.value.length)
		} catch {
			// Input types without a text selection (number, email) keep the browser default.
		}
		const listener = (event: Event) => onChangeRef.current?.(event)
		element.addEventListener("change", listener)
		return () => element.removeEventListener("change", listener)
	}, [element])

	// The forwarded ref gets the control once it is mounted.
	React.useImperativeHandle(ref, () => element as T, [element])

	const onDraftChange = React.useCallback((event: React.ChangeEvent<T>) => setDraft(event.target.value), [])

	return { draft, onDraftChange, controlRef: setElement, element }
}
