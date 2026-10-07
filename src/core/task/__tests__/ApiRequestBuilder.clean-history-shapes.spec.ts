// cd src && ./node_modules/.bin/vitest run core/task/__tests__/ApiRequestBuilder.clean-history-shapes.spec.ts

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"
import type { ApiMessage } from "../../task-persistence"
import { MICROCOMPACT_CLEARED_PLACEHOLDER } from "../../context-management/microcompact"
import { reasoningTrimKey, trimReasoningText } from "../../context-management/reasoningTrim"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

/**
 * S6 characterization: pins every assistant-message shape that
 * buildCleanConversationHistory tells apart (OpenRouter reasoning_details,
 * embedded encrypted reasoning, embedded plain-text reasoning, a reasoning
 * block with neither field, a plain message), so removing the `as any` casts
 * on those branches cannot change what is sent.
 */

// A handler that round-trips encrypted reasoning (OpenAI Native / Codex expose getEncryptedContent).
const encryptedApi = { getEncryptedContent: () => undefined }
// Any other handler.
const plainApi = {}

function build(
	api: object,
	messages: ApiMessage[],
	preserveReasoning = false,
	microcompactedIds: ReadonlySet<string> = new Set<string>(),
): unknown[] {
	const access = { api, microcompactedIds } as unknown as ApiRequestBuilderAccess
	return new ApiRequestBuilder(access).buildCleanConversationHistory(messages, preserveReasoning)
}

const reasoningDetails = [{ type: "reasoning.text", text: "why", format: "google-gemini-v1", index: 0 }]

describe("ApiRequestBuilder.buildCleanConversationHistory message shapes (S6 characterization)", () => {
	it("keeps OpenRouter reasoning_details and collapses a single text block to a string", () => {
		const clean = build(plainApi, [
			{
				role: "assistant",
				content: [{ type: "text", text: "Answer." }],
				reasoning_details: reasoningDetails,
				ts: 1,
			},
		])

		expect(clean).toEqual([{ role: "assistant", content: "Answer.", reasoning_details: reasoningDetails }])
	})

	it("keeps reasoning_details with an empty string for empty content and the array for several blocks", () => {
		const blocks = [
			{ type: "text" as const, text: "Reading." },
			{ type: "tool_use" as const, id: "t1", name: "read_file", input: { path: "a.ts" } },
		]
		const clean = build(plainApi, [
			{ role: "assistant", content: [], reasoning_details: reasoningDetails, ts: 1 },
			{ role: "assistant", content: blocks, reasoning_details: reasoningDetails, ts: 2 },
		])

		expect(clean).toEqual([
			{ role: "assistant", content: "", reasoning_details: reasoningDetails },
			{ role: "assistant", content: blocks, reasoning_details: reasoningDetails },
		])
	})

	it("sends embedded encrypted reasoning as a standalone item only to a handler that reads it back", () => {
		const history = (): ApiMessage[] => [
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						encrypted_content: "enc",
						summary: [{ type: "summary_text", text: "s" }],
					} as any,
					{ type: "text", text: "Done." },
				],
				ts: 1,
			},
		]

		expect(build(encryptedApi, history())).toEqual([
			{ type: "reasoning", summary: [{ type: "summary_text", text: "s" }], encrypted_content: "enc" },
			{ role: "assistant", content: "Done." },
		])
		expect(build(plainApi, history())).toEqual([{ role: "assistant", content: "Done." }])
	})

	it("defaults a missing summary to an empty array and keeps an id", () => {
		const clean = build(encryptedApi, [
			{
				role: "assistant",
				content: [{ type: "reasoning", encrypted_content: "enc", id: "rs_9" } as any],
				ts: 1,
			},
		])

		expect(clean).toEqual([
			{ type: "reasoning", summary: [], encrypted_content: "enc", id: "rs_9" },
			{ role: "assistant", content: "" },
		])
	})

	it("strips embedded plain-text reasoning unless the model preserves reasoning", () => {
		const content = [
			{ type: "reasoning", text: "Let me think." } as any,
			{ type: "text", text: "Result." },
			{ type: "text", text: "More." },
		]
		const history = (): ApiMessage[] => [{ role: "assistant", content, ts: 1 }]

		expect(build(plainApi, history())).toEqual([{ role: "assistant", content: content.slice(1) }])
		expect(build(plainApi, history(), true)).toEqual([{ role: "assistant", content }])
	})

	it("passes a reasoning block with neither text nor encrypted_content through the default path", () => {
		const content = [{ type: "reasoning", summary: [] } as any, { type: "text", text: "Hi." }]

		expect(build(encryptedApi, [{ role: "assistant", content, ts: 1 }])).toEqual([{ role: "assistant", content }])
	})

	it("passes a plain assistant string and user messages through unchanged", () => {
		expect(
			build(plainApi, [
				{ role: "user", content: "Q", ts: 1 },
				{ role: "assistant", content: "A", ts: 2 },
			]),
		).toEqual([
			{ role: "user", content: "Q" },
			{ role: "assistant", content: "A" },
		])
	})
})

describe("ApiRequestBuilder.buildCleanConversationHistory send-time strip of the microcompact set", () => {
	// Long enough to be trimmed: a head paragraph, plan paragraphs without a finding, a closing one.
	const longReasoning = [
		"The user wants the cache fixed. ".repeat(12).trim(),
		...Array.from({ length: 8 }, (_, i) => `Let me read helper ${i} and its call sites. `.repeat(8).trim()),
		"Next I read the config.",
	].join("\n\n")

	const history = (): ApiMessage[] => [
		{ role: "user", content: "Fix the cache", ts: 1 },
		{
			role: "assistant",
			content: [
				{ type: "reasoning", text: longReasoning, summary: [] } as any,
				{ type: "tool_use", id: "read-1", name: "read_file", input: {} },
			],
			ts: 2,
		},
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "read-1", content: "file text" }], ts: 3 },
		{
			role: "assistant",
			content: [{ type: "reasoning", text: longReasoning, summary: [] } as any, { type: "text", text: "Done." }],
			ts: 4,
		},
	]

	const reasoningAt = (clean: unknown[], index: number) => (clean[index] as any).content[0].text

	it("trims the reasoning of the keyed turns and clears the keyed tool results, one set for both", () => {
		const stored = history()
		const clean = build(plainApi, stored, true, new Set([reasoningTrimKey(2), "read-1"]))

		expect(reasoningAt(clean, 1)).toBe(trimReasoningText(longReasoning))
		expect((clean[2] as any).content[0].content).toBe(MICROCOMPACT_CLEARED_PLACEHOLDER)
		// A turn whose key is not in the set goes out in full.
		expect(reasoningAt(clean, 3)).toBe(longReasoning)
		// Only the outgoing copy changes: the stored history stays pristine.
		expect(stored).toEqual(history())
	})

	it("sends the reasoning in full when the set holds no key for it", () => {
		const clean = build(plainApi, history(), true, new Set(["read-1"]))

		expect(reasoningAt(clean, 1)).toBe(longReasoning)
		expect(reasoningAt(clean, 3)).toBe(longReasoning)
	})
})
