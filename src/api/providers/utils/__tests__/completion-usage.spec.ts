// npx vitest run api/providers/utils/__tests__/completion-usage.spec.ts

import {
	aiSdkCompletionUsage,
	anthropicCompletionUsage,
	geminiCompletionUsage,
	ollamaCompletionUsage,
	openAiCompletionUsage,
	openAiUsageChunk,
	responsesApiCompletionUsage,
} from "../completion-usage"
import type { ModelInfo } from "@roo-code/types"

/**
 * The property under test throughout: a figure the provider did not report must
 * come back as absent, never as zero. A zero would be added into a usage total
 * as if the call had been free, which is exactly the kind of quietly-wrong
 * number a cost dashboard must not produce.
 */
describe("completion usage mappers", () => {
	describe("openAiCompletionUsage", () => {
		it("reads prompt/completion tokens", () => {
			expect(openAiCompletionUsage({ prompt_tokens: 1200, completion_tokens: 34 })).toEqual({
				inputTokens: 1200,
				outputTokens: 34,
			})
		})

		it("reports the cached prefix as a subset of the input", () => {
			const usage = openAiCompletionUsage({
				prompt_tokens: 1200,
				completion_tokens: 34,
				prompt_tokens_details: { cached_tokens: 1024 },
			})

			expect(usage).toEqual({ inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1024 })
		})

		it.each([[null], [undefined], [{}]])("returns undefined for %p rather than zeros", (input) => {
			expect(openAiCompletionUsage(input as any)).toBeUndefined()
		})

		it("reads DeepSeek's top-level prompt_cache_hit_tokens as cache reads", () => {
			expect(
				openAiCompletionUsage({
					prompt_tokens: 1200,
					completion_tokens: 34,
					prompt_cache_hit_tokens: 1024,
					prompt_cache_miss_tokens: 176,
				} as any),
			).toEqual({ inputTokens: 1200, outputTokens: 34, cacheReadTokens: 1024 })
		})

		it("does not turn a non-numeric field into a number", () => {
			expect(openAiCompletionUsage({ prompt_tokens: "1200" as any, completion_tokens: 34 })).toEqual({
				inputTokens: 0,
				outputTokens: 34,
			})
		})
	})

	describe("anthropicCompletionUsage", () => {
		it("keeps the cache figures separate from the input, as Anthropic reports them", () => {
			expect(
				anthropicCompletionUsage({
					input_tokens: 100,
					output_tokens: 20,
					cache_creation_input_tokens: 500,
					cache_read_input_tokens: 4000,
				}),
			).toEqual({ inputTokens: 100, outputTokens: 20, cacheWriteTokens: 500, cacheReadTokens: 4000 })
		})

		it("returns undefined when nothing was reported", () => {
			expect(anthropicCompletionUsage(undefined)).toBeUndefined()
		})
	})

	describe("responsesApiCompletionUsage", () => {
		it("reads input_tokens/output_tokens, not prompt_tokens", () => {
			expect(
				responsesApiCompletionUsage({
					input_tokens: 900,
					output_tokens: 12,
					input_tokens_details: { cached_tokens: 512 },
				}),
			).toEqual({ inputTokens: 900, outputTokens: 12, cacheReadTokens: 512 })
		})

		it("ignores a Chat-Completions-shaped block instead of guessing", () => {
			expect(responsesApiCompletionUsage({ prompt_tokens: 900 } as any)).toBeUndefined()
		})
	})

	describe("geminiCompletionUsage", () => {
		it("maps the usageMetadata field names", () => {
			expect(
				geminiCompletionUsage({
					promptTokenCount: 700,
					candidatesTokenCount: 9,
					cachedContentTokenCount: 256,
				}),
			).toEqual({ inputTokens: 700, outputTokens: 9, cacheReadTokens: 256 })
		})
	})

	describe("ollamaCompletionUsage", () => {
		it("maps the native eval counters", () => {
			expect(ollamaCompletionUsage({ prompt_eval_count: 55, eval_count: 5 })).toEqual({
				inputTokens: 55,
				outputTokens: 5,
			})
		})
	})

	describe("aiSdkCompletionUsage", () => {
		it("accepts either naming the SDK has used", () => {
			expect(aiSdkCompletionUsage({ promptTokens: 10, completionTokens: 2 })).toEqual({
				inputTokens: 10,
				outputTokens: 2,
			})
			expect(aiSdkCompletionUsage({ inputTokens: 10, outputTokens: 2 })).toEqual({
				inputTokens: 10,
				outputTokens: 2,
			})
		})
	})

	describe("openAiUsageChunk (streaming)", () => {
		// $1 per million input, $2 per million output, $0.10 per million cache reads, $1.25 per million writes.
		const priced: ModelInfo = {
			contextWindow: 128_000,
			supportsPromptCache: true,
			inputPrice: 1,
			outputPrice: 2,
			cacheReadsPrice: 0.1,
			cacheWritesPrice: 1.25,
		}

		it("reads the same figures as the one-shot parser and computes the cost from the model's prices", () => {
			const usage = {
				prompt_tokens: 1_000_000,
				completion_tokens: 1_000_000,
				prompt_tokens_details: { cached_tokens: 400_000 },
			}

			expect(openAiUsageChunk(usage, { modelInfo: priced })).toEqual({
				type: "usage",
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 400_000,
				// 600k uncached input at $1 + 400k cache reads at $0.10 + 1M output at $2
				totalCost: 0.6 + 0.04 + 2,
			})
			expect(openAiCompletionUsage(usage)).toMatchObject({ cacheReadTokens: 400_000 })
		})

		it("reads DeepSeek's prompt_cache_hit_tokens like the one-shot parser", () => {
			expect(
				openAiUsageChunk({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 60 } as any),
			).toEqual({ type: "usage", inputTokens: 100, outputTokens: 5, cacheReadTokens: 60 })
		})

		it("uses the billed cost, including the upstream cost of bring-your-own-key requests", () => {
			expect(
				openAiUsageChunk(
					{
						prompt_tokens: 100,
						completion_tokens: 20,
						completion_tokens_details: { reasoning_tokens: 8 },
						cost: 0.002,
						cost_details: { upstream_inference_cost: 0.001 },
					},
					{ billedCost: true, modelInfo: priced },
				),
			).toEqual({ type: "usage", inputTokens: 100, outputTokens: 20, reasoningTokens: 8, totalCost: 0.003 })
		})

		it("carries no cost without model info or billing", () => {
			expect(openAiUsageChunk({ prompt_tokens: 100, completion_tokens: 5 })).toEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 5,
			})
		})

		it("leaves out cache figures of 0 and still yields zeros for a block without token counts", () => {
			expect(
				openAiUsageChunk({
					prompt_tokens: 100,
					completion_tokens: 5,
					prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
				}),
			).toEqual({ type: "usage", inputTokens: 100, outputTokens: 5 })
			expect(openAiUsageChunk({})).toEqual({ type: "usage", inputTokens: 0, outputTokens: 0 })
		})
	})
})
