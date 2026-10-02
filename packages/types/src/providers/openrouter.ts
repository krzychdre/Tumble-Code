import type { ModelInfo } from "../model.js"

// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4.5"

export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude Sonnet 4.5 is Anthropic's Sonnet model for coding and agentic work, with extended thinking, vision and prompt caching.",
}

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
