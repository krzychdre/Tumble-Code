import type { ApiStreamToolCallPartialChunk, ApiStreamFinishReasonChunk } from "../../transform/stream"

/**
 * Delta shape that the raw-OpenAI-SDK provider family receives.
 * Only the fields we need are declared; providers may pass the full SDK delta.
 */
interface DeltaWithToolCalls {
	tool_calls?: Array<{
		index: number
		id?: string
		function?: {
			name?: string
			arguments?: string
		}
	}> | null
}

/**
 * Yields one `tool_call_partial` chunk per entry in `delta.tool_calls`.
 *
 * Used by the raw-OpenAI-SDK provider family (base-openai-compatible, deepseek,
 * lm-studio, qwen-code, openrouter) to deduplicate the identical per-chunk
 * emission loop. `Array.isArray` (inherited from openrouter's original, most
 * defensive variant) protects against proxied/local backends that put a
 * non-array in `tool_calls` — a `for…of` over that would kill the stream.
 *
 * NativeToolCallParser handles all state management downstream.
 */
export function* emitToolCallChunks(
	delta: DeltaWithToolCalls | undefined | null,
): Generator<ApiStreamToolCallPartialChunk> {
	if (delta && Array.isArray(delta.tool_calls)) {
		for (const toolCall of delta.tool_calls) {
			yield {
				type: "tool_call_partial",
				index: toolCall.index,
				id: toolCall.id,
				name: toolCall.function?.name,
				arguments: toolCall.function?.arguments,
			}
		}
	}
}

/**
 * Yields a single `finish_reason` chunk when `finishReason` is a non-empty
 * string, otherwise yields nothing.
 *
 * TaskStreamProcessor finalizes centrally based on this chunk, covering
 * all finish reasons (not just "tool_calls") — many local/weak
 * OpenAI-compatible servers return "stop" even after emitting tool_calls
 * deltas (AP-2).
 */
export function* emitFinishReasonChunk(finishReason: string | null | undefined): Generator<ApiStreamFinishReasonChunk> {
	if (finishReason) {
		yield { type: "finish_reason", finishReason }
	}
}
