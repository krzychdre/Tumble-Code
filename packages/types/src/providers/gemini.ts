import type { ModelInfo } from "../model.js"

// https://ai.google.dev/gemini-api/docs/models/gemini
export type GeminiModelId = keyof typeof geminiModels

export const geminiDefaultModelId: GeminiModelId = "gemini-4-carbon"

export const geminiModels = {
	// The Gemini 4 Carbon launch prices ($2 / $10, cache $0.10) are promotional
	// through 2026-11-30; the entry records the standard $4 / $20 (cache $0.20)
	// that applies afterwards, so estimates never come in under the charge.
	"gemini-4-carbon": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 4.0,
		outputPrice: 20.0,
		cacheReadsPrice: 0.2,
		supportsReasoningBudget: false,
		description:
			"Google's flagship Gemini 4 Carbon reasoning model. Launch pricing of $2 / $10 runs through 2026-11-30; the listed prices are the standard rates.",
	},
	"gemini-4-hydrogen": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 1.5,
		outputPrice: 7.5,
		cacheReadsPrice: 0.075,
		supportsReasoningBudget: false,
		description: "Google's Gemini 4 Hydrogen model, the cost-efficient member of the Gemini 4 line.",
	},
	// The Gemini 4 Argon prices are promotional through 2026-11-30, after which
	// they double to $4 / $20.
	"gemini-4-argon": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 2.0,
		outputPrice: 10.0,
		cacheReadsPrice: 0.1,
		supportsReasoningBudget: false,
		description: "Google's flagship Gemini 4 reasoning model. Promotional pricing runs through 2026-11-30.",
	},
	// Google currently ships no stable Gemini 3.x Pro: the Pro line exists only
	// as `gemini-3.1-pro-preview`, and the whole stable Gemini 3 offering is
	// Flash and Flash-Lite.
	//
	// The 3.8 and 3.6 Flash prices are promotional through 2026-12-31, after
	// which they double to $1.50 / $7.50. (3.5 Flash and 3.7 Flash were removed
	// from the Gemini API.)
	"gemini-3.8-flash": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 0.75,
		outputPrice: 3.75,
		cacheReadsPrice: 0.075,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
		description: "Google's newest Gemini 3.8 Flash model. Promotional pricing runs through 2026-12-31.",
	},
	"gemini-3.6-flash": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 0.75,
		outputPrice: 3.75,
		cacheReadsPrice: 0.075,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
		description: "Gemini 3.6 Flash. Promotional pricing runs through 2026-12-31.",
	},
	"gemini-3.5-flash-lite": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 0.3,
		outputPrice: 2.5,
		cacheReadsPrice: 0.03,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
		description: "Gemini 3.5 Flash-Lite, the cheapest model in the stable Gemini 3 line.",
	},
	"gemini-3.1-pro-preview": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "low",

		supportsTemperature: true,
		defaultTemperature: 1,
		inputPrice: 4.0,
		outputPrice: 18.0,
		cacheReadsPrice: 0.4,
		cacheWritesPrice: 4.5,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 2.0,
				outputPrice: 12.0,
				cacheReadsPrice: 0.2,
			},
			{
				contextWindow: Infinity,
				inputPrice: 4.0,
				outputPrice: 18.0,
				cacheReadsPrice: 0.4,
			},
		],
	},
	"gemini-3.1-pro-preview-customtools": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "low",

		supportsTemperature: true,
		defaultTemperature: 1,
		inputPrice: 4.0,
		outputPrice: 18.0,
		cacheReadsPrice: 0.4,
		cacheWritesPrice: 4.5,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 2.0,
				outputPrice: 12.0,
				cacheReadsPrice: 0.2,
			},
			{
				contextWindow: Infinity,
				inputPrice: 4.0,
				outputPrice: 18.0,
				cacheReadsPrice: 0.4,
			},
		],
	},
	"gemini-3-flash-preview": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",

		supportsTemperature: true,
		defaultTemperature: 1,
		inputPrice: 0.5,
		outputPrice: 3.0,
		cacheReadsPrice: 0.05,
	},
	// Deprecated: the Gemini API routes requests away from the 2.5 models from
	// 2026-12-01; move to the Gemini 3.8 / Gemini 4 lines.
	// 2.5 Pro models
	"gemini-2.5-pro": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 2.5, // This is the pricing for prompts above 200k tokens.
		outputPrice: 15,
		cacheReadsPrice: 0.25,
		cacheWritesPrice: 4.5,
		maxThinkingTokens: 32_768,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 1.25,
				outputPrice: 10,
				cacheReadsPrice: 0.125,
			},
			{
				contextWindow: Infinity,
				inputPrice: 2.5,
				outputPrice: 15,
				cacheReadsPrice: 0.25,
			},
		],
		description:
			"Gemini 2.5 Pro. The Gemini API routes requests away from it from 2026-12-01; use the Gemini 3.1 Pro preview or a Gemini 4 model.",
		deprecated: true,
	},

	// 2.5 Flash models
	"gemini-flash-latest": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.3,
		outputPrice: 2.5,
		cacheReadsPrice: 0.075,
		cacheWritesPrice: 1.0,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
	},
	"gemini-2.5-flash": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.3,
		outputPrice: 2.5,
		cacheReadsPrice: 0.03,
		cacheWritesPrice: 1.0,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		description:
			"Gemini 2.5 Flash. The Gemini API routes requests away from it from 2026-12-01; use Gemini 3.6 Flash or newer.",
		deprecated: true,
	},

	// 2.5 Flash Lite models
	"gemini-flash-lite-latest": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: true,
		maxThinkingTokens: 24_576,
	},
} as const satisfies Record<string, ModelInfo>
