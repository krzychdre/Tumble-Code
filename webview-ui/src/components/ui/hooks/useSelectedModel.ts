import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	type ModelRecord,
	type RouterModels,
	anthropicModels,
	bedrockModels,
	deepSeekModels,
	moonshotModels,
	minimaxModels,
	geminiModels,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeModels,
	vertexModels,
	xaiModels,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openAiCodexModels,
	internationalZAiModels,
	mainlandZAiModels,
	qwenCodeModels,
	litellmDefaultModelInfo,
	lMStudioDefaultModelInfo,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	VERTEX_1M_CONTEXT_MODEL_IDS,
	isRetiredProvider,
	getProviderDefaultModelId,
	providerModelDefinitions,
} from "@roo-code/types"

import { useOpenRouterModelProviders } from "./useOpenRouterModelProviders"
import { useLmStudioModels } from "./useLmStudioModels"
import { useOllamaModels } from "./useOllamaModels"
import { useProviderModels } from "./useProviderModels"
import {
	getProviderModelSource,
	getProviderModelSourceOptions,
} from "@src/components/settings/utils/providerModelConfig"

/**
 * The model list a provider's configured id is checked against, or undefined
 * when the provider has none to check (Ollama and LM Studio report a missing
 * model themselves; OpenAI Compatible and VS Code LM have no list).
 */
function getProviderModelList(
	provider: ProviderName,
	apiConfiguration: ProviderSettings,
	dynamicModels: ModelRecord | undefined,
): Readonly<Record<string, ModelInfo>> | undefined {
	switch (provider) {
		case "openrouter":
		case "litellm":
			return dynamicModels
		case "deepseek":
			return { ...deepSeekModels, ...dynamicModels }
		case "zai":
			return apiConfiguration.zaiApiLine === "china_coding" ? mainlandZAiModels : internationalZAiModels
		default: {
			const definition = providerModelDefinitions[provider as keyof typeof providerModelDefinitions]
			return definition && "models" in definition ? definition.models : undefined
		}
	}
}

/**
 * Whether the selected model id is missing from the provider's model list.
 * The id is still used as is (owner decision 5), with the default model's
 * capabilities; the settings UI shows a warning.
 */
function isUnknownModelId(
	provider: ProviderName,
	id: string,
	apiConfiguration: ProviderSettings,
	dynamicModels: ModelRecord | undefined,
): boolean {
	// Bedrock's custom ARN option is a pseudo model: the ARN names the model.
	if (!id || (provider === "bedrock" && id === "custom-arn")) {
		return false
	}

	const models = getProviderModelList(provider, apiConfiguration, dynamicModels)

	return Boolean(models && Object.keys(models).length > 0 && !Object.hasOwn(models, id))
}

export const useSelectedModel = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const activeProvider: ProviderName | undefined = isRetiredProvider(provider) ? undefined : provider
	const modelSource = activeProvider ? getProviderModelSource(activeProvider) : undefined
	const dynamicProvider =
		modelSource?.kind === "remote" && modelSource.payload === "models" ? activeProvider : undefined
	const openRouterModelId = activeProvider === "openrouter" ? apiConfiguration?.openRouterModelId : undefined
	const lmStudioModelId = activeProvider === "lmstudio" ? apiConfiguration?.lmStudioModelId : undefined
	const ollamaModelId = activeProvider === "ollama" ? apiConfiguration?.ollamaModelId : undefined

	const providerModels = useProviderModels(dynamicProvider, getProviderModelSourceOptions(apiConfiguration ?? {}))
	// `useProviderModels` returns `{ source, models, modelIds, isLoading, error, refresh }`
	// with no legacy `data`/`isError` fields, so the previous `as unknown as`
	// fallbacks were dead code that could mask future regressions. Read the
	// real fields directly (M1).
	const dynamicModels = providerModels.models
	const providerModelsError = Boolean(providerModels.error)

	const openRouterModelProviders = useOpenRouterModelProviders(openRouterModelId)
	const lmStudioModels = useLmStudioModels(lmStudioModelId)
	const ollamaModels = useOllamaModels(ollamaModelId)

	// Compute readiness only for the data actually needed for the selected provider
	const needRouterModels = Boolean(dynamicProvider)
	const needOpenRouterProviders = activeProvider === "openrouter"
	const needLmStudio = typeof lmStudioModelId !== "undefined"
	const needOllama = typeof ollamaModelId !== "undefined"

	const hasValidRouterData =
		needRouterModels && dynamicProvider
			? dynamicModels !== undefined && typeof dynamicModels === "object" && !providerModels.isLoading
			: true

	const isReady =
		(!needLmStudio || typeof lmStudioModels.data !== "undefined") &&
		(!needOllama || typeof ollamaModels.data !== "undefined") &&
		hasValidRouterData &&
		(!needOpenRouterProviders || typeof openRouterModelProviders.data !== "undefined")

	const { id, info } =
		apiConfiguration && isReady && activeProvider
			? getSelectedModel({
					provider: activeProvider,
					apiConfiguration,
					routerModels: {
						...(dynamicProvider && dynamicModels ? { [dynamicProvider]: dynamicModels } : {}),
					} as RouterModels,
					openRouterModelProviders: (openRouterModelProviders.data || {}) as Record<string, ModelInfo>,
					lmStudioModels: (lmStudioModels.data || undefined) as ModelRecord | undefined,
					ollamaModels: (ollamaModels.data || undefined) as ModelRecord | undefined,
				})
			: { id: getProviderDefaultModelId(activeProvider ?? "anthropic"), info: undefined }

	const isLoading =
		(needRouterModels && providerModels.isLoading) ||
		(needOpenRouterProviders && openRouterModelProviders.isLoading) ||
		(needLmStudio && lmStudioModels!.isLoading) ||
		(needOllama && ollamaModels!.isLoading)
	const isError =
		(needRouterModels && providerModelsError) ||
		(needOpenRouterProviders && openRouterModelProviders.isError) ||
		(needLmStudio && lmStudioModels!.isError) ||
		(needOllama && ollamaModels!.isError)

	return {
		provider,
		id,
		info,
		isLoading,
		isError,
		isUnknownModel: Boolean(
			apiConfiguration &&
				activeProvider &&
				isReady &&
				!isLoading &&
				!isError &&
				isUnknownModelId(activeProvider, id, apiConfiguration, dynamicModels),
		),
	}
}

function getSelectedModel({
	provider,
	apiConfiguration,
	routerModels,
	openRouterModelProviders,
	lmStudioModels,
	ollamaModels,
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
	routerModels: RouterModels
	openRouterModelProviders: Record<string, ModelInfo>
	lmStudioModels: ModelRecord | undefined
	ollamaModels: ModelRecord | undefined
}): { id: string; info: ModelInfo | undefined } {
	// the `undefined` case are used to show the invalid selection to prevent
	// users from seeing the default model if their selection is invalid
	// this gives a better UX than showing the default model
	const defaultModelId = getProviderDefaultModelId(provider)
	switch (provider) {
		// A configured id is shown even when it is not in the list: requests
		// use it as is (owner decision 5) and the settings warn about it.
		case "openrouter": {
			const id = apiConfiguration.openRouterModelId || defaultModelId
			let info = routerModels.openrouter?.[id]
			const specificProvider = apiConfiguration.openRouterSpecificProvider

			if (specificProvider && openRouterModelProviders[specificProvider]) {
				// Overwrite the info with the specific provider info. Some
				// fields are missing the model info for `openRouterModelProviders`
				// so we need to merge the two.
				info = info
					? { ...info, ...openRouterModelProviders[specificProvider] }
					: openRouterModelProviders[specificProvider]
			}

			return { id, info }
		}
		case "litellm": {
			const id = apiConfiguration.litellmModelId || defaultModelId
			const routerInfo = routerModels.litellm?.[id]
			return { id, info: routerInfo ?? litellmDefaultModelInfo }
		}
		case "xai": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = xaiModels[id as keyof typeof xaiModels]
			return info ? { id, info } : { id, info: undefined }
		}
		case "bedrock": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = bedrockModels[id as keyof typeof bedrockModels]

			// Special case for custom ARN.
			if (id === "custom-arn") {
				return {
					id,
					info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: true, supportsImages: true },
				}
			}

			// Apply 1M context for supported Claude 4 models when enabled
			if (BEDROCK_1M_CONTEXT_MODEL_IDS.includes(id as any) && apiConfiguration.awsBedrock1MContext && baseInfo) {
				// Create a new ModelInfo object with updated context window
				const info: ModelInfo = {
					...baseInfo,
					contextWindow: 1_000_000,
				}
				return { id, info }
			}

			return { id, info: baseInfo }
		}
		case "vertex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = vertexModels[id as keyof typeof vertexModels]

			// Apply 1M context for supported Claude 4 models when enabled
			if (VERTEX_1M_CONTEXT_MODEL_IDS.includes(id as any) && apiConfiguration.vertex1MContext && baseInfo) {
				const modelInfo: ModelInfo = baseInfo
				const tier = modelInfo.tiers?.[0]
				if (tier) {
					const info: ModelInfo = {
						...modelInfo,
						contextWindow: tier.contextWindow,
						inputPrice: tier.inputPrice,
						outputPrice: tier.outputPrice,
						cacheWritesPrice: tier.cacheWritesPrice,
						cacheReadsPrice: tier.cacheReadsPrice,
					}
					return { id, info }
				}
			}

			return { id, info: baseInfo }
		}
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = geminiModels[id as keyof typeof geminiModels]
			return { id, info }
		}
		case "deepseek": {
			const id = apiConfiguration.apiModelId || defaultModelId
			const routerInfo = routerModels.deepseek?.[id]
			const staticInfo = deepSeekModels[id as keyof typeof deepSeekModels]
			return { id, info: routerInfo ?? staticInfo }
		}
		case "moonshot": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = moonshotModels[id as keyof typeof moonshotModels]
			return { id, info }
		}
		case "minimax": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = minimaxModels[id as keyof typeof minimaxModels]
			return { id, info }
		}
		case "zai": {
			const isChina = apiConfiguration.zaiApiLine === "china_coding"
			const models = isChina ? mainlandZAiModels : internationalZAiModels
			const defaultModelId = getProviderDefaultModelId(provider, { isChina })
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = models[id as keyof typeof models]
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiNativeModels[id as keyof typeof openAiNativeModels]
			return { id, info }
		}
		case "mistral": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mistralModels[id as keyof typeof mistralModels]
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			const info = customInfo ?? openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "ollama": {
			const id = apiConfiguration.ollamaModelId ?? ""
			const info = ollamaModels && ollamaModels[apiConfiguration.ollamaModelId!]

			const adjustedInfo =
				info?.contextWindow &&
				apiConfiguration?.ollamaNumCtx &&
				apiConfiguration.ollamaNumCtx < info.contextWindow
					? { ...info, contextWindow: apiConfiguration.ollamaNumCtx }
					: info

			return {
				id,
				info: adjustedInfo || undefined,
			}
		}
		case "lmstudio": {
			const id = apiConfiguration.lmStudioModelId ?? ""
			const modelInfo = lmStudioModels && lmStudioModels[apiConfiguration.lmStudioModelId!]
			return {
				id,
				info: modelInfo ? { ...lMStudioDefaultModelInfo, ...modelInfo } : undefined,
			}
		}
		case "vscode-lm": {
			const id = apiConfiguration?.vsCodeLmModelSelector
				? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
				: vscodeLlmDefaultModelId
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId
			const info = vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels]
			return { id, info: { ...openAiModelInfoSaneDefaults, ...info, supportsImages: false } } // VSCode LM API currently doesn't support images.
		}
		case "qwen-code": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = qwenCodeModels[id as keyof typeof qwenCodeModels]
			return { id, info }
		}
		case "openai-codex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiCodexModels[id as keyof typeof openAiCodexModels]
			return { id, info }
		}
		// case "anthropic":
		// case "fake-ai":
		default: {
			provider satisfies "anthropic" | "gemini-cli" | "fake-ai"
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = anthropicModels[id as keyof typeof anthropicModels]

			// Apply 1M context beta tier pricing for supported Claude 4 models
			if (
				provider === "anthropic" &&
				(id === "claude-sonnet-4-20250514" ||
					id === "claude-sonnet-4-5" ||
					id === "claude-sonnet-4-6" ||
					id === "claude-opus-4-6") &&
				apiConfiguration.anthropicBeta1MContext &&
				baseInfo
			) {
				// Type assertion since supported Claude 4 models include 1M context pricing tiers.
				const modelWithTiers = baseInfo as typeof baseInfo & {
					tiers?: Array<{
						contextWindow: number
						inputPrice?: number
						outputPrice?: number
						cacheWritesPrice?: number
						cacheReadsPrice?: number
					}>
				}
				const tier = modelWithTiers.tiers?.[0]
				if (tier) {
					// Create a new ModelInfo object with updated values
					const info: ModelInfo = {
						...baseInfo,
						contextWindow: tier.contextWindow,
						inputPrice: tier.inputPrice ?? baseInfo.inputPrice,
						outputPrice: tier.outputPrice ?? baseInfo.outputPrice,
						cacheWritesPrice: tier.cacheWritesPrice ?? baseInfo.cacheWritesPrice,
						cacheReadsPrice: tier.cacheReadsPrice ?? baseInfo.cacheReadsPrice,
					}
					return { id, info }
				}
			}

			return { id, info: baseInfo }
		}
	}
}
