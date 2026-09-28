import { isProviderName, isRetiredProvider } from "@roo-code/types"

import { logger } from "../../../../utils/logging"

import type { ContextProxyMigration } from "./types"

/**
 * Introduced 2025-12-05 (9f4dcfc0e, #9869): a stored `apiProvider` that is
 * neither a current nor a retired provider (for example a removed one)
 * caused an endless schema-error loop.
 *
 * Clears such a value. Retired providers are kept so users keep their
 * historical configuration. Done-record: the stored value is valid.
 * `ContextProxy.getProviderSettings()` also sanitizes at read time, so this
 * is not a candidate for deletion on its own.
 */
export const invalidApiProviderMigration: ContextProxyMigration = {
	id: "invalid-api-provider",
	introduced: "2025-12-05",
	async run({ globalState, stateCache }) {
		try {
			const apiProvider = stateCache.apiProvider
			const isKnownProvider =
				typeof apiProvider === "string" && (isProviderName(apiProvider) || isRetiredProvider(apiProvider))

			if (apiProvider !== undefined && !isKnownProvider) {
				logger.info(`[ContextProxy] Found invalid provider "${apiProvider}" in storage - clearing it`)
				// Clear the invalid provider from both cache and storage
				stateCache.apiProvider = undefined
				await globalState.update("apiProvider", undefined)
			}
		} catch (error) {
			logger.error(
				`Error during invalid API provider migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},
}
