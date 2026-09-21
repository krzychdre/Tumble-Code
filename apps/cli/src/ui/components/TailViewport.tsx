import { Box, type DOMElement } from "ink"
import { useInsertionEffect, useLayoutEffect, useReducer, useRef, type ReactNode } from "react"

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
 * The cap is a yoga max-height, not a fixed height. The previous
 * implementation measured the content after each commit and fed the result
 * back through state as a fixed `height`, which lagged one frame: when the
 * agent went idle and the whole tail was promoted into `<Static>`, the next
 * frame still had the old (full-screen) height with blank filler rows above
 * the short content. Ink writes that frame right after the promoted
 * transcript, so the tall blank frame scrolled the freshly printed answer off
 * the screen and left the prompt at the top of an empty window. With a
 * max-height the box is never taller than its content, so there is nothing
 * to lag. Ink's `Box` has no `maxHeight` prop, hence the direct yoga calls.
 *
 * Timing: ink computes the layout and writes the frame in the reconciler's
 * `resetAfterCommit`, which React runs after the mutation phase and before
 * layout effects. So:
 * - on updates the cap is (re)applied in an insertion effect, which runs in
 *   the mutation phase, i.e. before that commit's layout;
 * - on mount the node does not exist before the commit, so the first frame is
 *   laid out without the cap. The layout effect then applies it and, only if
 *   that first frame exceeded the cap, forces one more commit to redraw it
 *   clipped. In the app the viewport mounts once, with a tiny tail.
 *
 * The inner box must not shrink (`flexShrink={0}`): with the default
 * `flexShrink`, yoga squashes children into the capped box instead of
 * letting it overflow upward into the clip region.
 */
export default function TailViewport({ maxRows, children }: TailViewportProps) {
	const outerRef = useRef<DOMElement>(null)
	const cap = Math.max(1, Math.floor(maxRows))
	const [, forceRender] = useReducer((n: number) => n + 1, 0)

	useInsertionEffect(() => {
		outerRef.current?.yogaNode?.setMaxHeight(cap)
	}, [cap])

	useLayoutEffect(() => {
		const node = outerRef.current?.yogaNode
		if (!node) {
			return
		}
		node.setMaxHeight(cap)
		if (node.getComputedHeight() > cap) {
			forceRender()
		}
	}, [cap])

	return (
		<Box ref={outerRef} flexDirection="column" overflowY="hidden" justifyContent="flex-end">
			<Box flexDirection="column" flexShrink={0}>
				{children}
			</Box>
		</Box>
	)
}
