/**
 * Legacy entry point for provider helpers.
 *
 * All provider logic now lives in ./provider-types.ts (derived from the shared
 * @tumble-code/types registry). This module keeps the old import path working.
 */

export {
	getEnvVarName,
	getApiKeyFromEnv,
	getProviderSettings,
	getApiKeyField,
	providerRequiresApiKey,
	providerRequiresModelId,
} from "./provider-types.js"
