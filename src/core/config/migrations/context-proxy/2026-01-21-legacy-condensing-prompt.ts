import { logger } from "../../../../utils/logging"
import { supportPrompt } from "../../../../shared/support-prompt"

import type { ContextProxyMigration } from "./types"

/**
 * Introduced 2026-01-21 (3f332d8e2, #10881): the condensing prompt moved
 * from `customCondensingPrompt` to `customSupportPrompts.CONDENSE`.
 *
 * Moves a true customization (not the default text) unless CONDENSE is
 * already set, then always removes the legacy key. Done-record: the legacy
 * key is absent. Must run before the v1-default cleanup
 * (2026-01-23-old-default-condensing-prompt), which then clears a moved
 * v1 default.
 */
export const legacyCondensingPromptMigration: ContextProxyMigration = {
	id: "legacy-condensing-prompt",
	introduced: "2026-01-21",
	async run({ globalState, stateCache }) {
		try {
			const legacyPrompt = globalState.get<string>("customCondensingPrompt")
			if (legacyPrompt) {
				const currentSupportPrompts = globalState.get<Record<string, string>>("customSupportPrompts") || {}

				// Only migrate if:
				// 1. The new location doesn't already have a value
				// 2. The legacy prompt is a true customization (not equal to the default)
				// This prevents pinning users to an old default if the default prompt changes.
				const isCustomized = legacyPrompt.trim() !== supportPrompt.default.CONDENSE.trim()
				if (!currentSupportPrompts.CONDENSE && isCustomized) {
					logger.info("Migrating customized legacy customCondensingPrompt to customSupportPrompts")
					const updatedPrompts = { ...currentSupportPrompts, CONDENSE: legacyPrompt }
					await globalState.update("customSupportPrompts", updatedPrompts)
					stateCache.customSupportPrompts = updatedPrompts
				} else if (!isCustomized) {
					logger.info("Skipping migration: legacy customCondensingPrompt equals the default prompt")
				}

				// Always remove the legacy field
				await globalState.update("customCondensingPrompt", undefined)
				stateCache.customCondensingPrompt = undefined
			}
		} catch (error) {
			logger.error(
				`Error during customCondensingPrompt migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},
}
