// pnpm --filter @roo-code/vscode-webview test src/components/chat/rows/__tests__/computeRowMeta.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"

import { checkpointFixture, toolBatchingFixture } from "../../__tests__/fixtures/rowPipelineFixtures"
import { CONDENSING_ROW_TS, withCondensingRow } from "../condensingRow"
import { computeRowMeta } from "../computeRowMeta"
import { filterVisible } from "../filterVisible"
import { groupToolAsks } from "../groupToolAsks"

const rowsOf = (messages: ClineMessage[]) =>
	groupToolAsks(filterVisible(combineApiRequests(combineCommandSequences(messages.slice(1))), new Map()))

const todoAsk = (ts: number, todos: unknown[]): ClineMessage => ({
	type: "ask",
	ask: "tool",
	ts,
	text: JSON.stringify({ tool: "updateTodoList", todos }),
})

const newTaskAsk = (ts: number): ClineMessage => ({
	type: "ask",
	ask: "tool",
	ts,
	text: JSON.stringify({ tool: "newTask", mode: "code", content: "Sub task" }),
})

const todo = (content: string) => ({ id: content, content, status: "pending" })

// A task that updates its todos twice and starts two subtasks, the first one
// already finished (its subtask_result follows it).
const subtaskHistory: ClineMessage[] = [
	{ type: "say", say: "text", ts: 100, text: "Sanitized task" },
	todoAsk(101, [todo("plan")]),
	newTaskAsk(102),
	{ type: "say", say: "subtask_result", ts: 103, text: "Sub task done." },
	todoAsk(104, [todo("plan"), todo("build")]),
	{ type: "say", say: "text", ts: 105, text: "Starting the second subtask." },
	newTaskAsk(106),
]

describe("computeRowMeta", () => {
	it("lists the checkpoint_saved rows by their index in the rendered list", () => {
		const rows = rowsOf(checkpointFixture.messages)
		const { checkpointIndices } = computeRowMeta(checkpointFixture.messages, rows)

		expect(checkpointIndices).toEqual([2])
		expect(rows[2]).toMatchObject({ say: "checkpoint_saved", ts: 2004 })
	})

	it("gives each row the ts of the next message in the history", () => {
		const rows = rowsOf(toolBatchingFixture.messages)
		const { byTs } = computeRowMeta(toolBatchingFixture.messages, rows)

		// The batched read row keeps the first ask's ts; the next history
		// message is the second ask, hidden inside the batch.
		expect(byTs.get(1002)?.nextTs).toBe(1003)
		expect(byTs.get(1005)?.nextTs).toBe(1006)
		expect(byTs.get(1018)?.nextTs).toBeUndefined()
	})

	it("gives each row the todos of the latest earlier updateTodoList ask", () => {
		const { byTs } = computeRowMeta(subtaskHistory, subtaskHistory.slice(1))

		expect(byTs.get(101)?.previousTodos).toEqual([])
		expect(byTs.get(102)?.previousTodos).toEqual([todo("plan")])
		expect(byTs.get(104)?.previousTodos).toEqual([todo("plan")])
		expect(byTs.get(105)?.previousTodos).toEqual([todo("plan"), todo("build")])
	})

	it("numbers the newTask asks and tells whether a subtask_result follows", () => {
		const { byTs } = computeRowMeta(subtaskHistory, subtaskHistory.slice(1))

		expect(byTs.get(102)).toMatchObject({ newTaskIndex: 0, followedBySubtaskResult: true })
		expect(byTs.get(106)).toMatchObject({ newTaskIndex: 1, followedBySubtaskResult: false })
		expect(byTs.get(105)).toMatchObject({ newTaskIndex: undefined, followedBySubtaskResult: false })
	})

	it("gives a row that is not in the history no next message", () => {
		const rows = withCondensingRow(subtaskHistory.slice(1), true)
		const { byTs } = computeRowMeta(subtaskHistory, rows)

		expect(byTs.get(CONDENSING_ROW_TS)).toEqual({
			nextTs: undefined,
			previousTodos: [todo("plan"), todo("build")],
			newTaskIndex: undefined,
			followedBySubtaskResult: false,
		})
	})
})
