import type { ProviderProfileMigration } from "./types"
import { isOpaqueProfile } from "./types"

/**
 * Introduced 2025-07-21 (b1bc085aa, #6032): per-profile `todoListEnabled`
 * checkbox.
 *
 * Sets `todoListEnabled: true` on every profile that has no value.
 * Idempotent: `??=` never overwrites a stored value (including `false`).
 */
export const todoListEnabledMigration: ProviderProfileMigration = {
	flag: "todoListEnabledMigrated",
	introduced: "2025-07-21",
	async run(providerProfiles) {
		try {
			for (const profile of Object.values(providerProfiles.apiConfigs)) {
				if (isOpaqueProfile(profile)) profile.provider.opaqueLegacyPayload.todoListEnabled ??= true
				else {
					profile.shared ??= {}
					profile.shared.todoListEnabled ??= true
				}
			}
		} catch (error) {
			console.error(`[MigrateTodoListEnabled] Failed to migrate todo list enabled setting:`, error)
		}
	},
}
