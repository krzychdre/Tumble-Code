import type { ModelInfo } from "../model.js"

// Minimax
// https://platform.minimax.io/docs/guides/models-intro
// https://platform.minimax.io/docs/guides/pricing-paygo
// https://platform.minimax.io/docs/guides/pricing-tokenplan
export type MinimaxModelId = keyof typeof minimaxModels
export const minimaxDefaultModelId: MinimaxModelId = "MiniMax-M3"

export const minimaxModels = {
	"MiniMax-M3": {
		maxTokens: 16_384,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheReadsPrice: 0.06,
		// Above 512k input tokens the whole request bills at double the standard
		// rates, including cache reads; the pricing page lists no cache-write price.
		longContextPricing: {
			thresholdTokens: 512_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
		description:
			"MiniMax M3, MiniMax's frontier multimodal coding model with a 1M context window. See pricing at https://platform.minimax.io/docs/pricing/overview.",
	},
	"MiniMax-M3.1-Flash": {
		maxTokens: 16_384,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheReadsPrice: 0.015,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		reasoningEffort: "max",
		description:
			"MiniMax M3.1 Flash, a fast multimodal coding model with a 1M context window and tunable thinking depth. See pricing at https://platform.minimax.io/docs/pricing/overview.",
	},
	"MiniMax-M2.5": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2.5, the latest MiniMax model with enhanced coding and agentic capabilities, building on the strengths of the M2 series. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.5-highspeed": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.6,
		outputPrice: 2.4,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2.5 highspeed: same performance as M2.5 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.7": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.06,
		description:
			"MiniMax M2.7, the latest MiniMax model with recursive self-improvement capabilities. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.7-highspeed": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.6,
		outputPrice: 2.4,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.06,
		description:
			"MiniMax M2.7 highspeed: same performance as M2.7 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2, a model born for Agents and code, featuring Top-tier Coding Capabilities, Powerful Agentic Performance, and Ultimate Cost-Effectiveness & Speed. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2-Stable": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2 Stable (High Concurrency, Commercial Use), a model born for Agents and code, featuring Top-tier Coding Capabilities, Powerful Agentic Performance, and Ultimate Cost-Effectiveness & Speed. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.1": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2.1 builds on M2 with improved overall performance for agentic coding tasks and significantly faster response times. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.1-highspeed": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		includedTools: ["search_and_replace"],
		excludedTools: ["apply_diff"],
		preserveReasoning: true,
		inputPrice: 0.6,
		outputPrice: 2.4,
		cacheWritesPrice: 0.375,
		cacheReadsPrice: 0.03,
		description:
			"MiniMax M2.1 highspeed: same performance as M2.1 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
} as const satisfies Record<string, ModelInfo>
