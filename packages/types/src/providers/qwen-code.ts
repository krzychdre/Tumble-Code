import type { ModelInfo } from "../model.js"

// The Qwen Code Coding Plan model set, https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/model-providers.md.
// The plan is subscription-billed, so every entry is free per token. The docs list
// no per-model limits, so the shared Coding Plan limits (1M context, 64K output)
// apply to every model.
export type QwenCodeModelId =
	| "qwen3.5-plus"
	| "qwen3.6-plus"
	| "qwen3.7-plus"
	| "qwen3-coder-plus"
	| "qwen3-coder-next"
	| "qwen3-max-2026-01-23"
	| "glm-5"
	| "glm-4.7"
	| "kimi-k2.5"
	| "MiniMax-M2.5"
	| "qwen3-coder-flash"

export const qwenCodeDefaultModelId: QwenCodeModelId = "qwen3.5-plus"

const commonCodingPlanModelInfo = {
	maxTokens: 65_536,
	contextWindow: 1_000_000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	cacheWritesPrice: 0,
	cacheReadsPrice: 0,
} satisfies Partial<ModelInfo>

export const qwenCodeModels = {
	"qwen3.5-plus": {
		...commonCodingPlanModelInfo,
		description: "Qwen3.5 Plus - Advanced model with thinking enabled, the vendor default",
	},
	"qwen3.6-plus": {
		...commonCodingPlanModelInfo,
		description: "Qwen3.6 Plus - Latest model with thinking enabled (Pro subscribers only)",
	},
	"qwen3.7-plus": {
		...commonCodingPlanModelInfo,
		description: "Qwen3.7 Plus - Advanced model with thinking enabled",
	},
	"qwen3-coder-plus": {
		...commonCodingPlanModelInfo,
		description: "Qwen3 Coder Plus - High-performance coding model with 1M context window for large codebases",
	},
	"qwen3-coder-next": {
		...commonCodingPlanModelInfo,
		description: "Qwen3 Coder Next - Experimental coding model",
	},
	"qwen3-max-2026-01-23": {
		...commonCodingPlanModelInfo,
		description: "Qwen3 Max (2026-01-23) - Latest max model with thinking enabled",
	},
	"glm-5": {
		...commonCodingPlanModelInfo,
		description: "GLM-5 - GLM model with thinking enabled",
	},
	"glm-4.7": {
		...commonCodingPlanModelInfo,
		description: "GLM-4.7 - GLM model with thinking enabled",
	},
	"kimi-k2.5": {
		...commonCodingPlanModelInfo,
		supportsImages: true,
		description: "Kimi K2.5 - Kimi model with thinking and vision/video support",
	},
	"MiniMax-M2.5": {
		...commonCodingPlanModelInfo,
		description: "MiniMax M2.5 - MiniMax model with thinking enabled",
	},
	// Not part of the current Coding Plan set; kept until its retirement is verified.
	"qwen3-coder-flash": {
		...commonCodingPlanModelInfo,
		description:
			"Qwen3 Coder Flash - Fast coding model with 1M context window optimized for speed. No longer part of the current Coding Plan model set.",
		deprecated: true,
	},
} as const satisfies Record<QwenCodeModelId, ModelInfo>
