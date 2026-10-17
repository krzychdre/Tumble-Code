import type { ModelInfo } from "../model.js"

import { claudeModels, oneMillionContextIds, withoutFields } from "./claude.js"

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
export type VertexModelId = keyof typeof vertexModels

export const vertexDefaultModelId: VertexModelId = "claude-opus-5"

// Info stand-in for a model id that is not in the table (a Gemini or Claude id we do not list). It is
// kept on Claude Sonnet 4.5 when the default moved to Opus 5: Opus 5 info would send an effort/thinking
// level and drop temperature for models that may not accept them. Only the info is used, never the id.
export const vertexUnknownModelStandInId: VertexModelId = "claude-sonnet-4-5@20250929"

export const vertexModels = {
	"gemini-3.5-flash": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 1.5,
		outputPrice: 9,
		cacheReadsPrice: 0.15,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
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
	"gemini-3-pro-preview": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "high"],
		reasoningEffort: "low",

		supportsTemperature: true,
		defaultTemperature: 1,
		inputPrice: 4.0,
		outputPrice: 18.0,
		cacheReadsPrice: 0.4,
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
	"gemini-2.5-flash-preview-05-20:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.15,
		outputPrice: 3.5,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-05-20": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.5-flash": {
		maxTokens: 64_000,
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
	"gemini-2.5-flash-preview-04-17:thinking": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0.15,
		outputPrice: 3.5,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash-preview-04-17": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.5-pro-preview-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 2.5,
		outputPrice: 15,
	},
	"gemini-2.5-pro-preview-05-06": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 2.5,
		outputPrice: 15,
	},
	"gemini-2.5-pro-preview-06-05": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 2.5,
		outputPrice: 15,
		maxThinkingTokens: 32_768,
		supportsReasoningBudget: true,
	},
	"gemini-2.5-pro": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 2.5,
		outputPrice: 15,
		maxThinkingTokens: 32_768,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
		tiers: [
			{
				contextWindow: 200_000,
				inputPrice: 1.25,
				outputPrice: 10,
				cacheReadsPrice: 0.31,
			},
			{
				contextWindow: Infinity,
				inputPrice: 2.5,
				outputPrice: 15,
				cacheReadsPrice: 0.625,
			},
		],
	},
	"gemini-2.5-pro-exp-03-25": {
		maxTokens: 65_535,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-pro-exp-02-05": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-2.0-flash-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"gemini-2.0-flash-lite-001": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0.075,
		outputPrice: 0.3,
	},
	"gemini-2.0-flash-thinking-exp-01-21": {
		maxTokens: 8192,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 0,
		outputPrice: 0,
	},
	"gemini-1.5-flash-002": {
		maxTokens: 8192,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.075,
		outputPrice: 0.3,
	},
	"gemini-1.5-pro-002": {
		maxTokens: 8192,
		contextWindow: 2_097_152,
		supportsImages: true,
		supportsPromptCache: false,

		inputPrice: 1.25,
		outputPrice: 5,
	},
	"claude-sonnet-4@20250514": { ...claudeModels["sonnet-4"] },
	"claude-sonnet-4-5@20250929": { ...claudeModels["sonnet-4-5"] },
	"claude-sonnet-4-6": { ...claudeModels["sonnet-4-6"] },
	"claude-haiku-5-5": { ...claudeModels["haiku-5-5"] },
	"claude-haiku-4-5@20251001": { ...withoutFields(claudeModels["haiku-4-5"], "description") },
	"claude-opus-4-6": { ...claudeModels["opus-4-6"] },
	"claude-opus-4-7": { ...claudeModels["opus-4-7"] },
	"claude-opus-4-8": { ...claudeModels["opus-4-8"] },
	"claude-opus-5-5": { ...claudeModels["opus-5-5"] },
	"claude-opus-5": { ...claudeModels["opus-5"] },
	"claude-sonnet-5-5": { ...claudeModels["sonnet-5-5"] },
	"claude-sonnet-5": { ...claudeModels["sonnet-5"] },
	"claude-fable-5-1": { ...claudeModels["fable-5-1"] },
	"claude-fable-5": { ...claudeModels["fable-5"] },
	"claude-opus-4-5@20251101": { ...claudeModels["opus-4-5"] },
	"claude-opus-4@20250514": { ...withoutFields(claudeModels["opus-4"], "supportsReasoningBudget") },
	"gemini-2.5-flash-lite-preview-06-17": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,

		inputPrice: 0.1,
		outputPrice: 0.4,
		cacheReadsPrice: 0.025,
		cacheWritesPrice: 1.0,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
	},
} as const satisfies Record<string, ModelInfo>

// Vertex AI models that support 1M context window beta: the Claude entries that price its tier.
// Uses the same beta header 'context-1m-2025-08-07' as Anthropic and Bedrock
export const VERTEX_1M_CONTEXT_MODEL_IDS: readonly string[] = oneMillionContextIds(vertexModels)

export const VERTEX_REGIONS = [
	{ value: "global", label: "global" },
	{ value: "us", label: "us" },
	{ value: "eu", label: "eu" },
	{ value: "us-central1", label: "us-central1" },
	{ value: "us-east1", label: "us-east1" },
	{ value: "us-east4", label: "us-east4" },
	{ value: "us-east5", label: "us-east5" },
	{ value: "us-south1", label: "us-south1" },
	{ value: "us-west1", label: "us-west1" },
	{ value: "us-west2", label: "us-west2" },
	{ value: "us-west3", label: "us-west3" },
	{ value: "us-west4", label: "us-west4" },
	{ value: "northamerica-northeast1", label: "northamerica-northeast1" },
	{ value: "northamerica-northeast2", label: "northamerica-northeast2" },
	{ value: "southamerica-east1", label: "southamerica-east1" },
	{ value: "europe-west1", label: "europe-west1" },
	{ value: "europe-west2", label: "europe-west2" },
	{ value: "europe-west3", label: "europe-west3" },
	{ value: "europe-west4", label: "europe-west4" },
	{ value: "europe-west6", label: "europe-west6" },
	{ value: "europe-central2", label: "europe-central2" },
	{ value: "asia-east1", label: "asia-east1" },
	{ value: "asia-east2", label: "asia-east2" },
	{ value: "asia-northeast1", label: "asia-northeast1" },
	{ value: "asia-northeast2", label: "asia-northeast2" },
	{ value: "asia-northeast3", label: "asia-northeast3" },
	{ value: "asia-south1", label: "asia-south1" },
	{ value: "asia-south2", label: "asia-south2" },
	{ value: "asia-southeast1", label: "asia-southeast1" },
	{ value: "asia-southeast2", label: "asia-southeast2" },
	{ value: "australia-southeast1", label: "australia-southeast1" },
	{ value: "australia-southeast2", label: "australia-southeast2" },
	{ value: "me-west1", label: "me-west1" },
	{ value: "me-central1", label: "me-central1" },
	{ value: "africa-south1", label: "africa-south1" },
]
