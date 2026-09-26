import * as React from "react"

import { cn } from "@/lib/utils"

export interface ThemedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	/** Same values as the toolkit's `appearance`: filled primary, filled secondary, or a bare icon. */
	appearance?: "primary" | "secondary" | "icon"
}

/**
 * A button that looks like VS Code's own buttons, the replacement for the
 * deprecated toolkit's `VSCodeButton` (same `appearance` prop, so a call site
 * only changes the tag).
 *
 * It is one native `<button type="button">`: the toolkit's host element and
 * its inner button are merged, so the call site's className and style land
 * on the element that is clicked and focused. The children get one flex
 * wrapper, like the toolkit's `content` part; a direct `<span>` or `<svg>`
 * child (a codicon) is sized 16x16 as the toolkit did.
 *
 * The look comes from the `.ui-themed-button` rules in `index.css`, which sit
 * in the `components` layer so a call site's utility classes win.
 */
const ThemedButton = React.forwardRef<HTMLButtonElement, ThemedButtonProps>(
	({ appearance = "primary", className, children, type = "button", ...props }, ref) => (
		<button
			ref={ref}
			type={type}
			className={cn("ui-themed-button", className)}
			data-appearance={appearance}
			{...props}>
			<span className="ui-themed-button-content">{children}</span>
		</button>
	),
)
ThemedButton.displayName = "ThemedButton"

export { ThemedButton }
