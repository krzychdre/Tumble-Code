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
		// Caching is automatic: only hits are discounted, a write bills as input.
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.06,
		// Above 512k input tokens the whole request bills at double the standard rates.
		longContextPricing: {
			thresholdTokens: 512_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
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
		cacheWritesPrice: 0.15,
		cacheReadsPrice: 0.015,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		reasoningEffort: "max",
		description:
			"MiniMax M3.1 Flash, a fast multimodal coding model with a 1M context window and tunable thinking depth. See pricing at https://platform.minimax.io/docs/pricing/overview.",
	},
	// The M2 family was retired on 2026-11-18 and is no longer served: https://platform.minimax.io/docs/faq/models
} as const satisfies Record<string, ModelInfo>
