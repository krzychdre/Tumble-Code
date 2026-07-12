import type { ExtensionMessage, SubagentSummary } from "@roo-code/types"

import { SubagentRegistry, queuedSubagentId } from "../SubagentRegistry"

function makeSummary(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
	return {
		taskId: "task-1",
		parentTaskId: "parent-1",
		index: 0,
		mode: "ask",
		description: "subtask description",
		status: "running",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		startedAt: 1,
		lastActivityAt: 1,
		...overrides,
	}
}

describe("SubagentRegistry", () => {
	let posted: ExtensionMessage[]
	let registry: SubagentRegistry

	beforeEach(() => {
		posted = []
		registry = new SubagentRegistry((message) => posted.push(message))
	})

	it("posts subagentsUpdated with the full list on register", () => {
		registry.register(makeSummary())
		expect(posted).toHaveLength(1)
		expect(posted[0].type).toBe("subagentsUpdated")
		expect(posted[0].subagents).toHaveLength(1)
		expect(posted[0].subagents?.[0].taskId).toBe("task-1")
	})

	it("replaces the queued placeholder for the same (parent, index) slot", () => {
		registry.registerQueued({
			parentTaskId: "parent-1",
			index: 0,
			mode: "ask",
			description: "d",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			startedAt: 1,
			lastActivityAt: 1,
		})
		expect(registry.get(queuedSubagentId("parent-1", 0))?.status).toBe("queued")

		registry.register(makeSummary())
		expect(registry.has(queuedSubagentId("parent-1", 0))).toBe(false)
		expect(registry.list()).toHaveLength(1)
		expect(registry.get("task-1")?.status).toBe("running")
	})

	it("carries a watch flag from the placeholder to the real task id", () => {
		registry.registerQueued({
			parentTaskId: "parent-1",
			index: 0,
			mode: "ask",
			description: "d",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			startedAt: 1,
			lastActivityAt: 1,
		})
		registry.watch(queuedSubagentId("parent-1", 0))
		registry.register(makeSummary())
		expect(registry.isWatched("task-1")).toBe(true)
		expect(registry.isWatched(queuedSubagentId("parent-1", 0))).toBe(false)
	})

	it("beginFanOut drops only the given parent's entries and their watch flags", () => {
		registry.register(makeSummary({ taskId: "a", parentTaskId: "p1" }))
		registry.register(makeSummary({ taskId: "b", parentTaskId: "p2" }))
		registry.watch("a")
		registry.beginFanOut("p1")
		expect(registry.has("a")).toBe(false)
		expect(registry.isWatched("a")).toBe(false)
		expect(registry.has("b")).toBe(true)
	})

	it("setLiveStatus toggles running/awaiting_input but never resurrects a terminal entry", () => {
		registry.register(makeSummary())
		registry.setLiveStatus("task-1", "awaiting_input")
		expect(registry.get("task-1")?.status).toBe("awaiting_input")
		registry.markTerminal("task-1", "completed")
		registry.setLiveStatus("task-1", "running")
		expect(registry.get("task-1")?.status).toBe("completed")
	})

	it("markTerminal: first terminal wins, except failed → cancelled refinement", () => {
		registry.register(makeSummary())
		registry.markTerminal("task-1", "failed")
		registry.markTerminal("task-1", "completed")
		expect(registry.get("task-1")?.status).toBe("failed")
		registry.markTerminal("task-1", "cancelled")
		expect(registry.get("task-1")?.status).toBe("cancelled")
	})

	it("markTerminal fills finalMessage later without changing a terminal status", () => {
		registry.register(makeSummary())
		registry.markTerminal("task-1", "completed")
		registry.markTerminal("task-1", "completed", "the result")
		expect(registry.get("task-1")?.status).toBe("completed")
		expect(registry.get("task-1")?.finalMessage).toBe("the result")
	})

	it("truncates oversized final messages", () => {
		registry.register(makeSummary())
		registry.markTerminal("task-1", "completed", "x".repeat(5000))
		const finalMessage = registry.get("task-1")?.finalMessage ?? ""
		expect(finalMessage.length).toBeLessThanOrEqual(4001)
		expect(finalMessage.endsWith("…")).toBe(true)
	})

	it("update ignores unknown ids and does not post", () => {
		registry.update("nope", { tokensIn: 5 })
		expect(posted).toHaveLength(0)
	})

	it("list orders by parent then index", () => {
		registry.register(makeSummary({ taskId: "b", parentTaskId: "p1", index: 1 }))
		registry.register(makeSummary({ taskId: "a", parentTaskId: "p1", index: 0 }))
		expect(registry.list().map((s) => s.taskId)).toEqual(["a", "b"])
	})
})
