import {
	getProviderModelDefinition,
	getProviderModelId,
	resolvePortableProviderModel,
	type ModelInfo,
	type ProviderSettings,
} from "@roo-code/types"

import type { RouterModels } from "@/ui/store.js"

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * The context window of the current model, as the extension's handler sizes
 * it (condensing measures against that size): the model resolution shared
 * with the extension (`resolvePortableProviderModel`), fed with the model
 * list the extension fetched for the provider.
 *
 * @param routerModels - The fetched model lists per provider
 * @param apiConfiguration - The current API configuration with provider and model ID
 * @returns The context window size, or DEFAULT_CONTEXT_WINDOW (200K) when the
 * provider cannot be resolved here
 */
export function getContextWindow(routerModels: RouterModels | null, apiConfiguration: ProviderSettings | null): number {
	const provider = apiConfiguration?.apiProvider

	if (!apiConfiguration || !provider) {
		return DEFAULT_CONTEXT_WINDOW
	}

	// The store keeps the extension's fetched ModelRecord; only contextWindow is read.
	const fetchedModels = routerModels?.[provider] as Record<string, ModelInfo> | undefined
	const resolved = resolvePortableProviderModel(apiConfiguration, fetchedModels)

	if (resolved) {
		return resolved.info.contextWindow
	}

	// Bedrock's handler also parses a custom ARN and guesses unlisted models,
	// which needs the handler; its listed models and the user's size override
	// are read here the same way.
	if (apiConfiguration.awsModelContextWindow && apiConfiguration.awsModelContextWindow > 0) {
		return apiConfiguration.awsModelContextWindow
	}

	const definition = getProviderModelDefinition(provider)
	const modelId = getProviderModelId(apiConfiguration) || definition?.defaultModelId

	return (modelId && definition?.models?.[modelId]?.contextWindow) || DEFAULT_CONTEXT_WINDOW
}

export { DEFAULT_CONTEXT_WINDOW }
