import type { ModeConfig, PromptComponent, CustomModePrompts } from "@roo-code/types"

import { Mode, getRoleDefinition, getWhenToUse, getDescription } from "@roo/modes"

import { vscode } from "@src/utils/vscode"

/** A prompt field of a built-in mode that has a "reset to default" button. */
export type ResettablePromptField = "roleDefinition" | "description" | "whenToUse" | "customInstructions"

/**
 * Saves an override for a built-in mode. Merges into the stored override and drops the fields that
 * equal the built-in default, so the override only keeps real differences.
 */
export function postAgentPrompt(
	customModePrompts: CustomModePrompts | undefined,
	mode: Mode,
	promptData: PromptComponent,
) {
	const existingPrompt = customModePrompts?.[mode] as PromptComponent
	const updatedPrompt = { ...existingPrompt, ...promptData }

	// Only include properties that differ from defaults
	if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
		delete updatedPrompt.roleDefinition
	}
	if (updatedPrompt.description === getDescription(mode)) {
		delete updatedPrompt.description
	}
	if (updatedPrompt.whenToUse === getWhenToUse(mode)) {
		delete updatedPrompt.whenToUse
	}

	vscode.postMessage({
		type: "updatePrompt",
		promptMode: mode,
		customPrompt: updatedPrompt,
	})
}

/** Saves a custom mode; a mode without a source is saved as a global mode. */
export function postCustomMode(slug: string, modeConfig: ModeConfig) {
	vscode.postMessage({
		type: "updateCustomMode",
		slug,
		modeConfig: {
			...modeConfig,
			source: modeConfig.source || "global", // Ensure source is set
		},
	})
}

/** Removes one field from a built-in mode's override so the built-in default applies again. */
export function postAgentReset(
	customModePrompts: CustomModePrompts | undefined,
	modeSlug: string,
	type: ResettablePromptField,
) {
	// Only reset for built-in modes
	const existingPrompt = customModePrompts?.[modeSlug] as PromptComponent
	const updatedPrompt = { ...existingPrompt }
	delete updatedPrompt[type] // Remove the field entirely to ensure it reloads from defaults

	vscode.postMessage({
		type: "updatePrompt",
		promptMode: modeSlug,
		customPrompt: updatedPrompt,
	})
}
