import * as React from "react"

import { cn } from "@/lib/utils"

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

/**
 * A text link that looks and behaves like VS Code's own links, the drop-in
 * replacement for the deprecated toolkit's `VSCodeLink`.
 *
 * It renders a plain `<a>`, so clicks behave as before inside the webview:
 * VS Code's webview host opens any clicked `<a href>` itself (external URLs
 * in the browser, `#` scrolls to the top) unless a handler calls
 * `preventDefault()`, and the toolkit's anchor went through the same path.
 *
 * The look comes from the `.ui-link` rules in `index.css`. They sit in the
 * `components` cascade layer on purpose: any utility class a call site passes
 * (a colour, a font size, `underline`, `inline`) then wins, even over the
 * hover and focus states, exactly as outer classes beat the toolkit's shadow
 * `:host` styles.
 *
 * The children get one wrapping span, standing in for the toolkit's inner
 * anchor: a call site's `flex` display lays the link out as a single item, and
 * the span carries the hover underline and the focus frame, so both keep the
 * toolkit's size whatever display the call site picks.
 */
const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(({ className, children, ...props }, ref) => (
	<a ref={ref} className={cn("ui-link", className)} {...props}>
		<span className="ui-link-content">{children}</span>
	</a>
))
Link.displayName = "Link"

export { Link }
