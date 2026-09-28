import { DEFAULT_CONSECUTIVE_MISTAKE_LIMIT } from "@roo-code/types"

import type { ProviderProfileMigration } from "./types"
import { isOpaqueProfile } from "./types"

/**
 * Introduced 2025-07-15 (93f88b45b, #5752): per-profile
 * `consecutiveMistakeLimit` setting.
 *
 * Fills the default into every profile that has none.
 * Idempotent: `??=` never overwrites a stored value.
 */
export const consecutiveMistakeLimitMigration: ProviderProfileMigration = {
	flag: "consecutiveMistakeLimitMigrated",
	introduced: "2025-07-15",
	async run(providerProfiles) {
		try {
			for (const profile of Object.values(providerProfiles.apiConfigs)) {
				if (isOpaqueProfile(profile)) {
					profile.provider.opaqueLegacyPayload.consecutiveMistakeLimit ??= DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
				} else {
					profile.shared ??= {}
					profile.shared.consecutiveMistakeLimit ??= DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
				}
			}
		} catch (error) {
			console.error(`[MigrateConsecutiveMistakeLimit] Failed to migrate consecutive mistake limit:`, error)
		}
	},
}
