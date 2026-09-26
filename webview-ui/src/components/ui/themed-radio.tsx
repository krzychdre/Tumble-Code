import * as React from "react"

import { cn } from "@/lib/utils"

type RadioGroupContextValue = {
	name: string
	value?: string
	disabled?: boolean
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null)

export interface ThemedRadioGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
	/** The selected option's value. */
	value?: string
	/** Fires when the user selects an option; `e.target.value` is its value. */
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
	/** Groups the native radios; generated when omitted. */
	name?: string
	disabled?: boolean
	/** Options in a row (the toolkit's default) or in a column. */
	orientation?: "horizontal" | "vertical"
}

/**
 * A group of radio options with VS Code's look, the replacement for the
 * deprecated toolkit's `VSCodeRadioGroup` (use with `ThemedRadio`). The
 * options are native `<input type="radio">` sharing one name, so the browser
 * provides the keyboard behaviour (Tab reaches the selected option, arrow
 * keys move the selection) and `onChange` fires only when the user selects
 * an option. The toolkit also fired it whenever `value` changed.
 */
const ThemedRadioGroup = React.forwardRef<HTMLDivElement, ThemedRadioGroupProps>(
	({ value, onChange, name, disabled, orientation = "horizontal", className, children, ...props }, ref) => {
		const generatedName = React.useId()
		const context = React.useMemo(
			() => ({ name: name ?? generatedName, value, disabled, onChange }),
			[name, generatedName, value, disabled, onChange],
		)
		return (
			<div
				ref={ref}
				role="radiogroup"
				aria-disabled={disabled || undefined}
				className={cn("ui-radio-group", className)}
				data-orientation={orientation}
				{...props}>
				<div className="ui-radio-group-options">
					<RadioGroupContext.Provider value={context}>{children}</RadioGroupContext.Provider>
				</div>
			</div>
		)
	},
)
ThemedRadioGroup.displayName = "ThemedRadioGroup"

export interface ThemedRadioProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "children" | "className" | "style"> {
	value: string
	/** Label content; clicking it selects the option. */
	children?: React.ReactNode
	/** Classes for the wrapper that holds the circle and the label. */
	className?: string
	style?: React.CSSProperties
}

/** One option of a `ThemedRadioGroup` (replaces the toolkit's `VSCodeRadio`). */
const ThemedRadio = React.forwardRef<HTMLInputElement, ThemedRadioProps>(
	({ value, children, className, style, disabled, ...inputProps }, ref) => {
		const group = React.useContext(RadioGroupContext)
		const isDisabled = disabled ?? group?.disabled
		const hasLabel = React.Children.count(children) > 0
		return (
			<label className={cn("ui-radio", className)} style={style} data-disabled={isDisabled ? "" : undefined}>
				<span className="ui-radio-control">
					<input
						ref={ref}
						type="radio"
						className="ui-radio-input"
						name={group?.name}
						value={value}
						checked={group ? group.value === value : undefined}
						onChange={group?.onChange}
						disabled={isDisabled}
						{...inputProps}
					/>
					<span className="ui-radio-indicator" aria-hidden="true" />
				</span>
				{hasLabel && <span className="ui-radio-label">{children}</span>}
			</label>
		)
	},
)
ThemedRadio.displayName = "ThemedRadio"

export { ThemedRadioGroup, ThemedRadio }
