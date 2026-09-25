import type OpenAI from "openai"

import { TagMatcher } from "../../utils/tag-matcher"
import { extractReasoningFromDelta } from "../providers/utils/extract-reasoning"
import { emitFinishReasonChunk, emitToolCallChunks } from "../providers/utils/openai-stream-chunks"
import type { ApiStreamChunk, ApiStreamUsageChunk } from "./stream"

/**
 * One OpenRouter `reasoning_details` entry as it arrives in a delta. The same
 * detail (same `type` and `index`) is split over several deltas.
 */
export interface OpenRouterReasoningDetail {
	type: string
	text?: string
	summary?: string
	data?: string
	id?: string | null
	format?: string
	signature?: string
	index: number
}

/**
 * Where a server puts the model's reasoning in a Chat Completions delta:
 * - `reasoning_content`: `delta.reasoning_content`, falling back to
 *   `delta.reasoning` (DeepSeek, Z.ai, Qwen, Moonshot, vLLM, llama.cpp,
 *   LiteLLM).
 * - `openrouter`: `delta.reasoning_details` (kept for the next request) and
 *   the plain `delta.reasoning`, shown only when the details carried no text.
 * - `none`: the server sends no separate reasoning.
 */
export type ChatCompletionReasoningSource = "reasoning_content" | "openrouter" | "none"

export interface ChatCompletionStreamOptions {
	/**
	 * Read `<think>`/`<thought>` blocks at the start of `delta.content` as
	 * reasoning (local models that write their thoughts inline). The tags may
	 * be split across deltas.
	 */
	thinkTags?: boolean
	/** Defaults to `reasoning_content`. */
	reasoning?: ChatCompletionReasoningSource
	/**
	 * Builds the one usage chunk of the stream from the LAST usage block the
	 * server sent. Servers that repeat the cumulative usage in every chunk
	 * would otherwise be billed once per chunk, because the task adds usage
	 * chunks together (DEF-C12). Without it the stream yields no usage chunk.
	 */
	mapUsage?: (usage: OpenAI.CompletionUsage) => ApiStreamUsageChunk
	/**
	 * Sees every raw chunk before it is read, for provider-specific checks
	 * (an error object inside the stream) or bookkeeping. Throwing ends the
	 * stream with that error.
	 */
	onChunk?: (chunk: OpenAI.Chat.Completions.ChatCompletionChunk) => void
	/** With `reasoning: "openrouter"`: the accumulated details, once, after the last chunk. */
	onReasoningDetails?: (details: OpenRouterReasoningDetail[]) => void
}

type LooseDelta = {
	content?: string | null
	reasoning?: unknown
	reasoning_details?: unknown
	tool_calls?: unknown
}

/**
 * Reads an OpenAI Chat Completions stream into the task's stream chunks.
 *
 * Per chunk, in this order: reasoning, text, tool call partials (only when
 * `tool_calls` is an array; proxies have sent a bare object), then the finish
 * reason when the chunk has one (TaskStreamProcessor finalizes tool calls on
 * any finish reason, because local servers answer "stop" after tool calls).
 * After the last chunk: any text still held by the think-tag matcher, the
 * OpenRouter reasoning details, then one usage chunk.
 */
export async function* streamChatCompletion(
	stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
	options: ChatCompletionStreamOptions = {},
): AsyncGenerator<ApiStreamChunk> {
	const { thinkTags = false, reasoning = "reasoning_content", mapUsage, onChunk, onReasoningDetails } = options

	const matcher = thinkTags
		? new TagMatcher(
				["think", "thought"],
				(chunk) => ({ type: chunk.matched ? "reasoning" : "text", text: chunk.data }) as const,
			)
		: undefined
	const reasoningDetails = new Map<string, OpenRouterReasoningDetail>()
	// OpenRouter repeats the reasoning text in `delta.reasoning`; show it once.
	let reasoningShownFromDetails = false
	let lastUsage: OpenAI.CompletionUsage | undefined

	for await (const chunk of stream) {
		onChunk?.(chunk)

		const choice = chunk.choices?.[0]
		const delta = choice?.delta as LooseDelta | undefined

		if (delta) {
			if (reasoning === "reasoning_content") {
				const reasoningText = extractReasoningFromDelta(delta)
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}
			} else if (reasoning === "openrouter") {
				for (const text of readReasoningDetails(delta.reasoning_details, reasoningDetails)) {
					reasoningShownFromDetails = true
					yield { type: "reasoning", text }
				}
				if (typeof delta.reasoning === "string" && delta.reasoning && !reasoningShownFromDetails) {
					yield { type: "reasoning", text: delta.reasoning }
				}
			}

			if (delta.content) {
				if (matcher) {
					yield* matcher.update(delta.content)
				} else {
					yield { type: "text", text: delta.content }
				}
			}

			yield* emitToolCallChunks(delta as Parameters<typeof emitToolCallChunks>[0])
		}

		yield* emitFinishReasonChunk(choice?.finish_reason)

		if (chunk.usage) {
			lastUsage = chunk.usage
		}
	}

	if (matcher) {
		yield* matcher.final()
	}

	if (reasoningDetails.size > 0) {
		onReasoningDetails?.(Array.from(reasoningDetails.values()))
	}

	if (lastUsage && mapUsage) {
		yield mapUsage(lastUsage)
	}
}

/**
 * Adds one delta's `reasoning_details` to the accumulator (text, summary and
 * data are concatenated per `type` and `index`, the other fields take the
 * latest value) and returns the displayable parts: `reasoning.text` and
 * `reasoning.summary`. Encrypted details are kept but never shown.
 */
function readReasoningDetails(raw: unknown, accumulator: Map<string, OpenRouterReasoningDetail>): string[] {
	if (!Array.isArray(raw)) {
		return []
	}

	const shown: string[] = []

	for (const detail of raw as Array<Omit<OpenRouterReasoningDetail, "index"> & { index?: number }>) {
		const index = detail.index ?? 0
		const key = `${detail.type}-${index}`
		const existing = accumulator.get(key)

		if (existing) {
			if (detail.text !== undefined) existing.text = (existing.text || "") + detail.text
			if (detail.summary !== undefined) existing.summary = (existing.summary || "") + detail.summary
			if (detail.data !== undefined) existing.data = (existing.data || "") + detail.data
			if (detail.id !== undefined) existing.id = detail.id
			if (detail.format !== undefined) existing.format = detail.format
			if (detail.signature !== undefined) existing.signature = detail.signature
		} else {
			accumulator.set(key, {
				type: detail.type,
				text: detail.text,
				summary: detail.summary,
				data: detail.data,
				id: detail.id,
				format: detail.format,
				signature: detail.signature,
				index,
			})
		}

		const text =
			detail.type === "reasoning.text" && typeof detail.text === "string"
				? detail.text
				: detail.type === "reasoning.summary" && typeof detail.summary === "string"
					? detail.summary
					: undefined
		if (text) {
			shown.push(text)
		}
	}

	return shown
}
