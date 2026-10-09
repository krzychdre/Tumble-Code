import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one multi-line text field, with the frame language look: the input frame
 * (stronger on hover), 2px corners, the input colours, the editor font size,
 * 9px padding, the focus shown as a focusBorder-coloured border plus a 1px
 * focusBorder outline, 40% opacity when disabled. Not
 * resizable by default; pass `resize-y` for a vertical handle. `rows` sets
 * the height. `ui-textarea` is a marker for the unlayered rules (outline,
 * scrollbar) in `index.css`.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
	({ className, ...props }, ref) => {
		return (
			<textarea
				className={cn(
					"ui-textarea flex w-full p-[9px] resize-none outline-none",
					"rounded-control border border-input-frame hover:border-input-frame-hover bg-vscode-input-background text-vscode-input-foreground transition-colors",
					"text-base leading-[normal] placeholder:text-vscode-descriptionForeground",
					"focus:border-vscode-focusBorder focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-vscode-focusBorder disabled:cursor-not-allowed disabled:opacity-40 read-only:cursor-not-allowed",
					className,
				)}
				ref={ref}
				{...props}
			/>
		)
	},
)
Textarea.displayName = "Textarea"

export { Textarea }
