import { EventEmitter } from "events"
import { PassThrough } from "stream"

import type { ExtensionHost } from "@/agent/index.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { runStdinStreamMode } from "../stdin-stream.js"

// ---------------------------------------------------------------------------
// Fakes: a host and a client that hold the agent state the stream mode reads,
// a recording JSON emitter, and a PassThrough standing in for process.stdin.
// ---------------------------------------------------------------------------

type Handler = (payload: unknown) => void

class FakeClient {
	private handlers = new Map<string, Set<Handler>>()
	activeTask = false
	waitingForInput = false
	currentAsk: string | undefined
	cancelTask = vi.fn()

	on(event: string, handler: Handler): () => void {
		const set = this.handlers.get(event) ?? new Set<Handler>()
		set.add(handler)
		this.handlers.set(event, set)
		return () => set.delete(handler)
	}

	emit(event: string, payload: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(payload)
		}
	}

	listenerCount(event: string): number {
		return this.handlers.get(event)?.size ?? 0
	}

	hasActiveTask(): boolean {
		return this.activeTask
	}

	getCurrentAsk(): string | undefined {
		return this.currentAsk
	}

	getAgentState() {
		return { isWaitingForInput: this.waitingForInput, currentAsk: this.currentAsk }
	}

	/** Put the task on an ask (or clear it with `undefined`). */
	setAsk(ask: string | undefined): void {
		this.activeTask = true
		this.currentAsk = ask
		this.waitingForInput = ask !== undefined
	}
}

class FakeHost extends EventEmitter {
	client = new FakeClient()
	sendToExtension = vi.fn()
	runs: { resolve: () => void; reject: (error: unknown) => void }[] = []
	runTask = vi.fn(
		(_prompt: string, _taskId?: string, _configuration?: unknown, _images?: string[]) =>
			new Promise<void>((resolve, reject) => {
				this.runs.push({ resolve, reject })
			}),
	)

	isWaitingForInput(): boolean {
		return this.client.waitingForInput
	}

	/** Deliver a webview message the way the real host does. */
	post(message: unknown): void {
		this.emit("extensionWebviewMessage", message)
	}
}

function createEmitter() {
	return {
		emitControl: vi.fn(),
		emitQueue: vi.fn(),
		emitCommandOutputChunk: vi.fn(),
		markCommandOutputExited: vi.fn(),
		emitCommandOutputDone: vi.fn(),
	}
}

type FakeEmitter = ReturnType<typeof createEmitter>

interface Harness {
	host: FakeHost
	emitter: FakeEmitter
	stdin: PassThrough
	setStreamRequestId: ReturnType<typeof vi.fn>
	run: Promise<void>
	/** Settles to "resolved", "rejected: <message>" or "pending" after `ms`. */
	outcome: (ms: number) => Promise<string>
	send: (command: Record<string, unknown>) => void
	controls: () => Record<string, unknown>[]
	waitForControl: (match: Record<string, unknown>) => Promise<void>
}

function startHarness(): Harness {
	const host = new FakeHost()
	const emitter = createEmitter()
	const stdin = new PassThrough()
	vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as unknown as typeof process.stdin)
	const setStreamRequestId = vi.fn()

	const run = runStdinStreamMode({
		host: host as unknown as ExtensionHost,
		jsonEmitter: emitter as unknown as JsonEventEmitter,
		setStreamRequestId,
	})

	let settled: string | undefined
	run.then(
		() => {
			settled = "resolved"
		},
		(error: unknown) => {
			settled = `rejected: ${error instanceof Error ? error.message : String(error)}`
		},
	)

	const controls = () => emitter.emitControl.mock.calls.map(([event]) => event as Record<string, unknown>)

	return {
		host,
		emitter,
		stdin,
		setStreamRequestId,
		run,
		outcome: async (ms: number) => {
			const deadline = Date.now() + ms
			while (settled === undefined && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
			return settled ?? "pending"
		},
		send: (command) => {
			stdin.write(JSON.stringify(command) + "\n")
		},
		controls,
		waitForControl: (match) =>
			vi.waitFor(() => {
				expect(controls()).toContainEqual(expect.objectContaining(match))
			}),
	}
}

const TASK_ID = "018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87"

afterEach(() => {
	vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Characterization of runStdinStreamMode
// ---------------------------------------------------------------------------

describe("runStdinStreamMode", () => {
	describe("stdin handling", () => {
		it("fails when stdin closes before any command", async () => {
			const h = startHarness()
			h.stdin.end()
			await expect(h.run).rejects.toThrow("no stdin command provided")
		})

		it("fails on a line that is not a valid command and skips blank lines", async () => {
			const h = startHarness()
			h.stdin.write("\n   \n")
			h.stdin.write("not json\n")
			await expect(h.run).rejects.toThrow("stdin command line 3: invalid JSON")
		})

		it("detaches its listeners when it returns", async () => {
			const h = startHarness()
			h.send({ command: "ping", requestId: "p1" })
			h.stdin.end()
			await h.run
			expect(h.host.listenerCount("extensionWebviewMessage")).toBe(0)
			expect(h.host.client.listenerCount("error")).toBe(0)
			expect(h.host.client.listenerCount("taskCompleted")).toBe(0)
		})
	})

	describe("ping and shutdown", () => {
		it("answers ping with an ack and a pong", async () => {
			const h = startHarness()
			h.send({ command: "ping", requestId: "p1" })
			h.stdin.end()
			await h.run

			expect(h.controls()).toEqual([
				{
					subtype: "ack",
					requestId: "p1",
					command: "ping",
					taskId: undefined,
					content: "pong",
					code: "accepted",
					success: true,
				},
				{
					subtype: "done",
					requestId: "p1",
					command: "ping",
					taskId: undefined,
					content: "pong",
					code: "pong",
					success: true,
				},
			])
		})

		it("stops reading at shutdown and cancels a task that is still active", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			h.send({ command: "shutdown", requestId: "s1" })
			h.send({ command: "ping", requestId: "never" })
			await h.run

			expect(h.controls().map((c) => [c.subtype, c.command, c.code])).toEqual([
				["ack", "shutdown", "accepted"],
				["done", "shutdown", "shutdown_requested"],
			])
			expect(h.host.client.cancelTask).toHaveBeenCalledTimes(1)
		})

		it("does not wait for a running task after shutdown", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "go", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.send({ command: "shutdown", requestId: "s1" })
			expect(await h.outcome(1_000)).toBe("resolved")
		})
	})

	describe("start", () => {
		it("acks, runs the task with the stream defaults and reports completion", async () => {
			const h = startHarness()
			h.send({
				command: "start",
				requestId: "r1",
				prompt: "hello",
				taskId: TASK_ID,
				images: ["img"],
				configuration: { terminalShellIntegrationDisabled: false, mode: "code" },
			})
			await h.waitForControl({ subtype: "ack", command: "start" })

			expect(h.controls()[0]).toEqual({
				subtype: "ack",
				requestId: "r1",
				command: "start",
				taskId: TASK_ID,
				content: "starting task",
				code: "accepted",
				success: true,
			})
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith("r1")
			expect(h.host.runTask).toHaveBeenCalledWith(
				"hello",
				TASK_ID,
				{ terminalShellIntegrationDisabled: false, mode: "code" },
				["img"],
			)

			h.stdin.end()
			// EOF waits for the started task.
			expect(await h.outcome(300)).toBe("pending")

			h.host.client.emit("taskCompleted", { success: true })
			h.host.runs[0]!.resolve()
			expect(await h.outcome(1_000)).toBe("resolved")

			expect(h.controls()[1]).toEqual({
				subtype: "done",
				requestId: "r1",
				command: "start",
				taskId: TASK_ID,
				content: "task completed",
				code: "task_completed",
				success: true,
			})
		})

		it("turns shell integration off by default and generates a task id", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello" })
			await h.waitForControl({ subtype: "ack", command: "start" })

			const [, taskId, configuration, images] = h.host.runTask.mock.calls[0]!
			expect(taskId).toMatch(/^[0-9a-f-]{36}$/)
			expect(h.controls()[0]).toMatchObject({ taskId })
			expect(configuration).toEqual({ terminalShellIntegrationDisabled: true })
			expect(images).toBeUndefined()
			h.host.runs[0]!.resolve()
			h.stdin.end()
			await h.run
		})

		it("reports a failed task as task_failed", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.host.client.emit("taskCompleted", { success: false })
			await h.waitForControl({ subtype: "done", command: "start" })
			expect(h.controls()[1]).toMatchObject({ code: "task_failed", content: "task failed", success: false })
			h.host.runs[0]!.resolve()
			h.stdin.end()
			await h.run
		})

		it("refuses a second start while a task is active", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "one", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.host.client.setAsk(undefined)
			h.send({ command: "start", requestId: "r2", prompt: "two" })
			await h.waitForControl({ requestId: "r2" })

			expect(h.controls()[1]).toEqual({
				subtype: "error",
				requestId: "r2",
				command: "start",
				taskId: TASK_ID,
				content: "cannot start a new task while another task is active",
				code: "task_busy",
				success: false,
			})
			expect(h.host.runTask).toHaveBeenCalledTimes(1)
			h.host.client.activeTask = false
			h.host.runs[0]!.resolve()
			h.stdin.end()
			await h.run
		})

		it("waits for the previous run to settle instead of reporting task_busy", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "one", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.host.client.emit("taskCompleted", { success: true })
			// The client already reports no task, the run promise is still pending.
			h.send({ command: "start", requestId: "r2", prompt: "two" })
			await new Promise((resolve) => setTimeout(resolve, 50))
			expect(h.host.runTask).toHaveBeenCalledTimes(1)

			h.host.runs[0]!.resolve()
			await h.waitForControl({ subtype: "ack", requestId: "r2" })
			expect(h.host.runTask).toHaveBeenCalledTimes(2)
			h.host.runs[1]!.resolve()
			h.stdin.end()
			await h.run
		})

		it("reports a run failure as task_error and fails on the next command", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.host.runs[0]!.reject(new Error("boom"))
			await h.waitForControl({ subtype: "error", command: "start" })

			expect(h.controls()[1]).toEqual({
				subtype: "error",
				requestId: "r1",
				command: "start",
				taskId: TASK_ID,
				content: "boom",
				code: "task_error",
				success: false,
			})
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith(undefined)

			h.send({ command: "ping", requestId: "p1" })
			await expect(h.run).rejects.toThrow("boom")
		})

		it("reports a run rejected after a cancel as task_aborted", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "done", command: "cancel" })
			h.host.runs[0]!.reject(new Error("Task aborted"))
			await h.waitForControl({ subtype: "done", command: "start" })

			expect(h.controls().at(-1)).toEqual({
				subtype: "done",
				requestId: "r1",
				command: "start",
				taskId: TASK_ID,
				content: "task cancelled",
				code: "task_aborted",
				success: false,
			})
			h.stdin.end()
			expect(await h.outcome(1_000)).toBe("resolved")
		})

		it("treats an abort-like rejection without a cancel as a task error", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.host.runs[0]!.reject(new Error("Task aborted"))
			await h.waitForControl({ subtype: "error", command: "start" })
			expect(h.controls().at(-1)).toMatchObject({ code: "task_error", content: "Task aborted" })
			h.send({ command: "ping", requestId: "p1" })
			await expect(h.run).rejects.toThrow("Task aborted")
		})
	})

	describe("message", () => {
		it("reports no_active_task when nothing runs", async () => {
			const h = startHarness()
			h.send({ command: "message", requestId: "m1", prompt: "hi" })
			h.stdin.end()
			await h.run

			expect(h.controls()).toEqual([
				{
					subtype: "error",
					requestId: "m1",
					command: "message",
					taskId: undefined,
					content: "no active task; send a start command first",
					code: "no_active_task",
					success: false,
				},
			])
			expect(h.host.sendToExtension).not.toHaveBeenCalled()
		})

		it("answers a pending text ask directly", async () => {
			const h = startHarness()
			h.host.client.setAsk("followup")
			h.send({ command: "message", requestId: "m1", prompt: "yes please", images: ["i"] })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			expect(h.host.sendToExtension).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "yes please",
				images: ["i"],
			})
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith("m1")
			expect(h.controls().map((c) => [c.subtype, c.content, c.code])).toEqual([
				["ack", "message accepted", "accepted"],
				["done", "message sent to current ask", "responded"],
			])
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("queues a message while the task is running", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			h.send({ command: "message", requestId: "m1", prompt: "also this" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			expect(h.host.sendToExtension).toHaveBeenCalledWith({
				type: "queueMessage",
				text: "also this",
				images: undefined,
			})
			// Not waiting for input: attribution moves only when the queue drains.
			expect(h.setStreamRequestId).not.toHaveBeenCalled()
			expect(h.controls()[1]).toMatchObject({ content: "message queued", code: "queued" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("answers a resume ask directly, since resume asks are text asks", async () => {
			const h = startHarness()
			h.host.client.setAsk("resume_task")
			h.send({ command: "message", requestId: "m1", prompt: "go on" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			// resume_task is a text ask, so it is answered, not queued.
			expect(h.controls()[1]).toMatchObject({ code: "responded" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("queues on a non-text ask and tags later output with the message", async () => {
			const h = startHarness()
			h.host.client.setAsk("api_req_failed")
			h.send({ command: "message", requestId: "m1", prompt: "retry" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })

			expect(h.host.sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith("m1")
			expect(h.controls()[1]).toMatchObject({ code: "queued" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})
	})

	describe("cancel", () => {
		it("ignores a cancel without a task", async () => {
			const h = startHarness()
			h.send({ command: "cancel", requestId: "c1" })
			h.stdin.end()
			await h.run

			expect(h.controls().map((c) => [c.subtype, c.content, c.code])).toEqual([
				["ack", "no active task to cancel", "accepted"],
				["done", "cancel ignored (no active task)", "no_active_task"],
			])
			expect(h.host.client.cancelTask).not.toHaveBeenCalled()
			expect(h.setStreamRequestId).toHaveBeenCalledWith("c1")
		})

		it("cancels a running task and reports the task as aborted", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "done", command: "cancel" })

			expect(h.host.client.cancelTask).toHaveBeenCalledTimes(1)
			expect(h.controls().slice(1)).toEqual([
				{
					subtype: "ack",
					requestId: "c1",
					command: "cancel",
					taskId: TASK_ID,
					content: "cancel requested (task starting)",
					code: "accepted",
					success: true,
				},
				{
					subtype: "done",
					requestId: "c1",
					command: "cancel",
					taskId: TASK_ID,
					content: "cancel signal sent",
					code: "cancel_requested",
					success: true,
				},
			])

			h.host.client.emit("taskCompleted", { success: false })
			await h.waitForControl({ subtype: "done", command: "start" })
			expect(h.controls()[3]).toMatchObject({ code: "task_aborted", content: "task cancelled" })
			h.host.runs[0]!.resolve()
			h.stdin.end()
			await h.run
		})

		it("reports a settled task when cancelTask says there is none", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			h.host.client.cancelTask.mockImplementation(() => {
				throw new Error("No active task")
			})
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "done", command: "cancel" })

			expect(h.controls()[0]).toMatchObject({ content: "cancel requested" })
			expect(h.controls()[1]).toMatchObject({
				content: "cancel ignored (task already settled)",
				code: "no_active_task",
				success: true,
			})
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("reports an unexpected cancel failure as cancel_error", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			h.host.client.cancelTask.mockImplementation(() => {
				throw new Error("disk on fire")
			})
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "error", command: "cancel" })

			expect(h.controls()[1]).toMatchObject({ content: "disk on fire", code: "cancel_error", success: false })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})

		it("waits for the reloaded task before routing the next message", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "done", command: "cancel" })
			h.send({ command: "message", requestId: "m1", prompt: "continue" })
			await new Promise((resolve) => setTimeout(resolve, 250))
			expect(h.controls().some((c) => c.requestId === "m1")).toBe(false)

			h.host.client.setAsk("resume_task")
			await h.waitForControl({ subtype: "done", requestId: "m1" })
			expect(h.controls().at(-1)).toMatchObject({ code: "responded" })
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})
	})

	describe("client errors", () => {
		it("reports an unexpected client error and fails on the next command", async () => {
			const h = startHarness()
			h.send({ command: "ping", requestId: "p1" })
			await h.waitForControl({ subtype: "done", command: "ping" })
			h.host.client.emit("error", new Error("socket gone"))

			expect(h.controls()[2]).toEqual({
				subtype: "error",
				requestId: undefined,
				command: undefined,
				taskId: undefined,
				content: "socket gone",
				code: "client_error",
				success: false,
			})
			h.send({ command: "ping", requestId: "p2" })
			await expect(h.run).rejects.toThrow("socket gone")
		})

		it("treats a cancellation error after a cancel as an abort of the started task", async () => {
			const h = startHarness()
			h.send({ command: "start", requestId: "r1", prompt: "hello", taskId: TASK_ID })
			await h.waitForControl({ subtype: "ack", command: "start" })
			h.send({ command: "cancel", requestId: "c1" })
			await h.waitForControl({ subtype: "done", command: "cancel" })
			h.host.client.emit("error", new Error("Request cancelled"))

			expect(h.controls().at(-1)).toMatchObject({ subtype: "done", code: "task_aborted", command: "start" })
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith(undefined)
			h.host.runs[0]!.resolve()
			h.stdin.end()
			await h.run
		})
	})

	describe("extension messages", () => {
		it("forwards command output status to the emitter", async () => {
			const h = startHarness()
			h.send({ command: "ping", requestId: "p1" })
			await h.waitForControl({ subtype: "done", command: "ping" })

			const status = (value: unknown) => h.host.post({ type: "commandExecutionStatus", text: JSON.stringify(value) })
			status({ status: "output", output: "line 1" })
			status({ status: "exited", exitCode: 3, output: "tail" })
			status({ status: "exited" })
			status({ status: "timeout" })
			status({ status: "fallback" })
			status({ status: "started" })
			h.host.post({ type: "commandExecutionStatus", text: "not json" })
			h.host.post({ type: "commandExecutionStatus", text: 5 })

			expect(h.emitter.emitCommandOutputChunk.mock.calls).toEqual([["line 1"], ["tail"]])
			expect(h.emitter.markCommandOutputExited.mock.calls).toEqual([[3], [undefined]])
			expect(h.emitter.emitCommandOutputDone.mock.calls).toEqual([[undefined], [undefined]])
			h.stdin.end()
			await h.run
		})

		it("tracks the task id and reports queue changes", async () => {
			const h = startHarness()
			h.send({ command: "ping", requestId: "p1" })
			await h.waitForControl({ subtype: "done", command: "ping" })

			const state = (queue: unknown, currentTaskId?: string) =>
				h.host.post({ type: "state", state: { currentTaskId, messageQueue: queue } })

			state([{ id: "a", text: "first   message", images: ["x"], timestamp: 1 }], "task-9")
			state([
				{ id: "a", text: "first   message" },
				{ id: "b", text: "x".repeat(200) },
				{ nope: true },
			])
			state([{ id: "b", text: "x".repeat(200) }])
			state([{ id: "c" }])
			state([{ id: "c" }])
			state([])
			state(undefined)

			const queueEvents = h.emitter.emitQueue.mock.calls.map(([event]) => event)
			expect(queueEvents.map((e) => [e.subtype, e.content, e.queueDepth, e.taskId])).toEqual([
				["snapshot", "queue snapshot (1 item)", 1, "task-9"],
				["enqueued", "queue enqueued (2 items)", 2, "task-9"],
				["dequeued", "queue dequeued (1 item)", 1, "task-9"],
				["updated", "queue updated (1 item)", 1, "task-9"],
				["drained", "queue drained", 0, "task-9"],
			])
			expect(queueEvents[0].queue).toEqual([{ id: "a", text: "first message", imageCount: 1, timestamp: 1 }])
			expect(queueEvents[1].queue[1].text).toBe(`${"x".repeat(177)}...`)

			h.send({ command: "ping", requestId: "p2" })
			await h.waitForControl({ requestId: "p2", subtype: "done" })
			expect(h.controls().at(-1)).toMatchObject({ taskId: "task-9" })
			h.stdin.end()
			await h.run
		})

		it("tags output with a queued message once it leaves the queue", async () => {
			const h = startHarness()
			h.host.client.setAsk(undefined)
			const state = (queue: unknown) => h.host.post({ type: "state", state: { messageQueue: queue } })
			state([])

			h.send({ command: "message", requestId: "m1", prompt: "later" })
			await h.waitForControl({ subtype: "done", requestId: "m1" })
			state([{ id: "q1", text: "later" }])
			expect(h.setStreamRequestId).not.toHaveBeenCalled()

			state([])
			expect(h.setStreamRequestId).toHaveBeenLastCalledWith("m1")
			h.host.client.activeTask = false
			h.stdin.end()
			await h.run
		})
	})

	describe("stdin closed while a task is active without a run promise", () => {
		it("ends once the task rests on a completion ask with an empty queue", async () => {
			const h = startHarness()
			h.host.client.setAsk("completion_result")
			h.host.post({ type: "state", state: { messageQueue: [] } })
			h.send({ command: "ping", requestId: "p1" })
			h.stdin.end()
			expect(await h.outcome(5_000)).toBe("resolved")
		})

		it("fails when the task waits on an ask nobody can answer", async () => {
			const h = startHarness()
			h.host.client.setAsk("followup")
			h.send({ command: "ping", requestId: "p1" })
			h.stdin.end()
			expect(await h.outcome(5_000)).toBe("rejected: stdin ended while task was waiting for input (followup)")
		})
	})
})
