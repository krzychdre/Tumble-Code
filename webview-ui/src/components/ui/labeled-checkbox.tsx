import * as React from "react"

import { cn } from "@/lib/utils"

export interface LabeledCheckboxProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "children" | "className" | "style"> {
	/** Label content, shown right of the box; clicking it toggles the box. */
	children?: React.ReactNode
	/** Classes for the wrapper that holds box and label (layout, font size). */
	className?: string
	style?: React.CSSProperties
}

/**
 * A checkbox with its label, the replacement for the deprecated toolkit's
 * `VSCodeCheckbox`: same look (VS Code checkbox colours, 18px box, focusBorder
 * frame on keyboard focus) and the same call-site API (`checked`, `disabled`,
 * children as the label, and `onChange(e)` where `e.target.checked` is the new
 * state).
 *
 * It is a native `<input type="checkbox">` inside a `<label>`, so the label
 * names the checkbox, Space toggles it and clicking the label text toggles
 * it. `data-testid`, `aria-*` and every other input prop go on the input;
 * `className` and `style` go on the wrapper, where the toolkit's host took them.
 *
 * Two toolkit behaviours are intentionally NOT kept: the toolkit fired
 * `onChange` whenever its `checked` prop changed (not only on user input),
 * and a click flipped its box even when the call site did not update
 * `checked`. Here `onChange` fires on user input only and the box always
 * shows `checked`.
 *
 * The look comes from the `.ui-checkbox` rules in `index.css`.
 */
const LabeledCheckbox = React.forwardRef<HTMLInputElement, LabeledCheckboxProps>(
	({ className, style, children, checked, disabled, ...inputProps }, ref) => {
		const hasLabel = React.Children.count(children) > 0
		return (
			<label className={cn("ui-checkbox", className)} style={style} data-disabled={disabled ? "" : undefined}>
				<span className="ui-checkbox-box">
					<input
						ref={ref}
						type="checkbox"
						className="ui-checkbox-input"
						checked={!!checked}
						disabled={disabled}
						{...inputProps}
					/>
					<svg
						className="ui-checkbox-check"
						aria-hidden="true"
						width="16"
						height="16"
						viewBox="0 0 16 16"
						xmlns="http://www.w3.org/2000/svg"
						fill="currentColor">
						<path
							fillRule="evenodd"
							clipRule="evenodd"
							d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"
						/>
					</svg>
				</span>
				{hasLabel && <span className="ui-checkbox-label">{children}</span>}
			</label>
		)
	},
)
LabeledCheckbox.displayName = "LabeledCheckbox"

export { LabeledCheckbox }
