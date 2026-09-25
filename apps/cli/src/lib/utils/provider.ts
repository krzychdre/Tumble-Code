/**
 * Legacy entry point for provider helpers.
 *
 * All provider logic now lives in ./provider-types.ts (derived from the shared
 * @roo-code/types registry). This module keeps the old import path working.
 */

export {
	getEnvVarName,
	getBaseUrlEnvVarName,
	getApiKeyFromEnv,
	getBaseUrlFromEnv,
	getProviderSettings,
	getApiKeyField,
	getBaseUrlField,
	getModelField,
	providerRequiresApiKey,
	providerRequiresModelId,
	isSupportedProvider,
	keylessProviders,
	providerEnvMap,
	supportedProviders,
	type SupportedProvider,
	type ProviderEnvMapping,
} from "./provider-types.js"
