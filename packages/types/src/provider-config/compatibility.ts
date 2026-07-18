import type { ProviderSettings } from "../provider-settings.js"
import type { NarrowedProviderSettings, PersistedProviderProfile } from "../index.js"

/**
 * The single compatibility boundary for legacy UI/runtime consumers. Persistence must never use this flat shape.
 */
export const providerProfileToLegacySettings = (profile: PersistedProviderProfile): ProviderSettings => {
	if (!("config" in profile.provider)) {
		throw new Error(
			`Provider '${profile.provider.providerId}' is unavailable and cannot be resolved for execution.`,
		)
	}

	return {
		apiProvider: profile.provider.providerId,
		...("shared" in profile ? (profile.shared ?? {}) : {}),
		...profile.provider.config,
	} as ProviderSettings
}

export const narrowedSettingsToLegacySettings = (settings: NarrowedProviderSettings): ProviderSettings =>
	({
		apiProvider: settings.provider.providerId,
		...(settings.shared ?? {}),
		...settings.provider.config,
	}) as ProviderSettings
