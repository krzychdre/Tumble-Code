import * as React from "react"

import { cn } from "@/lib/utils"

export interface ThemedTextAreaProps
	extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange" | "style"> {
	value?: string
	/**
	 * Fires when the user leaves the field after editing it (the native
	 * `change` event, as in the toolkit); `e.target.value` is the text. For a
	 * report on every keystroke use `onInput`.
	 */
	onChange?: (event: Event) => void
	/** Resize handle, as the toolkit's `resize` attribute. */
	resize?: "none" | "both" | "horizontal" | "vertical"
	/** Classes for the wrapper (layout, width), where the toolkit's host took them. */
	className?: string
	style?: React.CSSProperties
}

/**
 * A multi-line text field with VS Code's look, the replacement for the
 * deprecated toolkit's `VSCodeTextArea`. It is a native `<textarea>` in a
 * wrapper, with the toolkit's call-site API: `value`, `onInput` on every
 * keystroke, `onChange` when the field is left after an edit, `resize`,
 * `rows`, `placeholder`. `className` and `style` go on the wrapper;
 * `data-testid`, `aria-*` and the other textarea props go on the textarea.
 *
 * The typed text is kept inside until the `value` prop changes. The
 * toolkit's React wrapper wrote `value` into the element on every re-render,
 * so a re-render while the user was typing into an `onChange` field put the
 * old text back and leaving the field saved the old text.
 *
 * The look comes from the `.ui-text-area` rules in `index.css`.
 */
const ThemedTextArea = React.forwardRef<HTMLTextAreaElement, ThemedTextAreaProps>(
	({ value, onChange, resize = "none", className, style, disabled, readOnly, ...props }, ref) => {
		const [draft, setDraft] = React.useState(value ?? "")
		const [shownValue, setShownValue] = React.useState(value)
		if (value !== shownValue) {
			setShownValue(value)
			setDraft(value ?? "")
		}

		// React's onChange on a textarea is the input event; the call site's
		// onChange means the native change event (the field was left after an edit).
		const onChangeRef = React.useRef(onChange)
		React.useEffect(() => {
			onChangeRef.current = onChange
		}, [onChange])
		const [element, setElement] = React.useState<HTMLTextAreaElement | null>(null)
		React.useEffect(() => {
			if (!element) return
			// The toolkit set the text through `value`, which leaves the caret at the
			// end; keep that, so Tab lands after the text as before.
			element.setSelectionRange(element.value.length, element.value.length)
			const listener = (event: Event) => onChangeRef.current?.(event)
			element.addEventListener("change", listener)
			return () => element.removeEventListener("change", listener)
		}, [element])

		const setRefs = React.useCallback(
			(node: HTMLTextAreaElement | null) => {
				setElement(node)
				if (typeof ref === "function") ref(node)
				else if (ref) ref.current = node
			},
			[ref],
		)

		return (
			<div
				className={cn("ui-text-area", className)}
				style={style}
				data-disabled={disabled ? "" : undefined}
				data-readonly={readOnly ? "" : undefined}>
				<textarea
					ref={setRefs}
					className="ui-text-area-control"
					data-resize={resize}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					disabled={disabled}
					readOnly={readOnly}
					{...props}
				/>
			</div>
		)
	},
)
ThemedTextArea.displayName = "ThemedTextArea"

export { ThemedTextArea }
