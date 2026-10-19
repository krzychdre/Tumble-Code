import { describe, it, expect, vi } from "vitest"

import { TaskStatus } from "@tumble-code/types"

import { BackgroundSubagents, type LiveParentTask } from "../BackgroundSubagents"
import type { ParallelSubtaskResult } from "../../tools/helpers/subagentResults"

const done = (index: number, message = "done"): ParallelSubtaskResult => ({
	index,
	mode: "code",
	status: "completed",
	message,
})

function makeParent(taskStatus: TaskStatus, abort = false) {
	const addMessage = vi.fn()
	const parent: LiveParentTask = { abort, taskStatus, messageQueueService: { addMessage } }
	return { parent, addMessage }
}

describe("BackgroundSubagents", () => {
	it("numbers the subagents of one parent across fan-outs, each parent on its own", () => {
		const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
		expect(subagents.start("p1", { description: "a", mode: "code" }).number).toBe(1)
		expect(subagents.start("p1", { description: "b", mode: "ask" }).number).toBe(2)
		expect(subagents.start("p2", { description: "c", mode: "code" }).number).toBe(1)
		expect(subagents.running("p1").map((s) => s.description)).toEqual(["a", "b"])
	})

	it("keeps a finished result unread until it is taken", () => {
		const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
		const ref = subagents.start("p1", { description: "a", mode: "code" })
		expect(subagents.hasWork("p1")).toBe(true)

		subagents.finish("p1", ref.number, done(0))
		expect(subagents.running("p1")).toEqual([])
		expect(subagents.unreadCount("p1")).toBe(1)
		expect(subagents.hasWork("p1")).toBe(true)

		expect(subagents.takeUnread("p1").map((f) => f.description)).toEqual(["a"])
		expect(subagents.hasWork("p1")).toBe(false)
		expect(subagents.takeUnread("p1")).toEqual([])
	})

	it("drops the outcome of a subagent finished without a result (user cancel)", () => {
		const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
		const ref = subagents.start("p1", { description: "a", mode: "code" })
		subagents.finish("p1", ref.number)
		expect(subagents.hasWork("p1")).toBe(false)
	})

	it("wakes subscribers when a subagent ends, until they unsubscribe", () => {
		const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
		const a = subagents.start("p1", { description: "a", mode: "code" })
		const b = subagents.start("p1", { description: "b", mode: "code" })
		const listener = vi.fn()
		const unsubscribe = subagents.subscribe("p1", listener)
		subagents.finish("p1", a.number, done(0))
		expect(listener).toHaveBeenCalledOnce()
		unsubscribe()
		subagents.finish("p1", b.number, done(1))
		expect(listener).toHaveBeenCalledOnce()
	})

	describe("delivery to a parent whose turn ended", () => {
		it.each([TaskStatus.Idle, TaskStatus.Resumable])("queues the results to a parent at a %s ask", (status) => {
			const { parent, addMessage } = makeParent(status)
			const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => parent })
			const a = subagents.start("p1", { description: "a", mode: "code" })
			subagents.start("p1", { description: "b", mode: "code" })

			subagents.finish("p1", a.number, done(0, "answer A"))

			expect(addMessage).toHaveBeenCalledOnce()
			const text = addMessage.mock.calls[0][0] as string
			expect(text).toContain("arrived while this task was waiting")
			expect(text).toContain("answer A")
			expect(text).toContain("- #2 b (code mode)")
			expect(subagents.unreadCount("p1")).toBe(0)
		})

		it.each([TaskStatus.Running, TaskStatus.Interactive])("keeps the results unread for a %s parent", (status) => {
			const { parent, addMessage } = makeParent(status)
			const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => parent })
			const a = subagents.start("p1", { description: "a", mode: "code" })
			subagents.finish("p1", a.number, done(0))
			expect(addMessage).not.toHaveBeenCalled()
			expect(subagents.unreadCount("p1")).toBe(1)
		})

		it("never queues while somebody waits, nor to an aborted or missing parent", () => {
			const idle = makeParent(TaskStatus.Idle)
			const aborted = makeParent(TaskStatus.Idle, true)
			let live: LiveParentTask | undefined = idle.parent
			const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => live })

			const unsubscribe = subagents.subscribe("p1", () => {})
			subagents.finish("p1", subagents.start("p1", { description: "a", mode: "code" }).number, done(0))
			expect(idle.addMessage).not.toHaveBeenCalled()
			unsubscribe()

			live = aborted.parent
			subagents.deliverIfIdle("p1")
			live = undefined
			subagents.deliverIfIdle("p1")
			expect(aborted.addMessage).not.toHaveBeenCalled()
			expect(subagents.unreadCount("p1")).toBe(1)

			// The parent turns idle later (TaskIdle): now the result goes out.
			live = idle.parent
			subagents.deliverIfIdle("p1")
			expect(idle.addMessage).toHaveBeenCalledOnce()
		})
	})

	describe("environmentSection", () => {
		it("is empty for a parent with nothing running and nothing unread", () => {
			const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
			expect(subagents.environmentSection("p1")).toBeUndefined()
		})

		it("lists the running subagents and counts the unread results", () => {
			const subagents = new BackgroundSubagents({ getLiveTaskInstance: () => undefined })
			const a = subagents.start("p1", { description: "fix the README", mode: "code" })
			subagents.start("p1", { description: "check the tests", mode: "ask" })
			subagents.finish("p1", a.number, done(0))

			const section = subagents.environmentSection("p1")!
			expect(section).toContain("# Background Subagents")
			expect(section).toContain("Still running (1):\n- #2 check the tests (ask mode)")
			expect(section).toContain("Finished, results not read yet: 1.")
			expect(section).toContain("Call wait_for_subagents")
		})
	})
})
