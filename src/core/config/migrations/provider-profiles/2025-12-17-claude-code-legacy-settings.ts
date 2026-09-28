import type { ProviderProfileMigration } from "./types"
import { isOpaqueProfile } from "./types"

/**
 * Introduced 2025-12-17 (0b86796b8, #10077): the local Claude Code CLI
 * wrapper was removed.
 *
 * Deletes its `claudeCodePath` and `claudeCodeMaxOutputTokens` keys from
 * stored `claude-code` profiles (stored opaquely, the provider is retired).
 * Idempotent: deleting an absent key does nothing.
 *
 * Unlike the others this one has no try/catch; an error fails
 * `initialize()` exactly as it did when the code was inline.
 */
export const claudeCodeLegacySettingsMigration: ProviderProfileMigration = {
	flag: "claudeCodeLegacySettingsMigrated",
	introduced: "2025-12-17",
	async run(providerProfiles) {
		// These keys were used by the removed local Claude Code CLI wrapper.
		for (const apiConfig of Object.values(providerProfiles.apiConfigs)) {
			if (!isOpaqueProfile(apiConfig)) continue
			const config = apiConfig.provider.opaqueLegacyPayload
			if (config.apiProvider !== "claude-code") continue

			if ("claudeCodePath" in config) {
				delete config.claudeCodePath
			}
			if ("claudeCodeMaxOutputTokens" in config) {
				delete config.claudeCodeMaxOutputTokens
			}
		}
	},
}
