import type { ModelInfo } from "../model.js"

// No default model: the settings require a model selector, and without one the
// handler runs the first model VS Code returns, which the settings cannot know.
export const vscodeLlmDefaultModelId = ""

// Static facts for the families the settings show info for (the handler reads
// the live limits from the selected model). Families GitHub Copilot retired are
// removed (https://docs.github.com/en/copilot/reference/ai-models/supported-models).
export const vscodeLlmModels = {
	"gpt-5-mini": {
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5-mini",
		version: "gpt-5-mini",
		name: "GPT-5 mini",
		supportsToolCalling: true,
		maxInputTokens: 108637,
	},
} as const satisfies Record<
	string,
	ModelInfo & {
		family: string
		version: string
		name: string
		supportsToolCalling: boolean
		maxInputTokens: number
	}
>
