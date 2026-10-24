// npx vitest run core/condense/__tests__/keep-recent-tail.spec.ts

import { ApiHandler } from "../../../api"
import { ApiMessage } from "../../task-persistence/apiMessages"

import {
	summarizeConversation,
	getEffectiveApiHistory,
	computeCondenseKeepBoundary,
	toolPairsSatisfiedFrom,
	CONDENSE_KEEP_RECENT_MESSAGES,
	CONDENSE_MIN_SUMMARIZED_MESSAGES,
} from "../index"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: { capture: vi.fn() },
	},
}))

/** A plain conversation of `n` messages alternating user/assistant, with `overrides` replacing some by index. */
function conversation(n: number, overrides: Record<number, Partial<ApiMessage>> = {}): ApiMessage[] {
	return Array.from({ length: n }, (_, i) => ({
		role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
		content: `message ${i}`,
		ts: i + 1,
		...overrides[i],
	}))
}

const use = (id: string): Partial<ApiMessage> => ({
	role: "assistant",
	content: [{ type: "tool_use", id, name: "read_file", input: {} }],
})
const result = (id: string): Partial<ApiMessage> => ({
	role: "user",
	content: [{ type: "tool_result", tool_use_id: id, content: "x" }],
})
/** tool_results at the given indexes whose tool_use is not in the history. */
const orphans = (...indexes: number[]) => Object.fromEntries(indexes.map((i) => [i, result(`ghost-${i}`)]))

describe("computeCondenseKeepBoundary", () => {
	const gate = CONDENSE_KEEP_RECENT_MESSAGES + CONDENSE_MIN_SUMMARIZED_MESSAGES

	it.each<[string, ApiMessage[], number | undefined, number]>([
		["no tail below the gate", conversation(gate - 1), undefined, gate - 1],
		["no tail when keepRecent is 0", conversation(20), 0, 20],
		["the last keepRecent messages", conversation(20), undefined, 20 - CONDENSE_KEEP_RECENT_MESSAGES],
		["a keepRecent override", conversation(20), 3, 17],
		[
			"one step back so a tool pair across the boundary stays whole",
			conversation(20, { 13: use("pair"), 14: result("pair") }),
			undefined,
			13,
		],
		// Backward window [12, 16] holds orphans at 12, 14, 16; 17 onward is clean.
		[
			"forward to the first clean boundary when the capped backward pull fails",
			conversation(20, orphans(12, 14, 16)),
			4,
			17,
		],
		["no tail when every boundary splits a pair", conversation(20, orphans(12, 14, 16, 18, 19)), 4, 20],
		[
			// Every message after the prior summary is an orphan, which would otherwise pull the boundary to it.
			"no tail rather than one reaching a prior summary",
			conversation(16, {
				3: { role: "user", content: "older summary", isSummary: true, condenseId: "old" },
				...orphans(4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
			}),
			undefined,
			16,
		],
	])("keeps %s", (_label, messages, keepRecent, expected) => {
		const boundary = computeCondenseKeepBoundary(messages, keepRecent)

		expect(boundary).toBe(expected)
		expect(toolPairsSatisfiedFrom(messages, boundary)).toBe(true)
	})
})

describe("summarizeConversation with a recent raw tail", () => {
	const handler = () =>
		({
			createMessage: vi.fn(() =>
				(async function* () {
					yield { type: "text" as const, text: "A summary" }
					yield { type: "usage" as const, totalCost: 0.02, outputTokens: 80 }
				})(),
			),
			countTokens: vi.fn().mockResolvedValue(100),
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 8000 } }),
		}) as unknown as ApiHandler

	const summarize = (messages: ApiMessage[]) =>
		summarizeConversation({ messages, apiHandler: handler(), systemPrompt: "sys", taskId: "tail-task" })

	it("tags the prefix, places the summary before the untouched tail, and counts the tail tokens", async () => {
		const messages = conversation(20)
		const boundary = 20 - CONDENSE_KEEP_RECENT_MESSAGES

		const condensed = await summarize(messages)

		expect(condensed.messages).toHaveLength(21)
		expect(condensed.messages.slice(0, boundary).every((m) => m.condenseParent === condensed.condenseId)).toBe(true)
		expect(condensed.messages[boundary]).toMatchObject({ isSummary: true, condenseId: condensed.condenseId })
		expect(condensed.messages.slice(boundary + 1)).toEqual(messages.slice(boundary))
		expect(getEffectiveApiHistory(condensed.messages).slice(1)).toEqual(messages.slice(boundary))
		// countTokens (100 each) runs once for system prompt + summary and once for the tail.
		expect(condensed.newContextTokens).toBe(200)
	})

	it("keeps a tool pair at the boundary in the effective history", async () => {
		const messages = conversation(20, { 13: use("kept-pair"), 14: result("kept-pair") })

		const condensed = await summarize(messages)

		expect(getEffectiveApiHistory(condensed.messages).slice(1)).toEqual(messages.slice(13))
	})
})
