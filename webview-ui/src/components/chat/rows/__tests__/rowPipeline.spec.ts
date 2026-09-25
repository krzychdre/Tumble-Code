// pnpm --filter @roo-code/vscode-webview test src/components/chat/rows/__tests__/rowPipeline.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"

import {
	completionAndHiddenKindsFixture,
	describeRow,
	retryDelayedLastFixture,
	rowPipelineFixtures,
	toolBatchingFixture,
} from "../../__tests__/fixtures/rowPipelineFixtures"
import { CONDENSING_ROW_TS, withCondensingRow } from "../condensingRow"
import { EVER_VISIBLE_VIEWPORT, filterVisible, markEverVisible } from "../filterVisible"
import { groupToolAsks } from "../groupToolAsks"

// What ChatView does with clineMessages before the list renders them.
const combined = (messages: ClineMessage[]) => combineApiRequests(combineCommandSequences(messages.slice(1)))

const rowsOf = (messages: ClineMessage[], everVisible = new Map<number, true>()) =>
	groupToolAsks(filterVisible(combined(messages), everVisible)).map(describeRow)

describe("row pipeline functions", () => {
	// The same fixtures and expected lines as the ChatView characterization
	// spec: the pure functions give exactly the rows ChatView renders.
	it.each(rowPipelineFixtures.map((fixture) => [fixture.name, fixture] as const))(
		"produce the characterized rows: %s",
		(_name, fixture) => {
			expect(rowsOf(fixture.messages)).toEqual(fixture.expectedRows)
		},
	)

	describe("filterVisible", () => {
		const retryDone: ClineMessage = { type: "say", say: "text", ts: 3003, text: "Done.", partial: false }

		it("keeps an ever-visible row whose kind would now be filtered", () => {
			const messages = [...retryDelayedLastFixture.messages, retryDone]
			const everVisible = new Map<number, true>([[3002, true]])

			expect(filterVisible(combined(messages), everVisible).map((m) => m.ts)).toEqual([3001, 3002, 3003])
			expect(filterVisible(combined(messages), new Map()).map((m) => m.ts)).toEqual([3001, 3003])
		})

		it("still hides always-hidden kinds and empty text rows that were visible before", () => {
			const messages = completionAndHiddenKindsFixture.messages
			const everVisible = new Map<number, true>(messages.map((m) => [m.ts, true]))

			// Only the ever-visible rule applies: completion_result with empty
			// text is shown again, the always-hidden kinds and the empty text
			// row stay hidden.
			expect(filterVisible(combined(messages), everVisible).map((m) => m.ts)).toEqual([
				4001, 4003, 4011, 4012, 4013,
			])
		})

		it("reads the ever-visible set without changing it", () => {
			const everVisible = new Map<number, true>()
			filterVisible(combined(toolBatchingFixture.messages), everVisible)
			expect(everVisible.size).toBe(0)
		})
	})

	describe("markEverVisible", () => {
		it("marks the rows of the last viewport only", () => {
			const visible = Array.from(
				{ length: EVER_VISIBLE_VIEWPORT + 5 },
				(_, i): ClineMessage => ({ type: "say", say: "text", ts: i, text: `row ${i}` }),
			)
			const everVisible = new Map<number, true>()

			markEverVisible(visible, everVisible)

			expect(everVisible.size).toBe(EVER_VISIBLE_VIEWPORT)
			expect(everVisible.has(4)).toBe(false)
			expect(everVisible.has(5)).toBe(true)
			expect(everVisible.has(EVER_VISIBLE_VIEWPORT + 4)).toBe(true)
		})
	})

	describe("groupToolAsks", () => {
		const visible = () => filterVisible(combined(toolBatchingFixture.messages), new Map())

		it("puts each batched ask's payload into the synthetic row", () => {
			const rows = groupToolAsks(visible())

			expect(JSON.parse(rows.find((row) => row.ts === 1002)!.text!)).toEqual({
				tool: "readFile",
				path: "src/a.ts",
				content: "a",
				reason: "lines 1-10",
				batchFiles: [
					{
						path: "src/a.ts",
						lineSnippet: "lines 1-10",
						isOutsideWorkspace: false,
						key: "src/a.ts (lines 1-10)",
						content: "a",
					},
					{ path: "src/b.ts", lineSnippet: "", isOutsideWorkspace: false, key: "src/b.ts", content: "b" },
					{ path: "src/c.ts", lineSnippet: "", isOutsideWorkspace: true, key: "src/c.ts", content: "c" },
				],
			})
			expect(JSON.parse(rows.find((row) => row.ts === 1006)!.text!).batchDirs).toEqual([
				{ path: "src", recursive: false, isOutsideWorkspace: false, key: "src" },
				{ path: "docs", recursive: true, isOutsideWorkspace: false, key: "docs" },
			])
			expect(JSON.parse(rows.find((row) => row.ts === 1009)!.text!).batchDiffs).toEqual([
				{
					path: "src/a.ts",
					changeCount: 1,
					key: "src/a.ts",
					content: "-a\n+A",
					diffStats: { added: 1, removed: 1 },
				},
				{ path: "src/d.ts", changeCount: 1, key: "src/d.ts", content: "d" },
				{ path: "src/b.ts", changeCount: 1, key: "src/b.ts", content: "B" },
			])
		})

		it("does not modify its input and does not batch its own output again", () => {
			const input = visible()
			const snapshot = structuredClone(input)

			const rows = groupToolAsks(input)

			expect(input).toEqual(snapshot)
			expect(groupToolAsks(rows)).toEqual(rows)
		})
		it("returns the same synthetic row while its batch is unchanged", () => {
			const input = visible()
			const first = groupToolAsks(input).find((row) => row.ts === 1002)

			// The next streamed token: a new array, the same message objects.
			expect(groupToolAsks([...input]).find((row) => row.ts === 1002)).toBe(first)

			// A member of the batch changes its text: the row is rebuilt.
			const changed = input.map((message) =>
				message.ts === 1003
					? { ...message, text: JSON.stringify({ tool: "readFile", path: "src/b2.ts", content: "b2" }) }
					: message,
			)
			const rebuilt = groupToolAsks(changed).find((row) => row.ts === 1002)
			expect(rebuilt).not.toBe(first)
			expect(JSON.parse(rebuilt!.text!).batchFiles[1]).toMatchObject({ path: "src/b2.ts", content: "b2" })
		})
	})

	describe("withCondensingRow", () => {
		it("appends one fixed-ts row while condensing and nothing otherwise", () => {
			const rows = groupToolAsks(filterVisible(combined(toolBatchingFixture.messages), new Map()))

			expect(withCondensingRow(rows, false)).toBe(rows)

			const condensing = withCondensingRow(rows, true)
			expect(condensing.slice(0, -1)).toEqual(rows)
			expect(condensing.at(-1)).toEqual({
				type: "say",
				say: "condense_context",
				ts: CONDENSING_ROW_TS,
				partial: true,
			})
			// Same object on every recompute, so the row's memo holds.
			expect(withCondensingRow(rows, true).at(-1)).toBe(condensing.at(-1))
		})
	})
})
