// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/openai-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ReasoningDetail,
	consolidateReasoningDetails,
	convertToOpenAiMessages,
	sanitizeGeminiMessages,
} from "../openai-format"

const image = {
	type: "image" as const,
	source: { type: "base64" as const, media_type: "image/png" as const, data: "AAAA" },
}
const imageUrl = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }

function convert(messages: unknown[], options?: Parameters<typeof convertToOpenAiMessages>[1]) {
	return convertToOpenAiMessages(messages as Anthropic.Messages.MessageParam[], options) as any[]
}

describe("convertToOpenAiMessages", () => {
	it("keeps string messages and maps text and images", () => {
		expect(
			convert([
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi" },
				{ role: "user", content: [{ type: "text", text: "Look" }, image] },
			]),
		).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
			{ role: "user", content: [{ type: "text", text: "Look" }, imageUrl] },
		])
	})

	it("turns tool uses into tool calls after the joined text, with empty content when there is no text", () => {
		expect(
			convert([
				{
					role: "assistant",
					content: [
						{ type: "text", text: "First" },
						{ type: "text", text: "second" },
						{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
					],
				},
				{ role: "assistant", content: [{ type: "tool_use", id: "call_2", name: "list_files", input: {} }] },
			]),
		).toEqual([
			{
				role: "assistant",
				content: "First\nsecond",
				tool_calls: [
					{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
				],
			},
			// Gemini (via OpenRouter) needs content on every message.
			{
				role: "assistant",
				content: "",
				tool_calls: [{ id: "call_2", type: "function", function: { name: "list_files", arguments: "{}" } }],
			},
		])
	})

	it("puts tool results first, then the other user content", () => {
		expect(
			convert([
				{
					role: "user",
					content: [
						{ type: "text", text: "Done?" },
						{ type: "tool_result", tool_use_id: "call_1", content: "file body" },
					],
				},
			]),
		).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "file body" },
			{ role: "user", content: [{ type: "text", text: "Done?" }] },
		])
	})

	it.each([
		[
			"text parts joined",
			[
				{ type: "text", text: "one" },
				{ type: "text", text: "two" },
			],
			"one\ntwo",
		],
		[
			"an image replaced by a pointer",
			[{ type: "text", text: "shot:" }, image],
			"shot:\n(see following user message for image)",
		],
		// Gemini (via OpenRouter) rejects an empty tool result.
		["an empty string", "", "(empty)"],
		["no content", undefined, "(empty)"],
		["an empty list", [], "(empty)"],
	])("maps a tool result with %s", (_label, content, expected) => {
		expect(convert([{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content }] }])).toEqual(
			[{ role: "tool", tool_call_id: "call_1", content: expected }],
		)
	})

	it("normalizes tool use and tool result ids when asked", () => {
		const normalizeToolCallId = (id: string) => `n_${id}`
		const result = convert(
			[
				{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "x", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
			],
			{ normalizeToolCallId },
		)
		expect(result[0].tool_calls[0].id).toBe("n_call_1")
		expect(result[1].tool_call_id).toBe("n_call_1")
	})

	// Gemini (via OpenRouter) rejects a message part without text.
	it.each([
		[
			"drops empty text blocks",
			[{ type: "text", text: "" }, { type: "text", text: "kept" }, image],
			[{ type: "text", text: "kept" }, imageUrl],
		],
		["sends no user message when every text block is empty", [{ type: "text", text: "" }], undefined],
	])("%s", (_label, content, expected) => {
		const result = convert([{ role: "user", content }])
		expect(result[0]?.content).toEqual(expected)
	})

	describe("mergeToolResultText", () => {
		const toolResults = (...extra: unknown[]) => [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call_1", content: "one" },
					{ type: "tool_result", tool_use_id: "call_2", content: "two" },
					...extra,
				],
			},
		]
		const details = { type: "text", text: "<environment_details>x</environment_details>" }

		it("merges post-tool text into the last tool message", () => {
			expect(
				convert(toolResults(details, { type: "text", text: "more" }), { mergeToolResultText: true }),
			).toEqual([
				{ role: "tool", tool_call_id: "call_1", content: "one" },
				{
					role: "tool",
					tool_call_id: "call_2",
					content: "two\n\n<environment_details>x</environment_details>\nmore",
				},
			])
		})

		it.each([
			["the option is off", toolResults(details), {}],
			["the text comes with an image", toolResults(details, image), { mergeToolResultText: true }],
			["there is no tool result", [{ role: "user", content: [details] }], { mergeToolResultText: true }],
		])("keeps a separate user message when %s", (_label, messages, options) => {
			expect(convert(messages, options).at(-1).role).toBe("user")
		})
	})

	describe("reasoning_details", () => {
		const xaiDetails = [
			{ type: "reasoning.summary", summary: "joke", format: "xai-responses-v1", index: 0 },
			{ type: "reasoning.encrypted", data: "enc", id: "rs_abc", format: "xai-responses-v1", index: 0 },
		]
		// OpenAI answers 404 for an `id` of an openai-responses-v1 block: items are not persisted
		// with store: false, which is how we call it.
		const openAiDetail = {
			type: "reasoning.summary",
			id: "rs_x",
			format: "openai-responses-v1",
			summary: "s",
			data: "d",
			index: 0,
		}
		const { id: _id, ...openAiDetailWithoutId } = openAiDetail

		it.each([
			["string content", "Ok."],
			["block content", [{ type: "text", text: "Ok." }]],
		])("passes them through on assistant %s, stripping only openai-responses-v1 ids", (_label, content) => {
			const [message] = convert([
				{ role: "assistant", content, reasoning_details: [...xaiDetails, openAiDetail] },
			])
			expect(message).toEqual({
				role: "assistant",
				content: "Ok.",
				reasoning_details: [...xaiDetails, openAiDetailWithoutId],
			})
		})

		it("puts them before the tool calls", () => {
			const [message] = convert([
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_1", name: "read_file", input: {} }],
					reasoning_details: xaiDetails,
				},
			])
			expect(Object.keys(message)).toEqual(["role", "content", "reasoning_details", "tool_calls"])
		})

		it("ignores them on user messages and when they are not a list", () => {
			expect(
				convert([
					{ role: "user", content: "Hi", reasoning_details: xaiDetails },
					{ role: "assistant", content: "Ok.", reasoning_details: "corrupt" },
				]),
			).toEqual([
				{ role: "user", content: "Hi" },
				{ role: "assistant", content: "Ok." },
			])
		})
	})
})

describe("consolidateReasoningDetails", () => {
	it("returns nothing for no details", () => {
		expect(consolidateReasoningDetails([])).toEqual([])
		expect(consolidateReasoningDetails(undefined as unknown as ReasoningDetail[])).toEqual([])
	})

	it("joins text per index with the last signature and id, keeps the last encrypted block, drops corrupted ones", () => {
		expect(
			consolidateReasoningDetails([
				{
					type: "reasoning.text",
					text: "Hello ",
					signature: "s1",
					id: "a",
					format: "anthropic-claude-v1",
					index: 0,
				},
				{ type: "reasoning.text", text: "world", signature: "s2", index: 0 },
				{ type: "reasoning.encrypted", index: 0 },
				{ type: "reasoning.encrypted", data: "old", index: 0 },
				{ type: "reasoning.encrypted", data: "new", id: "e", format: "google-gemini-v1", index: 0 },
				{ type: "reasoning.summary", summary: "Sum", index: 1 },
				{ type: "reasoning.summary", summary: "mary", index: 1 },
				{ type: "reasoning.text", text: "!" },
			]),
		).toEqual([
			// An entry without an index joins index 0; type and format come from the last entry with one.
			{
				type: "reasoning.text",
				text: "Hello world!",
				signature: "s2",
				id: "e",
				format: "google-gemini-v1",
				index: 0,
			},
			{
				type: "reasoning.encrypted",
				data: "new",
				signature: undefined,
				id: "e",
				format: "google-gemini-v1",
				index: 0,
			},
			{
				type: "reasoning.summary",
				summary: "Summary",
				signature: undefined,
				id: undefined,
				format: "unknown",
				index: 1,
			},
		])
	})
})

describe("sanitizeGeminiMessages", () => {
	const call = (id: string): OpenAI.Chat.ChatCompletionMessageToolCall => ({
		id,
		type: "function",
		function: { name: "read_file", arguments: "{}" },
	})
	const detail = (id?: string) => ({
		type: "reasoning.encrypted",
		data: `sig_${id ?? "legacy"}`,
		...(id && { id }),
		index: 0,
	})

	it("leaves the messages of a non-Gemini model alone", () => {
		const messages = [{ role: "assistant", content: "", tool_calls: [call("a")] }] as any
		expect(sanitizeGeminiMessages(messages, "claude-sonnet-4-5")).toBe(messages)
	})

	it("drops tool calls without matching reasoning details, and their tool results", () => {
		const messages = [
			{ role: "user", content: "go" },
			// A turn of another model: no details at all.
			{ role: "assistant", content: "Reading.", tool_calls: [call("other")] },
			{ role: "tool", tool_call_id: "other", content: "x" },
			{ role: "assistant", content: null, tool_calls: [call("other2")] },
			{ role: "tool", tool_call_id: "other2", content: "x" },
			// A Gemini turn: one call has its signature, one does not.
			{
				role: "assistant",
				content: null,
				tool_calls: [call("g1"), call("g2")],
				reasoning_details: [detail("g1"), detail("zz"), detail()],
			},
			{ role: "tool", tool_call_id: "g1", content: "kept" },
			{ role: "tool", tool_call_id: "g2", content: "dropped" },
			{ role: "assistant", content: "plain" },
		] as any

		expect(sanitizeGeminiMessages(messages, "google/gemini-3-pro")).toEqual([
			{ role: "user", content: "go" },
			{ role: "assistant", content: "Reading." },
			{
				role: "assistant",
				content: "",
				reasoning_details: consolidateReasoningDetails([
					detail("g1") as ReasoningDetail,
					detail() as ReasoningDetail,
				]),
				tool_calls: [call("g1")],
			},
			{ role: "tool", tool_call_id: "g1", content: "kept" },
			{ role: "assistant", content: "plain" },
		])
	})

	it("keeps the message without tool calls when no detail matches", () => {
		const messages = [
			{ role: "assistant", content: "text", tool_calls: [call("a")], reasoning_details: [detail("b")] },
		] as any
		expect(sanitizeGeminiMessages(messages, "gemini-3-pro")).toEqual([{ role: "assistant", content: "text" }])
	})
})
