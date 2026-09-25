// cd src && ./node_modules/.bin/vitest run api/providers/responses-api/__tests__/core.spec.ts

// Unit tests of the shared Responses API event processor and usage normalizer. The cases
// of the former transform/responses-api-stream.spec (the processor xAI used before it moved
// onto the core) are kept here, adapted to the core's full usage chunk.

import type { ModelInfo } from "@roo-code/types"

import type { ApiStreamChunk } from "../../../transform/stream"
import { ResponsesApiCore, type ResponsesApiCoreOptions } from "../core"

const info: ModelInfo = { contextWindow: 128_000, supportsPromptCache: true, inputPrice: 1, outputPrice: 2 }

const texts: ResponsesApiCoreOptions["texts"] = {
	httpError: (status) => `HTTP ${status}`,
	noResponseBody: "no body",
	ownTextMarker: "Test API",
	connectionFailed: (message) => `connect: ${message}`,
	unexpectedConnectionError: "connect",
	streamErrorEvent: (message) => `event: ${message}`,
	responseFailed: (message) => `failed: ${message}`,
	streamProcessingError: (message) => `stream: ${message}`,
	unexpectedStreamError: "stream",
}

function createCore(totalCost: ResponsesApiCoreOptions["totalCost"] = () => undefined) {
	const core = new ResponsesApiCore({ providerName: "Test", texts, totalCost })
	core.startResponse()
	return core
}

async function process(events: unknown[], core = createCore()): Promise<ApiStreamChunk[]> {
	const chunks: ApiStreamChunk[] = []
	for (const event of events) {
		for await (const chunk of core.processEvent(event, info)) {
			chunks.push(chunk)
		}
	}
	return chunks
}

const usageChunk = (inputTokens: number, outputTokens: number) => ({
	type: "usage",
	inputTokens,
	outputTokens,
	cacheWriteTokens: 0,
	cacheReadTokens: 0,
})

describe("ResponsesApiCore.processEvent", () => {
	describe("text deltas", () => {
		it("yields a text chunk for response.output_text.delta", async () => {
			expect(await process([{ type: "response.output_text.delta", delta: "Hello world" }])).toEqual([
				{ type: "text", text: "Hello world" },
			])
		})

		it("yields a text chunk for response.text.delta", async () => {
			expect(await process([{ type: "response.text.delta", delta: "Hello" }])).toEqual([
				{ type: "text", text: "Hello" },
			])
		})

		it("skips a text delta with an empty delta", async () => {
			expect(await process([{ type: "response.output_text.delta", delta: "" }])).toEqual([])
		})
	})

	describe("reasoning deltas", () => {
		it.each([
			"response.reasoning_text.delta",
			"response.reasoning.delta",
			"response.reasoning_summary_text.delta",
			"response.reasoning_summary.delta",
		])("yields a reasoning chunk for %s", async (type) => {
			expect(await process([{ type, delta: "Let me think..." }])).toEqual([
				{ type: "reasoning", text: "Let me think..." },
			])
		})
	})

	describe("tool calls", () => {
		it("yields tool_call for a function_call in output_item.done", async () => {
			expect(
				await process([
					{
						type: "response.output_item.done",
						item: {
							type: "function_call",
							call_id: "call_123",
							name: "read_file",
							arguments: '{"path":"/tmp/test.txt"}',
						},
					},
				]),
			).toEqual([{ type: "tool_call", id: "call_123", name: "read_file", arguments: '{"path":"/tmp/test.txt"}' }])
		})

		it("yields tool_call for a tool_call item in output_item.done", async () => {
			expect(
				await process([
					{
						type: "response.output_item.done",
						item: {
							type: "tool_call",
							tool_call_id: "call_456",
							name: "write_file",
							arguments: '{"path":"/tmp/out.txt"}',
						},
					},
				]),
			).toEqual([{ type: "tool_call", id: "call_456", name: "write_file", arguments: '{"path":"/tmp/out.txt"}' }])
		})

		it("JSON-stringifies object arguments", async () => {
			const chunks = await process([
				{
					type: "response.output_item.done",
					item: { type: "function_call", call_id: "call_789", name: "test", input: { key: "value" } },
				},
			])
			expect(chunks).toEqual([{ type: "tool_call", id: "call_789", name: "test", arguments: '{"key":"value"}' }])
		})

		it("skips a tool_call with a missing call_id or name", async () => {
			expect(
				await process([
					{
						type: "response.output_item.done",
						item: { type: "function_call", call_id: "", name: "test", arguments: "{}" },
					},
					{
						type: "response.output_item.done",
						item: { type: "function_call", call_id: "call_1", name: "", arguments: "{}" },
					},
				]),
			).toEqual([])
		})

		it("yields tool_call_partial for function_call_arguments.delta", async () => {
			expect(
				await process([
					{
						type: "response.function_call_arguments.delta",
						call_id: "call_123",
						name: "read_file",
						delta: '{"path":',
						index: 0,
					},
				]),
			).toEqual([
				{ type: "tool_call_partial", index: 0, id: "call_123", name: "read_file", arguments: '{"path":' },
			])
		})

		it("does not yield a duplicate tool_call when the arguments were streamed as deltas", async () => {
			const delta = {
				type: "response.function_call_arguments.delta",
				call_id: "call_123",
				name: "read_file",
				index: 0,
			}
			expect(
				await process([
					{ ...delta, delta: '{"path":' },
					{ ...delta, delta: '"/tmp/test.txt"}' },
					{
						type: "response.output_item.done",
						item: {
							type: "function_call",
							call_id: "call_123",
							name: "read_file",
							arguments: '{"path":"/tmp/test.txt"}',
						},
					},
				]),
			).toEqual([
				{ type: "tool_call_partial", index: 0, id: "call_123", name: "read_file", arguments: '{"path":' },
				{
					type: "tool_call_partial",
					index: 0,
					id: "call_123",
					name: "read_file",
					arguments: '"/tmp/test.txt"}',
				},
			])
		})

		it("falls back to output_item.done when a delta has no tool name and none was announced", async () => {
			expect(
				await process([
					{
						type: "response.function_call_arguments.delta",
						call_id: "call_123",
						delta: '{"path":',
						index: 0,
					},
					{
						type: "response.output_item.done",
						item: {
							type: "function_call",
							call_id: "call_123",
							name: "read_file",
							arguments: '{"path":"/tmp/test.txt"}',
						},
					},
				]),
			).toEqual([{ type: "tool_call", id: "call_123", name: "read_file", arguments: '{"path":"/tmp/test.txt"}' }])
		})

		it("attributes identity-less deltas to the call announced in output_item.added", async () => {
			expect(
				await process([
					{
						type: "response.output_item.added",
						item: {
							id: "fc_1",
							type: "function_call",
							call_id: "call_1",
							name: "read_file",
							arguments: "",
						},
					},
					{ type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"path":"a"}' },
				]),
			).toEqual([
				{ type: "tool_call_partial", index: 0, id: "call_1", name: "read_file", arguments: '{"path":"a"}' },
			])
		})
	})

	describe("completion and usage", () => {
		it("yields usage from response.completed", async () => {
			expect(
				await process([
					{ type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 50 } } },
				]),
			).toEqual([usageChunk(100, 50)])
		})

		it("yields usage from response.done", async () => {
			expect(
				await process([
					{ type: "response.done", response: { usage: { input_tokens: 200, output_tokens: 100 } } },
				]),
			).toEqual([usageChunk(200, 100)])
		})

		it("yields no usage when the response has none", async () => {
			expect(await process([{ type: "response.completed", response: { usage: null } }])).toEqual([])
		})
	})

	it("silently ignores lifecycle events and empty items", async () => {
		expect(
			await process([
				{ type: "response.created" },
				{ type: "response.in_progress" },
				{ type: "response.output_item.added", item: { type: "message" } },
				{ type: "response.content_part.added" },
			]),
		).toEqual([])
	})

	it("handles a complete stream with reasoning, text and usage", async () => {
		expect(
			await process([
				{ type: "response.reasoning_text.delta", delta: "Thinking..." },
				{ type: "response.reasoning_text.delta", delta: " done." },
				{ type: "response.output_text.delta", delta: "The answer is " },
				{ type: "response.output_text.delta", delta: "42." },
				{ type: "response.completed", response: { usage: { input_tokens: 50, output_tokens: 30 } } },
			]),
		).toEqual([
			{ type: "reasoning", text: "Thinking..." },
			{ type: "reasoning", text: " done." },
			{ type: "text", text: "The answer is " },
			{ type: "text", text: "42." },
			usageChunk(50, 30),
		])
	})

	it("starts every response fresh: shown text and tool identity are forgotten", async () => {
		const core = createCore()
		await process(
			[
				{ type: "response.output_text.delta", delta: "first" },
				{
					type: "response.output_item.added",
					item: { type: "function_call", call_id: "c1", name: "read_file" },
				},
			],
			core,
		)
		core.startResponse()
		expect(
			await process(
				[
					{ type: "response.function_call_arguments.delta", delta: "{}" },
					{ type: "response.output_text.done", text: "second" },
				],
				core,
			),
		).toEqual([{ type: "text", text: "second" }])
	})

	it("keeps the response id and the first encrypted reasoning item", async () => {
		const core = createCore()
		await process(
			[
				{
					type: "response.completed",
					response: {
						id: "resp_1",
						output: [
							{ type: "reasoning", summary: [] },
							{ type: "reasoning", id: "rs_2", encrypted_content: "enc" },
						],
					},
				},
			],
			core,
		)
		expect(core.getResponseId()).toBe("resp_1")
		expect(core.getEncryptedContent()).toEqual({ encrypted_content: "enc", id: "rs_2" })
	})
})

describe("ResponsesApiCore.normalizeUsage", () => {
	it("returns undefined for null or undefined usage", () => {
		const core = createCore()
		expect(core.normalizeUsage(null, info)).toBeUndefined()
		expect(core.normalizeUsage(undefined, info)).toBeUndefined()
	})

	it("reads input and output tokens", () => {
		expect(createCore().normalizeUsage({ input_tokens: 100, output_tokens: 50 }, info)).toEqual(usageChunk(100, 50))
	})

	it("reads cached tokens from input_tokens_details", () => {
		const usage = { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 30 } }
		expect(createCore().normalizeUsage(usage, info)?.cacheReadTokens).toBe(30)
	})

	it("reads cache writes (Anthropic style name and GPT-5.6 details)", () => {
		const core = createCore()
		expect(
			core.normalizeUsage({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 15 }, info)
				?.cacheWriteTokens,
		).toBe(15)
		expect(
			core.normalizeUsage(
				{ input_tokens: 100, output_tokens: 50, input_tokens_details: { cache_write_tokens: 25 } },
				info,
			)?.cacheWriteTokens,
		).toBe(25)
	})

	it("derives the input total from the details when it is missing", () => {
		const usage = {
			output_tokens: 9,
			input_tokens_details: { cached_tokens: 30, cache_miss_tokens: 70, cache_write_tokens: 5 },
		}
		expect(createCore().normalizeUsage(usage, info)?.inputTokens).toBe(105)
	})

	it("reads reasoning tokens from output_tokens_details, and leaves them out when absent", () => {
		const core = createCore()
		expect(
			core.normalizeUsage(
				{ input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 20 } },
				info,
			)?.reasoningTokens,
		).toBe(20)
		expect(core.normalizeUsage({ input_tokens: 100, output_tokens: 50 }, info)).not.toHaveProperty(
			"reasoningTokens",
		)
	})

	it("adds the cost the handler computes, with the service tier the server reported", async () => {
		const totalCost = vitest.fn().mockReturnValue(0.42)
		const core = createCore(totalCost)
		const chunks = await process(
			[
				{
					type: "response.completed",
					response: {
						service_tier: "flex",
						usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 10 } },
					},
				},
			],
			core,
		)
		expect(chunks).toEqual([{ ...usageChunk(100, 50), cacheReadTokens: 10, totalCost: 0.42 }])
		expect(totalCost).toHaveBeenCalledWith(
			{ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 10 },
			info,
			"flex",
		)
	})

	it("leaves totalCost out when the handler returns none", () => {
		expect(createCore().normalizeUsage({ input_tokens: 100, output_tokens: 50 }, info)).not.toHaveProperty(
			"totalCost",
		)
	})

	it("accepts Chat Completions style field names", () => {
		expect(
			createCore().normalizeUsage(
				{ prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 10 } },
				info,
			),
		).toEqual(expect.objectContaining({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 }))
	})
})
