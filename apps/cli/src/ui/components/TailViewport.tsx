import { Box } from "ink"
import type { ReactNode } from "react"

interface TailViewportProps {
	/** Hard cap for the tail's rendered height (physical rows). */
	maxRows: number
	children: ReactNode
}

/**
 * Hard height bound for the dynamic tail (plans: 2026-08-07 clamp dynamic
 * tail, addendum; 2026-09-21 tail viewport stale height).
 *
 * Ink can only reposition/erase inside the visible viewport. Whenever the
 * dynamic region's height reaches the terminal height, frames scroll their
 * own top rows into scrollback (permanent duplicates) and ink oscillates
 * between its clearTerminal fallback and normal rendering with a stale line
 * count, corrupting the visible region. Per-component clamps can't guarantee
 * the invariant (dialogs, spinner, margins and wraps all add up), so this
 * viewport enforces it structurally: the tail is clipped to `maxRows`,
 * bottom-anchored (`flex-end`), so the newest rows (input, dialogs) always
 * stay visible and the clipped rows are the oldest.
 *
 * The cap is a max-height, not a fixed height, so the box is never taller
 * than its content: a measured fixed height lags one frame, and the frame
 * written right after the tail is promoted into `<Static>` then still has
 * the old full-screen height and scrolls the freshly printed answer off the
 * screen.
 *
 * The inner box must not shrink (`flexShrink={0}`): with the default
 * `flexShrink`, yoga squashes children into the capped box instead of
 * letting it overflow upward into the clip region.
 */
export default function TailViewport({ maxRows, children }: TailViewportProps) {
	return (
		<Box
			flexDirection="column"
			maxHeight={Math.max(1, Math.floor(maxRows))}
			overflowY="hidden"
			justifyContent="flex-end">
			<Box flexDirection="column" flexShrink={0}>
				{children}
			</Box>
		</Box>
	)
}
