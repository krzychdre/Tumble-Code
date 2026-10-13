/**
 * /model saves the model it gives a mode, so later sessions run that model in
 * that mode too, the way VS Code keeps the API profile chosen in a mode. This
 * is the one place the CLI writes cli-settings.json, and it changes nothing
 * but where the mode's model is named: `modes.<mode>.model` when the file
 * names it there, else the `modes` list of the model's `models` entry.
 */

import fs from "fs/promises"

import { withLockedJsonTransaction } from "@tumble-code/core"

import { getSettingsPath } from "./settings.js"

/** What became of saving a /model choice, for the line that confirms the switch. */
export type ModelChoiceSave =
	| { outcome: "saved"; settingsPath: string; key: string }
	/** Not saved on purpose; `reason` says why, to finish "Not saved: ...". */
	| { outcome: "session-only"; reason: string }
	| { outcome: "failed"; settingsPath: string; error: string }

export type SaveModelChoice = (mode: string, model: string) => Promise<ModelChoiceSave>

/**
 * Names `model` as the model of `mode` in a parsed settings file, in place,
 * and returns the key it is now named under. Keys are only ever changed where
 * they are, so the file keeps its order. The mode is also taken out of every
 * other model's `modes` list, since a list naming the old model would
 * contradict the new choice and stop the next run at startup.
 */
export function setModeModel(file: Record<string, unknown>, mode: string, model: string): string {
	const modeEntry = isPlainObject(file.modes) ? file.modes[mode] : undefined

	if (isPlainObject(modeEntry) && modeEntry.model !== undefined) {
		modeEntry.model = model
		removeFromOtherLists(file, mode, model)
		return `modes.${mode}.model`
	}

	removeFromOtherLists(file, mode, model)

	file.models ??= {}
	if (!isPlainObject(file.models)) {
		throw new Error("models is not an object")
	}

	const entry = (file.models[model] ??= {})
	if (!isPlainObject(entry)) {
		throw new Error(`models.${model} is not an object`)
	}

	entry.modes ??= []
	if (!Array.isArray(entry.modes)) {
		throw new Error(`models.${model}.modes is not a list`)
	}

	if (!entry.modes.includes(mode)) {
		entry.modes.push(mode)
	}

	return `models.${model}.modes`
}

/**
 * Drops `mode` from the `modes` list of every model but `keep`; a list left
 * empty goes, and so does an entry that held nothing else.
 */
function removeFromOtherLists(file: Record<string, unknown>, mode: string, keep: string): void {
	if (!isPlainObject(file.models)) {
		return
	}

	for (const [model, entry] of Object.entries(file.models)) {
		if (model === keep || !isPlainObject(entry) || !Array.isArray(entry.modes) || !entry.modes.includes(mode)) {
			continue
		}

		const rest = entry.modes.filter((slug) => slug !== mode)
		if (rest.length > 0) {
			entry.modes = rest
			continue
		}

		delete entry.modes
		if (Object.keys(entry).length === 0) {
			delete file.models[model]
		}
	}
}

/**
 * Saves `model` as the model of `mode` in cli-settings.json and returns the
 * key it is named under. The file is read under the write lock, so an edit
 * the owner made during the session is kept, and replaced atomically with its
 * permission bits (it may hold an API key and be chmod 600). An unchanged
 * file is not written. A missing file is created with only this choice.
 */
export async function saveModeModel(mode: string, model: string): Promise<string> {
	const settingsPath = getSettingsPath()

	return withLockedJsonTransaction(settingsPath, settingsPath, async (writeJson) => {
		const text = await fs.readFile(settingsPath, "utf-8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				return undefined
			}
			throw error
		})
		const file: unknown = text === undefined ? {} : JSON.parse(text)

		if (!isPlainObject(file)) {
			throw new Error("the file does not hold a JSON object")
		}

		const before = JSON.stringify(file)
		const key = setModeModel(file, mode, model)

		if (JSON.stringify(file) !== before) {
			await writeJson(file, { prettyPrint: true })
		}

		return key
	})
}

/**
 * The save /model calls after each switch. A run with provider flags uses one
 * configuration for every mode and ignores the file's mode models, so saving
 * one would change a later run behind a choice this run never made; an
 * --ephemeral run promises to persist nothing. Both switch for the session
 * only. A failed write is reported, never thrown: the switch stands.
 */
export function createModelChoiceSaver({
	providerFlags,
	ephemeral,
	save = saveModeModel,
}: {
	providerFlags: boolean
	ephemeral: boolean
	save?: (mode: string, model: string) => Promise<string>
}): SaveModelChoice {
	return async (mode, model) => {
		if (providerFlags) {
			return {
				outcome: "session-only",
				reason: "this run was started with --provider, --model, --base-url or --api-key, which set one model for every mode",
			}
		}

		if (ephemeral) {
			return { outcome: "session-only", reason: "an --ephemeral run saves nothing" }
		}

		try {
			return { outcome: "saved", settingsPath: getSettingsPath(), key: await save(mode, model) }
		} catch (error) {
			return {
				outcome: "failed",
				settingsPath: getSettingsPath(),
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
