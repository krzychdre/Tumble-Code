import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"

import { RooCodeEventName } from "@roo-code/types"

import { ClineProvider } from "../ClineProvider"

/**
 * Focused unit tests for the reusable background-task primitive
 * (`awaitTaskCompletion`). The method only touches `this.backgroundTasks` and
 * the task's event/method surface, so we exercise the real implementation via
 * `prototype.call` with a minimal fake `this` and a fake Task — no heavy
 * ClineProvider construction required.
 */

interface FakeTaskOptions {
	taskId?: string
	completionText?: string
}

function makeFakeTask({ taskId = "bg-1", completionText }: FakeTaskOptions = {}) {
	const emitter = new EventEmitter()
	const task = Object.assign(emitter, {
		taskId,
		clineMessages: completionText
			? [
					{ type: "say", say: "text", text: "working" },
					{ type: "say", say: "completion_result", text: completionText },
				]
			: [{ type: "say", say: "text", text: "working" }],
		abortTask: vi.fn(async () => {}),
	})
	return task as unknown as Parameters<ClineProvider["awaitTaskCompletion"]>[0] & {
		abortTask: ReturnType<typeof vi.fn>
	}
}

function invokeAwait(
	task: ReturnType<typeof makeFakeTask>,
	options?: { signal?: AbortSignal },
	backgroundTasks = new Map<string, unknown>(),
) {
	const fakeThis = { backgroundTasks } as unknown as ClineProvider
	backgroundTasks.set((task as unknown as { taskId: string }).taskId, task)
	const promise = ClineProvider.prototype.awaitTaskCompletion.call(fakeThis, task as never, options)
	return { promise, backgroundTasks }
}

describe("ClineProvider.awaitTaskCompletion", () => {
	it("resolves completed:true with the last completion_result text on TaskCompleted", async () => {
		const task = makeFakeTask({ completionText: "saved 2 memories" })
		const { promise, backgroundTasks } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "saved 2 memories" })
		// completed task is disposed and de-registered
		expect(task.abortTask).toHaveBeenCalledWith(true)
		expect(backgroundTasks.has("bg-1")).toBe(false)
	})

	it("resolves completed:false on TaskAborted and does not double-dispose", async () => {
		const task = makeFakeTask()
		const { promise, backgroundTasks } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")

		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined })
		expect(task.abortTask).not.toHaveBeenCalled() // aborted tasks are already torn down
		expect(backgroundTasks.has("bg-1")).toBe(false)
	})

	it("only settles once (first terminal event wins)", async () => {
		const task = makeFakeTask({ completionText: "done" })
		const { promise } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})
		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "done" })
		expect(task.abortTask).toHaveBeenCalledTimes(1)
	})

	it("aborts the task when the provided signal fires", async () => {
		const task = makeFakeTask()
		const controller = new AbortController()
		const { promise } = invokeAwait(task, { signal: controller.signal })

		controller.abort()
		// The task's own abortTask -> TaskAborted would normally fire; simulate it.
		expect(task.abortTask).toHaveBeenCalledTimes(1)
		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")
		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined })
	})

	it("aborts immediately if the signal is already aborted", async () => {
		const task = makeFakeTask()
		const controller = new AbortController()
		controller.abort()
		const { promise } = invokeAwait(task, { signal: controller.signal })
		expect(task.abortTask).toHaveBeenCalledTimes(1)
		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")
		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined })
	})
})
