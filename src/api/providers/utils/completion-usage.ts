import type { CompletionUsage } from "../../index"

/**
 * Read a provider's usage block into the shared {@link CompletionUsage}.
 *
 * One-shot completions (`completePromptWithUsage`) go through here so that every
 * provider reports the same shape, and so the "the provider said nothing" case
 * is decided in one place: an absent or empty usage block returns `undefined`
 * rather than a row of zeros, because a zero would land in a usage total as if
 * the call had been free.
 */

type OpenAiShapedUsage =
	| {
			prompt_tokens?: number | null
			completion_tokens?: number | null
			total_tokens?: number | null
			prompt_tokens_details?: OpenAiPromptTokensDetails | null
			cache_creation_input_tokens?: number | null
			cache_read_input_tokens?: number | null
			cost?: number | null
	  }
	| null
	| undefined

type OpenAiPromptTokensDetails = {
	cached_tokens?: number | null
	cache_write_tokens?: number | null
	cache_creation_tokens?: number | null
	cache_creation_input_tokens?: number | null
}

const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined

/**
 * The first positive figure among `values`; failing that a reported 0; failing
 * that `undefined`. A server that fills several names keeps them in step, but a
 * 0 under one name must not hide a count reported under another.
 */
const firstReported = (...values: unknown[]): number | undefined => {
	const numbers = values.map(numberOrUndefined).filter((value): value is number => value !== undefined)
	return numbers.find((value) => value > 0) ?? numbers[0]
}

/**
 * Read the prompt-cache figures of an OpenAI-shaped (Chat Completions) usage
 * block. Every path that reads such a block goes through here, so one-shot and
 * streaming usage cannot drift apart again (DEF-C23).
 *
 * Cache reads, by the names servers document:
 * - `prompt_tokens_details.cached_tokens`: OpenAI, OpenRouter, Z.ai, DeepSeek,
 *   Moonshot, DashScope, LiteLLM, vLLM, llama.cpp.
 * - `cache_read_input_tokens` (top level): LiteLLM and Anthropic-style gateways.
 *
 * Cache writes:
 * - `prompt_tokens_details.cache_write_tokens`: OpenRouter, Moonshot (kimi-k3),
 *   LiteLLM.
 * - `prompt_tokens_details.cache_creation_tokens`: LiteLLM (its Anthropic and
 *   Bedrock name, mirrored with `cache_write_tokens` in current releases).
 * - `prompt_tokens_details.cache_creation_input_tokens`: DashScope (Qwen)
 *   explicit cache.
 * - `cache_creation_input_tokens` (top level): LiteLLM and Anthropic-style
 *   gateways.
 *
 * DeepSeek's `prompt_cache_miss_tokens` is deliberately not a write: those are
 * ordinary input tokens at the normal price. Under the OpenAI protocol both
 * figures are part of `prompt_tokens`, which is what `calculateApiCostOpenAI`
 * expects.
 */
export function openAiCacheTokens(usage: OpenAiShapedUsage): {
	cacheReadTokens: number | undefined
	cacheWriteTokens: number | undefined
} {
	const details = usage?.prompt_tokens_details

	return {
		cacheReadTokens: firstReported(details?.cached_tokens, usage?.cache_read_input_tokens),
		cacheWriteTokens: firstReported(
			details?.cache_write_tokens,
			details?.cache_creation_tokens,
			details?.cache_creation_input_tokens,
			usage?.cache_creation_input_tokens,
		),
	}
}

/**
 * Map an OpenAI-shaped `usage` block (`prompt_tokens` / `completion_tokens`).
 *
 * Per the OpenAI protocol `prompt_tokens` already includes any cached prefix,
 * so `cacheReadTokens` is reported alongside it as a subset, exactly as the
 * streaming path does — see `calculateApiCostOpenAI`.
 */
export function openAiCompletionUsage(usage: OpenAiShapedUsage): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.prompt_tokens)
	const outputTokens = numberOrUndefined(usage.completion_tokens)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	const { cacheReadTokens, cacheWriteTokens } = openAiCacheTokens(usage)

	return {
		inputTokens: inputTokens ?? 0,
		outputTokens: outputTokens ?? 0,
		...(cacheReadTokens !== undefined && { cacheReadTokens }),
		...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
		...(numberOrUndefined(usage.cost) !== undefined && { totalCost: usage.cost as number }),
	}
}

type AnthropicShapedUsage =
	| {
			input_tokens?: number | null
			output_tokens?: number | null
			cache_creation_input_tokens?: number | null
			cache_read_input_tokens?: number | null
	  }
	| null
	| undefined

/**
 * Map an Anthropic-shaped `usage` block.
 *
 * Here `input_tokens` excludes the cached portions, which is why the cache
 * figures are reported separately and summed by `calculateApiCostAnthropic`
 * rather than treated as a subset.
 */
export function anthropicCompletionUsage(usage: AnthropicShapedUsage): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.input_tokens)
	const outputTokens = numberOrUndefined(usage.output_tokens)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	const cacheWriteTokens = numberOrUndefined(usage.cache_creation_input_tokens)
	const cacheReadTokens = numberOrUndefined(usage.cache_read_input_tokens)

	return {
		inputTokens: inputTokens ?? 0,
		outputTokens: outputTokens ?? 0,
		...(cacheReadTokens !== undefined && { cacheReadTokens }),
		...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
	}
}

/**
 * Map the Responses API's usage block, which names its fields
 * `input_tokens`/`output_tokens` rather than the Chat Completions
 * `prompt_tokens`/`completion_tokens`. As in the rest of the OpenAI protocol
 * the cached prefix is already inside `input_tokens`.
 */
export function responsesApiCompletionUsage(
	usage:
		| {
				input_tokens?: number | null
				output_tokens?: number | null
				input_tokens_details?: { cached_tokens?: number | null } | null
		  }
		| null
		| undefined,
): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.input_tokens)
	const outputTokens = numberOrUndefined(usage.output_tokens)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	const cacheReadTokens = numberOrUndefined(usage.input_tokens_details?.cached_tokens)

	return {
		inputTokens: inputTokens ?? 0,
		outputTokens: outputTokens ?? 0,
		...(cacheReadTokens !== undefined && { cacheReadTokens }),
	}
}

/**
 * Map Gemini's `usageMetadata`, whose `promptTokenCount` includes the cached
 * portion (so the cache figure is a subset, as in the OpenAI protocol).
 */
export function geminiCompletionUsage(
	usage:
		| {
				promptTokenCount?: number | null
				candidatesTokenCount?: number | null
				cachedContentTokenCount?: number | null
		  }
		| null
		| undefined,
): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.promptTokenCount)
	const outputTokens = numberOrUndefined(usage.candidatesTokenCount)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	const cacheReadTokens = numberOrUndefined(usage.cachedContentTokenCount)

	return {
		inputTokens: inputTokens ?? 0,
		outputTokens: outputTokens ?? 0,
		...(cacheReadTokens !== undefined && { cacheReadTokens }),
	}
}

/**
 * Map Ollama's native counters (`prompt_eval_count` / `eval_count`).
 */
export function ollamaCompletionUsage(
	usage: { prompt_eval_count?: number | null; eval_count?: number | null } | null | undefined,
): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.prompt_eval_count)
	const outputTokens = numberOrUndefined(usage.eval_count)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 }
}

/**
 * Map a `{ promptTokens, completionTokens }`-shaped usage block, as returned by
 * the Vercel AI SDK's `generateText`.
 */
export function aiSdkCompletionUsage(
	usage:
		| { promptTokens?: number; completionTokens?: number; inputTokens?: number; outputTokens?: number }
		| null
		| undefined,
): CompletionUsage | undefined {
	if (!usage) {
		return undefined
	}

	const inputTokens = numberOrUndefined(usage.promptTokens) ?? numberOrUndefined(usage.inputTokens)
	const outputTokens = numberOrUndefined(usage.completionTokens) ?? numberOrUndefined(usage.outputTokens)

	if (inputTokens === undefined && outputTokens === undefined) {
		return undefined
	}

	return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 }
}
