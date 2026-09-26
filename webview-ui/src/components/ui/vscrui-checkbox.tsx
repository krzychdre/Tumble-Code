import * as React from "react"

import { LabeledCheckbox } from "@/components/ui/labeled-checkbox"

export interface VSCRUICheckboxProps
	extends Omit<
		React.InputHTMLAttributes<HTMLInputElement>,
		"type" | "onChange" | "children" | "checked" | "defaultChecked"
	> {
	/** Whether the box is checked. The box always shows this value (controlled). */
	checked?: boolean
	/** Shows the dash box instead of the check mark. */
	indeterminate?: boolean
	/** Dims the checkbox and stops user interaction. */
	disabled?: boolean
	/** Called with the new boolean state on user input only. */
	onChange?: (checked: boolean) => void
	/** Label content, shown right of the box; clicking it toggles the box. */
	children?: React.ReactNode
}

/**
 * Drop-in replacement for the `vscrui` package's `Checkbox`, with the same
 * call-site API: `checked` / `indeterminate` / `disabled` / boolean
 * `onChange(checked)` and children as the label.
 *
 * The look and the markup come from `LabeledCheckbox` (a native
 * `<input type="checkbox">` inside a `<label>`, styled by the `.ui-checkbox`
 * rules in `index.css`): the label names the checkbox, Space toggles it and
 * clicking the label text toggles it. `data-testid` and `aria-*` props go on
 * the input, as before.
 *
 * Differences from vscrui, kept from `LabeledCheckbox`:
 * - `onChange` fires on user input only (vscrui also fired it when its
 *   internal state was synced from the `checked` prop via an effect).
 * - `indeterminate` renders the dash only while true; it does not force the
 *   checked state off.
 */
const VSCRUICheckbox = React.forwardRef<HTMLInputElement, VSCRUICheckboxProps>(
	({ checked, indeterminate, disabled, onChange, children, className, ...rest }, ref) => {
		const inputRef = React.useRef<HTMLInputElement>(null)

		React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

		React.useEffect(() => {
			if (inputRef.current) {
				inputRef.current.indeterminate = indeterminate === true
			}
		}, [indeterminate])

		return (
			<LabeledCheckbox
				ref={inputRef}
				className={className}
				checked={checked}
				disabled={disabled}
				onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
				{...rest}>
				{children}
			</LabeledCheckbox>
		)
	},
)
VSCRUICheckbox.displayName = "VSCRUI_Checkbox"

export { VSCRUICheckbox }
