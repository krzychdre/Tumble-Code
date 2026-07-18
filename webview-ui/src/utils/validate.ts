import i18next from "i18next"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	type ProviderName,
	type RouterModels,
	modelIdKeysByProvider,
	isProviderName,
	isRetiredProvider,
	isFauxProvider,
	isCustomProvider,
} from "@roo-code/types"

import { providerValidationRegistry } from "@src/provider-validation-registry"
import { getProviderModelSource } from "@src/components/settings/utils/providerModelConfig"

export function validateApiConfiguration(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)

	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)

	if (organizationAllowListError) {
		return organizationAllowListError.message
	}

	return validateDynamicProviderModelId(apiConfiguration, routerModels)
}

function validateModelsAndKeysProvided(apiConfiguration: ProviderSettings): string | undefined {
	if (!isProviderName(apiConfiguration.apiProvider)) {
		return undefined
	}

	const strategy = providerValidationRegistry[apiConfiguration.apiProvider]

	return strategy.kind === "required-fields" && strategy.fields.some((field) => !apiConfiguration[field])
		? i18next.t(strategy.message)
		: undefined
}

type ValidationError = {
	message: string
	code: "PROVIDER_NOT_ALLOWED" | "MODEL_NOT_ALLOWED"
}

function validateProviderAgainstOrganizationSettings(
	apiConfiguration: ProviderSettings,
	organizationAllowList?: OrganizationAllowList,
): ValidationError | undefined {
	if (organizationAllowList && !organizationAllowList.allowAll) {
		const provider = apiConfiguration.apiProvider

		if (!provider) {
			return undefined
		}

		const providerConfig = organizationAllowList.providers[provider]

		if (!providerConfig) {
			return {
				message: i18next.t("settings:validation.providerNotAllowed", { provider }),
				code: "PROVIDER_NOT_ALLOWED",
			}
		}

		if (!providerConfig.allowAll) {
			const activeProvider = isRetiredProvider(provider) ? undefined : provider
			const modelId = activeProvider ? getModelIdForProvider(apiConfiguration, activeProvider) : undefined
			const allowedModels = providerConfig.models || []

			if (modelId && !allowedModels.includes(modelId)) {
				return {
					message: i18next.t("settings:validation.modelNotAllowed", {
						model: modelId,
						provider,
					}),
					code: "MODEL_NOT_ALLOWED",
				}
			}
		}
	}
}

function getModelIdForProvider(apiConfiguration: ProviderSettings, provider: ProviderName): string | undefined {
	if (provider === "vscode-lm") {
		return apiConfiguration.vsCodeLmModelSelector?.id
	}

	if (isCustomProvider(provider) || isFauxProvider(provider)) {
		return apiConfiguration.apiModelId
	}

	return apiConfiguration[modelIdKeysByProvider[provider]]
}

/**
 * Validates an Amazon Bedrock ARN and optionally checks if the region in
 * the ARN matches the provided region.
 *
 * Note: This function does not perform strict format validation on the ARN.
 * Users entering custom ARNs are advanced users who should be trusted to
 * provide valid ARNs without restriction. See issue #10108.
 *
 * @param arn The ARN string to validate
 * @param region Optional region to check against the ARN's region
 * @returns An object with validation results: { isValid, arnRegion, errorMessage }
 */
export function validateBedrockArn(arn: string, region?: string) {
	// Try to extract region from ARN for region mismatch warning.
	// This is a permissive regex that attempts to find the region component
	// without enforcing strict ARN format validation.
	const regionMatch = arn.match(/^arn:[^:]+:[^:]+:([^:]+):/)
	const arnRegion = regionMatch?.[1]

	// Check if region in ARN matches provided region (if specified).
	if (region && arnRegion && arnRegion !== region) {
		return {
			isValid: true,
			arnRegion,
			errorMessage: i18next.t("settings:validation.arn.regionMismatch", { arnRegion, region }),
		}
	}

	// ARN is always considered valid - trust the user to enter valid ARNs.
	return { isValid: true, arnRegion, errorMessage: undefined }
}

function validateDynamicProviderModelId(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
): string | undefined {
	const provider = apiConfiguration.apiProvider ?? ""

	if (!isProviderName(provider)) {
		return
	}
	const modelSource = getProviderModelSource(provider)
	if (!modelSource || modelSource.kind !== "remote" || modelSource.payload !== "models") {
		return undefined
	}

	const modelId = getModelIdForProvider(apiConfiguration, provider)

	if (!modelId) {
		return i18next.t("settings:validation.modelId")
	}

	const models = routerModels?.[modelSource.id as keyof RouterModels]

	if (models && Object.keys(models).length > 1 && !Object.keys(models).includes(modelId)) {
		return i18next.t("settings:validation.modelAvailability", { modelId })
	}

	return undefined
}

/**
 * Extracts model-specific validation errors from the API configuration.
 * This is used to show model errors specifically in the model selector components.
 */
export function getModelValidationError(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const modelId = isProviderName(apiConfiguration.apiProvider)
		? getModelIdForProvider(apiConfiguration, apiConfiguration.apiProvider)
		: apiConfiguration.apiModelId

	const configWithModelId = {
		...apiConfiguration,
		apiModelId: modelId || "",
	}

	const orgError = validateProviderAgainstOrganizationSettings(configWithModelId, organizationAllowList)

	if (orgError && orgError.code === "MODEL_NOT_ALLOWED") {
		return orgError.message
	}

	return validateDynamicProviderModelId(configWithModelId, routerModels)
}

/**
 * Validates API configuration but excludes model-specific errors.
 * This is used for the general API error display to prevent duplication
 * when model errors are shown in the model selector.
 */
export function validateApiConfigurationExcludingModelErrors(
	apiConfiguration: ProviderSettings,
	_routerModels?: RouterModels, // Keeping this for compatibility with the old function.
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)

	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)

	// Only return organization errors if they're not model-specific.
	if (organizationAllowListError && organizationAllowListError.code === "PROVIDER_NOT_ALLOWED") {
		return organizationAllowListError.message
	}

	// Skip model validation errors as they'll be shown in the model selector.
	return undefined
}
