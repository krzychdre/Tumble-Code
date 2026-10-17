import type { ModelInfo } from "../model.js"

// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-opus-5"

// The default model's info until the model list is fetched, in the shape
// `parseOpenRouterModel` gives it once the list is there.
export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 128_000,
	contextWindow: 1_000_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 5.0,
	outputPrice: 25.0,
	cacheWritesPrice: 6.25,
	cacheReadsPrice: 0.5,
	supportsReasoningBudget: true,
	supportsReasoningBinary: true,
	supportsTemperature: false,
	description:
		"Claude Opus 5 is Anthropic's model for complex agentic coding and enterprise work, strongest on deep reasoning and long-horizon tasks.",
}

// The info a model id gets when the fetched list does not have it (or the
// list could not be fetched). It is a plain chat model with no Claude 5
// contract, so an unknown GPT or Gemini id keeps its temperature and gets no
// reasoning settings.
const openRouterUnknownModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

/** The info for a model id the fetched list does not have. */
export const openRouterFallbackModelInfo = (id: string): ModelInfo =>
	id === openRouterDefaultModelId ? openRouterDefaultModelInfo : openRouterUnknownModelInfo

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

export const OPEN_ROUTER_PROMPT_CACHING_MODELS = new Set([
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-sonnet-4.6",
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-4.5",
	"anthropic/claude-opus-4.6",
	"anthropic/claude-sonnet-5.5",
	"anthropic/claude-sonnet-5",
	"anthropic/claude-opus-5",
	"anthropic/claude-opus-5.5",
	"anthropic/claude-fable-5.1",
	"anthropic/claude-fable-5",
	"anthropic/claude-haiku-4.5",
	"google/gemini-2.5-flash-preview",
	"google/gemini-2.5-flash-preview:thinking",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash-preview-05-20:thinking",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-flash-lite-preview-06-17",
	"google/gemini-2.0-flash-001",
	"google/gemini-flash-1.5",
	"google/gemini-flash-1.5-8b",
])

// When we first launched these models we didn't have support for
// enabling/disabling the reasoning budget for hybrid models. Now that we
// do support this we should give users the option to enable/disable it
// whenever possible. However these particular (virtual) model ids with the
// `:thinking` suffix always require the reasoning budget to be enabled, so
// for backwards compatibility we should still require it.
// We should *not* be adding new models to this set.
export const OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS = new Set([
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

export const OPEN_ROUTER_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-opus-4",
	"anthropic/claude-opus-4.5",
	"anthropic/claude-opus-4.6",
	"anthropic/claude-sonnet-5.5",
	"anthropic/claude-sonnet-5",
	"anthropic/claude-opus-5",
	"anthropic/claude-opus-5.5",
	"anthropic/claude-fable-5.1",
	"anthropic/claude-fable-5",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-sonnet-4.5",
	"anthropic/claude-sonnet-4.6",
	"anthropic/claude-haiku-4.5",
	"google/gemini-2.5-pro-preview",
	"google/gemini-2.5-pro",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash",
	"google/gemini-2.5-flash-lite-preview-06-17",
	// Also include the models that require the reasoning budget to be enabled
	// even though `OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS` takes precedence.
	"google/gemini-2.5-flash-preview-05-20:thinking",
])
