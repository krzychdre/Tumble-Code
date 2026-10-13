/**
 * Per-model settings from cli-settings.json: `models`, keyed by model id.
 *
 * The context window and the prices. The openai provider (any
 * OpenAI-compatible server) has no model list with sizes or prices, since its
 * model source returns ids only, so without an entry here the extension sizes
 * every such model with openAiModelInfoSaneDefaults (128,000 tokens, free) and
 * condenses the conversation against that, and every request costs $0.
 * toProviderSettings hands the entry to the extension as
 * openAiCustomModelInfo, the same field the VS Code settings fill. Other
 * providers size and price their models from their own tables and have no
 * field that could take it.
 *
 * `preserveReasoning` belongs here for the same reason: whether a model reads
 * its earlier reasoning back is a fact about the model and its server, so it
 * follows the model through every mode that runs it. It becomes the
 * extension's openAiPreserveReasoning. `trimOldReasoning`, which shortens the
 * long reasoning of older turns once the context fills up, goes with it and
 * becomes openAiTrimOldReasoning.
 *
 * `reasoningEffort` too, and unlike the others it works with every provider:
 * the levels a model accepts are its own, so one level for all models sent
 * "max" to models that reject it.
 *
 * `modelSize` (with `hideMcp`) works with every provider as well: it picks the
 * system prompt and the tool set for the model, the same choice as "Model
 * size" in the VS Code profile settings, and becomes the extension's
 * slimToolset, slimHidesMcp and compactProfile.
 *
 * `provider`, `baseUrl`, `apiKey` and `apiKeyEnv` put the model on its own
 * connection, for a model served elsewhere than the top level or the mode
 * says; resolveProviderConfigWithModel layers them under the flags.
 *
 * `modes` names the modes that run the model, the other way round from
 * `modes.<slug>.model`; getEffectiveModeSettings folds both into one entry
 * per mode.
 */

import type { CliModeSettings, CliModelSettings, CliSettings } from "@/types/types.js"
import { MODEL_SIZES, REASONING_EFFORTS } from "@/types/constants.js"

/** The one provider whose model size and prices the settings file can set. */
export const MODEL_SETTINGS_PROVIDER = "openai"

/** Prices in USD per million tokens, named as in the extension's ModelInfo. */
export const MODEL_PRICE_KEYS = ["inputPrice", "outputPrice", "cacheReadsPrice", "cacheWritesPrice"] as const

/** The on/off settings of a model, each true or false. */
const MODEL_SWITCH_KEYS = ["preserveReasoning", "trimOldReasoning", "hideMcp"] as const

/** The keys every provider takes, so they never count as ignored. */
const ANY_PROVIDER_KEYS: ReadonlySet<string> = new Set([
	"reasoningEffort",
	"modelSize",
	"hideMcp",
	"provider",
	"baseUrl",
	"apiKey",
	"apiKeyEnv",
	"modes",
])

/** The connection fields of a model, each a non-empty string when set. */
const MODEL_CONNECTION_KEYS = ["provider", "baseUrl", "apiKey", "apiKeyEnv"] as const

export function getConfiguredModelSettings(
	models: Record<string, CliModelSettings> | undefined,
	model: string,
): CliModelSettings | undefined {
	return models?.[model]
}

/**
 * The keys an entry sets that only the openai provider takes, for the warning
 * that names what is ignored with another provider. `reasoningEffort`,
 * `modelSize`, `hideMcp`, the connection fields and `modes` are not among
 * them: every provider takes them.
 */
export function listSetModelSettings(entry: CliModelSettings | undefined): string[] {
	return Object.entries(entry ?? {})
		.filter(([key, value]) => value !== undefined && !ANY_PROVIDER_KEYS.has(key))
		.map(([key]) => key)
}

/** One message per malformed part of the `models` map, for a startup error. */
export function findModelSettingsProblems(models: unknown): string[] {
	if (models === undefined) {
		return []
	}

	if (!isPlainObject(models)) {
		return ['models must be an object keyed by model id, e.g. { "GLM-5.3-NVFP4": { "contextWindow": 262144 } }']
	}

	const problems: string[] = []

	for (const [model, entry] of Object.entries(models)) {
		if (!isPlainObject(entry)) {
			problems.push(`models.${model} must be an object, e.g. { "contextWindow": 262144 }`)
			continue
		}

		const { contextWindow, reasoningEffort, modelSize } = entry as CliModelSettings

		if (contextWindow !== undefined && !(Number.isInteger(contextWindow) && contextWindow > 0)) {
			problems.push(
				`models.${model}.contextWindow must be a whole number of tokens greater than 0, got ${JSON.stringify(contextWindow)}`,
			)
		}

		for (const key of MODEL_SWITCH_KEYS) {
			const value = entry[key]

			if (value !== undefined && typeof value !== "boolean") {
				problems.push(`models.${model}.${key} must be true or false, got ${JSON.stringify(value)}`)
			}
		}

		if (reasoningEffort !== undefined && !REASONING_EFFORTS.includes(reasoningEffort)) {
			problems.push(
				`models.${model}.reasoningEffort must be one of: ${REASONING_EFFORTS.join(", ")}, got ${JSON.stringify(reasoningEffort)}`,
			)
		}

		if (modelSize !== undefined && !MODEL_SIZES.includes(modelSize)) {
			problems.push(
				`models.${model}.modelSize must be one of: ${MODEL_SIZES.join(", ")}, got ${JSON.stringify(modelSize)}`,
			)
		}

		for (const key of MODEL_CONNECTION_KEYS) {
			const value = entry[key]

			if (value !== undefined && !(typeof value === "string" && value.trim() !== "")) {
				problems.push(`models.${model}.${key} must be a non-empty string, got ${JSON.stringify(value)}`)
			}
		}

		if (entry.modes !== undefined && !isModeSlugList(entry.modes)) {
			problems.push(
				`models.${model}.modes must be a list of mode slugs, e.g. ["code", "debug"], got ${JSON.stringify(entry.modes)}`,
			)
		}

		for (const key of MODEL_PRICE_KEYS) {
			const price = entry[key]

			if (price !== undefined && !(typeof price === "number" && Number.isFinite(price) && price >= 0)) {
				problems.push(
					`models.${model}.${key} must be a number of USD per million tokens, 0 or more, got ${JSON.stringify(price)}`,
				)
			}
		}
	}

	return problems
}

/** One mode's entry as the run uses it, and where in the file its parts were written. */
export interface EffectiveModeSettings {
	settings: CliModeSettings
	/** `modes.<slug>`, `models.<id>.modes` or both, for the messages that name the entry. */
	label: string
}

/**
 * The per-mode entries the file describes: every `modes` entry as written,
 * plus the model of each mode a `models.<id>.modes` list names, added to the
 * mode's entry or making one. A mode listed there therefore behaves exactly
 * as if `modes.<slug>.model` named the model. Where the file contradicts
 * itself (findModeBindingProblems stops the run then) the `modes` entry and
 * the first list win, so this never throws on a malformed file.
 */
export function getEffectiveModeSettings(settings: CliSettings): Record<string, EffectiveModeSettings> {
	const entries: Record<string, EffectiveModeSettings> = {}

	for (const [slug, written] of Object.entries(settings.modes ?? {})) {
		entries[slug] = { settings: written, label: `modes.${slug}` }
	}

	for (const [slug, model] of Object.entries(listModelBindings(settings.models))) {
		const label = `models.${model}.modes`
		const existing = entries[slug]

		if (!existing) {
			entries[slug] = { settings: { model }, label }
		} else {
			entries[slug] = {
				settings: { ...existing.settings, model: existing.settings.model ?? model },
				label: `${existing.label} and ${label}`,
			}
		}
	}

	return entries
}

/**
 * One message per mode the file gives two different models: listed in the
 * `modes` of two models, or listed in one while `modes.<slug>.model` names
 * another. The same model in both places is fine.
 */
export function findModeBindingProblems(settings: CliSettings): string[] {
	const problems: string[] = []
	const listedBy: Record<string, string> = {}

	for (const [model, slug] of modelModePairs(settings.models)) {
		const first = listedBy[slug]

		if (first === undefined) {
			listedBy[slug] = model
		} else if (first !== model) {
			problems.push(
				`mode "${slug}" is listed in both models.${first}.modes and models.${model}.modes; a mode runs one model, so keep it in one list`,
			)
		}

		const written = settings.modes?.[slug]?.model
		if (written !== undefined && written !== model) {
			problems.push(
				`models.${model}.modes lists "${slug}", but modes.${slug}.model names ${written}; keep one of them`,
			)
		}
	}

	return problems
}

/** Mode slug -> the model whose `modes` lists it first. */
function listModelBindings(models: unknown): Record<string, string> {
	const bindings: Record<string, string> = {}
	for (const [model, slug] of modelModePairs(models)) {
		bindings[slug] ??= model
	}
	return bindings
}

/** Every [model id, mode slug] pair of the well-formed `modes` lists, in file order, a slug repeated in one list once. */
function modelModePairs(models: unknown): [model: string, slug: string][] {
	if (!isPlainObject(models)) {
		return []
	}

	return Object.entries(models).flatMap(([model, entry]) =>
		isPlainObject(entry) && isModeSlugList(entry.modes)
			? [...new Set(entry.modes)].map((slug): [string, string] => [model, slug])
			: [],
	)
}

function isModeSlugList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((slug) => typeof slug === "string" && slug.trim() !== "")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
