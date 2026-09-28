import { logger } from "../../../../utils/logging"

import type { ContextProxyMigration } from "./types"

/**
 * Introduced 2026-09-25 (1af172cf2, #420): `vertexJsonCredentials` was a
 * plain global state key until it joined SECRET_STATE_KEYS.
 *
 * Moves a leftover copy into secret storage (unless a secret is already
 * stored) and always clears the plain-text copy. Done-record: the global
 * state key is absent.
 */
export const globalStateSecretsMigration: ContextProxyMigration = {
	id: "global-state-secrets",
	introduced: "2026-09-25",
	async run({ globalState, secretCache, storeSecret }) {
		for (const key of ["vertexJsonCredentials"] as const) {
			try {
				const legacyValue = globalState.get<unknown>(key)
				if (legacyValue === undefined) continue
				if (typeof legacyValue === "string" && legacyValue !== "" && !secretCache[key]) {
					await storeSecret(key, legacyValue)
				}
				await globalState.update(key, undefined)
				logger.info(`Moved ${key} from global state to secret storage`)
			} catch (error) {
				logger.error(
					`Error moving ${key} to secret storage: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	},
}
