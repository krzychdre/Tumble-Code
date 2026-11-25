import type { CustomModePrompts, ModeConfig } from "@tumble-code/types"

import { getAllModesWithPrompts } from "../modeDetails"

export function getModesSection(
	customModes: ModeConfig[] | undefined,
	customModePrompts: CustomModePrompts | undefined,
): string {
	const allModes = getAllModesWithPrompts(customModes, customModePrompts)

	const modesContent = `====

MODES

- These are the currently available modes:
${allModes
	.map((mode: ModeConfig) => {
		let description: string
		if (mode.whenToUse && mode.whenToUse.trim() !== "") {
			// Use whenToUse as the primary description, indenting subsequent lines for readability
			description = mode.whenToUse.replace(/\n/g, "\n    ")
		} else {
			// Fallback to the first sentence of roleDefinition if whenToUse is not available
			description = mode.roleDefinition.split(".")[0]
		}
		return `  * "${mode.name}" mode (${mode.slug}) - ${description}`
	})
	.join("\n")}`

	return modesContent
}
