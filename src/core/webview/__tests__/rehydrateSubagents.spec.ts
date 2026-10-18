// npx vitest run core/webview/__tests__/rehydrateSubagents.spec.ts

import type { HistoryItem } from "@tumble-code/types"

import { ClineProvider } from "../ClineProvider"
import { logger } from "../../../utils/logging"

const loadSubagentSummaries = vi.fn()

vi.mock("../../task-persistence/subagentSummariesStore", () => ({
	loadSubagentSummaries: (...args: unknown[]) => loadSubagentSummaries(...args),
}))

/**
 * `rehydrateSubagents` restores the parallel-subagent panel when a task is
 * reopened from history. It had no coverage of its own, which is how the
 * provider doubles in the resume specs came to be missing it entirely — the
 * only thing that ever exercised it was those tests, indirectly, and they broke
 * with "is not a function" rather than with anything about subagents.
 */
describe("ClineProvider.rehydrateSubagents", () => {
	function makeFakeThis(overrides: Record<string, unknown> = {}) {
		return {
			contextProxy: { globalStorageUri: { fsPath: "/tmp/storage" } },
			subagentRegistry: {
				restore: vi.fn(),
				has: vi.fn().mockReturnValue(false),
				list: vi.fn().mockReturnValue([{ taskId: "child-a" }]),
			},
			getCurrentTask: vi.fn().mockReturnValue({ taskId: "parent-1" }),
			getHistoryItem: vi.fn().mockRejectedValue(new Error("Task not found")),
			readParentMessages: vi.fn().mockResolvedValue([]),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			...overrides,
		}
	}

	const historyItem = (parallelChildIds?: string[]) =>
		({ id: "parent-1", parallelChildIds }) as unknown as HistoryItem

	const rehydrate = (fakeThis: unknown, item: HistoryItem) =>
		(ClineProvider.prototype as any).rehydrateSubagents.call(fakeThis, item)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does nothing for a task that never fanned out", async () => {
		const fakeThis = makeFakeThis()

		await rehydrate(fakeThis, historyItem(undefined))

		expect(loadSubagentSummaries).not.toHaveBeenCalled()
		expect(fakeThis.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("does nothing for an empty child list", async () => {
		const fakeThis = makeFakeThis()

		await rehydrate(fakeThis, historyItem([]))

		expect(loadSubagentSummaries).not.toHaveBeenCalled()
	})

	it("restores the children the task actually spawned, and posts them", async () => {
		loadSubagentSummaries.mockResolvedValue([
			{ taskId: "child-a", runId: "r1" },
			{ taskId: "child-b", runId: "r1" },
		])
		const fakeThis = makeFakeThis()

		await rehydrate(fakeThis, historyItem(["child-a", "child-b"]))

		expect(loadSubagentSummaries).toHaveBeenCalledWith("/tmp/storage", "parent-1")
		expect(fakeThis.subagentRegistry.restore).toHaveBeenCalledWith("parent-1", [
			{ taskId: "child-a", runId: "r1" },
			{ taskId: "child-b", runId: "r1" },
		])
		// Every row has its run: the parent's messages are not read.
		expect(fakeThis.readParentMessages).not.toHaveBeenCalled()
		expect(fakeThis.postMessageToWebview).toHaveBeenCalledWith({
			type: "subagentsUpdated",
			sourceTaskId: "parent-1",
			subagents: [{ taskId: "child-a" }],
		})
	})

	it("drops a summary the parent never listed, so a half-written sidecar cannot invent rows", async () => {
		loadSubagentSummaries.mockResolvedValue([
			{ taskId: "child-a", runId: "r1" },
			{ taskId: "child-from-a-crashed-run", runId: "r1" },
		])
		const fakeThis = makeFakeThis()

		await rehydrate(fakeThis, historyItem(["child-a"]))

		expect(fakeThis.subagentRegistry.restore).toHaveBeenCalledWith("parent-1", [{ taskId: "child-a", runId: "r1" }])
	})

	// Regression: each fan-out overwrote the sidecar, so a task reopened after
	// several fan-outs listed only the last one.
	it("rebuilds a child the sidecar lacks from its history item, in the run it was created in", async () => {
		loadSubagentSummaries.mockResolvedValue([{ taskId: "child-a", runId: "r1" }])
		const fakeThis = makeFakeThis({
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
			readParentMessages: vi
				.fn()
				.mockResolvedValue([{ ts: 1000, type: "ask", ask: "tool", text: '{"tool":"runParallelTasks"}' }]),
		})
		fakeThis.subagentRegistry.has.mockImplementation((id: string) => id === "child-live")

		await rehydrate(fakeThis, historyItem(["child-old", "child-a", "child-live", "child-gone"]))

		expect(fakeThis.getHistoryItem).not.toHaveBeenCalledWith("child-live")
		expect(fakeThis.readParentMessages).toHaveBeenCalledWith("parent-1")
		const [, rows] = fakeThis.subagentRegistry.restore.mock.calls[0]
		expect(rows).toEqual([
			{ taskId: "child-a", runId: "r1" },
			expect.objectContaining({
				taskId: "child-old",
				parentTaskId: "parent-1",
				runId: (1000).toString(36),
				status: "completed",
				description: "old work",
			}),
		])
	})

	it("survives an unreadable sidecar — restoring the parent must not depend on it", async () => {
		loadSubagentSummaries.mockRejectedValue(new Error("ENOENT"))
		const fakeThis = makeFakeThis()
		const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {})

		await expect(rehydrate(fakeThis, historyItem(["child-a"]))).resolves.toBeUndefined()
		expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[rehydrateSubagents]"))
		expect(fakeThis.postMessageToWebview).not.toHaveBeenCalled()
		loggerWarnSpy.mockRestore()
	})
})
