// npx vitest run src/api/transform/__tests__/anthropic-stream.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { calculateApiCostAnthropic } from "../../../shared/cost"
import { addAnthropicCacheControl, processAnthropicStream } from "../anthropic-stream"
import type { ApiStreamChunk } from "../stream"

const MODEL_INFO: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsPromptCache: true,
	inputPrice: 3,
	outputPrice: 15,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

async function* events(list: unknown[]): AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
	for (const event of list) {
		yield event as Anthropic.Messages.RawMessageStreamEvent
	}
}

async function collect(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

describe("processAnthropicStream", () => {
	it("maps every event type to ApiStream chunks and ends with the computed cost", async () => {
		const chunks = await collect(
			processAnthropicStream(
				events([
					{
						type: "message_start",
						message: {
							usage: {
								input_tokens: 1000,
								output_tokens: 1,
								cache_creation_input_tokens: 200,
								cache_read_input_tokens: 300,
							},
						},
					},
					{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "a" } },
					{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "b" } },
					{ type: "content_block_stop", index: 0 },
					{ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "c" } },
					{ type: "content_block_start", index: 2, content_block: { type: "text", text: "x" } },
					{ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "y" } },
					{
						type: "content_block_start",
						index: 3,
						content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
					},
					{ type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: "{}" } },
					{ type: "message_delta", delta: {}, usage: { output_tokens: 120 } },
					{ type: "message_stop" },
				]),
				MODEL_INFO,
			),
		)

		const { totalCost } = calculateApiCostAnthropic(MODEL_INFO, 1000, 120, 200, 300)
		expect(chunks).toEqual([
			{ type: "usage", inputTokens: 1000, outputTokens: 1, cacheWriteTokens: 200, cacheReadTokens: 300 },
			{ type: "reasoning", text: "a" },
			{ type: "reasoning", text: "b" },
			{ type: "reasoning", text: "\n" },
			{ type: "reasoning", text: "c" },
			{ type: "text", text: "\n" },
			{ type: "text", text: "x" },
			{ type: "text", text: "y" },
			{ type: "tool_call_partial", index: 3, id: "toolu_1", name: "read_file", arguments: undefined },
			{ type: "tool_call_partial", index: 3, id: undefined, name: undefined, arguments: "{}" },
			{ type: "usage", inputTokens: 0, outputTokens: 120 },
			{ type: "usage", inputTokens: 0, outputTokens: 0, totalCost },
		])
	})

	it("bills the cumulative message_delta output, never lowering it", async () => {
		const chunks = await collect(
			processAnthropicStream(
				events([
					{ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
					{ type: "message_delta", delta: {}, usage: { output_tokens: 200 } },
					{ type: "message_delta", delta: {}, usage: { output_tokens: 500 } },
					{ type: "message_delta", delta: {}, usage: { output_tokens: 0 } },
				]),
				MODEL_INFO,
			),
		)

		expect(chunks.at(-1)).toEqual({
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			totalCost: calculateApiCostAnthropic(MODEL_INFO, 10, 500, 0, 0).totalCost,
		})
	})

	it("yields no cost chunk when the stream reports no tokens", async () => {
		const chunks = await collect(
			processAnthropicStream(
				events([
					{ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } },
					{ type: "message_delta", delta: {}, usage: { output_tokens: 0 } },
				]),
				MODEL_INFO,
			),
		)

		expect(chunks).toEqual([
			{ type: "usage", inputTokens: 0, outputTokens: 0, cacheWriteTokens: undefined, cacheReadTokens: undefined },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		])
	})

	it("ignores signature deltas, redacted thinking and unknown events", async () => {
		const chunks = await collect(
			processAnthropicStream(
				events([
					{ type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "x" } },
					{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "s" } },
					{ type: "ping" },
				]),
				MODEL_INFO,
			),
		)

		expect(chunks).toEqual([])
	})
})

describe("addAnthropicCacheControl", () => {
	const ephemeral = { type: "ephemeral" }

	it("marks the last block of the last two user messages and turns strings into text blocks", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "old" },
			{ role: "assistant", content: "reply" },
			{
				role: "user",
				content: [
					{ type: "text", text: "a" },
					{ type: "tool_result", tool_use_id: "t", content: "r" },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "reply 2" }] },
			{ role: "user", content: "new" },
		]

		expect(addAnthropicCacheControl(messages)).toEqual([
			{ role: "user", content: "old" },
			{ role: "assistant", content: "reply" },
			{
				role: "user",
				content: [
					{ type: "text", text: "a" },
					{ type: "tool_result", tool_use_id: "t", content: "r", cache_control: ephemeral },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "reply 2" }] },
			{ role: "user", content: [{ type: "text", text: "new", cache_control: ephemeral }] },
		])
	})

	it("does not mutate its input", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: [{ type: "text", text: "a" }] },
			{ role: "user", content: "b" },
		]
		const before = structuredClone(messages)

		addAnthropicCacheControl(messages)

		expect(messages).toEqual(before)
	})

	it("returns the messages unchanged when there is no user message", () => {
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "assistant", content: "only" }]

		expect(addAnthropicCacheControl(messages)).toEqual(messages)
	})
})
