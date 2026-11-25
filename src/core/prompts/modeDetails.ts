import type { CustomModePrompts, ModeConfig } from "@tumble-code/types"

import { getAllModes, getModeBySlug, modes } from "../../shared/modes"

import { addCustomInstructions } from "./sections/custom-instructions"

// The extension-side mode helpers: getFullModeDetails reads the file system
// (custom instructions), so they live here and not in src/shared/modes.ts,
// which the webview bundles.

/**
 * Every mode with its prompt overrides applied, from the caller's own
 * `customModes` and `customModePrompts`. Never read these from
 * `context.globalState`: VS Code shares it between all windows, a Remote-SSH
 * window included, so another window's list would leak into this prompt.
 */
export function getAllModesWithPrompts(
	customModes: ModeConfig[] | undefined,
	customModePrompts: CustomModePrompts | undefined,
): ModeConfig[] {
	return getAllModes(customModes).map((mode) => ({
		...mode,
		roleDefinition: customModePrompts?.[mode.slug]?.roleDefinition ?? mode.roleDefinition,
		whenToUse: customModePrompts?.[mode.slug]?.whenToUse ?? mode.whenToUse,
		customInstructions: customModePrompts?.[mode.slug]?.customInstructions ?? mode.customInstructions,
		// description is not overridable via customModePrompts, so we keep the original
	}))
}

// Helper function to get complete mode details with all overrides
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		language?: string
	},
): Promise<ModeConfig> {
	// First get the base mode config from custom modes or built-in modes
	const baseMode = getModeBySlug(modeSlug, customModes) || modes.find((m) => m.slug === modeSlug) || modes[0]

	// Check for any prompt component overrides
	const promptComponent = customModePrompts?.[modeSlug]

	// Get the base custom instructions
	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""
	const baseWhenToUse = promptComponent?.whenToUse || baseMode.whenToUse || ""
	const baseDescription = promptComponent?.description || baseMode.description || ""

	// If we have cwd, load and combine all custom instructions
	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			modeSlug,
			{ language: options.language },
		)
	}

	// Return mode with any overrides applied
	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		whenToUse: baseWhenToUse,
		description: baseDescription,
		customInstructions: fullCustomInstructions,
	}
}
