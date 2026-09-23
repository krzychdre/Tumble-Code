/**
 * Per-model settings from cli-settings.json: `models`, keyed by model id.
 *
 * So far only the context window. The openai provider (any OpenAI-compatible
 * server) has no model list with sizes, since its model source returns ids
 * only, so without an entry here the extension sizes every such model with
 * openAiModelInfoSaneDefaults (128,000 tokens) and condenses the conversation
 * against that. toProviderSettings hands the configured size to the extension
 * as openAiCustomModelInfo. Other providers size their models from their own
 * tables and have no field that could take it.
 */

import type { CliModelSettings } from "@/types/types.js"

/** The one provider whose model size the settings file can set. */
export const CONTEXT_WINDOW_PROVIDER = "openai"

export function getConfiguredContextWindow(
	models: Record<string, CliModelSettings> | undefined,
	model: string,
): number | undefined {
	return models?.[model]?.contextWindow
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

		const { contextWindow } = entry as CliModelSettings

		if (contextWindow !== undefined && !(Number.isInteger(contextWindow) && contextWindow > 0)) {
			problems.push(
				`models.${model}.contextWindow must be a whole number of tokens greater than 0, got ${JSON.stringify(contextWindow)}`,
			)
		}
	}

	return problems
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
