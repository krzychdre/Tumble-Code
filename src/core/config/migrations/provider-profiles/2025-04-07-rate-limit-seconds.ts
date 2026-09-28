import type { ProviderProfileMigration } from "./types"
import { isOpaqueProfile } from "./types"

/**
 * Introduced 2025-04-07 (260fc3004, #2376): the rate limit moved from one
 * global `rateLimitSeconds` state key into every provider profile.
 *
 * Copies the global value (or 0) into each profile that has none.
 * Idempotent: a profile that already has a value is left alone.
 */
export const rateLimitSecondsMigration: ProviderProfileMigration = {
	flag: "rateLimitSecondsMigrated",
	introduced: "2025-04-07",
	async run(providerProfiles, { globalState }) {
		try {
			let rateLimitSeconds: number | undefined

			try {
				rateLimitSeconds = await globalState.get<number>("rateLimitSeconds")
			} catch (error) {
				console.error("[MigrateRateLimitSeconds] Error getting global rate limit:", error)
			}

			if (rateLimitSeconds === undefined) {
				// Failed to get the existing value, use the default.
				rateLimitSeconds = 0
			}

			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (isOpaqueProfile(apiConfig)) {
					if (apiConfig.provider.opaqueLegacyPayload.rateLimitSeconds === undefined) {
						apiConfig.provider.opaqueLegacyPayload.rateLimitSeconds = rateLimitSeconds
					}
				} else {
					apiConfig.shared ??= {}
					if (apiConfig.shared.rateLimitSeconds === undefined)
						apiConfig.shared.rateLimitSeconds = rateLimitSeconds
				}
			}
		} catch (error) {
			console.error(`[MigrateRateLimitSeconds] Failed to migrate rate limit settings:`, error)
		}
	},
}
