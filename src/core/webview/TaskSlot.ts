import { TumbleCodeEventName, isIdleAsk, isResumableAsk } from "@tumble-code/types"

import { t } from "../../i18n"
import type { Task } from "../task/Task"
import { logger } from "../../utils/logging"

/**
 * The host seam of {@link TaskSlot}: everything the slot needs from the
 * provider, as constructor-injected callbacks instead of a back-reference to
 * the ClineProvider class (S1, extracted from ClineProvider; see
 * ai_plans/2026-09-28_s1-clineprovider-split.md).
 */
export interface TaskSlotHost {
	/** The provider's settings state; the set path validates its mode. */
	getState(): Promise<{ mode?: unknown }>
	/** Provider-specific setup for a starting task (e.g. the LM Studio model preload). */
	performPreparationTasks(task: Task): Promise<void>
	/** Removes (and runs) the provider's task-event listener cleanups for `task`. */
	removeTaskEventListeners(task: Task): void
	/**
	 * Delegation-aware parent metadata repair (delegated → active); returns
	 * whether the repair applied. See DelegationService.detach.
	 */
	detachDelegatedParent(parentTaskId: string, childTaskId: string): Promise<boolean>
}

/**
 * True while `task` is doing work the user would lose by stopping it: its
 * loop has started, it is not aborted, and its last message is not an ask
 * that ends the work (completion, resume, a failed request). A task blocked
 * on an approval or a question counts as working: it keeps its pending ask.
 */
function isWorking(task: Task): boolean {
	if (!task.isInitialized || task.abort || task.abandoned) {
		return false
	}

	const last = task.clineMessages.at(-1)
	const endsWork =
		last?.type === "ask" && !last.partial && !!last.ask && (isIdleAsk(last.ask) || isResumableAsk(last.ask))
	return !endsWork
}

/** The events after which a detached task no longer works (see {@link TaskSlot.clear}). */
const DETACHED_TASK_END_EVENTS = [
	TumbleCodeEventName.TaskIdle,
	TumbleCodeEventName.TaskResumable,
	TumbleCodeEventName.TaskAborted,
] as const

/**
 * The single foreground task slot (D7 replaced the clineStack array; S1
 * extracts the slot mechanics from ClineProvider), plus the tasks the user
 * left while they were still working ("detached"). Headless background tasks
 * (memory writers, parallel subagents) never come here: they live in
 * BackgroundTaskRunner.
 *
 * Invariants kept from D7:
 * - Callers enforce the single-open invariant: every production path clears
 *   the previous task before setting another (or replaces it in-place via the
 *   flicker-free rehydrate branch).
 * - `clear` removes the occupant; resuming a parent is NOT done here: it
 *   happens by rehydrating the parent from history.
 *
 * A detached task keeps running with its provider event listeners; it is
 * stopped and dropped as soon as it comes to rest, so the detached set only
 * ever holds tasks that work.
 */
export class TaskSlot {
	private currentTask?: Task
	/** Detached tasks by id, each with the release of its end-of-work listeners. */
	private readonly detached = new Map<string, { task: Task; release: () => void }>()

	constructor(private readonly host: TaskSlotHost) {}

	/** The current occupant, if any (read-only: install via {@link set}). */
	get current(): Task | undefined {
		return this.currentTask
	}

	/**
	 * Installs `task` as the occupant with no side effects — no TaskFocused
	 * emit, no preparation tasks, no abort of the previous occupant. For
	 * tests only: specs seed the slot with mock tasks; production code must
	 * go through {@link set} / {@link replaceInPlace} / {@link clear}.
	 */
	seedForTests(task?: Task): void {
		this.currentTask = task
	}

	/**
	 * Installs `task` as THE current (foreground) task, marking the start of
	 * a new task. Callers enforce the single-open invariant: every production
	 * path first clears the previous task (or replaces it in-place via
	 * {@link replaceInPlace}). (Was `addClineToStack`.)
	 */
	async set(task: Task): Promise<void> {
		// Re-attaching a detached task: it is the foreground task again.
		this.takeDetached(task)
		this.currentTask = task
		task.emit(TumbleCodeEventName.TaskFocused)

		// Perform special setup provider specific tasks.
		await this.host.performPreparationTasks(task)

		// Ensure getState() resolves correctly.
		const state = await this.host.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	/**
	 * Replaces the current occupant IN PLACE with `task` (the flicker-free
	 * rehydrate branch of createTaskWithHistoryItem): aborts the old instance,
	 * removes its listeners and installs the new one, so the webview never
	 * sees an empty slot between the two. The caller has already verified the
	 * old and the new task share a task id.
	 */
	async replaceInPlace(task: Task): Promise<void> {
		const oldTask = this.currentTask!

		// Abort the old task to stop running processes and mark as abandoned
		try {
			await oldTask.abortTask(true)
		} catch (e) {
			logger.warn(
				`[TaskSlot#replaceInPlace] abortTask() failed for old task ${oldTask.taskId}.${oldTask.instanceId}: ${e.message}`,
			)
		}

		this.host.removeTaskEventListeners(oldTask)

		this.currentTask = task
		task.emit(TumbleCodeEventName.TaskFocused)

		await this.host.performPreparationTasks(task)
	}

	/**
	 * Takes the current task out of the slot. By default it is destroyed;
	 * with `keepRunning` (the user opened something else) a task that is
	 * still working is detached instead and keeps running off screen.
	 * Resuming a parent is NOT done here: it happens by rehydrating the
	 * parent from history (createTaskWithHistoryItem / delegation complete).
	 * (Was `removeClineFromStack`.)
	 */
	async clear(options?: { skipDelegationRepair?: boolean; keepRunning?: boolean }): Promise<void> {
		// Take the current task instance out of the slot.
		const task = this.currentTask
		this.currentTask = undefined

		if (!task) {
			return
		}

		// NOTE: deliberately no subagentRegistry cleanup here. Clearing the
		// slot is often mere abandonment (switching tasks via history, an
		// in-place rehydrate) — its fan-out children keep running detached
		// and must stay visible in the panel. The panel is reset at task
		// boundaries by the entry points (createTask / clearTask /
		// createTaskWithHistoryItem) via `resetSubagentPanel`, NOT here,
		// so mid-task re-fan-out for the same parent (beginFanOut) keeps
		// its semantics. For a pure abandonment (history switch), the
		// detached children stay visible until the next task boundary.

		task.emit(TumbleCodeEventName.TaskUnfocused)

		// A detached child did not go away: its parent stays delegated.
		if (options?.keepRunning && isWorking(task)) {
			this.detach(task)
			return
		}

		await this.destroy(task, options)
	}

	/**
	 * Aborts `task`, removes its provider listeners and, for a delegated
	 * child, repairs the parent's metadata. Shared by {@link clear} and the
	 * end of a detached task.
	 */
	private async destroy(task: Task, options?: { skipDelegationRepair?: boolean }): Promise<void> {
		// Capture delegation metadata before abort/dispose, since abortTask(true)
		// is async.
		const childTaskId = task.taskId
		const parentTaskId = task.parentTaskId

		try {
			// Abort the running task and set isAbandoned to true so
			// all running promises will exit as well.
			await task.abortTask(true)
		} catch (e) {
			logger.warn(`[TaskSlot#destroy] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`)
		}

		// Remove event listeners; once its promises end the task is garbage
		// collected.
		this.host.removeTaskEventListeners(task)

		// Delegation-aware parent metadata repair:
		// If the cleared task was a delegated child, repair the parent's metadata
		// so it transitions from "delegated" back to "active" and becomes resumable
		// from the task history list.
		// Skip when called from delegateParentAndOpenChild() during nested delegation
		// transitions (A→B→C), where the caller intentionally replaces the active
		// child and will update the parent to point at the new child.
		if (parentTaskId && childTaskId && !options?.skipDelegationRepair) {
			try {
				if (await this.host.detachDelegatedParent(parentTaskId, childTaskId)) {
					logger.info(
						`[TaskSlot#destroy] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
					)
				}
			} catch (err) {
				// Non-fatal: log but do not block the clear operation.
				logger.warn(
					`[TaskSlot#destroy] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
						err instanceof Error ? err.message : String(err)
					}`,
				)
			}
		}
	}

	/**
	 * The legacy stack-shape view of the slot: the occupant's id alone, or
	 * empty. Kept because `TumbleCodeAPI.getCurrentTaskStack` (and
	 * DelegationService's reattach proofs) speak this shape.
	 */
	getTaskIds(): string[] {
		return this.currentTask ? [this.currentTask.taskId] : []
	}

	/**
	 * The live instance of a task by id: the foreground task or a detached
	 * one. Used to re-attach a task the user comes back to, and by a
	 * detached fan-out to deliver its report to the live instance of its
	 * parent (the instance that launched the fan-out may have been replaced
	 * by an in-place rehydrate while the children kept running).
	 */
	findLiveInstance(taskId: string): Task | undefined {
		return this.currentTask?.taskId === taskId ? this.currentTask : this.detached.get(taskId)?.task
	}

	/** Destroys the detached tasks among `taskIds` (their history is being deleted). */
	async destroyDetached(taskIds: Iterable<string> = [...this.detached.keys()]): Promise<void> {
		for (const taskId of taskIds) {
			const task = this.detached.get(taskId)?.task
			if (task) {
				this.takeDetached(task)
				await this.destroy(task)
			}
		}
	}

	/** Keeps `task` running off screen until it comes to rest or aborts. */
	private detach(task: Task): void {
		const end = () => {
			if (this.takeDetached(task)) {
				void this.destroy(task)
			}
		}
		for (const event of DETACHED_TASK_END_EVENTS) {
			task.once(event, end)
		}
		this.detached.set(task.taskId, {
			task,
			release: () => DETACHED_TASK_END_EVENTS.forEach((event) => task.off(event, end)),
		})
		logger.info(`[TaskSlot#detach] task ${task.taskId}.${task.instanceId} keeps running off screen`)
	}

	/** Removes `task` from the detached set; returns whether it was there. */
	private takeDetached(task: Task): boolean {
		const entry = this.detached.get(task.taskId)
		if (entry?.task !== task) {
			return false
		}
		entry.release()
		this.detached.delete(task.taskId)
		return true
	}
}
