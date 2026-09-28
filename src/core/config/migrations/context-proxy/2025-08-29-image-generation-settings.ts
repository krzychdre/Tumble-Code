import { logger } from "../../../../utils/logging"

import type { ContextProxyMigration } from "./types"

/**
 * Introduced 2025-08-29 (c3d84d295, #7536): the nested
 * `openRouterImageGenerationSettings` object was flattened into the
 * `openRouterImageApiKey` secret and `openRouterImageGenerationSelectedModel`.
 *
 * Moves each value unless the new location already has one, then removes
 * the nested object. Done-record: the nested key is absent.
 */
export const imageGenerationSettingsMigration: ContextProxyMigration = {
	id: "image-generation-settings",
	introduced: "2025-08-29",
	async run({ globalState, secrets, stateCache, secretCache }) {
		try {
			// Check if there's an old nested structure
			const oldNestedSettings = globalState.get<any>("openRouterImageGenerationSettings")

			if (oldNestedSettings && typeof oldNestedSettings === "object") {
				logger.info("Migrating old nested image generation settings to flattened structure")

				// Migrate the API key if it exists and we don't already have one
				if (oldNestedSettings.openRouterApiKey && !secretCache.openRouterImageApiKey) {
					await secrets.store("openRouterImageApiKey", oldNestedSettings.openRouterApiKey)
					secretCache.openRouterImageApiKey = oldNestedSettings.openRouterApiKey
					logger.info("Migrated openRouterImageApiKey to secrets")
				}

				// Migrate the selected model if it exists and we don't already have one
				if (oldNestedSettings.selectedModel && !stateCache.openRouterImageGenerationSelectedModel) {
					await globalState.update("openRouterImageGenerationSelectedModel", oldNestedSettings.selectedModel)
					stateCache.openRouterImageGenerationSelectedModel = oldNestedSettings.selectedModel
					logger.info("Migrated openRouterImageGenerationSelectedModel to global state")
				}

				// Clean up the old nested structure
				await globalState.update("openRouterImageGenerationSettings", undefined)
				logger.info("Removed old nested openRouterImageGenerationSettings")
			}
		} catch (error) {
			logger.error(
				`Error during image generation settings migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},
}
