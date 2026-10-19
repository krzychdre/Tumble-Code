import { TaskStatus } from "@tumble-code/types"

import {
	formatSubagentList,
	formatSubagentUpdate,
	type FinishedSubagent,
	type ParallelSubtaskResult,
	type SubagentRef,
} from "../tools/helpers/subagentResults"
import { SubagentSlotPool } from "./SubagentSlotPool"

/** What the tracker needs from the live instance of a parent task. */
export interface LiveParentTask {
	readonly abort: boolean
	readonly taskStatus: TaskStatus
	readonly messageQueueService: { addMessage(text: string): unknown }
}

/** What the tracker needs from its provider. */
export interface BackgroundSubagentsHost {
	/** The current live instance of a task (see ClineProvider.getLiveTaskInstance). */
	getLiveTaskInstance(taskId: string): LiveParentTask | undefined
}

/** The subagents of one parent task. */
interface ParentSubagents {
	/** The number the next subagent of this parent gets. */
	nextNumber: number
	running: Map<number, SubagentRef>
	/** Finished subagents whose result the parent model has not read yet. */
	unread: FinishedSubagent[]
	/** Called on every change; a listener means somebody waits (wait_for_subagents). */
	listeners: Set<() => void>
}

/**
 * The parallel subagents running in the background, per parent task, for
 * one provider. Owned by ClineProvider next to the subagent registry (which
 * feeds the panel); this class feeds the parent MODEL.
 *
 * Keyed by parent task id, not by Task instance: a parent can be rebuilt
 * into a new instance (opened from history, rehydrated after a failure)
 * while its subagents keep running, and the new instance must see them.
 *
 * A result that finishes while nobody waits stays unread until the next
 * wait_for_subagents. When the parent's turn already ended (it sits at an
 * idle or resumable ask), the results are queued to it as a user message
 * instead, which wakes it up.
 */
export class BackgroundSubagents {
	/** The provider-wide cap on subagents running at once. */
	readonly slots = new SubagentSlotPool()
	private readonly parents = new Map<string, ParentSubagents>()

	constructor(private readonly host: BackgroundSubagentsHost) {}

	private entry(parentTaskId: string): ParentSubagents {
		let entry = this.parents.get(parentTaskId)
		if (!entry) {
			entry = { nextNumber: 1, running: new Map(), unread: [], listeners: new Set() }
			this.parents.set(parentTaskId, entry)
		}
		return entry
	}

	/** Record a subagent that was just requested (it may still wait for a slot). */
	start(parentTaskId: string, subagent: { description: string; mode: string }): SubagentRef {
		const entry = this.entry(parentTaskId)
		const ref: SubagentRef = { number: entry.nextNumber++, ...subagent }
		entry.running.set(ref.number, ref)
		return ref
	}

	/**
	 * Record that subagent `number` ended. Without a result the outcome is
	 * dropped: the user cancelled the parent, so nobody should be woken up
	 * to read it.
	 */
	finish(parentTaskId: string, number: number, result?: ParallelSubtaskResult): void {
		const entry = this.parents.get(parentTaskId)
		const ref = entry?.running.get(number)
		if (!entry || !ref) {
			return
		}
		entry.running.delete(number)
		if (result) {
			entry.unread.push({ ...ref, result })
		}
		for (const listener of [...entry.listeners]) {
			listener()
		}
		if (entry.listeners.size === 0) {
			this.deliverIfIdle(parentTaskId)
		}
	}

	/** The subagents of `parentTaskId` still running (or waiting for a slot). */
	running(parentTaskId: string): SubagentRef[] {
		return [...(this.parents.get(parentTaskId)?.running.values() ?? [])]
	}

	/** How many finished subagents of `parentTaskId` the model has not read. */
	unreadCount(parentTaskId: string): number {
		return this.parents.get(parentTaskId)?.unread.length ?? 0
	}

	/** Whether `parentTaskId` has subagents running or results it has not read. */
	hasWork(parentTaskId: string): boolean {
		return this.running(parentTaskId).length > 0 || this.unreadCount(parentTaskId) > 0
	}

	/** Hand over the unread results of `parentTaskId`; they count as read from now on. */
	takeUnread(parentTaskId: string): FinishedSubagent[] {
		const entry = this.parents.get(parentTaskId)
		if (!entry) {
			return []
		}
		const unread = entry.unread
		entry.unread = []
		return unread
	}

	/**
	 * Call `listener` whenever a subagent of `parentTaskId` ends. While a
	 * listener is subscribed, results are never queued to the parent: the
	 * waiter reads them. Returns the unsubscribe function.
	 */
	subscribe(parentTaskId: string, listener: () => void): () => void {
		const entry = this.entry(parentTaskId)
		entry.listeners.add(listener)
		return () => entry.listeners.delete(listener)
	}

	/**
	 * Queue the unread results to the parent's live instance when its turn
	 * ended (idle or resumable ask) and nobody waits for them. The queued
	 * message answers that ask, so the parent continues with the results.
	 * Called when a result arrives and when a task turns idle or resumable.
	 */
	deliverIfIdle(parentTaskId: string): void {
		const entry = this.parents.get(parentTaskId)
		if (!entry || entry.unread.length === 0 || entry.listeners.size > 0) {
			return
		}
		const parent = this.host.getLiveTaskInstance(parentTaskId)
		if (!parent || parent.abort) {
			return
		}
		if (parent.taskStatus !== TaskStatus.Idle && parent.taskStatus !== TaskStatus.Resumable) {
			return
		}
		const finished = this.takeUnread(parentTaskId)
		parent.messageQueueService.addMessage(
			`Results of your parallel subagents arrived while this task was waiting.\n\n${formatSubagentUpdate(
				finished,
				this.running(parentTaskId),
			)}`,
		)
	}

	/**
	 * The environment-details section of a parent with background subagents,
	 * or undefined when it has none running and nothing unread.
	 */
	environmentSection(parentTaskId: string): string | undefined {
		const running = this.running(parentTaskId)
		const unread = this.unreadCount(parentTaskId)
		if (running.length === 0 && unread === 0) {
			return undefined
		}
		const lines = ["# Background Subagents"]
		if (running.length > 0) {
			lines.push(`Still running (${running.length}):`, formatSubagentList(running))
		}
		if (unread > 0) {
			lines.push(`Finished, results not read yet: ${unread}.`)
		}
		lines.push(
			"Call wait_for_subagents to collect their results. Do not call attempt_completion before every subagent has reported.",
		)
		return lines.join("\n")
	}
}
