import type { PersistedProviderProfile } from "@roo-code/types"
import { providerProfileToLegacySettings } from "@roo-code/types"

import type { ApiHandlerOptions } from "../shared/api"
import { getRuntimeProviderFactory } from "./runtime-provider-registry"

/**
 * The extension's sole persisted-profile -> flat-handler compatibility boundary.
 */
export const resolveProviderProfileRuntimeOptions = (
	profile: PersistedProviderProfile,
	secrets: Partial<ApiHandlerOptions> = {},
): ApiHandlerOptions => {
	const { apiProvider, ...legacyOptions } = providerProfileToLegacySettings(profile)
	if (!getRuntimeProviderFactory(apiProvider)) {
		throw new Error(`Provider '${apiProvider ?? "unknown"}' has no runtime handler.`)
	}
	return { ...legacyOptions, ...secrets }
}
