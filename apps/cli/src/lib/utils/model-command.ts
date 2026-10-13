/**
 * The texts of the TUI's /model: the list of the models the settings file
 * describes, and the line that confirms a switch and says whether it was
 * saved. The switch itself is ExtensionHost.switchModel, the save
 * createModelChoiceSaver.
 */

import os from "os"
import path from "path"

import type { ProviderSettings } from "@tumble-code/types"

import type { CliModelSettings } from "@/types/types.js"
import type { ModelChoiceSave } from "@/lib/storage/mode-model.js"

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
	if (entry.modelSize && entry.modelSize !== "standard") {
		parts.push(entry.modelSize)
	}
	if (entry.modes?.length) {
		parts.push(`modes ${[...new Set(entry.modes)].join(", ")}`)
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
		"/model <id> runs another model in this mode and saves the choice for later sessions: on the provider and base URL of its models entry when it sets them, else on the mode's, where any id the provider serves works.",
	)
	return lines.join("\n")
}

/** The line that confirms /model <id>. */
export function formatModelSwitched({
	mode,
	model,
	settings,
	hasEntry,
	saved,
}: {
	mode: string
	model: string
	settings: ProviderSettings
	hasEntry: boolean
	saved: ModelChoiceSave
}): string {
	const effort = summarizeProviderSettings(settings)?.reasoningEffort
	const runs = `${mode} mode now runs ${model}${effort ? ` [${effort}]` : ""}`
	const line =
		saved.outcome === "saved"
			? `${runs}; the next request goes to it. Saved in ${tildify(saved.settingsPath)} (${saved.key}), so later sessions run it in ${mode} mode too.`
			: saved.outcome === "session-only"
				? `${runs} for the rest of this session; the next request goes to it. Not saved: ${saved.reason}.`
				: `${runs} for the rest of this session; the next request goes to it. Saving it in ${tildify(saved.settingsPath)} failed: ${saved.error}`

	// An openai model without an entry gets the extension's sane defaults,
	// which is easy to miss when the previous model had a size and prices.
	if (!hasEntry && settings.apiProvider === MODEL_SETTINGS_PROVIDER) {
		return `${line} It has no entry in models, so it runs with a 128,000-token window, no prices and no reasoning effort.`
	}

	return line
}

/** A path under the home directory as ~/..., the way the user writes it. */
function tildify(filePath: string): string {
	const home = os.homedir()
	return filePath.startsWith(home + path.sep) ? `~${filePath.slice(home.length)}` : filePath
}
