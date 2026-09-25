import { useEffect, useMemo, useRef, useState } from "react"

import type { TUIMessage } from "../types.js"
import type { WelcomeBannerProps } from "../components/WelcomeBanner.js"
import { getStaticCount, buildStaticItems, nextPromotion, type StaticItem } from "../transcript.js"
import { advanceStreamCommit, tailHeads, type StreamCommits } from "../streamCommit.js"

export interface UseTranscriptPromotionOptions {
	messages: TUIMessage[]
	isLoading: boolean
	hasPendingAsk: boolean
	verboseTranscript: boolean
	transcriptReprintEpoch: number
	welcomeProps: WelcomeBannerProps
}

export interface UseTranscriptPromotionReturn {
	/** Part of the `<Static>` key: bumped when a task switch replaced the transcript. */
	staticKey: number
	/** What the `<Static>` region prints (banner, promoted messages, committed stream lines). */
	staticItems: StaticItem[]
	/** Messages still re-rendering in the dynamic tail. */
	dynamicMessages: TUIMessage[]
	/** What was printed of streaming answers before they completed. */
	streamCommits: StreamCommits
	/** The tail head whose finished lines are already in scrollback, if any. */
	committedHead: TUIMessage | undefined
}

/**
 * The transcript split (plan §3): which messages are final and go into ink's
 * `<Static>` scrollback, which stay in the dynamic tail, and how much of a
 * streaming answer has already been committed line by line.
 *
 * The effect order here is load-bearing: promotion runs before the stream
 * commit, exactly as it did inline in `App`.
 */
export function useTranscriptPromotion({
	messages,
	isLoading,
	hasPendingAsk,
	verboseTranscript,
	transcriptReprintEpoch,
	welcomeProps,
}: UseTranscriptPromotionOptions): UseTranscriptPromotionReturn {
	// The collapsed thinking row does not show the reasoning text, so a thinking
	// message the answer has already moved past can be printed before the core's
	// late finalization arrives (see `getStaticCount`).
	const staticCount = getStaticCount(messages, isLoading, hasPendingAsk, {
		settleSupersededThinking: !verboseTranscript,
	})

	// Monotonicity + task-switch reset detection. `staticKey` remounts the
	// `<Static>` region when the message array identity changes (task switch
	// cleared it), so the old scrollback stays above a fresh region. The rule
	// itself lives in `nextPromotion` so it can be tested on its own.
	const [staticKey, setStaticKey] = useState(0)
	const [prevStaticCount, setPrevStaticCount] = useState(0)
	// `prevIds` is only consulted inside the effect below to detect task-switch
	// resets (it never participates in rendering) so it lives in a ref instead
	// of state. Keeping it in state made it an effect dependency, and since we
	// rebuild a fresh ids array on every run, the new identity retriggered the
	// effect unconditionally, which ended in "Maximum update depth exceeded".
	const prevIdsRef = useRef<string[]>([])
	// Mirror of `prevStaticCount` for the effect to read. Reading the state
	// itself would need it in the dependency list, which would re-run the
	// effect on its own update.
	const promotedRef = useRef(0)
	// What was printed of streaming answers before they completed (see
	// `streamCommit.ts`). Belongs to the current `<Static>` region, so it is
	// dropped together with it.
	const [streamCommits, setStreamCommits] = useState<StreamCommits>({})

	useEffect(() => {
		const messageIds = messages.map((m) => m.id)
		const next = nextPromotion({
			messageIds,
			previousIds: prevIdsRef.current,
			staticCount,
			promoted: promotedRef.current,
		})
		if (next.remount) {
			setStaticKey((k) => k + 1)
		}
		if (next.remount || messageIds.length === 0) {
			setStreamCommits((commits) => (Object.keys(commits).length === 0 ? commits : {}))
		}
		promotedRef.current = next.promoted
		setPrevStaticCount(next.promoted)
		prevIdsRef.current = messageIds
	}, [messages, staticCount])

	const effectiveStaticCount = Math.max(prevStaticCount, staticCount)
	const staticMessages = messages.slice(0, effectiveStaticCount)
	const dynamicMessages = messages.slice(effectiveStaticCount)

	// Stream the answer into scrollback line by line (plan: 2026-09-22 cli
	// stream answer into scrollback).
	const { streaming: streamingHead, committed: committedHead } = tailHeads(dynamicMessages[0], streamCommits)

	useEffect(() => {
		if (!streamingHead) {
			return
		}
		setStreamCommits((commits) => {
			const next = advanceStreamCommit(streamingHead.content, commits[streamingHead.id])
			return next ? { ...commits, [streamingHead.id]: next } : commits
		})
	}, [streamingHead])

	const staticItems = useMemo<StaticItem[]>(
		() =>
			buildStaticItems({
				messages: staticMessages,
				welcomeProps,
				expanded: verboseTranscript,
				reprintEpoch: transcriptReprintEpoch,
				commits: streamCommits,
				streamingHead: committedHead,
			}),
		[staticMessages, welcomeProps, verboseTranscript, transcriptReprintEpoch, streamCommits, committedHead],
	)

	return { staticKey, staticItems, dynamicMessages, streamCommits, committedHead }
}
