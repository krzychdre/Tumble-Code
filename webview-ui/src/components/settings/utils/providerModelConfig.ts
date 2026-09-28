import type { ProviderName, ModelInfo, ModelSource, ModelSourceOptions, ProviderSettings } from "@roo-code/types"
import {
	getProviderDefinition,
	getInFormModelPickerProviderIds,
	getProviderDescriptor,
	modelSources,
	providerModelDefinitions,
	resolveProviderModelSourceOptions,
	zaiModelCatalog,
} from "@roo-code/types"

import { MODELS_BY_PROVIDER } from "../constants"

export interface ProviderServiceConfig {
	serviceName: string
	serviceUrl: string
}

/** The default model of every provider with a static model list, from `providerModelDefinitions`. */
export const PROVIDER_DEFAULT_MODEL_IDS: Partial<Record<ProviderName, string>> = Object.fromEntries(
	Object.entries(providerModelDefinitions).flatMap(([provider, definition]) =>
		"models" in definition ? [[provider, definition.defaultModelId]] : [],
	),
)

/** The model picker's service name and link, from the provider's `PROVIDER_DESCRIPTORS` row. */
export const getProviderServiceConfig = (provider: ProviderName): ProviderServiceConfig => {
	const service = getProviderDescriptor(provider)?.service
	return service ? { serviceName: service.name, serviceUrl: service.url } : { serviceName: provider, serviceUrl: "" }
}

export const getDefaultModelIdForProvider = (provider: ProviderName, apiConfiguration?: ProviderSettings): string => {
	// Z.ai's default depends on its API line (the request's rule, see `zaiModelCatalog`).
	if (provider === "zai" && apiConfiguration) {
		return zaiModelCatalog(apiConfiguration).defaultModelId
	}

	return PROVIDER_DEFAULT_MODEL_IDS[provider] ?? ""
}

export const getStaticModelsForProvider = (
	provider: ProviderName,
	customArnLabel?: string,
): Record<string, ModelInfo> => {
	const models = MODELS_BY_PROVIDER[provider] ?? {}

	// Add custom-arn option for Bedrock
	if (provider === "bedrock") {
		return {
			...models,
			"custom-arn": {
				maxTokens: 0,
				contextWindow: 0,
				supportsPromptCache: false,
				description: customArnLabel ?? "Use Custom ARN",
			},
		}
	}

	return models
}

/**
 * Checks if a provider uses static models from MODELS_BY_PROVIDER
 */
export const isStaticModelProvider = (provider: ProviderName): boolean => {
	return provider in MODELS_BY_PROVIDER
}

export const getProviderModelSource = (provider: ProviderName): ModelSource | undefined => {
	if (isStaticModelProvider(provider)) {
		return { kind: "static" }
	}
	const definition = getProviderDefinition(provider)
	const sourceId = definition && "modelSource" in definition ? definition.modelSource : undefined
	return sourceId ? modelSources[sourceId] : undefined
}

/** The options of the model-list request, from the provider's `modelSourceOptions` descriptor row. */
export const getProviderModelSourceOptions = (apiConfiguration: ProviderSettings): ModelSourceOptions =>
	resolveProviderModelSourceOptions(apiConfiguration)

/**
 * Providers whose form has its own model selection and should not get the generic ModelPicker
 * in ApiOptions (`modelPicker: "in-form"` in PROVIDER_DESCRIPTORS).
 */
export const PROVIDERS_WITH_CUSTOM_MODEL_UI: readonly ProviderName[] = getInFormModelPickerProviderIds()

/**
 * Checks if a provider should use the generic ModelPicker
 */
export const shouldUseGenericModelPicker = (provider: ProviderName): boolean => {
	return isStaticModelProvider(provider) && !PROVIDERS_WITH_CUSTOM_MODEL_UI.includes(provider)
}

/**
 * Handles provider-specific side effects when a model is changed.
 * Centralizes provider-specific logic to keep it out of the ApiOptions template.
 */
export const handleModelChangeSideEffects = <K extends keyof ProviderSettings>(
	provider: ProviderName,
	modelId: string,
	setApiConfigurationField: (field: K, value: ProviderSettings[K]) => void,
): void => {
	// Bedrock: Clear custom ARN if not using custom ARN option
	if (provider === "bedrock" && modelId !== "custom-arn") {
		setApiConfigurationField("awsCustomArn" as K, "" as ProviderSettings[K])
	}

	// All providers: Clear reasoning settings when switching models to allow
	// the new model's defaults to take effect. Different models within the
	// same provider can have different reasoning defaults/options.
	setApiConfigurationField("reasoningEffort" as K, undefined as ProviderSettings[K])
	setApiConfigurationField("modelMaxTokens" as K, undefined as ProviderSettings[K])
	setApiConfigurationField("modelMaxThinkingTokens" as K, undefined as ProviderSettings[K])
}
