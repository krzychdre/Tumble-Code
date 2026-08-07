import { Box, measureElement, type DOMElement } from "ink"
import { useEffect, useRef, useState, type ReactNode } from "react"

interface TailViewportProps {
	/** Hard cap for the tail's rendered height (physical rows). */
	maxRows: number
	children: ReactNode
}

/**
 * Hard height bound for the dynamic tail (plan: 2026-08-07 clamp dynamic
 * tail, addendum).
 *
 * Ink can only reposition/erase inside the visible viewport. Whenever the
 * dynamic region's height reaches the terminal height, frames scroll their
 * own top rows into scrollback (permanent duplicates) and ink oscillates
 * between its clearTerminal fallback and normal rendering with a stale line
 * count, corrupting the visible region. Per-component clamps can't guarantee
 * the invariant — dialogs, spinner, margins and wraps all add up — so this
 * viewport enforces it structurally: the tail is clipped to `maxRows`,
 * bottom-anchored (`flex-end`), so the newest rows — input, dialogs — always
 * stay visible and the clipped rows are the oldest.
 *
 * The inner box must not shrink (`flexShrink={0}`): with the default
 * `flexShrink`, yoga squashes children into the fixed-height box instead of
 * letting it overflow upward into the clip region.
 *
 * Height tracks the content's natural height (measured after each commit)
 * capped at `maxRows`, so a short tail renders at its natural height with no
 * filler rows. The one-frame lag after a content jump only affects which rows
 * are clipped — the cap itself always holds.
 */
export default function TailViewport({ maxRows, children }: TailViewportProps) {
	const innerRef = useRef<DOMElement>(null)
	const [height, setHeight] = useState<number | undefined>(undefined)

	useEffect(() => {
		if (!innerRef.current) {
			return
		}
		const natural = measureElement(innerRef.current).height
		const next = Math.min(natural, Math.max(1, maxRows))
		setHeight((prev) => (prev === next ? prev : next))
	})

	return (
		<Box flexDirection="column" height={height} overflowY="hidden" justifyContent="flex-end">
			<Box ref={innerRef} flexDirection="column" flexShrink={0}>
				{children}
			</Box>
		</Box>
	)
}
