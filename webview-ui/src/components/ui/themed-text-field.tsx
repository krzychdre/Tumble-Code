import * as React from "react"

import { cn } from "@/lib/utils"

import { useToolkitTextValue } from "./hooks/useToolkitTextValue"

export interface ThemedTextFieldProps
	extends Omit<
		React.InputHTMLAttributes<HTMLInputElement>,
		"value" | "defaultValue" | "onChange" | "style" | "children"
	> {
	value?: string
	/**
	 * Fires when the user leaves the field (or presses Enter) after editing it:
	 * the native `change` event, as in the toolkit; `e.target.value` is the
	 * text. For a report on every keystroke use `onInput`.
	 */
	onChange?: (event: Event) => void
	/**
	 * The label shown above the input (it names the input). Children with
	 * `slot="start"` or `slot="end"` are shown inside the field, before or after
	 * the text, like the toolkit's slots.
	 */
	children?: React.ReactNode
	/** Classes for the wrapper (layout, width), where the toolkit's host took them. */
	className?: string
	style?: React.CSSProperties
	/**
	 * Select the whole text when the field gets the focus other than by a press
	 * on the text (default, as the toolkit did through its host). Off for
	 * wrappers that focused the toolkit's inner input directly.
	 */
	selectOnFocus?: boolean
}

const slotOf = (child: React.ReactNode) =>
	React.isValidElement<{ slot?: string }>(child) ? child.props.slot : undefined

/**
 * A single-line text field with VS Code's look, the replacement for the
 * deprecated toolkit's `VSCodeTextField`. It is a native `<input>` with the
 * toolkit's call-site API: `value`, `onInput` on every keystroke, `onChange`
 * on leaving after an edit, `onBlur`, `onKeyDown`, `type`, `placeholder`,
 * children as the label, `slot="start"` / `slot="end"` children inside the
 * field. `className` and `style` go on the wrapper (where the toolkit's host
 * took them); `ref`, `id`, `data-testid`, `aria-*` and the other input props
 * go on the input, so `ref.current.focus()` focuses it as before.
 *
 * The typed text is kept until the `value` prop changes (see
 * `useToolkitTextValue`). Like the toolkit, the whole text is selected when
 * the field gets the focus by Tab, a label click or `ref.focus()`, and a click
 * on the label (also on a call site's own `<label>` child) focuses the input.
 * The look comes from the `.ui-text-field` rules in `index.css`.
 */
const ThemedTextField = React.forwardRef<HTMLInputElement, ThemedTextFieldProps>(
	(
		{
			value,
			onChange,
			children,
			className,
			style,
			id,
			disabled,
			readOnly,
			type = "text",
			onFocus,
			onMouseDown,
			onMouseUp,
			selectOnFocus = true,
			...props
		},
		ref,
	) => {
		const { draft, onDraftChange, controlRef, element } = useToolkitTextValue(value, onChange, ref)
		// The toolkit selected the whole text whenever the field got the focus
		// other than by a press on the text itself: Tab, a click on the label,
		// or `ref.focus()` (the rename fields rely on it to replace the name).
		const pressed = React.useRef(false)
		const generatedId = React.useId()
		const inputId = id ?? generatedId

		const items = React.Children.toArray(children)
		const start = items.filter((child) => slotOf(child) === "start")
		const end = items.filter((child) => slotOf(child) === "end")
		const label = items.filter(
			(child) =>
				slotOf(child) !== "start" && slotOf(child) !== "end" && !(typeof child === "string" && !child.trim()),
		)

		return (
			<div
				className={cn("ui-text-field", className)}
				style={style}
				data-disabled={disabled ? "" : undefined}
				data-readonly={readOnly ? "" : undefined}>
				{label.length > 0 && (
					<label
						className="ui-text-field-label"
						htmlFor={inputId}
						onClick={(event) => {
							// A call site's own <label> inside this one does not pass the click on.
							if ((event.target as Element).closest("label") !== event.currentTarget) element?.focus()
						}}>
						{label}
					</label>
				)}
				<div className="ui-text-field-root">
					<span className={start.length > 0 ? "ui-text-field-start" : undefined}>{start}</span>
					<input
						ref={controlRef}
						id={inputId}
						type={type}
						className="ui-text-field-control"
						value={draft}
						onChange={onDraftChange}
						onMouseDown={(event) => {
							pressed.current = true
							onMouseDown?.(event)
						}}
						onMouseUp={(event) => {
							pressed.current = false
							onMouseUp?.(event)
						}}
						onFocus={(event) => {
							if (selectOnFocus && !pressed.current) event.currentTarget.select()
							pressed.current = false
							onFocus?.(event)
						}}
						disabled={disabled}
						readOnly={readOnly}
						{...props}
					/>
					<span className={end.length > 0 ? "ui-text-field-end" : undefined}>{end}</span>
				</div>
			</div>
		)
	},
)
ThemedTextField.displayName = "ThemedTextField"

export { ThemedTextField }
