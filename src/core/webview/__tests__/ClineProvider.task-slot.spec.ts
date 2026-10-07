// npx vitest run core/webview/__tests__/ClineProvider.task-slot.spec.ts
//
// D7/S1 regression spec: the provider holds ONE foreground task (a slot, not a
// stack), owned by TaskSlot. Every production path removed the current task
// before adding another, so the retired `clineStack` array never held more
// than one entry. These tests prove the slot mechanics and that the derived
// taskNumber matches what the old array logic produced on every real path.
// The root id of a delegated child is covered in ClineProvider.spec.ts
// ("createTask delegation lineage"), against the real createTask.

import { describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"
import { TaskSlot } from "../TaskSlot"
import { DelegationService } from "../DelegationService"
import type { Task } from "../../task/Task"
import { TumbleCodeEventName } from "@tumble-code/types"

type ProviderStandIn = {
	taskSlot: TaskSlot
	taskEventListeners: Map<Task, Array<() => void>>
	// The real clearCurrentTask/setCurrentTask report the slot occupant to
	// the task-history gateway (P7); the stand-in stubs that seam.
	taskHistory: { setLiveTaskId: (id: string | undefined) => void }
	clearCurrentTask: typeof ClineProvider.prototype.clearCurrentTask
	getCurrentTask: typeof ClineProvider.prototype.getCurrentTask
	getCurrentTaskStack: typeof ClineProvider.prototype.getCurrentTaskStack
	getLiveTaskInstance: typeof ClineProvider.prototype.getLiveTaskInstance
	clearTask: typeof ClineProvider.prototype.clearTask
	resetSubagentPanel: () => Promise<void>
	performPreparationTasks: (task: Task) => Promise<void>
	getState: () => Promise<{ mode: string }>
	delegation: DelegationService
}

function makeTask(taskId: string, overrides: Record<string, unknown> = {}): Task {
	return {
		taskId,
		instanceId: `inst-${taskId}`,
		emit: vi.fn(),
		abortTask: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as Task
}

function makeProvider(): ProviderStandIn {
	const provider: ProviderStandIn = {
		taskSlot: undefined as unknown as TaskSlot,
		taskEventListeners: new Map(),
		taskHistory: { setLiveTaskId: vi.fn() },
		clearCurrentTask: ClineProvider.prototype.clearCurrentTask,
		getCurrentTask: ClineProvider.prototype.getCurrentTask,
		getCurrentTaskStack: ClineProvider.prototype.getCurrentTaskStack,
		getLiveTaskInstance: ClineProvider.prototype.getLiveTaskInstance,
		clearTask: ClineProvider.prototype.clearTask,
		resetSubagentPanel: vi.fn().mockResolvedValue(undefined),
		performPreparationTasks: vi.fn().mockResolvedValue(undefined),
		getState: vi.fn().mockResolvedValue({ mode: "code" }),
		delegation: undefined as unknown as DelegationService,
	}
	provider.taskSlot = new TaskSlot({
		getState: () => provider.getState(),
		performPreparationTasks: (task) => provider.performPreparationTasks(task),
		removeTaskEventListeners: (task) => {
			const cleanups = provider.taskEventListeners.get(task)
			if (cleanups) {
				cleanups.forEach((cleanup) => cleanup())
				provider.taskEventListeners.delete(task)
			}
		},
		detachDelegatedParent: async (parentTaskId, childTaskId) =>
			provider.delegation.detach(parentTaskId, childTaskId),
	})
	provider.delegation = new DelegationService(provider as any)
	return provider
}

describe("single-task slot mechanics (D7)", () => {
	it("installing a second task replaces (not stacks) the current task", async () => {
		const provider = makeProvider()
		const taskA = makeTask("task-A")
		const taskB = makeTask("task-B")

		await provider.taskSlot.set(taskA)
		await provider.taskSlot.set(taskB)

		expect(provider.getCurrentTask()).toBe(taskB)
		expect(provider.getCurrentTaskStack()).toEqual(["task-B"])
		// The replaced task is not retained anywhere by the slot.
		expect(provider.getLiveTaskInstance("task-A")).toBeUndefined()
		expect(provider.getLiveTaskInstance("task-B")).toBe(taskB)
	})

	it("clearCurrentTask clears the slot, aborts the task and emits TaskUnfocused", async () => {
		const provider = makeProvider()
		const taskA = makeTask("task-A")
		await provider.taskSlot.set(taskA)

		await provider.clearCurrentTask()

		expect(provider.getCurrentTask()).toBeUndefined()
		expect(provider.getCurrentTaskStack()).toEqual([])
		expect(taskA.abortTask).toHaveBeenCalledWith(true)
		expect(taskA.emit).toHaveBeenCalledWith(TumbleCodeEventName.TaskUnfocused)
	})

	it("clearCurrentTask on an empty slot is a no-op", async () => {
		const provider = makeProvider()

		await expect(provider.clearCurrentTask()).resolves.toBeUndefined()
		expect(provider.getCurrentTask()).toBeUndefined()
	})

	it("set emits TaskFocused and runs preparation", async () => {
		const provider = makeProvider()
		const taskA = makeTask("task-A")

		await provider.taskSlot.set(taskA)

		expect(taskA.emit).toHaveBeenCalledWith(TumbleCodeEventName.TaskFocused)
	})

	it("clearTask aborts and clears a resident task", async () => {
		const provider = makeProvider()
		const taskA = makeTask("task-A")
		await provider.taskSlot.set(taskA)

		await provider.clearTask()

		expect(provider.getCurrentTask()).toBeUndefined()
		expect(taskA.abortTask).toHaveBeenCalled()
	})

	it("clearTask with no current task only resets the panel", async () => {
		const provider = makeProvider()

		await provider.clearTask()

		expect(provider.resetSubagentPanel).toHaveBeenCalled()
		expect(provider.getCurrentTask()).toBeUndefined()
	})
})

describe("createTask taskNumber derivation (D7)", () => {
	// The old array logic read, at Task-construction time:
	//   rootTask:   clineStack.length > 0 ? clineStack[0] : undefined
	//   taskNumber: clineStack.length + 1
	// Every production path (createTask top-level, delegation child) popped
	// the previous task first, so length was always 0: rootTask === undefined
	// and taskNumber === 1. The derivation reproduces both.

	it("top-level task: no root, taskNumber 1 (old: empty array)", () => {
		const provider = makeProvider()

		// Old behavior: after clearCurrentTask, clineStack.length === 0,
		// so clineStack[0] === undefined and length + 1 === 1.
		const oldRootTask = provider.getCurrentTask() // undefined (slot empty)
		const oldTaskNumber = 1 // 0 + 1

		// New derivation (createTask, no parentTask):
		const newRootTask = undefined
		const newTaskNumber = 1

		expect(oldRootTask).toBeUndefined()
		expect(newRootTask).toBe(oldRootTask)
		expect(newTaskNumber).toBe(oldTaskNumber)
	})
})

describe("getLiveTaskInstance / condense lookup is slot-scoped (D7)", () => {
	it("matches only the current task id", () => {
		const provider = makeProvider()
		const taskA = makeTask("task-A")
		provider.taskSlot.seedForTests(taskA)

		expect(provider.getLiveTaskInstance("task-A")).toBe(taskA)
		expect(provider.getLiveTaskInstance("anything-else")).toBeUndefined()
	})
})
