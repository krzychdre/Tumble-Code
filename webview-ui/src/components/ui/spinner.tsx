import * as React from "react"

import { cn } from "@/lib/utils"

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
	/**
	 * What is loading, already translated. With a label the spinner is a polite
	 * live status that screen readers announce; without one it is decorative
	 * (use that next to visible text such as "Creating...").
	 */
	label?: string
}

/**
 * The webview's one loading indicator: an indeterminate ring in VS Code's
 * progress bar colour. Default size 28px; call sites size it with classes such
 * as `size-4`. The look and the spin come from the `.ui-progress-ring` rules in
 * `index.css`.
 *
 * The primitives do not import the translation context (many specs mock
 * react-i18next without initialising it), so call sites pass a translated
 * `label`.
 */
const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(({ label, className, ...props }, ref) => (
	<span
		ref={ref}
		role={label ? "status" : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		className={cn("ui-progress-ring", className)}
		{...props}>
		<svg className="ui-progress-ring-svg" viewBox="0 0 16 16" aria-hidden="true">
			<circle className="ui-progress-ring-background" cx="8px" cy="8px" r="7px" />
			<circle className="ui-progress-ring-indicator" cx="8px" cy="8px" r="7px" />
		</svg>
	</span>
))
Spinner.displayName = "Spinner"

export { Spinner }
