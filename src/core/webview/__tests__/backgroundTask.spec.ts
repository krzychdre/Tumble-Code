import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"

import { RooCodeEventName } from "@roo-code/types"

import { BackgroundTaskRunner, type BackgroundTaskHost } from "../BackgroundTaskRunner"


/**
 * Focused unit tests for the reusable background-task primitive
 * (`awaitTaskCompletion`), which lives in BackgroundTaskRunner since CORE-R6 (d).
 * The method only touches the runner's task registry and the task's
 * event/method surface, so a runner over a stub host and a fake Task is
 * enough: no heavy provider construction required.
 */

function makeRunner(host: Partial<BackgroundTaskHost> = {}): BackgroundTaskRunner {
	return new BackgroundTaskRunner({ log: vi.fn(), ...host } as unknown as BackgroundTaskHost)
}

/** The runner's private members these tests reach into. */
type RunnerInternals = {
	backgroundTasks: Map<string, unknown>
	cleanupBackgroundTaskFiles: (taskId: string) => void
	resolveMemoryWriterApiConfiguration: () => Promise<unknown>
	setMemoryActivity: (kind: string, active: boolean) => void
	runMemorySubTask: (...args: any[]) => Promise<unknown>
}

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
	return task as unknown as Parameters<BackgroundTaskRunner["awaitTaskCompletion"]>[0] & {
		abortTask: ReturnType<typeof vi.fn>
	}
}

function invokeAwait(
	task: ReturnType<typeof makeFakeTask>,
	options?: { signal?: AbortSignal },
	_unused?: undefined,
	cleanupSpy?: ReturnType<typeof vi.fn>,
) {
	const runner = makeRunner()
	const internals = runner as unknown as RunnerInternals
	internals.cleanupBackgroundTaskFiles = cleanupSpy ?? vi.fn()
	const backgroundTasks = internals.backgroundTasks
	backgroundTasks.set((task as unknown as { taskId: string }).taskId, task)
	const promise = runner.awaitTaskCompletion(task as never, options)
	return { promise, backgroundTasks }
}

describe("BackgroundTaskRunner.awaitTaskCompletion", () => {
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

describe("BackgroundTaskRunner.resolveMemoryWriterApiConfiguration", () => {
	// The method is private but reachable on a runner whose host provides
	// `getMemoryWriterApiConfigId` and `activateProfile`.

	// `resolveMemoryWriterApiConfiguration` calls `activateProfile`, not
	// `getProfile`. While the double stubbed only the latter, the two tests that
	// resolve a profile were asserting on the TypeError the catch block swallowed
	// — both "passed" through the failure path they were written to avoid.
	function makeFakeThis(opts: {
		configId?: string
		activateProfile?: ReturnType<typeof vi.fn>
		log?: ReturnType<typeof vi.fn>
	}) {
		return makeRunner({
			getMemoryWriterApiConfigId: vi.fn().mockReturnValue(opts.configId),
			activateProfile: opts.activateProfile ?? vi.fn(),
			log: opts.log ?? vi.fn(),
		}) as unknown as RunnerInternals
	}

	it("returns undefined when memoryWriterApiConfigId is unset", async () => {
		const activateProfile = vi.fn()
		const fakeThis = makeFakeThis({ configId: undefined, activateProfile })
		const result = await fakeThis.resolveMemoryWriterApiConfiguration()
		expect(result).toBeUndefined()
		expect(activateProfile).not.toHaveBeenCalled()
	})

	it("returns undefined when memoryWriterApiConfigId is empty string", async () => {
		const activateProfile = vi.fn()
		const fakeThis = makeFakeThis({ configId: "", activateProfile })
		const result = await fakeThis.resolveMemoryWriterApiConfiguration()
		expect(result).toBeUndefined()
		expect(activateProfile).not.toHaveBeenCalled()
	})

	it("returns the resolved profile (minus name) when activateProfile succeeds", async () => {
		const activateProfile = vi.fn().mockResolvedValue({
			name: "cheap-local",
			id: "profile-1",
			apiProvider: "ollama",
			apiModelId: "llama3",
		})
		const fakeThis = makeFakeThis({ configId: "profile-1", activateProfile })
		const result = await fakeThis.resolveMemoryWriterApiConfiguration()
		expect(result).toEqual({
			id: "profile-1",
			apiProvider: "ollama",
			apiModelId: "llama3",
		})
		expect(activateProfile).toHaveBeenCalledWith({ id: "profile-1" })
	})

	it("falls back to undefined and logs when activateProfile throws", async () => {
		const activateProfile = vi.fn().mockRejectedValue(new Error("not found"))
		const log = vi.fn()
		const fakeThis = makeFakeThis({ configId: "stale-id", activateProfile, log })
		const result = await fakeThis.resolveMemoryWriterApiConfiguration()
		expect(result).toBeUndefined()
		expect(activateProfile).toHaveBeenCalledWith({ id: "stale-id" })
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("[memoryWriterQuery] failed to load writer profile stale-id"),
		)
	})
})
