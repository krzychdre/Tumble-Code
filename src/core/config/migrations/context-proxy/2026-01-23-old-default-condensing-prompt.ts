import { logger } from "../../../../utils/logging"

import type { ContextProxyMigration } from "./types"

/**
 * Detects the old v1 default condensing prompt by fingerprint rather than
 * exact match (tolerates whitespace changes): all v1 phrases present and
 * none of the v2-only features.
 *
 * V1 characteristics:
 * - Exactly 6 numbered sections (1-6)
 * - Contains specific section headers like "Previous Conversation", "Current Work", etc.
 * - Does NOT contain v2-specific features like "<analysis>", "SYSTEM OPERATION", etc.
 */
function isOldV1DefaultCondensePrompt(prompt: string): boolean {
	// Key phrases unique to the v1 default (must ALL be present)
	const v1RequiredPhrases = [
		"Your task is to create a detailed summary of the conversation so far",
		"1. Previous Conversation:",
		"2. Current Work:",
		"3. Key Technical Concepts:",
		"4. Relevant Files and Code:",
		"5. Problem Solving:",
		"6. Pending Tasks and Next Steps:",
		"Output only the summary of the conversation so far",
	]

	// V2-specific features (if ANY are present, this is NOT v1 default)
	const v2Features = [
		"<analysis>",
		"SYSTEM OPERATION",
		"Errors and fixes",
		"All user messages",
		"7.", // v2 has more than 6 sections
		"8.",
		"9.",
	]

	// Check that all v1 required phrases are present
	const hasAllV1Phrases = v1RequiredPhrases.every((phrase) => prompt.toLowerCase().includes(phrase.toLowerCase()))

	// Check that no v2 features are present
	const hasNoV2Features = v2Features.every((feature) => !prompt.toLowerCase().includes(feature.toLowerCase()))

	return hasAllV1Phrases && hasNoV2Features
}

/**
 * Introduced 2026-01-23 (b042866ee, #10931): users who had the old v1
 * default condensing prompt saved in `customSupportPrompts.CONDENSE` were
 * stuck with it instead of getting the improved v2 default (PR #10873).
 *
 * Removes CONDENSE when it is the v1 default, keeping other prompts.
 * Done-record: CONDENSE is absent or not the v1 default.
 */
export const oldDefaultCondensingPromptMigration: ContextProxyMigration = {
	id: "old-default-condensing-prompt",
	introduced: "2026-01-23",
	async run({ globalState, stateCache }) {
		try {
			const currentSupportPrompts = globalState.get<Record<string, string>>("customSupportPrompts") || {}

			const savedCondensePrompt = currentSupportPrompts.CONDENSE

			if (savedCondensePrompt && isOldV1DefaultCondensePrompt(savedCondensePrompt)) {
				logger.info(
					"Clearing old v1 default condensing prompt from customSupportPrompts.CONDENSE - user will now get the improved v2 default",
				)

				// Remove the CONDENSE key from customSupportPrompts
				const { CONDENSE: _, ...remainingPrompts } = currentSupportPrompts
				const updatedPrompts = Object.keys(remainingPrompts).length > 0 ? remainingPrompts : undefined

				await globalState.update("customSupportPrompts", updatedPrompts)
				stateCache.customSupportPrompts = updatedPrompts
			}
		} catch (error) {
			logger.error(
				`Error during old default condensing prompt migration: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	},
}
