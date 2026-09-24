// npx vitest run api/providers/__tests__/openai-cache-usage-shapes.spec.ts

import { OpenAiHandler } from "../openai"
import { ZAiHandler } from "../zai"
import { openAiCompletionUsage } from "../utils/completion-usage"

/**
 * Usage blocks in the shape the OpenAI-compatible servers this extension talks
 * to document for Chat Completions. Numbers come from the documentation's own
 * examples where it has one; where it only has a field table, the numbers are
 * made up but the field names and nesting are the documented ones.
 *
 * The same block must give the same cache figures on every path that reads an
 * OpenAI-shaped usage block: the one-shot mapper (`openAiCompletionUsage`, used
 * by condense, memory writers and prompt enhancement) and the two streaming
 * `processUsageMetrics` implementations (`OpenAiHandler` for any
 * OpenAI-compatible base URL, `BaseOpenAiCompatibleProvider` for Z.ai).
 */
type Shape = {
	server: string
	source: string
	usage: Record<string, unknown>
	cacheReadTokens: number | undefined
	cacheWriteTokens: number | undefined
}

const shapes: Shape[] = [
	{
		server: "OpenRouter, model with explicit caching",
		source: "https://openrouter.ai/docs/use-cases/usage-accounting",
		usage: {
			completion_tokens: 2,
			completion_tokens_details: { reasoning_tokens: 0 },
			cost: 0.95,
			cost_details: { upstream_inference_cost: 19 },
			prompt_tokens: 194,
			prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 100, audio_tokens: 0 },
			total_tokens: 196,
		},
		cacheReadTokens: undefined,
		cacheWriteTokens: 100,
	},
	{
		server: "Moonshot Kimi (kimi-k3), Chat Completions",
		source: "https://platform.kimi.ai/docs/guide/context-caching.md",
		usage: {
			prompt_tokens: 1200,
			completion_tokens: 30,
			total_tokens: 1230,
			prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 400 },
		},
		cacheReadTokens: 600,
		cacheWriteTokens: 400,
	},
	{
		server: "Alibaba DashScope (Qwen), explicit cache, first request creates the cache",
		source: "https://help.aliyun.com/zh/model-studio/context-cache",
		usage: {
			prompt_tokens: 2174,
			completion_tokens: 20,
			total_tokens: 2194,
			prompt_tokens_details: { cache_creation_input_tokens: 2156, cached_tokens: 0 },
		},
		cacheReadTokens: undefined,
		cacheWriteTokens: 2156,
	},
	{
		server: "Alibaba DashScope (Qwen), explicit cache, second request hits it",
		source: "https://help.aliyun.com/zh/model-studio/context-cache",
		usage: {
			prompt_tokens: 2174,
			completion_tokens: 20,
			total_tokens: 2194,
			prompt_tokens_details: { cache_creation_input_tokens: 0, cached_tokens: 2156 },
		},
		cacheReadTokens: 2156,
		cacheWriteTokens: undefined,
	},
	{
		server: "LiteLLM proxy (current: both nested names mirrored, plus Anthropic-style top level)",
		source: "https://github.com/BerriAI/litellm/blob/main/litellm/types/utils.py (PromptTokensDetailsWrapper, Usage)",
		usage: {
			prompt_tokens: 5000,
			completion_tokens: 50,
			total_tokens: 5050,
			prompt_tokens_details: { cached_tokens: 3000, cache_write_tokens: 1500, cache_creation_tokens: 1500 },
			cache_creation_input_tokens: 1500,
			cache_read_input_tokens: 3000,
		},
		cacheReadTokens: 3000,
		cacheWriteTokens: 1500,
	},
	{
		server: "LiteLLM proxy (older: only the Anthropic/Bedrock nested name)",
		source: "https://github.com/BerriAI/litellm/blob/main/litellm/llms/bedrock/chat/converse_transformation.py",
		usage: {
			prompt_tokens: 5000,
			completion_tokens: 50,
			total_tokens: 5050,
			prompt_tokens_details: { cached_tokens: 3000, cache_creation_tokens: 1500 },
		},
		cacheReadTokens: 3000,
		cacheWriteTokens: 1500,
	},
	{
		server: "Z.ai GLM",
		source: "https://docs.z.ai/guides/capabilities/cache",
		usage: {
			prompt_tokens: 1200,
			completion_tokens: 300,
			total_tokens: 1500,
			prompt_tokens_details: { cached_tokens: 800 },
		},
		cacheReadTokens: 800,
		cacheWriteTokens: undefined,
	},
	{
		server: "DeepSeek",
		source: "https://api-docs.deepseek.com/api/create-chat-completion",
		usage: {
			completion_tokens: 9,
			prompt_tokens: 17,
			total_tokens: 26,
			prompt_tokens_details: { cached_tokens: 0 },
			prompt_cache_hit_tokens: 0,
			prompt_cache_miss_tokens: 17,
		},
		cacheReadTokens: undefined,
		cacheWriteTokens: undefined,
	},
	{
		server: "llama.cpp llama-server",
		source: "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md",
		usage: {
			completion_tokens: 48,
			prompt_tokens: 44,
			total_tokens: 92,
			prompt_tokens_details: { cached_tokens: 0 },
		},
		cacheReadTokens: undefined,
		cacheWriteTokens: undefined,
	},
]

/** The streaming chunks report "no figure" as undefined, never as 0. */
const positiveOrUndefined = (value: number | undefined) => (value ? value : undefined)

describe("cache usage fields documented by OpenAI-compatible servers", () => {
	const openAi = new OpenAiHandler({
		openAiApiKey: "test",
		openAiModelId: "any-model",
		openAiBaseUrl: "http://localhost:8000/v1",
	})
	const zai = new ZAiHandler({ zaiApiKey: "test" })

	describe.each(shapes)("$server", ({ usage, cacheReadTokens, cacheWriteTokens }) => {
		it("one-shot completions (openAiCompletionUsage)", () => {
			const result = openAiCompletionUsage(usage as any)
			expect(positiveOrUndefined(result?.cacheReadTokens)).toBe(cacheReadTokens)
			expect(positiveOrUndefined(result?.cacheWriteTokens)).toBe(cacheWriteTokens)
		})

		it("streaming through OpenAiHandler", () => {
			const chunk = (openAi as any).processUsageMetrics(usage)
			expect(chunk.cacheReadTokens).toBe(cacheReadTokens)
			expect(chunk.cacheWriteTokens).toBe(cacheWriteTokens)
		})

		it("streaming through BaseOpenAiCompatibleProvider (Z.ai)", () => {
			const chunk = (zai as any).processUsageMetrics(usage)
			expect(chunk.cacheReadTokens).toBe(cacheReadTokens)
			expect(chunk.cacheWriteTokens).toBe(cacheWriteTokens)
		})
	})

	it("a zero in the first write field does not hide a figure reported under another name", () => {
		// OpenAiHandler used `||` here, so a 0 fell through to the next name; the
		// shared reader keeps that, rather than letting the first 0 win.
		const usage = {
			prompt_tokens: 1000,
			completion_tokens: 10,
			prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
			cache_creation_input_tokens: 400,
			cache_read_input_tokens: 600,
		}

		expect(openAiCompletionUsage(usage)).toMatchObject({ cacheReadTokens: 600, cacheWriteTokens: 400 })
		expect((openAi as any).processUsageMetrics(usage)).toMatchObject({ cacheReadTokens: 600, cacheWriteTokens: 400 })
		expect((zai as any).processUsageMetrics(usage)).toMatchObject({ cacheReadTokens: 600, cacheWriteTokens: 400 })
	})

	it("one-shot keeps a reported zero as zero, so a real 0 is not mistaken for 'not reported'", () => {
		expect(
			openAiCompletionUsage({
				prompt_tokens: 10,
				completion_tokens: 1,
				prompt_tokens_details: { cached_tokens: 0 },
			}),
		).toEqual({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 })
	})

	it("does not count a DeepSeek cache miss as a cache write", () => {
		// prompt_cache_miss_tokens are ordinary input tokens billed at the normal
		// price, not tokens written to a separately priced cache.
		const result = openAiCompletionUsage({
			prompt_tokens: 17,
			completion_tokens: 9,
			prompt_cache_miss_tokens: 17,
		} as any)
		expect(result?.cacheWriteTokens).toBeUndefined()
	})
})
