import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	type ModelRecord,
	type RouterModels,
	bedrockModels,
	deepSeekModels,
	deepSeekModelAliases,
	openAiModelInfoSaneDefaults,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	lMStudioDefaultModelInfo,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	isRetiredProvider,
	getProviderDefaultModelId,
	providerModelDefinitions,
	resolveProviderModelSelection,
	zaiModelCatalog,
} from "@roo-code/types"

import { useOpenRouterModelProviders } from "./useOpenRouterModelProviders"
import { useLmStudioModels } from "./useLmStudioModels"
import { useOllamaModels } from "./useOllamaModels"
import { useProviderModels } from "./useProviderModels"
import {
	getProviderModelSource,
	getProviderModelSourceOptions,
} from "@src/components/settings/utils/providerModelConfig"

// DeepSeek's documented aliases (deepseek-chat, deepseek-reasoner) with the
// info of the model each one names.
const deepSeekAliasModels: Record<string, ModelInfo> = Object.fromEntries(
	Object.entries(deepSeekModelAliases).map(([alias, modelId]) => [alias, deepSeekModels[modelId]]),
)

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
			return { ...deepSeekModels, ...deepSeekAliasModels, ...dynamicModels }
		case "zai":
			return zaiModelCatalog(apiConfiguration).models
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
		// Settings-only branches: what they show is not what the request computes (OpenRouter merges the
		// chosen endpoint's info and falls back to the default for an empty id, Bedrock has the custom ARN
		// pseudo model and a flat 1M window, Ollama caps the window at num_ctx, LM Studio fills its own
		// defaults, VS Code LM names the selector), so they stay here (S4 slice d).
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
		// Everything else is the shared resolver (`resolveProviderModelSelection`), the one the request
		// uses, with the settings' policies: an unknown id shows no info (the request uses a stand-in),
		// so the settings warn about it; an empty id stays empty (the request runs the default model),
		// except on DeepSeek, whose settings always showed the default for it.
		default: {
			const resolved = resolveProviderModelSelection(settingsForSharedResolver(provider, apiConfiguration), {
				fetchedModels: routerModels[provider as keyof RouterModels],
				emptyModelId: provider === "deepseek" ? "default-model" : "keep-empty",
			})

			if (!resolved) {
				return { id: defaultModelId, info: undefined }
			}

			// LiteLLM's settings show the stand-in info of an unlisted id, as the request uses it.
			return { id: resolved.id, info: resolved.known || provider === "litellm" ? resolved.info : undefined }
		}
	}
}

/**
 * The profile the shared resolver sees for the settings, where the settings resolve a provider unlike
 * its request (kept on purpose, S4 slice d; see ai_plans/2026-09-28_s4-model-resolution.md):
 * - fake-ai shows the plain Anthropic list, without the 1M tier;
 * - Vertex shows an unset id as the default model routed as that id (a Claude model, with its 1M tier);
 *   the request routes by the configured id and runs the Gemini handler without the tier.
 */
function settingsForSharedResolver(provider: ProviderName, apiConfiguration: ProviderSettings): ProviderSettings {
	switch (provider) {
		case "fake-ai":
			return { ...apiConfiguration, apiProvider: "anthropic", anthropicBeta1MContext: undefined }
		case "vertex":
			return {
				...apiConfiguration,
				apiProvider: provider,
				apiModelId: apiConfiguration.apiModelId ?? providerModelDefinitions.vertex.defaultModelId,
			}
		default:
			return { ...apiConfiguration, apiProvider: provider }
	}
}
