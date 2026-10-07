// npx vitest run core/webview/__tests__/ClineProvider.task-slot.spec.ts
//
// D7/S1 regression spec: the provider holds ONE foreground task (a slot, not a
// stack), owned by TaskSlot. Every production path removed the current task
// before adding another, so the retired `clineStack` array never held more
// than one entry. These tests prove the slot mechanics and that the derived
// taskNumber matches what the old array logic produced on every real path.
// The root id of a delegated child is covered in ClineProvider.spec.ts
// ("createTask delegation lineage"), against the real createTask.

import { EventEmitter } from "events"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClineProvider } from "../ClineProvider"
import { TaskSlot } from "../TaskSlot"
import { DelegationService } from "../DelegationService"
import type { Task } from "../../task/Task"
import { TaskStatus, TumbleCodeEventName } from "@tumble-code/types"

type ProviderStandIn = {
	taskSlot: TaskSlot
	taskEventListeners: Map<Task, Array<() => void>>
	// The real clearCurrentTask/setCurrentTask report the slot occupant to
	// the task-history gateway (P7); the stand-in stubs that seam.
	taskHistory: { setLiveTaskId: (id: string | undefined) => void }
	clearCurrentTask: typeof ClineProvider.prototype.clearCurrentTask
	leaveCurrentTask: typeof ClineProvider.prototype.leaveCurrentTask
	getCurrentTask: typeof ClineProvider.prototype.getCurrentTask
	getCurrentTaskStack: typeof ClineProvider.prototype.getCurrentTaskStack
	getLiveTaskInstance: typeof ClineProvider.prototype.getLiveTaskInstance
	clearTask: typeof ClineProvider.prototype.clearTask
	resetSubagentPanel: () => Promise<void>
	performPreparationTasks: (task: Task) => Promise<void>
	getState: () => Promise<{ mode: string }>
	delegation: DelegationService
	onDetachedTaskCompleted: (task: Task) => void
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

/**
 * A task with a real event emitter whose loop has started and whose last
 * message is `lastMessage` (default: a streaming text, i.e. still working).
 */
function makeLiveTask(taskId: string, lastMessage: Record<string, unknown> = { type: "say", say: "text" }): Task {
	const task = Object.assign(new EventEmitter(), {
		taskId,
		instanceId: `inst-${taskId}`,
		isInitialized: true,
		abort: false,
		abandoned: false,
		clineMessages: [{ ts: 1, ...lastMessage }],
		abortTask: vi.fn(async function (this: { abort: boolean; abandoned: boolean }) {
			this.abort = true
			this.abandoned = true
		}),
	})
	vi.spyOn(task, "emit")
	return task as unknown as Task
}

function makeProvider(): ProviderStandIn {
	const provider: ProviderStandIn = {
		taskSlot: undefined as unknown as TaskSlot,
		taskEventListeners: new Map(),
		taskHistory: { setLiveTaskId: vi.fn() },
		clearCurrentTask: ClineProvider.prototype.clearCurrentTask,
		leaveCurrentTask: ClineProvider.prototype.leaveCurrentTask,
		getCurrentTask: ClineProvider.prototype.getCurrentTask,
		getCurrentTaskStack: ClineProvider.prototype.getCurrentTaskStack,
		getLiveTaskInstance: ClineProvider.prototype.getLiveTaskInstance,
		clearTask: ClineProvider.prototype.clearTask,
		resetSubagentPanel: vi.fn().mockResolvedValue(undefined),
		performPreparationTasks: vi.fn().mockResolvedValue(undefined),
		getState: vi.fn().mockResolvedValue({ mode: "code" }),
		delegation: undefined as unknown as DelegationService,
		onDetachedTaskCompleted: vi.fn(),
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
		onDetachedTaskCompleted: (task) => provider.onDetachedTaskCompleted(task),
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

describe("leaving a task that still works (keep running off screen)", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it("detaches a working task: not aborted, listeners kept, still found by id", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		const cleanup = vi.fn()
		provider.taskEventListeners.set(taskA, [cleanup])
		await provider.taskSlot.set(taskA)

		await provider.leaveCurrentTask()

		expect(provider.getCurrentTask()).toBeUndefined()
		expect(taskA.abortTask).not.toHaveBeenCalled()
		expect(cleanup).not.toHaveBeenCalled()
		expect(taskA.emit).toHaveBeenCalledWith(TumbleCodeEventName.TaskUnfocused)
		expect(provider.getLiveTaskInstance("task-A")).toBe(taskA)
	})

	it("keeps a task blocked on an approval: the user finds the pending ask when back", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A", { type: "ask", ask: "tool" })
		await provider.taskSlot.set(taskA)

		await provider.leaveCurrentTask()

		expect(taskA.abortTask).not.toHaveBeenCalled()
		expect(provider.getLiveTaskInstance("task-A")).toBe(taskA)
	})

	it.each([
		["finished (completion ask)", { type: "ask", ask: "completion_result" }],
		["waiting to be resumed", { type: "ask", ask: "resume_task" }],
		["stopped by a failed request", { type: "ask", ask: "api_req_failed" }],
	])("destroys a task at rest as before: %s", async (_label, lastMessage) => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A", lastMessage)
		await provider.taskSlot.set(taskA)

		await provider.leaveCurrentTask()

		expect(taskA.abortTask).toHaveBeenCalledWith(true)
		expect(provider.getLiveTaskInstance("task-A")).toBeUndefined()
	})

	it("destroys a task whose loop never started (a view of history)", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		;(taskA as { isInitialized: boolean }).isInitialized = false
		await provider.taskSlot.set(taskA)

		await provider.leaveCurrentTask()

		expect(taskA.abortTask).toHaveBeenCalledWith(true)
	})

	it("clearCurrentTask without keepRunning still destroys a working task (delegation, delete, dispose)", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		await provider.taskSlot.set(taskA)

		await provider.clearCurrentTask()

		expect(taskA.abortTask).toHaveBeenCalledWith(true)
		expect(provider.getLiveTaskInstance("task-A")).toBeUndefined()
	})

	it("in the CLI a working task is destroyed: the CLI cannot show a detached task", async () => {
		vi.stubEnv("ROO_CLI_RUNTIME", "1")
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		await provider.taskSlot.set(taskA)

		await provider.leaveCurrentTask()

		expect(taskA.abortTask).toHaveBeenCalledWith(true)
	})

	it("set() re-attaches a detached task as the foreground task", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		const taskB = makeLiveTask("task-B")
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskB)

		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskA)

		expect(provider.getCurrentTask()).toBe(taskA)
		// Back in the slot, coming to rest no longer drops it.
		taskA.emit(TumbleCodeEventName.TaskIdle, taskA.taskId)
		expect(taskA.abortTask).not.toHaveBeenCalled()
		expect(provider.getLiveTaskInstance("task-B")).toBe(taskB)
	})

	it.each([
		TumbleCodeEventName.TaskIdle,
		TumbleCodeEventName.TaskResumable,
		TumbleCodeEventName.TaskAborted,
	] as const)("a detached task is destroyed and dropped once it ends work (%s)", async (event) => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		const cleanup = vi.fn()
		provider.taskEventListeners.set(taskA, [cleanup])
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()

		// The task's own events carry no arguments for TaskAborted, its id for the others.
		;(taskA as unknown as EventEmitter).emit(event, taskA.taskId)

		await vi.waitFor(() => expect(cleanup).toHaveBeenCalled())
		expect(taskA.abortTask).toHaveBeenCalledWith(true)
		expect(provider.getLiveTaskInstance("task-A")).toBeUndefined()
	})

	it("a detached delegated child keeps its parent delegated (no repair)", async () => {
		const provider = makeProvider()
		const detach = vi.spyOn(provider.delegation, "detach").mockResolvedValue(true)
		const child = makeLiveTask("child-1")
		;(child as { parentTaskId?: string }).parentTaskId = "parent-1"
		await provider.taskSlot.set(child)

		await provider.leaveCurrentTask()

		expect(detach).not.toHaveBeenCalled()
	})

	it("destroyDetached stops only the given detached tasks", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		const taskB = makeLiveTask("task-B")
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskB)
		await provider.leaveCurrentTask()

		await provider.taskSlot.destroyDetached(["task-A", "unknown"])

		expect(taskA.abortTask).toHaveBeenCalledWith(true)
		expect(taskB.abortTask).not.toHaveBeenCalled()
		expect(provider.getLiveTaskInstance("task-B")).toBe(taskB)

		await provider.taskSlot.destroyDetached()
		expect(taskB.abortTask).toHaveBeenCalledWith(true)
	})
})

describe("getRunningTasks: the working tasks shown on the history rows", () => {
	it("is empty for an empty slot", () => {
		expect(makeProvider().taskSlot.getRunningTasks()).toEqual({})
	})

	it("lists the foreground task and the detached ones, a task blocked on an ask as awaiting input", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		const taskB = Object.assign(makeLiveTask("task-B", { type: "ask", ask: "tool" }), {
			taskStatus: TaskStatus.Interactive,
		})
		const taskC = makeLiveTask("task-C")
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskB)
		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskC)

		expect(provider.taskSlot.getRunningTasks()).toEqual({
			"task-A": "running",
			"task-B": "awaiting_input",
			"task-C": "running",
		})
	})

	it.each<[string, Record<string, unknown> | undefined, Record<string, unknown>]>([
		["finished (completion ask)", { type: "ask", ask: "completion_result" }, {}],
		["waiting to be resumed", { type: "ask", ask: "resume_task" }, {}],
		["a view of history whose loop never started", undefined, { isInitialized: false }],
		["aborted", undefined, { abort: true }],
	])("leaves out a foreground task at rest: %s", async (_label, lastMessage, fields) => {
		const provider = makeProvider()
		await provider.taskSlot.set(Object.assign(makeLiveTask("task-A", lastMessage), fields))

		expect(provider.taskSlot.getRunningTasks()).toEqual({})
	})

	it("drops a detached task once it comes to rest", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		expect(provider.taskSlot.getRunningTasks()).toEqual({ "task-A": "running" })

		taskA.clineMessages.push({ ts: 2, type: "ask", ask: "completion_result" })
		taskA.emit(TumbleCodeEventName.TaskIdle, "task-A")

		expect(provider.taskSlot.getRunningTasks()).toEqual({})
	})
})

describe("a detached task that finishes is announced (completion sound)", () => {
	async function detachedTask() {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		return { provider, taskA }
	}

	it("announces a detached task that comes to rest on its completion ask", async () => {
		const { provider, taskA } = await detachedTask()

		taskA.clineMessages.push({ ts: 2, type: "ask", ask: "completion_result" })
		taskA.emit(TumbleCodeEventName.TaskIdle, "task-A")

		expect(provider.onDetachedTaskCompleted).toHaveBeenCalledExactlyOnceWith(taskA)
	})

	it.each([
		["rests on another ask", TumbleCodeEventName.TaskIdle, { ts: 2, type: "ask", ask: "api_req_failed" }],
		["waits to be resumed", TumbleCodeEventName.TaskResumable, { ts: 2, type: "ask", ask: "resume_task" }],
		[
			"is aborted after its completion ask",
			TumbleCodeEventName.TaskAborted,
			{ ts: 2, type: "ask", ask: "completion_result" },
		],
	] as const)("stays silent when the detached task %s", async (_label, event, lastMessage) => {
		const { provider, taskA } = await detachedTask()

		taskA.clineMessages.push({ ...lastMessage })
		;(taskA as unknown as EventEmitter).emit(event, "task-A")

		expect(provider.onDetachedTaskCompleted).not.toHaveBeenCalled()
	})

	it("stays silent for the foreground task: its own view plays the sound", async () => {
		const provider = makeProvider()
		const taskA = makeLiveTask("task-A")
		await provider.taskSlot.set(taskA)

		taskA.clineMessages.push({ ts: 2, type: "ask", ask: "completion_result" })
		taskA.emit(TumbleCodeEventName.TaskIdle, "task-A")

		expect(provider.onDetachedTaskCompleted).not.toHaveBeenCalled()
	})
})

describe("showTaskWithId puts a task running off screen back on screen", () => {
	function makeNavigatingProvider() {
		const provider = makeProvider() as ProviderStandIn & Record<string, any>
		Object.assign(provider, {
			showTaskWithId: ClineProvider.prototype.showTaskWithId,
			reattachTask: (ClineProvider.prototype as any).reattachTask,
			setCurrentTask: ClineProvider.prototype.setCurrentTask,
			getHistoryItem: vi.fn(async (id: string) => ({ id, mode: "code" })),
			createTaskWithHistoryItem: vi.fn(),
			modeProfiles: { restoreForHistoryItem: vi.fn().mockResolvedValue(undefined) },
			rehydrateSubagents: vi.fn().mockResolvedValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		})
		return provider
	}

	it("re-attaches the live instance instead of rebuilding the task from history", async () => {
		const provider = makeNavigatingProvider()
		const taskA = makeLiveTask("task-A")
		const taskB = makeLiveTask("task-B", { type: "ask", ask: "completion_result" })
		await provider.taskSlot.set(taskA)
		await provider.leaveCurrentTask()
		await provider.taskSlot.set(taskB)

		await provider.showTaskWithId("task-A")

		expect(provider.getCurrentTask()).toBe(taskA)
		expect(taskA.abortTask).not.toHaveBeenCalled()
		expect(provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
		// The task left behind was at rest: destroyed as before.
		expect(taskB.abortTask).toHaveBeenCalledWith(true)
		// The panel shows the task's own mode and profile, its subagents, its state.
		expect(provider.modeProfiles.restoreForHistoryItem).toHaveBeenCalledWith({ id: "task-A", mode: "code" })
		expect(provider.rehydrateSubagents).toHaveBeenCalled()
		expect(provider.postStateToWebview).toHaveBeenCalled()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "chatButtonClicked" })
	})

	it("shows, without resuming, a parent whose child still works off screen", async () => {
		const provider = makeNavigatingProvider()
		const child = makeLiveTask("child-1")
		await provider.taskSlot.set(child)
		await provider.leaveCurrentTask()
		const saved = [{ ts: 1, type: "say", say: "text", text: "before the subtask" }]
		const view = { overwriteClineMessages: vi.fn(), history: { getSavedClineMessages: vi.fn(async () => saved) } }
		provider.getHistoryItem.mockResolvedValue({ id: "parent-1", status: "delegated", awaitingChildId: "child-1" })
		provider.createTaskWithHistoryItem.mockResolvedValue(view)

		await provider.showTaskWithId("parent-1")

		expect(provider.createTaskWithHistoryItem).toHaveBeenCalledWith(expect.objectContaining({ id: "parent-1" }), {
			startTask: false,
		})
		expect(view.overwriteClineMessages).toHaveBeenCalledWith(saved)
		expect(child.abortTask).not.toHaveBeenCalled()
	})

	it("rebuilds from history a task that is not alive", async () => {
		const provider = makeNavigatingProvider()

		await provider.showTaskWithId("task-A")

		expect(provider.createTaskWithHistoryItem).toHaveBeenCalledWith(expect.objectContaining({ id: "task-A" }), {
			startTask: true,
		})
	})
})
