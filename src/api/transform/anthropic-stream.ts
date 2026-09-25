import type { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { calculateApiCostAnthropic } from "../../shared/cost"

import type { ApiStream } from "./stream"

/**
 * Turns a streamed Anthropic Messages response into ApiStream chunks. Shared
 * by every handler that speaks the Anthropic protocol (Anthropic, MiniMax,
 * Anthropic on Vertex) so the event mapping and the cost live in one place.
 *
 * Usage chunks pass the raw counts through as they arrive (message_start with
 * input and cache tokens, each message_delta with its output tokens). When
 * any token was reported, a last usage chunk carries the total cost priced
 * with `costInfo`. message_delta output_tokens is cumulative for the whole
 * response (it already includes the provisional count from message_start), so
 * it replaces the running total instead of adding to it; Math.max keeps a
 * missing or zero value from lowering the count.
 *
 * Not mapped today: thinking signatures (signature_delta), redacted_thinking
 * blocks, and the stop reason. Tool call completion is left to
 * NativeToolCallParser, which receives the raw tool_call_partial chunks.
 */
export async function* processAnthropicStream(
	stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
	costInfo: ModelInfo,
): ApiStream {
	let inputTokens = 0
	let outputTokens = 0
	let cacheWriteTokens = 0
	let cacheReadTokens = 0

	for await (const chunk of stream) {
		switch (chunk.type) {
			case "message_start": {
				const usage = chunk.message.usage
				const input = usage.input_tokens || 0
				const output = usage.output_tokens || 0

				yield {
					type: "usage",
					inputTokens: input,
					outputTokens: output,
					cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
					cacheReadTokens: usage.cache_read_input_tokens || undefined,
				}

				inputTokens += input
				outputTokens += output
				cacheWriteTokens += usage.cache_creation_input_tokens || 0
				cacheReadTokens += usage.cache_read_input_tokens || 0
				break
			}
			case "message_delta": {
				const deltaOutputTokens = chunk.usage.output_tokens || 0

				yield { type: "usage", inputTokens: 0, outputTokens: deltaOutputTokens }

				outputTokens = Math.max(outputTokens, deltaOutputTokens)
				break
			}
			case "content_block_start":
				switch (chunk.content_block.type) {
					case "thinking":
						// Several blocks of one kind are joined with a line break.
						if (chunk.index > 0) {
							yield { type: "reasoning", text: "\n" }
						}
						yield { type: "reasoning", text: chunk.content_block.thinking }
						break
					case "text":
						if (chunk.index > 0) {
							yield { type: "text", text: "\n" }
						}
						yield { type: "text", text: chunk.content_block.text }
						break
					case "tool_use":
						// The first partial carries the id and the name.
						yield {
							type: "tool_call_partial",
							index: chunk.index,
							id: chunk.content_block.id,
							name: chunk.content_block.name,
							arguments: undefined,
						}
						break
				}
				break
			case "content_block_delta":
				switch (chunk.delta.type) {
					case "thinking_delta":
						yield { type: "reasoning", text: chunk.delta.thinking }
						break
					case "text_delta":
						yield { type: "text", text: chunk.delta.text }
						break
					case "input_json_delta":
						// Later partials carry the arguments as they stream in.
						yield {
							type: "tool_call_partial",
							index: chunk.index,
							id: undefined,
							name: undefined,
							arguments: chunk.delta.partial_json,
						}
						break
				}
				break
		}
	}

	if (inputTokens > 0 || outputTokens > 0 || cacheWriteTokens > 0 || cacheReadTokens > 0) {
		const { totalCost } = calculateApiCostAnthropic(
			costInfo,
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
		)

		yield { type: "usage", inputTokens: 0, outputTokens: 0, totalCost }
	}
}

/**
 * Prompt caching for the Anthropic protocol: marks the last content block of
 * the last two user messages with `cache_control` (a string content becomes
 * one text block). The last user message is cached for the next request; the
 * one before it tells the server where the cached prefix of this request
 * ends. Returns new message objects and never mutates its input.
 *
 * Anthropic on Vertex uses its own placement (`caching/vertex.ts`: only text
 * blocks are marked).
 */
export function addAnthropicCacheControl(
	messages: Anthropic.Messages.MessageParam[],
	cacheControl: Anthropic.Messages.CacheControlEphemeral = { type: "ephemeral" },
): Anthropic.Messages.MessageParam[] {
	const userMsgIndices = messages.reduce(
		(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
		[] as number[],
	)

	const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
	const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

	return messages.map((message, index) => {
		if (index !== lastUserMsgIndex && index !== secondLastUserMsgIndex) {
			return message
		}

		return {
			...message,
			content:
				typeof message.content === "string"
					? [{ type: "text", text: message.content, cache_control: cacheControl }]
					: message.content.map((content, contentIndex) =>
							contentIndex === message.content.length - 1
								? { ...content, cache_control: cacheControl }
								: content,
						),
		}
	})
}
