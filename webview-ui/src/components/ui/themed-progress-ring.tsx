import * as React from "react"

import { cn } from "@/lib/utils"

export type ThemedProgressRingProps = React.HTMLAttributes<HTMLSpanElement>

/**
 * An indeterminate spinning ring in VS Code's progress bar colour, the
 * replacement for the deprecated toolkit's `VSCodeProgressRing`. Default size
 * 28px; call sites shrink it with classes such as `size-3`.
 *
 * Like the toolkit it announces itself to screen readers as a live "Loading"
 * alert (role="alert", aria-label="Loading", aria-live="assertive"); a call
 * site can override those props. The look and the spin animation come from
 * the `.ui-progress-ring` rules in `index.css`.
 */
const ThemedProgressRing = React.forwardRef<HTMLSpanElement, ThemedProgressRingProps>(
	({ className, ...props }, ref) => (
		<span
			ref={ref}
			role="alert"
			aria-label="Loading"
			aria-live="assertive"
			className={cn("ui-progress-ring", className)}
			{...props}>
			<svg className="ui-progress-ring-svg" viewBox="0 0 16 16" aria-hidden="true">
				<circle className="ui-progress-ring-background" cx="8px" cy="8px" r="7px" />
				<circle className="ui-progress-ring-indicator" cx="8px" cy="8px" r="7px" />
			</svg>
		</span>
	),
)
ThemedProgressRing.displayName = "ThemedProgressRing"

export { ThemedProgressRing }
