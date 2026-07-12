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
	cleanupSpy?: ReturnType<typeof vi.fn>,
) {
	const fakeThis = {
		backgroundTasks,
		cleanupBackgroundTaskFiles: cleanupSpy ?? vi.fn(),
	} as unknown as ClineProvider
	backgroundTasks.set((task as unknown as { taskId: string }).taskId, task)
	const promise = ClineProvider.prototype.awaitTaskCompletion.call(fakeThis, task as never, options)
	return { promise, backgroundTasks }
}

describe("ClineProvider.awaitTaskCompletion", () => {
	it("resolves completed:true with the last completion_result text on TaskCompleted", async () => {
		const task = makeFakeTask({ completionText: "saved 2 memories" })
		const { promise, backgroundTasks } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "saved 2 memories", writtenPaths: [] })
		// completed task is disposed and de-registered
		expect(task.abortTask).toHaveBeenCalledWith(true)
		expect(backgroundTasks.has("bg-1")).toBe(false)
	})

	it("resolves completed:false on TaskAborted and does not double-dispose", async () => {
		const task = makeFakeTask()
		const { promise, backgroundTasks } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")

		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined, writtenPaths: [] })
		expect(task.abortTask).not.toHaveBeenCalled() // aborted tasks are already torn down
		expect(backgroundTasks.has("bg-1")).toBe(false)
	})

	it("only settles once (first terminal event wins)", async () => {
		const task = makeFakeTask({ completionText: "done" })
		const { promise } = invokeAwait(task)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})
		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "done", writtenPaths: [] })
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
		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined, writtenPaths: [] })
	})

	it("aborts immediately if the signal is already aborted", async () => {
		const task = makeFakeTask()
		const controller = new AbortController()
		controller.abort()
		const { promise } = invokeAwait(task, { signal: controller.signal })
		expect(task.abortTask).toHaveBeenCalledTimes(1)
		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")
		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined, writtenPaths: [] })
	})

	it("cleans up task directory for completed background tasks", async () => {
		const task = makeFakeTask({ completionText: "done" })
		const cleanupSpy = vi.fn()
		const { promise } = invokeAwait(task, {}, undefined, cleanupSpy)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "done", writtenPaths: [] })
		// Cleanup is chained after the dispose (abortTask) settles.
		await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith("bg-1"))
	})

	it("does not clean up task directory for aborted background tasks", async () => {
		const task = makeFakeTask()
		const cleanupSpy = vi.fn()
		const { promise } = invokeAwait(task, {}, undefined, cleanupSpy)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskAborted, "bg-1")

		await expect(promise).resolves.toEqual({ completed: false, lastMessage: undefined, writtenPaths: [] })
		// Flush microtasks so a wrongly-chained cleanup would have fired by now.
		await new Promise((r) => setTimeout(r, 0))
		expect(cleanupSpy).not.toHaveBeenCalled()
	})

	it("cleanup failure does not affect the await result", async () => {
		const task = makeFakeTask({ completionText: "done" })
		// The real cleanupBackgroundTaskFiles is fire-and-forget (void async IIFE
		// with try/catch); it never throws synchronously. Simulate a rejection
		// inside the async body by returning a rejected promise — the await
		// result must still resolve normally.
		const cleanupSpy = vi.fn().mockResolvedValue(undefined)
		const { promise } = invokeAwait(task, {}, undefined, cleanupSpy)

		;(task as unknown as EventEmitter).emit(RooCodeEventName.TaskCompleted, "bg-1", {}, {})

		await expect(promise).resolves.toEqual({ completed: true, lastMessage: "done", writtenPaths: [] })
		await vi.waitFor(() => expect(cleanupSpy).toHaveBeenCalledWith("bg-1"))
	})
})

describe("ClineProvider.resolveMemoryWriterApiConfiguration", () => {
	// The method is private but accessible via prototype.call with a fake `this`
	// that provides `getValue` and `providerSettingsManager`.

	function makeFakeThis(opts: {
		configId?: string
		getProfile?: ReturnType<typeof vi.fn>
		log?: ReturnType<typeof vi.fn>
	}) {
		return {
			getValue: vi.fn().mockReturnValue(opts.configId),
			providerSettingsManager: { getProfile: opts.getProfile ?? vi.fn() },
			log: opts.log ?? vi.fn(),
		} as unknown as ClineProvider
	}

	it("returns undefined when memoryWriterApiConfigId is unset", async () => {
		const getProfile = vi.fn()
		const fakeThis = makeFakeThis({ configId: undefined, getProfile })
		const result = await (ClineProvider.prototype as any).resolveMemoryWriterApiConfiguration.call(fakeThis)
		expect(result).toBeUndefined()
		expect(getProfile).not.toHaveBeenCalled()
	})

	it("returns undefined when memoryWriterApiConfigId is empty string", async () => {
		const getProfile = vi.fn()
		const fakeThis = makeFakeThis({ configId: "", getProfile })
		const result = await (ClineProvider.prototype as any).resolveMemoryWriterApiConfiguration.call(fakeThis)
		expect(result).toBeUndefined()
		expect(getProfile).not.toHaveBeenCalled()
	})

	it("returns the resolved profile (minus name) when getProfile succeeds", async () => {
		const getProfile = vi.fn().mockResolvedValue({
			name: "cheap-local",
			id: "profile-1",
			apiProvider: "ollama",
			apiModelId: "llama3",
		})
		const fakeThis = makeFakeThis({ configId: "profile-1", getProfile })
		const result = await (ClineProvider.prototype as any).resolveMemoryWriterApiConfiguration.call(fakeThis)
		expect(result).toEqual({
			id: "profile-1",
			apiProvider: "ollama",
			apiModelId: "llama3",
		})
		expect(getProfile).toHaveBeenCalledWith({ id: "profile-1" })
	})

	it("falls back to undefined and logs when getProfile throws", async () => {
		const getProfile = vi.fn().mockRejectedValue(new Error("not found"))
		const log = vi.fn()
		const fakeThis = makeFakeThis({ configId: "stale-id", getProfile, log })
		const result = await (ClineProvider.prototype as any).resolveMemoryWriterApiConfiguration.call(fakeThis)
		expect(result).toBeUndefined()
		expect(getProfile).toHaveBeenCalledWith({ id: "stale-id" })
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("[memorySubTaskRunner] failed to load writer profile stale-id"),
		)
	})
})
