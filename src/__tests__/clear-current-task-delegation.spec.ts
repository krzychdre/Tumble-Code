// npx vitest run __tests__/clear-current-task-delegation.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DelegationService } from "../core/webview/DelegationService"
import { TaskSlot } from "../core/webview/TaskSlot"
import { logger } from "../utils/logging"

// The delegation-repair half of the old removeClineFromStack (S1: TaskSlot.clear).
// The repair transition itself lives in DelegationService (CORE-R2); these
// tests drive it through the slot exactly like the provider does.
describe("TaskSlot.clear() delegation awareness", () => {
	beforeEach(() => {
		vi.spyOn(logger, "info").mockImplementation(() => {})
		vi.spyOn(logger, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	/**
	 * Helper to build a minimal slot host mock with a single task in the slot.
	 * The task's parentTaskId and taskId are configurable.
	 */
	function buildSlotWithTask(opts: {
		childTaskId: string
		parentTaskId?: string
		parentHistoryItem?: Record<string, any>
		getHistoryItemError?: Error
	}) {
		const childTask = {
			taskId: opts.childTaskId,
			instanceId: "inst-1",
			parentTaskId: opts.parentTaskId,
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
		}

		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		const getHistoryItem = opts.getHistoryItemError
			? vi.fn().mockRejectedValue(opts.getHistoryItemError)
			: vi.fn().mockImplementation(async (id: string) => {
					if (id === opts.parentTaskId && opts.parentHistoryItem) {
						return { ...opts.parentHistoryItem }
					}
					throw new Error("Task not found")
				})

		const provider = {
			currentTask: childTask as any,
			taskEventListeners: new Map(),
			getHistoryItem,
			updateTaskHistory,
			// The repair transition lives in DelegationService (CORE-R2); it
			// reads and writes the history through this same fake.
			delegation: undefined as unknown as DelegationService,
		}
		provider.delegation = new DelegationService(provider as any)

		const slot = new TaskSlot({
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			performPreparationTasks: vi.fn().mockResolvedValue(undefined),
			removeTaskEventListeners: (task) => {
				const cleanups = provider.taskEventListeners.get(task)
				if (cleanups) {
					cleanups.forEach((cleanup: () => void) => cleanup())
					provider.taskEventListeners.delete(task)
				}
			},
			detachDelegatedParent: (parentTaskId, childTaskId) => provider.delegation.detach(parentTaskId, childTaskId),
			onDetachedTaskCompleted: vi.fn(),
		})
		slot.seedForTests(childTask as any)

		return { slot, provider, childTask, updateTaskHistory, getHistoryItem }
	}

	it("repairs parent metadata (delegated → active) when a delegated child is removed", async () => {
		const { slot, provider, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "child-1",
			parentTaskId: "parent-1",
			parentHistoryItem: {
				id: "parent-1",
				task: "Parent task",
				ts: 1000,
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "delegated",
				awaitingChildId: "child-1",
				delegatedToId: "child-1",
				childIds: ["child-1"],
			},
		})

		await slot.clear()

		// Slot should be empty after removal
		expect(slot.current).toBeUndefined()

		// Parent lookup should have been called
		expect(getHistoryItem).toHaveBeenCalledWith("parent-1")

		// Parent metadata should be repaired
		expect(updateTaskHistory).toHaveBeenCalledTimes(1)
		const updatedParent = updateTaskHistory.mock.calls[0][0]
		expect(updatedParent).toEqual(
			expect.objectContaining({
				id: "parent-1",
				status: "active",
				awaitingChildId: undefined,
			}),
		)

		// Log the repair
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Repaired parent parent-1 metadata"))
	})

	it("does NOT modify parent metadata when the task has no parentTaskId (non-delegated)", async () => {
		const { slot, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "standalone-1",
			// No parentTaskId — this is a top-level task
		})

		await slot.clear()

		// Slot should be empty
		expect(slot.current).toBeUndefined()

		// No parent lookup or update should happen
		expect(getHistoryItem).not.toHaveBeenCalled()
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("does NOT modify parent metadata when awaitingChildId does not match the popped child", async () => {
		const { slot, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "child-1",
			parentTaskId: "parent-1",
			parentHistoryItem: {
				id: "parent-1",
				task: "Parent task",
				ts: 1000,
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "delegated",
				awaitingChildId: "child-OTHER", // different child
				delegatedToId: "child-OTHER",
				childIds: ["child-OTHER"],
			},
		})

		await slot.clear()

		// Parent was looked up but should NOT be updated
		expect(getHistoryItem).toHaveBeenCalledWith("parent-1")
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("does NOT modify parent metadata when parent status is not 'delegated'", async () => {
		const { slot, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "child-1",
			parentTaskId: "parent-1",
			parentHistoryItem: {
				id: "parent-1",
				task: "Parent task",
				ts: 1000,
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "completed", // already completed
				awaitingChildId: "child-1",
				childIds: ["child-1"],
			},
		})

		await slot.clear()

		expect(getHistoryItem).toHaveBeenCalledWith("parent-1")
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("catches and logs errors during parent metadata repair without blocking the pop", async () => {
		const { slot, provider, childTask, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "child-1",
			parentTaskId: "parent-1",
			getHistoryItemError: new Error("Storage unavailable"),
		})

		// Should NOT throw
		await slot.clear()

		// Slot should still be empty (removal was not blocked)
		expect(slot.current).toBeUndefined()

		// The abort should still have been called
		expect(childTask.abortTask).toHaveBeenCalledWith(true)

		// Error should be logged as non-fatal
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Failed to repair parent metadata for parent-1 (non-fatal)"),
		)

		// No update should have been attempted
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("handles an empty slot gracefully", async () => {
		const slot = new TaskSlot({
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			performPreparationTasks: vi.fn(),
			removeTaskEventListeners: vi.fn(),
			detachDelegatedParent: vi.fn(),
			onDetachedTaskCompleted: vi.fn(),
		})

		// Should not throw
		await slot.clear()

		expect(slot.current).toBeUndefined()
	})

	it("skips delegation repair when skipDelegationRepair option is true", async () => {
		const { slot, updateTaskHistory, getHistoryItem } = buildSlotWithTask({
			childTaskId: "child-1",
			parentTaskId: "parent-1",
			parentHistoryItem: {
				id: "parent-1",
				task: "Parent task",
				ts: 1000,
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "delegated",
				awaitingChildId: "child-1",
				delegatedToId: "child-1",
				childIds: ["child-1"],
			},
		})

		// Call with skipDelegationRepair: true (as delegateParentAndOpenChild would)
		await slot.clear({ skipDelegationRepair: true })

		// Slot should be empty after removal
		expect(slot.current).toBeUndefined()

		// Parent lookup should NOT have been called — repair was skipped entirely
		expect(getHistoryItem).not.toHaveBeenCalled()
		expect(updateTaskHistory).not.toHaveBeenCalled()
	})

	it("does NOT reset grandparent during A→B→C nested delegation transition", async () => {
		// Scenario: A delegated to B, B is now delegating to C.
		// delegateParentAndOpenChild() pops B via clearCurrentTask({ skipDelegationRepair: true }).
		// Grandparent A should remain "delegated" — its metadata must not be repaired.
		const grandparentHistory = {
			id: "task-A",
			task: "Grandparent task",
			ts: 1000,
			number: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			status: "delegated",
			awaitingChildId: "task-B",
			delegatedToId: "task-B",
			childIds: ["task-B"],
		}

		const taskB = {
			taskId: "task-B",
			instanceId: "inst-B",
			parentTaskId: "task-A",
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
		}

		const getHistoryItem = vi.fn().mockImplementation(async (id: string) => {
			if (id === "task-A") {
				return { ...grandparentHistory }
			}
			throw new Error("Task not found")
		})
		const updateTaskHistory = vi.fn().mockResolvedValue(undefined)

		const provider = {
			currentTask: taskB as any,
			taskEventListeners: new Map(),
			getHistoryItem,
			updateTaskHistory,
		}

		const slot = new TaskSlot({
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			performPreparationTasks: vi.fn(),
			removeTaskEventListeners: vi.fn(),
			detachDelegatedParent: vi.fn(),
			onDetachedTaskCompleted: vi.fn(),
		})
		slot.seedForTests(taskB as any)

		// Simulate what delegateParentAndOpenChild does: pop B with skipDelegationRepair
		await slot.clear({ skipDelegationRepair: true })

		// B was removed
		expect(slot.current).toBeUndefined()

		// Grandparent A should NOT have been looked up or modified
		expect(getHistoryItem).not.toHaveBeenCalled()
		expect(updateTaskHistory).not.toHaveBeenCalled()

		// Grandparent A's metadata remains intact (delegated, awaitingChildId: task-B)
		// The caller (delegateParentAndOpenChild) will update A to point to C separately.
	})
})
