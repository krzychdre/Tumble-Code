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
 * extension's openAiPreserveReasoning.
 *
 * `reasoningEffort` too, and unlike the others it works with every provider:
 * the levels a model accepts are its own, so one level for all models sent
 * "max" to models that reject it.
 */

import type { CliModelSettings } from "@/types/types.js"
import { REASONING_EFFORTS } from "@/types/constants.js"

/** The one provider whose model size and prices the settings file can set. */
export const MODEL_SETTINGS_PROVIDER = "openai"

/** Prices in USD per million tokens, named as in the extension's ModelInfo. */
export const MODEL_PRICE_KEYS = ["inputPrice", "outputPrice", "cacheReadsPrice", "cacheWritesPrice"] as const

export function getConfiguredModelSettings(
	models: Record<string, CliModelSettings> | undefined,
	model: string,
): CliModelSettings | undefined {
	return models?.[model]
}

/**
 * The keys an entry sets that only the openai provider takes, for the warning
 * that names what is ignored with another provider. `reasoningEffort` is not
 * one of them: every provider takes it.
 */
export function listSetModelSettings(entry: CliModelSettings | undefined): string[] {
	return Object.entries(entry ?? {})
		.filter(([key, value]) => value !== undefined && key !== "reasoningEffort")
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

		const { contextWindow, preserveReasoning, reasoningEffort } = entry as CliModelSettings

		if (contextWindow !== undefined && !(Number.isInteger(contextWindow) && contextWindow > 0)) {
			problems.push(
				`models.${model}.contextWindow must be a whole number of tokens greater than 0, got ${JSON.stringify(contextWindow)}`,
			)
		}

		if (preserveReasoning !== undefined && typeof preserveReasoning !== "boolean") {
			problems.push(
				`models.${model}.preserveReasoning must be true or false, got ${JSON.stringify(preserveReasoning)}`,
			)
		}

		if (reasoningEffort !== undefined && !REASONING_EFFORTS.includes(reasoningEffort)) {
			problems.push(
				`models.${model}.reasoningEffort must be one of: ${REASONING_EFFORTS.join(", ")}, got ${JSON.stringify(reasoningEffort)}`,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
