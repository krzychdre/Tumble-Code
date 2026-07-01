/**
 * Relevant-memory prefetch lifecycle.
 *
 * Ported from Claude Code's `startRelevantMemoryPrefetch` (utils/attachments.ts).
 * Roo has no `using`/Disposable, so the handle exposes an explicit `dispose()`
 * for try/finally cleanup instead.
 *
 * The prefetch is fired once per user turn and is NON-BLOCKING: the consume
 * point in the task loop polls `settledAt` and only `await`s the (already
 * settled) promise, so a slow ranker never stalls the first iteration.
 *
 * Single-word prompts are skipped (no term-extraction signal). The abort
 * controller is double-chained: to the task's `currentRequestAbortController`
 * (so Escape cancels immediately) and to `dispose()` (so generator exit cancels
 * even if the task controller lingers).
 */

import { getAutoMemPath, isAutoMemoryEnabled } from "./paths"
import {
	findRelevantMemories,
	type SideQuery,
	type RecentToolMessageView,
	collectRecentSuccessfulTools,
} from "./relevance"
import { type RelevantMemory, type FileStateCache, collectSurfacedMemories, MAX_SESSION_BYTES } from "./surfacing"

export { type SideQuery, type RecentToolMessageView } from "./relevance"
export { type RelevantMemory, type FileStateCache } from "./surfacing"

/** Minimal message view the prefetch needs to find the last user message. */
export interface PrefetchMessage {
	type: string
	/** True for meta/system messages that should be skipped when finding the last user turn. */
	isMeta?: boolean
	/** The user message text (only for `type === "user"`). */
	text?: string
	/** Attachment payload, for cumulative-byte accounting. */
	attachment?: { type: string; memories?: RelevantMemory[] }
}

export interface MemoryPrefetch {
	/** Resolves to the surfaced memories (possibly []). Never rejects. */
	promise: Promise<RelevantMemory[]>
	/** Wall-clock ms when the promise settled, or null if still pending. */
	settledAt: number | null
	/** Which loop iteration consumed this, or -1 if not yet consumed. */
	consumedOnIteration: number
	/** Abort the in-flight ranker. Idempotent. */
	dispose(): void
}

export interface PrefetchContext {
	/** The workspace cwd — selects the memory dir. */
	cwd: string
	/** Whether recall is enabled (the `memoryRecallEnabled` setting). */
	recallEnabled: boolean
	/** The cumulative read-file cache (dedup against tool reads + prior surfaces). */
	readFileState: FileStateCache
	/** The side-query adapter (wired to the task's ApiHandler). */
	sideQuery: SideQuery
	/** The task-level abort controller to chain to. */
	parentAbortController?: AbortController
}

function isWhitespaceOnly(s: string): boolean {
	return !/\s/.test(s.trim())
}

/**
 * Start the recall prefetch for the current user turn.
 *
 * Returns `undefined` (no prefetch) when:
 * - memory is disabled, or recall is disabled, or
 * - there's no real user message, or the message is a single word, or
 * - the session has already surfaced ≥ `MAX_SESSION_BYTES` of memory.
 *
 * Otherwise returns a handle whose `promise` resolves to the surfaced
 * memories. The promise never rejects — ranker errors resolve to `[]`.
 */
export function startRelevantMemoryPrefetch(
	messages: ReadonlyArray<PrefetchMessage>,
	context: PrefetchContext,
): MemoryPrefetch | undefined {
	if (!isAutoMemoryEnabled() || !context.recallEnabled) return undefined

	// Find the last non-meta user message.
	let lastUserIndex = -1
	let input = ""
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m && m.type === "user" && !m.isMeta) {
			lastUserIndex = i
			input = m.text ?? ""
			break
		}
	}
	if (lastUserIndex === -1 || !input || isWhitespaceOnly(input)) return undefined

	const surfaced = collectSurfacedMemories(messages as any)
	if (surfaced.totalBytes >= MAX_SESSION_BYTES) return undefined

	// Chain abort to the parent (task) controller so Escape cancels immediately.
	const controller = new AbortController()
	const parent = context.parentAbortController
	const onParentAbort = () => controller.abort()
	if (parent) {
		if (parent.signal.aborted) controller.abort()
		else parent.signal.addEventListener("abort", onParentAbort, { once: true })
	}

	const memoryDir = getAutoMemPath(context.cwd)
	const recentTools = collectRecentSuccessfulTools(
		messages as unknown as ReadonlyArray<RecentToolMessageView>,
		lastUserIndex,
	)

	const promise = findRelevantMemories(
		input,
		memoryDir,
		controller.signal,
		recentTools,
		surfaced.paths,
		context.sideQuery,
	).catch(() => [] as RelevantMemory[])

	const handle: MemoryPrefetch = {
		promise,
		settledAt: null,
		consumedOnIteration: -1,
		dispose() {
			controller.abort()
			if (parent) parent.signal.removeEventListener("abort", onParentAbort)
		},
	}
	void promise.finally(() => {
		handle.settledAt = Date.now()
	})
	return handle
}
