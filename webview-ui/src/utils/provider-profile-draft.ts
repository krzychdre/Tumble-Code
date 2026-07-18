import {
	createKnownPersistedProviderProfile,
	providerProfileToLegacySettings,
	type OpaqueProviderProfile,
	type PersistedProviderProfile,
	type ProviderSettings,
} from "@roo-code/types"

/**
 * Buffered settings-form compatibility boundary. The draft remains local to
 * SettingsView.
 *
 * Opaque retired/unknown profiles bypass `providerProfileToLegacySettings`
 * (which throws for unavailable providers) and instead spread the
 * `opaqueLegacyPayload` directly, mirroring
 * `ProviderSettingsManager.toProviderSettings` for the opaque branch (M2).
 * Without this, loading an opaque profile into the edit draft would crash the
 * Settings UI once the draft helper is wired into SettingsView.
 */
export const providerProfileToEditDraft = (profile: PersistedProviderProfile): ProviderSettings => {
	if (!("config" in profile.provider)) {
		const opaque = profile as OpaqueProviderProfile
		return {
			apiProvider: opaque.provider.providerId as ProviderSettings["apiProvider"],
			...opaque.provider.opaqueLegacyPayload,
		} as ProviderSettings
	}
	return providerProfileToLegacySettings(profile)
}

export const providerEditDraftToProfile = (draft: ProviderSettings): PersistedProviderProfile =>
	createKnownPersistedProviderProfile(draft)
