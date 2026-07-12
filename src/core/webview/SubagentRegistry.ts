import type { ExtensionMessage, SubagentStatus, SubagentSummary } from "@roo-code/types"

/** Cap on the terminal-state message carried in a summary (transport size). */
const FINAL_MESSAGE_MAX_CHARS = 4000

const TERMINAL_STATUSES: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "cancelled"])

/**
 * Deterministic placeholder id for a subtask registered at fan-out time,
 * before its child Task exists (queued behind the concurrency limit or still
 * creating its worktree). Replaced by the real taskId via {@link
 * SubagentRegistry.register}.
 */
export function queuedSubagentId(parentTaskId: string, index: number): string {
	return `queued:${parentTaskId}:${index}`
}

/**
 * In-memory registry of parallel background subagents (`run_parallel_tasks`
 * children), the source of truth for the webview subagents panel.
 *
 * Holds one lightweight {@link SubagentSummary} per subtask of the most recent
 * fan-out per parent, plus the set of subagents whose live message tail the
 * webview is currently subscribed to. Every mutation pushes the full summary
 * list to the webview (`subagentsUpdated`) — the list is small (fan-outs are
 * a handful of subtasks) and full pushes keep the webview merge trivial.
 *
 * Memory-writer background tasks never register here, so they stay invisible.
 */
export class SubagentRegistry {
	private summaries = new Map<string, SubagentSummary>()
	private watched = new Set<string>()

	constructor(private readonly post: (message: ExtensionMessage) => void) {}

	/**
	 * Start a new fan-out for `parentTaskId`: drop the previous fan-out's
	 * entries (and their watch flags) so the panel only ever shows the live
	 * generation.
	 */
	beginFanOut(parentTaskId: string): void {
		let changed = false
		for (const [taskId, summary] of this.summaries) {
			if (summary.parentTaskId === parentTaskId) {
				this.summaries.delete(taskId)
				this.watched.delete(taskId)
				changed = true
			}
		}
		if (changed) {
			this.postUpdate()
		}
	}

	/** Alias with intent: a parent task is gone — remove its fan-out entries. */
	clearForParent(parentTaskId: string): void {
		this.beginFanOut(parentTaskId)
	}

	/**
	 * Register a queued placeholder for subtask `index` before its child Task
	 * exists. No-op if an entry with that placeholder id is already present.
	 */
	registerQueued(summary: Omit<SubagentSummary, "taskId" | "status">): void {
		const taskId = queuedSubagentId(summary.parentTaskId, summary.index)
		if (this.summaries.has(taskId)) {
			return
		}
		this.summaries.set(taskId, { ...summary, taskId, status: "queued" })
		this.postUpdate()
	}

	/**
	 * Register a live subagent. Replaces the queued placeholder for the same
	 * (parent, index) slot, carrying a watch flag over so a tail opened on the
	 * placeholder keeps streaming once the child starts.
	 */
	register(summary: SubagentSummary): void {
		const placeholderId = queuedSubagentId(summary.parentTaskId, summary.index)
		if (this.summaries.delete(placeholderId) && this.watched.delete(placeholderId)) {
			this.watched.add(summary.taskId)
		}
		this.summaries.set(summary.taskId, summary)
		this.postUpdate()
	}

	/** Merge `patch` into an existing summary; unknown ids are ignored. */
	update(taskId: string, patch: Partial<Omit<SubagentSummary, "taskId">>): void {
		const existing = this.summaries.get(taskId)
		if (!existing) {
			return
		}
		this.summaries.set(taskId, { ...existing, ...patch, taskId, lastActivityAt: Date.now() })
		this.postUpdate()
	}

	/**
	 * Non-terminal status transition ("running" ⇄ "awaiting_input"). Ignored
	 * once the subagent is terminal — late TaskActive/TaskInteractive events
	 * from a torn-down child must not resurrect it.
	 */
	setLiveStatus(taskId: string, status: Extract<SubagentStatus, "running" | "awaiting_input">): void {
		const existing = this.summaries.get(taskId)
		if (!existing || TERMINAL_STATUSES.has(existing.status)) {
			return
		}
		if (existing.status !== status) {
			this.update(taskId, { status })
		}
	}

	/**
	 * Terminal transition. First terminal status wins — with one refinement:
	 * a generic "failed" (from the TaskAborted listener) may be upgraded to
	 * "cancelled" when the fan-out later learns the abort was a cancellation.
	 * A `finalMessage` fills in whenever the slot is still empty.
	 */
	markTerminal(
		taskId: string,
		status: Extract<SubagentStatus, "completed" | "failed" | "cancelled">,
		finalMessage?: string,
	): void {
		const existing = this.summaries.get(taskId)
		if (!existing) {
			return
		}
		const truncated =
			finalMessage && finalMessage.length > FINAL_MESSAGE_MAX_CHARS
				? `${finalMessage.slice(0, FINAL_MESSAGE_MAX_CHARS)}…`
				: finalMessage
		if (TERMINAL_STATUSES.has(existing.status)) {
			const refinesToCancelled = existing.status === "failed" && status === "cancelled"
			const fillsFinalMessage = !existing.finalMessage && truncated
			if (refinesToCancelled || fillsFinalMessage) {
				this.update(taskId, {
					status: refinesToCancelled ? status : existing.status,
					finalMessage: existing.finalMessage ?? truncated,
				})
			}
			return
		}
		this.update(taskId, { status, finalMessage: truncated ?? existing.finalMessage })
	}

	get(taskId: string): SubagentSummary | undefined {
		return this.summaries.get(taskId)
	}

	has(taskId: string): boolean {
		return this.summaries.has(taskId)
	}

	/** Panel ordering: fan-out registration order (parent, then index). */
	list(): SubagentSummary[] {
		return [...this.summaries.values()].sort(
			(a, b) => a.parentTaskId.localeCompare(b.parentTaskId) || a.index - b.index,
		)
	}

	watch(taskId: string): void {
		this.watched.add(taskId)
	}

	unwatch(taskId: string): void {
		this.watched.delete(taskId)
	}

	/** Consulted by TaskHistory before streaming a background task's messages. */
	isWatched(taskId: string): boolean {
		return this.watched.has(taskId)
	}

	private postUpdate(): void {
		this.post({ type: "subagentsUpdated", subagents: this.list() })
	}
}
