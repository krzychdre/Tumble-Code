/**
 * The code index of a run: the `codeIndex` entry of cli-settings.json over the
 * `vscode` section's codebaseIndexConfig and codeIndexSecrets, field by field.
 * The extension takes it as the message the VS Code code index settings send
 * (saveCodeIndexSettingsAtomic): it saves it and starts or stops indexing.
 */

import {
	CODEBASE_INDEX_DEFAULTS,
	CODEBASE_INDEX_EMBEDDER_SECRET_KEYS,
	type CodebaseIndexEmbedderProvider,
	type WebviewMessage,
} from "@tumble-code/types"

import type { CliCodeIndexSettings, CliSettings } from "@/types/types.js"

import { definedOnly } from "./vscode-profiles.js"

export type CodeIndexSettings = NonNullable<WebviewMessage["codeIndexSettings"]>

const EMBEDDERS = Object.keys(CODEBASE_INDEX_EMBEDDER_SECRET_KEYS) as CodebaseIndexEmbedderProvider[]

/** The config field of the embedders whose server the entry's `baseUrl` names. */
const BASE_URL_FIELDS: Partial<Record<CodebaseIndexEmbedderProvider, keyof CodeIndexSettings>> = {
	"openai-compatible": "codebaseIndexOpenAiCompatibleBaseUrl",
	ollama: "codebaseIndexEmbedderBaseUrl",
}

/**
 * The settings to send, and a warning for each key environment variable that
 * is unset. Without any source the index is off; an entry of its own turns it
 * on unless it says `"enabled": false`.
 */
export function resolveCodeIndexSettings(
	settings: CliSettings,
	env: NodeJS.ProcessEnv = process.env,
): { codeIndexSettings: CodeIndexSettings; warnings: string[] } {
	const own: CliCodeIndexSettings = settings.codeIndex ?? {}
	const fromVscode = { ...settings.vscode?.settings?.codebaseIndexConfig, ...settings.vscode?.codeIndexSecrets }
	const embedder = own.embedder ?? fromVscode.codebaseIndexEmbedderProvider ?? "openai"
	const warnings: string[] = []
	const key = (value: string | undefined, envName: string | undefined, field: string) => {
		if (value !== undefined || envName === undefined) {
			return value
		}
		if (!env[envName]) {
			warnings.push(`codeIndex.${field} names ${envName}, which is not set`)
		}
		return env[envName] || undefined
	}
	const baseUrlField = BASE_URL_FIELDS[embedder]
	const keyField = CODEBASE_INDEX_EMBEDDER_SECRET_KEYS[embedder]
	const codeIndexSettings: CodeIndexSettings = {
		...fromVscode,
		...definedOnly({
			codeIndexQdrantApiKey: key(own.qdrantApiKey, own.qdrantApiKeyEnv, "qdrantApiKeyEnv"),
			codebaseIndexEmbedderModelDimension: own.dimension,
			codebaseIndexSearchMinScore: own.searchMinScore,
			codebaseIndexSearchMaxResults: own.searchMaxResults,
			...(baseUrlField ? { [baseUrlField]: own.baseUrl } : {}),
			...(keyField ? { [keyField]: key(own.apiKey, own.apiKeyEnv, "apiKeyEnv") } : {}),
		}),
		codebaseIndexEnabled: own.enabled ?? fromVscode.codebaseIndexEnabled ?? settings.codeIndex !== undefined,
		codebaseIndexEmbedderProvider: embedder,
		codebaseIndexQdrantUrl: own.qdrantUrl ?? fromVscode.codebaseIndexQdrantUrl ?? "",
		codebaseIndexEmbedderModelId: own.model ?? fromVscode.codebaseIndexEmbedderModelId ?? "",
	}
	return { codeIndexSettings, warnings }
}

/** One message per malformed key of the `codeIndex` entry, for a startup error. */
export function findCodeIndexProblems(codeIndex: unknown): string[] {
	if (codeIndex === undefined) {
		return []
	}
	if (typeof codeIndex !== "object" || codeIndex === null || Array.isArray(codeIndex)) {
		return ['codeIndex must be an object, e.g. { "qdrantUrl": "http://localhost:6333", "embedder": "ollama" }']
	}
	const entry = codeIndex as Record<string, unknown>
	const problems: string[] = []
	const check = (field: string, valid: (value: unknown) => boolean, expected: string) => {
		if (entry[field] !== undefined && !valid(entry[field])) {
			problems.push(`codeIndex.${field} must be ${expected}, got ${JSON.stringify(entry[field])}`)
		}
	}
	const text = (value: unknown) => typeof value === "string" && value.trim() !== ""
	const { MIN_SEARCH_RESULTS, MAX_SEARCH_RESULTS } = CODEBASE_INDEX_DEFAULTS
	check("enabled", (value) => typeof value === "boolean", "true or false")
	check(
		"embedder",
		(value) => EMBEDDERS.includes(value as CodebaseIndexEmbedderProvider),
		`one of: ${EMBEDDERS.join(", ")}`,
	)
	for (const field of ["qdrantUrl", "qdrantApiKey", "qdrantApiKeyEnv", "baseUrl", "model", "apiKey", "apiKeyEnv"]) {
		check(field, text, "a non-empty string")
	}
	check("dimension", (value) => Number.isInteger(value) && (value as number) > 0, "a whole number greater than 0")
	check("searchMinScore", (value) => typeof value === "number" && value >= 0 && value <= 1, "a number from 0 to 1")
	check(
		"searchMaxResults",
		(value) =>
			Number.isInteger(value) &&
			(value as number) >= MIN_SEARCH_RESULTS &&
			(value as number) <= MAX_SEARCH_RESULTS,
		`a whole number from ${MIN_SEARCH_RESULTS} to ${MAX_SEARCH_RESULTS}`,
	)
	return problems
}
