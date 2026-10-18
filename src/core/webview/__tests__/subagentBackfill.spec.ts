// npx vitest run core/webview/__tests__/subagentBackfill.spec.ts

import type { ClineMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { completeSubagentRows, fanOutStartTimes, uuidv7Time } from "../subagentBackfill"

vi.mock("../../tools/RunParallelTasksTool", () => ({
	subagentDescription: (message: string) => message.split("\n", 1)[0],
}))

// The 2026-10-18 Game task: three fan-outs, ten subagents, a sidecar that
// only held the second run (each fan-out overwrote it).
const PARENT = "01a14ea2-0548-7721-808f-57e3155a7a45"
const RUN1_START = 1792337325667
const RUN2_START = 1792339125542
const RUN3_START = 1792342085614
const RUN1 = ["01a14fa1-2f02-747d-815e-2a8e88824568", "01a14fa1-2f67-770f-9190-f8f6d8adbbf8"]
const RUN1_LATE = "01a14fac-85e8-7176-ba04-a98b180e7cc5" // queued behind the concurrency limit
const RUN2 = "01a14fbc-a626-76a6-9983-5296aa6d3073"

const toolAsk = (ts: number, tool: string): ClineMessage =>
	({ ts, type: "ask", ask: "tool", text: JSON.stringify({ tool }) }) as ClineMessage

function historyItem(id: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id,
		number: 1,
		ts: (uuidv7Time(id) ?? 0) + 60_000,
		task: "Repo: /home/krzych/Desktop/Game\nmore lines",
		tokensIn: 10,
		tokensOut: 20,
		totalCost: 0.5,
		mode: "code",
		apiConfigName: "DeepSeek",
		outcome: "unfinished",
		...overrides,
	} as HistoryItem
}

function savedRow(taskId: string, overrides: Partial<SubagentSummary> = {}): SubagentSummary {
	return {
		taskId,
		parentTaskId: PARENT,
		index: 0,
		mode: "code",
		description: "d",
		status: "failed",
		tokensIn: 1,
		tokensOut: 1,
		totalCost: 0,
		startedAt: uuidv7Time(taskId) ?? 0,
		lastActivityAt: 0,
		...overrides,
	}
}

describe("uuidv7Time", () => {
	it("reads the creation time of a UUIDv7 task id", () => {
		expect(uuidv7Time(RUN1[0])).toBe(1792337325826)
	})

	it("is undefined for any other id", () => {
		expect(uuidv7Time("queued:p:r:0")).toBeUndefined()
		expect(uuidv7Time("6ba7b810-9dad-41d1-80b4-00c04fd430c8")).toBeUndefined()
	})
})

describe("fanOutStartTimes", () => {
	it("returns the ts of the runParallelTasks approval asks only", () => {
		const messages = [
			toolAsk(RUN2_START, "runParallelTasks"),
			toolAsk(5, "readFile"),
			{ ts: 6, type: "say", say: "text", text: "{}" } as ClineMessage,
			{ ts: 7, type: "ask", ask: "tool", text: "not json" } as ClineMessage,
			toolAsk(RUN1_START, "runParallelTasks"),
		]
		expect(fanOutStartTimes(messages)).toEqual([RUN1_START, RUN2_START])
	})
})

describe("completeSubagentRows", () => {
	const starts = [RUN1_START, RUN2_START, RUN3_START]

	it("rebuilds the subagents the sidecar lacks and puts every row in the run it was created in", () => {
		const rows = completeSubagentRows(
			PARENT,
			[savedRow(RUN2, { index: 0 })],
			[historyItem(RUN1_LATE), historyItem(RUN1[1], { outcome: "completed" }), historyItem(RUN1[0])],
			starts,
		)

		const byId = new Map(rows.map((row) => [row.taskId, row]))
		expect(byId.get(RUN2)?.runId).toBe(RUN2_START.toString(36))
		expect(byId.get(RUN1[0])).toMatchObject({
			runId: RUN1_START.toString(36),
			index: 0,
			status: "failed",
			mode: "code",
			description: "Repo: /home/krzych/Desktop/Game",
			apiConfigName: "DeepSeek",
			totalCost: 0.5,
			startedAt: 1792337325826,
		})
		expect(byId.get(RUN1[1])).toMatchObject({ runId: RUN1_START.toString(36), index: 1, status: "completed" })
		// Created 13 minutes after the run started (a slot freed up): still run 1.
		expect(byId.get(RUN1_LATE)).toMatchObject({ runId: RUN1_START.toString(36), index: 2 })
	})

	it("keeps a saved run id and continues a run's indexes after its saved rows", () => {
		const rows = completeSubagentRows(
			PARENT,
			[savedRow(RUN1[0], { runId: RUN1_START.toString(36), index: 0 })],
			[historyItem(RUN1[1])],
			starts,
		)
		expect(rows.map((row) => [row.taskId, row.runId, row.index])).toEqual([
			[RUN1[0], RUN1_START.toString(36), 0],
			[RUN1[1], RUN1_START.toString(36), 1],
		])
	})

	it("leaves the run unknown when no fan-out start is known", () => {
		const [row] = completeSubagentRows(PARENT, [], [historyItem(RUN2)], [])
		expect(row.runId).toBeUndefined()
	})
})
