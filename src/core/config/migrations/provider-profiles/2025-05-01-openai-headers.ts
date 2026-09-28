import type { ProviderProfileMigration } from "./types"
import { isOpaqueProfile } from "./types"

/**
 * Introduced 2025-05-01 (a356d7066, #3056): the OpenAI-compatible provider's
 * single `openAiHostHeader` became a general `openAiHeaders` map.
 *
 * Turns `openAiHostHeader` into `openAiHeaders: { Host }` when no headers are
 * set, and clears the old key so a deleted header does not come back.
 * Idempotent: once the old key is cleared there is nothing left to move.
 */
export const openAiHeadersMigration: ProviderProfileMigration = {
	flag: "openAiHeadersMigrated",
	introduced: "2025-05-01",
	async run(providerProfiles) {
		try {
			for (const [_name, apiConfig] of Object.entries(providerProfiles.apiConfigs)) {
				if (isOpaqueProfile(apiConfig) || apiConfig.provider.providerId !== "openai") continue
				const config = apiConfig.provider.config

				// Check if openAiHostHeader exists but openAiHeaders doesn't
				if (
					config.openAiHostHeader &&
					(!config.openAiHeaders || Object.keys(config.openAiHeaders).length === 0)
				) {
					// Create the headers object with the Host value
					config.openAiHeaders = { Host: config.openAiHostHeader }

					// Delete the old property to prevent re-migration
					// This prevents the header from reappearing after deletion
					config.openAiHostHeader = undefined
				}
			}
		} catch (error) {
			console.error(`[MigrateOpenAiHeaders] Failed to migrate OpenAI headers:`, error)
		}
	},
}
