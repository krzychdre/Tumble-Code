import type { ModelInfo } from "../model.js"

// https://docs.x.ai/developers/models
// https://docs.x.ai/developers/pricing
export type XAIModelId = keyof typeof xaiModels

export const xaiDefaultModelId: XAIModelId = "grok-4.7"

// xAI applies a long-context surcharge to the WHOLE request once the prompt
// reaches 200K tokens, rather than only to the excess. The prices below are the
// sub-200K rates, with `longContextPricing` carrying the doubling that kicks in
// at the threshold, which is exactly the whole-request semantics that field has.
//
// xAI does not publish a max output token limit for any Grok model, so the
// existing conservative defaults are kept rather than inventing a figure.
//
// xAI retired seven text models on 2026-05-15. Their slugs still resolve, so the
// entries stay for profiles pinned to them, but requests are served by the
// redirect target and billed at its rates. Those entries share the redirect
// target's info and carry the deprecated flag, so the picker offers the current
// model instead.
// https://docs.x.ai/developers/migration/may-15-retirement
const grok43Info: ModelInfo = {
	maxTokens: 65_536,
	contextWindow: 1_000_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 1.25,
	outputPrice: 2.5,
	cacheWritesPrice: 0.2,
	cacheReadsPrice: 0.2,
	includedTools: ["search_replace"],
	excludedTools: ["apply_diff"],
	longContextPricing: {
		thresholdTokens: 200_000,
		inputPriceMultiplier: 2,
		outputPriceMultiplier: 2,
		cacheWritesPriceMultiplier: 2,
		cacheReadsPriceMultiplier: 2,
	},
}

const grokBuild01Info: ModelInfo = {
	maxTokens: 65_536,
	contextWindow: 256_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 1.0,
	outputPrice: 2.0,
	cacheWritesPrice: 0.2,
	cacheReadsPrice: 0.2,
	includedTools: ["search_replace"],
	excludedTools: ["apply_diff"],
	longContextPricing: {
		thresholdTokens: 200_000,
		inputPriceMultiplier: 2,
		outputPriceMultiplier: 2,
		cacheWritesPriceMultiplier: 2,
		cacheReadsPriceMultiplier: 2,
	},
}

export const xaiModels = {
	"grok-4.7": {
		maxTokens: 65_536,
		contextWindow: 500_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0,
		outputPrice: 6.0,
		cacheWritesPrice: 0.5,
		cacheReadsPrice: 0.5,
		description:
			"xAI's flagship Grok 4.7 model with a 500K context window and configurable reasoning effort, with encrypted reasoning on the Responses API.",
		supportsReasoningEffort: true,
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-4.6": {
		maxTokens: 65_536,
		contextWindow: 500_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0,
		outputPrice: 6.0,
		cacheWritesPrice: 0.5,
		cacheReadsPrice: 0.5,
		description:
			"xAI's flagship Grok 4.6 model with a 500K context window and configurable reasoning effort. Not available via Batch API.",
		supportsReasoningEffort: true,
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-4.5": {
		maxTokens: 65_536,
		contextWindow: 500_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0,
		outputPrice: 6.0,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.3,
		description: "xAI's Grok 4.5 model with a 500K context window.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-4.3": {
		...grok43Info,
		description: "xAI's Grok 4.3 model with a 1M context window.",
	},
	// The vendor no longer serves the undated `grok-4.20`; only the dated
	// 0309 snapshot ids remain.
	"grok-4.20-0309-reasoning": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 2.5,
		cacheWritesPrice: 0.2,
		cacheReadsPrice: 0.2,
		description: "xAI's Grok 4.20 model (0309 snapshot) with 1M context and reasoning support via Responses API.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-4.20-0309-non-reasoning": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 2.5,
		cacheWritesPrice: 0.2,
		cacheReadsPrice: 0.2,
		description: "xAI's Grok 4.20 model (0309 snapshot) with 1M context, without reasoning.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-4.20-multi-agent-0309": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.25,
		outputPrice: 2.5,
		cacheWritesPrice: 0.2,
		cacheReadsPrice: 0.2,
		description:
			"xAI's Grok 4.20 multi-agent model (0309 snapshot) with 1M context, for multi-agent orchestration.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
		longContextPricing: {
			thresholdTokens: 200_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheWritesPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
	},
	"grok-build-0.1": {
		...grokBuild01Info,
		description: "xAI's Grok Build 0.1 model with 256K context window.",
	},
	// Retired on 2026-05-15; the id is now an alias of grok-build-0.1 and is
	// served and billed as that model.
	"grok-code-fast-1": {
		...grokBuild01Info,
		deprecated: true,
		description: "Retired on 2026-05-15; requests are served by Grok Build 0.1. Select grok-build-0.1 instead.",
	},
	"grok-4-1-fast-reasoning": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 at low reasoning effort. Select grok-4.3 instead.",
	},
	"grok-4-1-fast-non-reasoning": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 with reasoning effort none. Select grok-4.3 instead.",
	},
	"grok-4-fast-reasoning": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 at low reasoning effort. Select grok-4.3 instead.",
	},
	"grok-4-fast-non-reasoning": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 with reasoning effort none. Select grok-4.3 instead.",
	},
	"grok-4-0709": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 at low reasoning effort. Select grok-4.3 instead.",
	},
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 0.5,
		cacheWritesPrice: 0.07,
		cacheReadsPrice: 0.07,
		description: "xAI's Grok-3 mini model with 128K context window",
		supportsReasoningEffort: ["low", "high"],
		reasoningEffort: "low",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-3": {
		...grok43Info,
		deprecated: true,
		description:
			"Retired on 2026-05-15; requests are served by Grok 4.3 with reasoning effort none. Select grok-4.3 instead.",
	},
} as const satisfies Record<string, ModelInfo>
