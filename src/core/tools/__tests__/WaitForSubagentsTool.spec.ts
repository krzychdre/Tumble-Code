import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"

import { TumbleCodeEventName } from "@tumble-code/types"

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((text: string, images?: string[]) =>
			images?.length ? [{ type: "text", text }, ...images.map((data) => ({ type: "image", data }))] : text,
		),
	},
}))

import { waitForSubagents, waitForSubagentsTool, type WaitingTask } from "../WaitForSubagentsTool"
import { BackgroundSubagents } from "../../webview/BackgroundSubagents"
import { MessageQueueService } from "../../message-queue/MessageQueueService"
import type { ParallelSubtaskResult } from "../helpers/subagentResults"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"

const done = (index: number, message: string): ParallelSubtaskResult => ({
	index,
	mode: "code",
	status: "completed",
	message,
})

function makeTask(subagents: BackgroundSubagents, overrides: Record<string, unknown> = {}) {
	const task = Object.assign(new EventEmitter(), {
		taskId: "parent-1",
		abort: false,
		isBackground: false,
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		messageQueueService: new MessageQueueService(),
		say: vi.fn().mockResolvedValue(undefined),
		providerRef: { deref: () => ({ backgroundSubagents: subagents }) },
		...overrides,
	})
	return task as unknown as WaitingTask & Task & EventEmitter
}

const newTracker = () => new BackgroundSubagents({ getLiveTaskInstance: () => undefined })

describe("waitForSubagents", () => {
	it("returns every result pending when a subagent finishes, with the ones still running", async () => {
		const subagents = newTracker()
		const a = subagents.start("parent-1", { description: "job A", mode: "code" })
		const b = subagents.start("parent-1", { description: "job B", mode: "code" })
		subagents.start("parent-1", { description: "job C", mode: "ask" })
		const task = makeTask(subagents)

		const waiting = waitForSubagents(task, subagents)
		await Promise.resolve()
		subagents.finish("parent-1", a.number, done(0, "answer A"))
		const result = (await waiting) as string

		expect(result).toContain("### Subagent #1: COMPLETED")
		expect(result).toContain("answer A")
		expect(result).toContain("Still running (2):\n- #2 job B (code mode)\n- #3 job C (ask mode)")
		expect(result).toContain("start it now with run_parallel_tasks")
		expect(result).toContain("Do not call attempt_completion")
		// Collected results are read: the next wait does not repeat them.
		subagents.finish("parent-1", b.number, done(1, "answer B"))
		const next = (await waitForSubagents(task, subagents)) as string
		expect(next).toContain("answer B")
		expect(next).not.toContain("answer A")
	})

	it("returns the results already waiting without blocking", async () => {
		const subagents = newTracker()
		const a = subagents.start("parent-1", { description: "job A", mode: "code" })
		subagents.finish("parent-1", a.number, done(0, "answer A"))

		const result = (await waitForSubagents(makeTask(subagents), subagents)) as string
		expect(result).toContain("answer A")
		expect(result).toContain("Every subagent has reported")
	})

	it("a user message interrupts the wait: shown in the chat, returned, subagents keep running", async () => {
		const subagents = newTracker()
		subagents.start("parent-1", { description: "job A", mode: "code" })
		const task = makeTask(subagents)

		const waiting = waitForSubagents(task, subagents)
		await Promise.resolve()
		task.messageQueueService.addMessage("what did you find so far?", ["img-1"])
		const result = (await waiting) as Array<{ type: string; text?: string }>

		expect(task.say).toHaveBeenCalledWith("user_feedback", "what did you find so far?", ["img-1"])
		expect(result[0].text).toContain("<user_message>\nwhat did you find so far?\n</user_message>")
		expect(result[0].text).toContain("Answer the user's message now.")
		expect(result[0].text).toContain("1 subagent(s) keep running")
		expect(result[0].text).toContain("call wait_for_subagents")
		expect(result[1]).toMatchObject({ type: "image" })
		expect(task.messageQueueService.isEmpty()).toBe(true)
		expect(subagents.running("parent-1")).toHaveLength(1)
	})

	it("leaves a queued user message alone when there is nothing to wait for", async () => {
		const subagents = newTracker()
		const task = makeTask(subagents)
		task.messageQueueService.addMessage("hello")

		expect(await waitForSubagents(task, subagents)).toContain("No subagent is running")
		expect(task.messageQueueService.isEmpty()).toBe(false)
	})

	it("stops when the task is aborted", async () => {
		const subagents = newTracker()
		subagents.start("parent-1", { description: "job A", mode: "code" })
		const task = makeTask(subagents)

		const waiting = waitForSubagents(task, subagents)
		await Promise.resolve()
		;(task as unknown as { abort: boolean }).abort = true
		task.emit(TumbleCodeEventName.TaskAborted)

		expect(await waiting).toContain("this task was stopped")
		expect(task.listenerCount(TumbleCodeEventName.TaskAborted)).toBe(0)
		expect(task.messageQueueService.listenerCount("stateChanged")).toBe(0)
	})
})

describe("WaitForSubagentsTool", () => {
	const callbacks = () =>
		({
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}) as unknown as ToolCallbacks & { pushToolResult: ReturnType<typeof vi.fn> }

	it("shows a waiting row and returns the next result", async () => {
		const subagents = newTracker()
		const a = subagents.start("parent-1", { description: "job A", mode: "code" })
		const task = makeTask(subagents)
		const cb = callbacks()

		const running = waitForSubagentsTool.execute({}, task, cb)
		await vi.waitFor(() => expect(task.say).toHaveBeenCalled())
		subagents.finish("parent-1", a.number, done(0, "answer A"))
		await running

		expect(task.say).toHaveBeenCalledWith("tool", JSON.stringify({ tool: "waitForSubagents" }))
		expect(cb.pushToolResult.mock.calls[0][0]).toContain("answer A")
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("with nothing to wait for: says so and counts a mistake, so a loop reaches the mistake limit", async () => {
		const subagents = newTracker()
		const task = makeTask(subagents)
		const cb = callbacks()

		await waitForSubagentsTool.execute({}, task, cb)

		expect(cb.pushToolResult.mock.calls[0][0]).toContain("No subagent is running")
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.say).not.toHaveBeenCalled()
	})

	it("is refused inside a subagent", async () => {
		const subagents = newTracker()
		const task = makeTask(subagents, { isBackground: true })
		const cb = callbacks()

		await waitForSubagentsTool.execute({}, task, cb)

		expect(cb.pushToolResult.mock.calls[0][0]).toContain("not available inside a parallel subtask")
		expect(task.recordToolError).toHaveBeenCalledWith("wait_for_subagents")
	})
})
