import {
	anthropicModels,
	bedrockModels,
	deepSeekModels,
	geminiModels,
	getProviderDefaultModelId,
	internationalZAiModels,
	isProviderName,
	mainlandZAiModels,
	minimaxModels,
	mistralModels,
	moonshotModels,
	openAiCodexModels,
	openAiModelInfoSaneDefaults,
	openAiNativeModels,
	qwenCodeModels,
	vertexModels,
	xaiModels,
	zaiApiLineConfigs,
	type ModelInfo,
	type ProviderName,
	type ProviderSettings,
} from "@roo-code/types"

import type { RouterModels } from "@/ui/store.js"

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Built-in model tables of the providers that never appear in routerModels
 * (the same tables the extension's handlers size their models from).
 */
const STATIC_MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels,
	bedrock: bedrockModels,
	deepseek: deepSeekModels,
	moonshot: moonshotModels,
	gemini: geminiModels,
	mistral: mistralModels,
	"openai-native": openAiNativeModels,
	"openai-codex": openAiCodexModels,
	"qwen-code": qwenCodeModels,
	vertex: vertexModels,
	xai: xaiModels,
	zai: internationalZAiModels,
	minimax: minimaxModels,
}

function isChinaZai(config: ProviderSettings): boolean {
	return zaiApiLineConfigs[config.zaiApiLine ?? "international_coding"].isChina
}

function getStaticModels(config: ProviderSettings): Record<string, ModelInfo> | undefined {
	if (config.apiProvider === "zai" && isChinaZai(config)) {
		return mainlandZAiModels
	}
	return isProviderName(config.apiProvider) ? STATIC_MODELS_BY_PROVIDER[config.apiProvider] : undefined
}

/**
 * Looks up the context window size for the current model: routerModels for
 * the providers whose model list is fetched, else the provider's built-in
 * model table.
 *
 * @param routerModels - The router models data containing model info per provider
 * @param apiConfiguration - The current API configuration with provider and model ID
 * @returns The context window size, or DEFAULT_CONTEXT_WINDOW (200K) if neither knows the model
 */
export function getContextWindow(routerModels: RouterModels | null, apiConfiguration: ProviderSettings | null): number {
	// The openai provider never reaches routerModels: its model source returns
	// ids without sizes. The extension sizes the model from
	// openAiCustomModelInfo (the CLI fills it from `models` in
	// cli-settings.json), else from the provider's defaults; read the same
	// fields, so the gauge measures against the size the condensing uses.
	if (apiConfiguration?.apiProvider === "openai") {
		return apiConfiguration.openAiCustomModelInfo?.contextWindow ?? openAiModelInfoSaneDefaults.contextWindow
	}

	if (!apiConfiguration) {
		return DEFAULT_CONTEXT_WINDOW
	}

	const provider = apiConfiguration.apiProvider

	if (!provider) {
		return DEFAULT_CONTEXT_WINDOW
	}

	// Without a model id the extension runs the provider's default model.
	const modelId =
		getModelIdForProvider(apiConfiguration) ||
		(isProviderName(provider)
			? getProviderDefaultModelId(provider, { isChina: provider === "zai" && isChinaZai(apiConfiguration) })
			: undefined)

	if (!modelId) {
		return DEFAULT_CONTEXT_WINDOW
	}

	return (
		routerModels?.[provider]?.[modelId]?.contextWindow ??
		getStaticModels(apiConfiguration)?.[modelId]?.contextWindow ??
		DEFAULT_CONTEXT_WINDOW
	)
}

/**
 * Gets the model ID from the API configuration based on the provider type.
 *
 * Different providers store their model ID in different fields of ProviderSettings.
 */
function getModelIdForProvider(config: ProviderSettings): string | undefined {
	switch (config.apiProvider) {
		case "openrouter":
			return config.openRouterModelId
		case "ollama":
			return config.ollamaModelId
		case "lmstudio":
			return config.lmStudioModelId
		case "openai":
			return config.openAiModelId
		case "litellm":
			return config.litellmModelId
		default:
			// For anthropic, bedrock, vertex, gemini, xai, etc.
			return config.apiModelId
	}
}

export { DEFAULT_CONTEXT_WINDOW }
