import * as React from "react"

import { cn } from "@/lib/utils"

import { useToolkitTextValue } from "./hooks/useToolkitTextValue"

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
 * The typed text is kept until the `value` prop changes (see
 * `useToolkitTextValue`).
 *
 * The look comes from the `.ui-text-area` rules in `index.css`.
 */
const ThemedTextArea = React.forwardRef<HTMLTextAreaElement, ThemedTextAreaProps>(
	({ value, onChange, resize = "none", className, style, disabled, readOnly, ...props }, ref) => {
		const { draft, onDraftChange, controlRef } = useToolkitTextValue(value, onChange, ref)

		return (
			<div
				className={cn("ui-text-area", className)}
				style={style}
				data-disabled={disabled ? "" : undefined}
				data-readonly={readOnly ? "" : undefined}>
				<textarea
					ref={controlRef}
					className="ui-text-area-control"
					data-resize={resize}
					value={draft}
					onChange={onDraftChange}
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
