/**
 * Memory ↔ Task integration glue.
 *
 * This module keeps the Task-layer changes (TaskApiLoop, TaskLifecycle) thin
 * by concentrating the recall-prefetch lifecycle and the background-writer
 * sub-Task wiring here. It wires:
 * - a {@link SideQuery} adapter over the task's `ApiHandler.completePrompt`;
 * - the recall prefetch start/consume against the task's `readFileState` and
 *   abort controller;
 * - a sandboxed {@link SubTaskRunner} for extract/dream that delegates to a
 *   real `Task` spawn with a memory-write-only sandbox.
 *
 * The Task classes hold a single `MemoryCoordinator` instance; the loop/lifecycle
 * call into it at the documented hook points.
 */

import { Anthropic } from "@anthropic-ai/sdk"

import { type ApiHandler, type SingleCompletionHandler } from "../../api"
import { logger } from "../../utils/logging"

import { type SideQuery } from "./relevance"
import { startRelevantMemoryPrefetch, type MemoryPrefetch, type PrefetchMessage } from "./prefetch"
import {
	filterDuplicateMemoryAttachments,
	wrapMemoryAsSystemReminder,
	type RelevantMemory,
	type FileStateCache,
} from "./surfacing"
import { type SubTaskRunner, type SubTaskResult } from "./extractMemories"

/**
 * Build a {@link SideQuery} over a handler that implements
 * {@link SingleCompletionHandler.completePrompt}. Most Roo providers extend
 * `BaseProvider` and implement both `ApiHandler` and `SingleCompletionHandler`,
 * but the intersection isn't statically guaranteed, so we narrow at runtime.
 *
 * The handler's `completePrompt` returns a plain string; we pass our selector
 * system prompt through verbatim (the handler adds its own provider plumbing).
 * On any error we throw so the ranker can detect abort vs failure.
 */
export function makeSideQuery(handler: ApiHandler): SideQuery | undefined {
	const completePrompt = (handler as Partial<SingleCompletionHandler>).completePrompt
	if (typeof completePrompt !== "function") return undefined
	const doComplete: (prompt: string) => Promise<string> = completePrompt.bind(handler)
	return async (system, user, signal) => {
		// `completePrompt` implementations don't all accept an AbortSignal; we
		// race against the signal so an aborted task still unblocks promptly.
		const completion = doComplete(`${system}\n\n${user}`)
		// Attach a no-op catch on a derived promise so that if abort wins the
		// race and `completion` later rejects, the late rejection doesn't surface
		// as an unhandled rejection in the extension host. The race still
		// propagates `completion`'s rejection when abort hasn't fired — the
		// derived handler doesn't affect what `Promise.race` sees.
		completion.catch(() => {})
		if (signal.aborted) throw new Error("aborted")
		const result = await Promise.race([
			completion,
			new Promise<never>((_, reject) => {
				if (signal.aborted) reject(new Error("aborted"))
				else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
			}),
		])
		return result
	}
}

/**
 * Coordinator owning the per-task memory prefetch handle. One instance per Task.
 */
export class MemoryCoordinator {
	private prefetch: MemoryPrefetch | undefined
	private readonly readFileState: FileStateCache
	private readonly cwd: string
	private readonly recallEnabled: boolean
	private readonly sideQuery: SideQuery | undefined

	constructor(params: {
		cwd: string
		recallEnabled: boolean
		readFileState: FileStateCache
		apiHandler?: ApiHandler
	}) {
		this.cwd = params.cwd
		this.recallEnabled = params.recallEnabled
		this.readFileState = params.readFileState
		this.sideQuery = params.apiHandler ? makeSideQuery(params.apiHandler) : undefined
	}

	/**
	 * Start the recall prefetch for the current user turn. Called when a user
	 * message is committed. No-op if recall is disabled, no handler, or the
	 * prefetch gate (single-word, session cap, etc.) rejects.
	 */
	startPrefetch(messages: ReadonlyArray<PrefetchMessage>, parentAbortController?: AbortController): void {
		if (!this.recallEnabled || !this.sideQuery) return
		// Dispose any prior unconsumed prefetch (e.g. multi-turn reuse).
		this.disposePrefetch()
		this.prefetch = startRelevantMemoryPrefetch(messages, {
			cwd: this.cwd,
			recallEnabled: this.recallEnabled,
			readFileState: this.readFileState,
			sideQuery: this.sideQuery,
			parentAbortController,
		})
	}

	/**
	 * Consume the prefetch if it has settled. Returns the `<system-reminder>`
	 * user-message texts to inject, or [] if not yet settled / already consumed
	 * / no memories. Non-blocking: only `await`s an already-settled promise.
	 *
	 * @param iteration The current loop iteration index (for consume-once tracking).
	 */
	async consumePrefetch(iteration: number): Promise<Anthropic.TextBlockParam[]> {
		const p = this.prefetch
		if (!p || p.settledAt === null || p.consumedOnIteration !== -1) return []
		const memories = filterDuplicateMemoryAttachments(await p.promise, this.readFileState)
		p.consumedOnIteration = iteration
		if (memories.length === 0) return []
		return memories.map((m) => ({
			type: "text" as const,
			text: wrapMemoryAsSystemReminder(m),
		}))
	}

	/** Abort + drop the prefetch handle. Called on task abort/dispose. */
	disposePrefetch(): void {
		this.prefetch?.dispose()
		this.prefetch = undefined
	}
}

/**
 * A no-op SubTaskRunner used when background writers can't run (no handler,
 * tests, disabled). Returns an empty written-paths list.
 */
export const noopSubTaskRunner: SubTaskRunner = async () => ({ writtenPaths: [] })

/**
 * Adapt a real Roo sub-Task spawn into the {@link SubTaskRunner} shape.
 *
 * The concrete spawn lives in the Task layer (it needs the provider, context,
 * etc.); this adapter is injected from there so the memory module stays
 * decoupled. The sandbox (read anywhere; write only inside the memory dir) is
 * enforced by the spawn implementation via the `validateToolUse` carve-out +
 * the sub-Task's tool-approval path.
 *
 * @param spawn The provider-specific sub-Task spawner.
 */
export function makeSubTaskRunner(
	spawn: (params: {
		cwd: string
		systemPrompt: string
		userPrompt: string
		maxTurns: number
		signal: AbortSignal
	}) => Promise<{ writtenPaths: string[] }>,
): SubTaskRunner {
	return async (params) => {
		try {
			return await spawn(params)
		} catch (e) {
			logger.error(`[memory] subTaskRunner failed: ${e instanceof Error ? e.message : String(e)}`)
			return { writtenPaths: [] } as SubTaskResult
		}
	}
}

export { type RelevantMemory }
