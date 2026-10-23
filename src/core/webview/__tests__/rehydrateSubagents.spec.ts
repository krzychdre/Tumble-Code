// npx vitest run core/webview/__tests__/rehydrateSubagents.spec.ts

import type { ClineMessage, ExtensionMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { rehydrateSubagents } from "../subagentBackfill"
import { SubagentRegistry } from "../SubagentRegistry"
import { logger } from "../../../utils/logging"

const loadSubagentSummaries = vi.fn()
const readTaskMessages = vi.fn()

vi.mock("../../task-persistence/subagentSummariesStore", () => ({
	loadSubagentSummaries: (...args: unknown[]) => loadSubagentSummaries(...args),
}))

vi.mock("../../task-persistence", () => ({
	readTaskMessages: (...args: unknown[]) => readTaskMessages(...args),
}))

const FAN_OUT_ASK: ClineMessage = { ts: 1000, type: "ask", ask: "tool", text: '{"tool":"runParallelTasks"}' }

function row(taskId: string, overrides: Partial<SubagentSummary> = {}): SubagentSummary {
	return {
		taskId,
		parentTaskId: "parent-1",
		runId: "r1",
		index: 0,
		mode: "code",
		description: taskId,
		status: "completed",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		startedAt: 1,
		lastActivityAt: 1,
		...overrides,
	}
}

/**
 * `rehydrateSubagents` restores the parallel-subagent panel when a task is
 * reopened from history or put back on screen.
 */
describe("rehydrateSubagents", () => {
	function makeHost(overrides: Record<string, unknown> = {}) {
		const posted: ExtensionMessage[] = []
		const host = {
			subagentRegistry: new SubagentRegistry(
				(message) => posted.push(message),
				() => "parent-1",
			),
			globalStoragePath: "/tmp/storage",
			getCurrentTask: vi.fn().mockReturnValue({ taskId: "parent-1", clineMessages: [] }),
			getHistoryItem: vi.fn().mockRejectedValue(new Error("Task not found")),
			...overrides,
		}
		return { host, posted }
	}

	const historyItem = (parallelChildIds?: string[]) =>
		({ id: "parent-1", parallelChildIds }) as unknown as HistoryItem

	const taskIds = (message: ExtensionMessage) => message.subagents?.map((s) => s.taskId)

	beforeEach(() => {
		vi.clearAllMocks()
		readTaskMessages.mockResolvedValue([])
	})

	it.each([
		["never fanned out", undefined],
		["has an empty child list", []],
	])("does nothing for a task that %s", async (_label, childIds) => {
		const { host, posted } = makeHost()

		await rehydrateSubagents(host, historyItem(childIds))

		expect(loadSubagentSummaries).not.toHaveBeenCalled()
		expect(posted).toHaveLength(0)
	})

	it("restores the children the task actually spawned, and posts them once", async () => {
		loadSubagentSummaries.mockResolvedValue([row("child-a"), row("child-b", { index: 1 })])
		const { host, posted } = makeHost()

		await rehydrateSubagents(host, historyItem(["child-a", "child-b"]))

		expect(loadSubagentSummaries).toHaveBeenCalledWith("/tmp/storage", "parent-1")
		// Every row has its run: the parent's messages are not read.
		expect(readTaskMessages).not.toHaveBeenCalled()
		expect(posted).toHaveLength(1)
		expect(posted[0]).toMatchObject({ type: "subagentsUpdated", sourceTaskId: "parent-1" })
		expect(taskIds(posted[0])).toEqual(["child-a", "child-b"])
	})

	it("drops a summary the parent never listed, so a half-written sidecar cannot invent rows", async () => {
		loadSubagentSummaries.mockResolvedValue([row("child-a"), row("child-from-a-crashed-run", { index: 1 })])
		const { host } = makeHost()

		await rehydrateSubagents(host, historyItem(["child-a"]))

		expect(host.subagentRegistry.list().map((s) => s.taskId)).toEqual(["child-a"])
	})

	// Regression: each fan-out overwrote the sidecar, so a task reopened after
	// several fan-outs listed only the last one.
	it("rebuilds a child the sidecar lacks from its history item, in the run it was created in", async () => {
		loadSubagentSummaries.mockResolvedValue([row("child-a")])
		const { host } = makeHost({
			getHistoryItem: vi.fn(async (id: string) => {
				if (id !== "child-old") throw new Error("Task not found")
				return {
					id,
					ts: 2000,
					task: "old work",
					tokensIn: 1,
					tokensOut: 2,
					totalCost: 0.1,
					outcome: "completed",
				}
			}),
			getCurrentTask: vi.fn().mockReturnValue({ taskId: "parent-1", clineMessages: [FAN_OUT_ASK] }),
		})
		host.subagentRegistry.register(row("child-live", { status: "running", runId: "r2" }))

		await rehydrateSubagents(host, historyItem(["child-old", "child-a", "child-live", "child-gone"]))

		expect(host.getHistoryItem).not.toHaveBeenCalledWith("child-live")
		// The parent is on screen: its live messages are used, not the disk.
		expect(readTaskMessages).not.toHaveBeenCalled()
		expect(host.subagentRegistry.get("child-old")).toMatchObject({
			parentTaskId: "parent-1",
			runId: (1000).toString(36),
			status: "completed",
			description: "old work",
		})
		// A row the registry already held stays as it is.
		expect(host.subagentRegistry.get("child-live")?.status).toBe("running")
		expect(host.subagentRegistry.has("child-gone")).toBe(false)
	})

	it("reads the parent's messages from disk when it is not on screen", async () => {
		loadSubagentSummaries.mockResolvedValue([row("child-a", { runId: undefined, startedAt: 1500 })])
		readTaskMessages.mockResolvedValue([FAN_OUT_ASK])
		const { host } = makeHost({ getCurrentTask: vi.fn().mockReturnValue(undefined) })

		await rehydrateSubagents(host, historyItem(["child-a"]))

		expect(readTaskMessages).toHaveBeenCalledWith({ taskId: "parent-1", globalStoragePath: "/tmp/storage" })
		expect(host.subagentRegistry.get("child-a")?.runId).toBe((1000).toString(36))
	})

	it("survives an unreadable sidecar: restoring the parent must not depend on it", async () => {
		loadSubagentSummaries.mockRejectedValue(new Error("ENOENT"))
		const { host, posted } = makeHost()
		const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {})

		await expect(rehydrateSubagents(host, historyItem(["child-a"]))).resolves.toBeUndefined()
		expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[rehydrateSubagents]"))
		expect(posted).toHaveLength(0)
		loggerWarnSpy.mockRestore()
	})
})
