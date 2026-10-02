import { TumbleCodeEventName } from "@tumble-code/types"

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
 * The single foreground task slot (D7 replaced the clineStack array; S1
 * extracts the slot mechanics from ClineProvider). Background tasks (memory
 * writers, parallel subagents) never occupy it — they live in
 * BackgroundTaskRunner.
 *
 * Invariants kept from D7:
 * - Callers enforce the single-open invariant: every production path clears
 *   the previous task before setting another (or replaces it in-place via the
 *   flicker-free rehydrate branch).
 * - `clear` removes and destroys the occupant; resuming a parent is NOT done
 *   here — it happens by rehydrating the parent from history.
 */
export class TaskSlot {
	private currentTask?: Task

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
	 * Removes and destroys the current task instance. Resuming a parent is
	 * NOT done here — it happens by rehydrating the parent from history
	 * (createTaskWithHistoryItem / delegation complete). (Was
	 * `removeClineFromStack`.)
	 */
	async clear(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		// Take the current task instance out of the slot.
		let task = this.currentTask
		this.currentTask = undefined

		if (!task) {
			return
		}

		// Capture delegation metadata before abort/dispose, since abortTask(true)
		// is async and the task reference is cleared afterwards.
		const childTaskId = task.taskId
		const parentTaskId = task.parentTaskId

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

		try {
			// Abort the running task and set isAbandoned to true so
			// all running promises will exit as well.
			await task.abortTask(true)
		} catch (e) {
			logger.warn(`[TaskSlot#clear] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`)
		}

		// Remove event listeners before clearing the reference.
		this.host.removeTaskEventListeners(task)

		// Make sure no reference kept, once promises end it will be
		// garbage collected.
		task = undefined

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
						`[TaskSlot#clear] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
					)
				}
			} catch (err) {
				// Non-fatal: log but do not block the clear operation.
				logger.warn(
					`[TaskSlot#clear] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
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
	 * The CURRENT live instance of a task by id (slot-scoped). Used by a
	 * detached fan-out to deliver its report to the rehydrated instance of
	 * its parent — the original instance that launched the fan-out may have
	 * been abandoned by a task switch or in-place rehydrate while the
	 * children kept running.
	 */
	findLiveInstance(taskId: string): Task | undefined {
		return this.currentTask?.taskId === taskId ? this.currentTask : undefined
	}
}
