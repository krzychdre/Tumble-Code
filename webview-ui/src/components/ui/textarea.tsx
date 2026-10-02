import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The one multi-line text field, with VS Code's look: the dropdown border, the
 * input colours, the editor font size, 9px padding, the focus shown as a
 * focusBorder-coloured border (no outline), 40% opacity when disabled. Not
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
					"border border-vscode-dropdown-border bg-vscode-input-background text-vscode-input-foreground",
					"text-base leading-[normal] placeholder:text-[#757575]",
					"focus:border-vscode-focusBorder disabled:cursor-not-allowed disabled:opacity-40 read-only:cursor-not-allowed",
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
