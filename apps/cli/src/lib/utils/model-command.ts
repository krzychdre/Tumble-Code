/**
 * The texts of the TUI's /model: the list of the models the settings file
 * describes (printed, and the rows of the interactive list), and the line
 * that confirms a switch and says whether it was saved. The switch itself is
 * ExtensionHost.switchModel, the save createModelChoiceSaver.
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

/** One row of the interactive /model list. */
export interface ModelRow {
	/** The model id, which is also the row's key in the picker. */
	key: string
	/** What its `models` entry sets, worded as in the printed list. */
	details: string
	/** The model the mode runs now. */
	current: boolean
}

/**
 * The rows of the interactive /model list: every `models` entry in file
 * order, and before them the model the mode runs now when it has no entry
 * (it came from --model or the provider), so the list always shows what is
 * running.
 */
export function buildModelRows(
	currentModel: string | undefined,
	models: Record<string, CliModelSettings> | undefined,
): ModelRow[] {
	const rows = Object.entries(models ?? {}).map(([id, entry]) => ({
		key: id,
		details: describeEntry(entry),
		current: id === currentModel,
	}))

	if (currentModel && !rows.some((row) => row.current)) {
		rows.unshift({ key: currentModel, details: "no entry in models", current: true })
	}

	return rows
}

/** Whether the list offers anything besides the model already running. */
export function hasOtherModel(rows: ModelRow[]): boolean {
	return rows.some((row) => !row.current)
}

/** What /model without an argument prints when there is nothing to pick from. */
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
