import * as React from "react"

import { cn } from "@/lib/utils"

export type ThemedBadgeProps = React.HTMLAttributes<HTMLSpanElement>

/**
 * A small pill for a count or a short label, with VS Code's badge colours:
 * the replacement for the deprecated toolkit's `VSCodeBadge`. The existing
 * `Badge` in this folder is a different, larger style and stays as it is.
 *
 * Like the toolkit it has an outer element, which takes the call site's
 * className and style (font size, opacity), and an inner pill. The look comes
 * from the `.ui-badge` rules in `index.css` (components layer, so a call
 * site's utility classes win).
 */
const ThemedBadge = React.forwardRef<HTMLSpanElement, ThemedBadgeProps>(({ className, children, ...props }, ref) => (
	<span ref={ref} className={cn("ui-badge", className)} {...props}>
		<span className="ui-badge-control">{children}</span>
	</span>
))
ThemedBadge.displayName = "ThemedBadge"

export { ThemedBadge }
