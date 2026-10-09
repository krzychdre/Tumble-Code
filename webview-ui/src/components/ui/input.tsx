import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The look of a single-line text field (ai_plans/2026-10-09_ui-frame-language.md):
 * 26px high, the input frame (stronger on hover), 2px corners, the input
 * colours, the editor font size, the focus shown as a focusBorder-coloured
 * border plus a 1px focusBorder outline, the description colour for the
 * placeholder, 40% opacity when disabled.
 * `ui-input` is a marker for the unlayered rules in `index.css`. A label
 * above a field takes `leading-[normal]`, the line height of VS Code's own
 * field labels.
 */
const FIELD_BOX =
	"h-[26px] w-full rounded-control border border-input-frame hover:border-input-frame-hover bg-vscode-input-background text-vscode-input-foreground transition-colors"
const FIELD_TEXT = "text-base leading-[normal] placeholder:text-vscode-descriptionForeground"
const FIELD_STATE = "disabled:cursor-not-allowed read-only:cursor-not-allowed"

const hasContent = (node: React.ReactNode) => node !== undefined && node !== null && node !== false && node !== ""

export interface InputProps extends React.ComponentProps<"input"> {
	/** Shown inside the field before the text: an icon or a unit. */
	start?: React.ReactNode
	/** Shown inside the field after the text: a clear button, an icon. */
	end?: React.ReactNode
}

/**
 * The one single-line text field. A native `<input>` with React's `onChange`
 * on every keystroke; `className`, `ref`, `id`, `data-testid` and the other
 * props go on the `<input>`. With `start` or `end` the border moves to a
 * wrapper that holds them around the input, and `className` goes on that
 * wrapper (layout, width), while the props still go on the `<input>`. Passing
 * `start` or `end` at all (even `null`) picks the wrapper, so a slot that comes
 * and goes while typing does not remount the input.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, start, end, ...props }, ref) => {
	if (start === undefined && end === undefined) {
		return (
			<input
				ref={ref}
				className={cn(
					"ui-input flex px-[9px] py-0 outline-none",
					FIELD_BOX,
					FIELD_TEXT,
					FIELD_STATE,
					"focus:border-vscode-focusBorder focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-vscode-focusBorder disabled:opacity-40",
					className,
				)}
				{...props}
			/>
		)
	}

	return (
		<div
			className={cn(
				"flex items-center",
				FIELD_BOX,
				"focus-within:border-vscode-focusBorder focus-within:outline-solid focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-vscode-focusBorder",
				props.disabled && "opacity-40",
				className,
			)}>
			{hasContent(start) && <span className="flex shrink-0 items-center ms-2">{start}</span>}
			<input
				ref={ref}
				className={cn(
					"ui-input h-full min-w-0 flex-1 px-[9px] py-0 border-0 bg-transparent text-inherit outline-none",
					FIELD_TEXT,
					FIELD_STATE,
				)}
				{...props}
			/>
			{hasContent(end) && <span className="flex shrink-0 items-center me-2">{end}</span>}
		</div>
	)
})
Input.displayName = "Input"

export { Input }
