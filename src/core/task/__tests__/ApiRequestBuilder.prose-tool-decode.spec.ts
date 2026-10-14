// cd src && ./node_modules/.bin/vitest run core/task/__tests__/ApiRequestBuilder.prose-tool-decode.spec.ts

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"
import type { ApiMessage } from "../../task-persistence"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

/**
 * A task saved before prose tool arguments were decoded at parse time can hold
 * attempt_completion calls whose input carries literal `ł` text. The model
 * copies its own earlier calls, so the request built from that history must
 * carry real letters, while the stored history and non-prose tools stay as
 * written.
 */

function build(messages: ApiMessage[]): unknown[] {
	const access = { api: {}, microcompactedIds: new Set<string>() } as unknown as ApiRequestBuilderAccess
	return new ApiRequestBuilder(access).buildCleanConversationHistory(messages)
}

// Backslash-u text as it sits in api_conversation_history.json after JSON parsing.
const ESCAPED = "Dok\\u0142adnie tak, w kt\\u00f3rym"
const DECODED = "Dokładnie tak, w którym"

function history(): ApiMessage[] {
	return [
		{ role: "user", content: [{ type: "text", text: "Zr\\u00f3b to" }], ts: 1 },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "Writing the file." },
				{ type: "tool_use", id: "w1", name: "write_to_file", input: { path: "a.js", content: ESCAPED } },
			],
			ts: 2,
		},
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "ok" }], ts: 3 },
		{
			role: "assistant",
			content: [{ type: "tool_use", id: "c1", name: "attempt_completion", input: { result: ESCAPED } }],
			ts: 4,
		},
	]
}

describe("ApiRequestBuilder.buildCleanConversationHistory prose tool decoding", () => {
	it("sends an escaped attempt_completion input decoded", () => {
		const clean = build(history()) as ApiMessage[]

		expect(clean[3]).toEqual({
			role: "assistant",
			content: [{ type: "tool_use", id: "c1", name: "attempt_completion", input: { result: DECODED } }],
		})
	})

	it("sends write_to_file content and user text verbatim", () => {
		const clean = build(history()) as ApiMessage[]

		expect(clean[0]).toEqual({ role: "user", content: [{ type: "text", text: "Zr\\u00f3b to" }] })
		expect(clean[1]).toEqual({
			role: "assistant",
			content: [
				{ type: "text", text: "Writing the file." },
				{ type: "tool_use", id: "w1", name: "write_to_file", input: { path: "a.js", content: ESCAPED } },
			],
		})
	})

	it("leaves the stored history untouched", () => {
		const stored = history()
		const snapshot = structuredClone(stored)
		const completionInput = (stored[3].content as Array<{ input: unknown }>)[0].input

		build(stored)

		expect(stored).toEqual(snapshot)
		expect((stored[3].content as Array<{ input: unknown }>)[0].input).toBe(completionInput)
	})
})
