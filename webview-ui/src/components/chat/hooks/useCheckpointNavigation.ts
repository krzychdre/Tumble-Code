import type React from "react"
import { useCallback, useEffect, useRef } from "react"
import type { VirtuosoHandle } from "react-virtuoso"

interface CheckpointNavigationOptions {
	/** Indices (in the rendered list) of the rows with a checkpoint, oldest first. */
	checkpointIndices: number[]
	taskTs: number | undefined
	virtuosoRef: React.RefObject<VirtuosoHandle>
	enterUserBrowsingHistory: (reason: "keyboard-nav-up") => void
	handleScrollToBottomClick: () => void
}

/**
 * "Jump to the previous checkpoint": each press scrolls one checkpoint further
 * back, starting from the newest. Scrolling to the bottom, a task switch or a
 * new checkpoint starts over from the newest.
 */
export function useCheckpointNavigation({
	checkpointIndices,
	taskTs,
	virtuosoRef,
	enterUserBrowsingHistory,
	handleScrollToBottomClick,
}: CheckpointNavigationOptions) {
	const checkpointJumpCursorRef = useRef<number | null>(null)

	// Narrow the dep to `.length` so streamed message ticks don't clobber the user's
	// checkpoint-jump cursor mid-scroll. Ported from Zoo-Code 5ea544d07 by Elliott de Launay;
	// applied as-is here (no behavioral changes beyond the upstream patch).
	useEffect(() => {
		checkpointJumpCursorRef.current = null
	}, [taskTs, checkpointIndices.length])

	const handleScrollToBottomAndResetCheckpointCursor = useCallback(() => {
		checkpointJumpCursorRef.current = null
		handleScrollToBottomClick()
	}, [handleScrollToBottomClick])

	const handleScrollToLatestCheckpoint = useCallback(() => {
		if (checkpointIndices.length === 0) {
			return
		}

		const previousCursor = checkpointJumpCursorRef.current
		const nextCursor = previousCursor === null ? checkpointIndices.length - 1 : Math.max(0, previousCursor - 1)
		const nextCheckpointIndex = checkpointIndices[nextCursor]
		checkpointJumpCursorRef.current = nextCursor

		enterUserBrowsingHistory("keyboard-nav-up")
		virtuosoRef.current?.scrollToIndex({
			index: nextCheckpointIndex,
			align: "center",
			behavior: "smooth",
		})
	}, [checkpointIndices, enterUserBrowsingHistory, virtuosoRef])

	return {
		hasLatestCheckpoint: checkpointIndices.length > 0,
		handleScrollToBottomAndResetCheckpointCursor,
		handleScrollToLatestCheckpoint,
	}
}
