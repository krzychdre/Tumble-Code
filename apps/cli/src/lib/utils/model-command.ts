/**
 * The texts of the TUI's /model: the list of the models the settings file
 * describes, and the line that confirms a switch. The switch itself is
 * ExtensionHost.switchModel.
 */

import type { ProviderSettings } from "@tumble-code/types"

import type { CliModelSettings } from "@/types/types.js"

import { MODEL_SETTINGS_PROVIDER } from "./model-settings.js"
import { summarizeProviderSettings } from "./provider-config.js"

function describeEntry(entry: CliModelSettings): string {
	const parts: string[] = []
	if (entry.reasoningEffort) {
		parts.push(`reasoning ${entry.reasoningEffort}`)
	}
	if (entry.contextWindow) {
		parts.push(`${entry.contextWindow.toLocaleString("en-US")} tokens`)
	}
	return parts.join(", ")
}

/** What /model without an argument prints. */
export function formatModelList({
	mode,
	currentModel,
	models,
	settingsPath,
}: {
	mode: string
	currentModel: string | undefined
	models: Record<string, CliModelSettings> | undefined
	settingsPath: string
}): string {
	const lines = [`Model in ${mode} mode: ${currentModel ?? "(unknown)"}`]
	const entries = Object.entries(models ?? {})

	if (entries.length > 0) {
		lines.push(`Models in ${settingsPath}:`)
		for (const [id, entry] of entries) {
			const marker = id === currentModel ? "● " : "  "
			const details = describeEntry(entry)
			lines.push(`${marker}${id}${details ? ` (${details})` : ""}`)
		}
	} else {
		lines.push(`No models in ${settingsPath}.`)
	}

	lines.push(
		"/model <id> runs another model of the same provider in this mode until the session ends; any id the provider serves works.",
	)
	return lines.join("\n")
}

/** The line that confirms /model <id>. */
export function formatModelSwitched({
	mode,
	model,
	settings,
	hasEntry,
}: {
	mode: string
	model: string
	settings: ProviderSettings
	hasEntry: boolean
}): string {
	const effort = summarizeProviderSettings(settings)?.reasoningEffort
	const line = `${mode} mode now runs ${model}${effort ? ` [${effort}]` : ""} for the rest of this session; the next request goes to it.`

	// An openai model without an entry gets the extension's sane defaults,
	// which is easy to miss when the previous model had a size and prices.
	if (!hasEntry && settings.apiProvider === MODEL_SETTINGS_PROVIDER) {
		return `${line} It has no entry in models, so it runs with a 128,000-token window, no prices and no reasoning effort.`
	}

	return line
}
