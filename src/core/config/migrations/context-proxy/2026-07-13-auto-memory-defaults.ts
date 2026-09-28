import type { GlobalState } from "@roo-code/types"

import { logger } from "../../../../utils/logging"
import { validateMemoryPath } from "../../../memory/paths"

import type { ContextProxyMigration } from "./types"

type GlobalStateKey = keyof GlobalState

/**
 * Introduced 2026-07-13 (359ea2407, #118): the native memory system shipped
 * default ON for existing users.
 *
 * Writes defaults only for absent keys, so a user who set a value
 * (including `false`) keeps it: `autoMemoryEnabled=true`,
 * `autoDreamEnabled=true`, `memoryRecallEnabled=true`,
 * `autoDreamMinHours=24`, `autoDreamMinSessions=5`. Also clears a stored
 * `autoMemoryDirectory` that no longer validates (a blank value means the
 * default folder and is kept). Not a deletion candidate: it re-applies the
 * defaults after `resetAllState()` and repairs a bad folder on every start.
 */
/**
 * `stateCache[key] = value` with `key` a union of keys does not type-check
 * (TypeScript wants a value assignable to every key's type); a generic key
 * ties the value to its own key.
 */
function setCachedValue<K extends GlobalStateKey>(cache: GlobalState, key: K, value: GlobalState[K]): void {
	cache[key] = value
}

export const autoMemoryDefaultsMigration: ContextProxyMigration = {
	id: "auto-memory-defaults",
	introduced: "2026-07-13",
	async run({ globalState, stateCache }) {
		try {
			const updates: Partial<GlobalState> = {}
			if (stateCache.autoMemoryEnabled === undefined) updates.autoMemoryEnabled = true
			if (stateCache.autoDreamEnabled === undefined) updates.autoDreamEnabled = true
			if (stateCache.memoryRecallEnabled === undefined) updates.memoryRecallEnabled = true
			if (stateCache.autoDreamMinHours === undefined) updates.autoDreamMinHours = 24
			if (stateCache.autoDreamMinSessions === undefined) updates.autoDreamMinSessions = 5
			// If a stored autoMemoryDirectory is invalid (e.g. a leftover from a
			// removed volume), clear it rather than crash the path module. A
			// blank value is how the Settings view clears the folder (it means
			// the default folder) and is kept as it is.
			const storedMemoryDirectory = stateCache.autoMemoryDirectory
			if (typeof storedMemoryDirectory === "string" && storedMemoryDirectory.trim() !== "") {
				try {
					validateMemoryPath(storedMemoryDirectory)
				} catch {
					updates.autoMemoryDirectory = undefined
				}
			}
			const keys = Object.keys(updates) as GlobalStateKey[]
			if (keys.length === 0) return
			for (const key of keys) {
				const value = updates[key]
				setCachedValue(stateCache, key, value)
				await globalState.update(key, value)
			}
			logger.info(`[memory] migrateAutoMemoryDefaults applied ${keys.length} default(s)`)
		} catch (error) {
			logger.error(
				`Error during auto-memory defaults migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},
}
