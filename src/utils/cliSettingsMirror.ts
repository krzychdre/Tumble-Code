/**
 * Mirror the extension's active API configuration into the CLI settings file
 * (`~/.roo/cli-settings.json`), so bare `tumble` runs can read provider/model/
 * baseUrl chosen in the app without any flags.
 *
 * Shared contract: the CLI reads this same file at startup
 * (apps/cli/src/lib/storage/settings.ts, loadSettings) and merges it under
 *  flags > cli-settings.json > mock VS Code config > defaults.
 *
 * Rules (must stay in sync with the CLI's storage semantics):
 * - NEVER write API keys — keys stay in the VS Code secret storage.
 * - Merge, never overwrite: unrelated keys in the file are preserved.
 * - Omit keys whose value is null/undefined (the CLI null-strips on save).
 * - Best-effort only: a failure here must never break settings persistence or
 *   extension startup.
 */

import fs from "fs/promises"
import os from "os"
import path from "path"

import type { ProviderSettings } from "@roo-code/types"

/** Same shape the CLI's saveSettings produces/provider union. */
export interface CliSettingsMirror {
	provider?: string
	model?: string
	baseUrl?: string
}

/** Where the CLI stores its settings (~/.roo/cli-settings.json). */
export function getCliSettingsPath(): string {
	return path.join(os.homedir(), ".roo", "cli-settings.json")
}

/** Test-only override of the settings file location. */
export function setCliSettingsPathOverride(override: string | undefined): void {
	cliSettingsPathOverride = override
}

let cliSettingsPathOverride: string | undefined

/** The CLI's provider id — a provider alias ("tumble") stays raw, matching
 * what the CLI accepts (isAcceptedProvider handles the alias). */
function toCliProviderId(apiProvider: ProviderSettings["apiProvider"]): string | undefined {
	return apiProvider ?? undefined
}

/**
 * Map the extension's ProviderSettings to the CLI settings-file shape, omitting
 * anything null/undefined and never touching key fields.
 */
export function buildCliSettingsFromApiConfiguration(apiConfiguration: ProviderSettings): CliSettingsMirror {
	const settings: CliSettingsMirror = {}

	const provider = toCliProviderId(apiConfiguration.apiProvider)
	if (provider) {
		settings.provider = provider
	}

	// Model: the extension's provider-specific model field (openRouterModelId,
	// openAiModelId, apiModelId, ...). `getModelId` reads the first present key.
	const modelField = getModelIdField(apiConfiguration)
	if (modelField && apiConfiguration[modelField]) {
		settings.model = apiConfiguration[modelField]
	}

	// Base URL: the provider's base-url field when the schema has one
	// (openRouterBaseUrl, openAiBaseUrl, anthropicBaseUrl, ...).
	const baseUrlField = getBaseUrlField(apiConfiguration.apiProvider)
	const baseUrlValue = baseUrlField ? apiConfiguration[baseUrlField] : undefined
	if (typeof baseUrlValue === "string" && baseUrlValue) {
		settings.baseUrl = baseUrlValue
	}

	return settings
}

const MODEL_ID_FIELDS = [
	"openRouterModelId",
	"openAiModelId",
	"apiModelId",
	"ollamaModelId",
	"lmStudioModelId",
	"requestyModelId",
	"unboundModelId",
	"litellmModelId",
	"vercelAiGatewayModelId",
] as const satisfies readonly (keyof ProviderSettings)[]

function getModelIdField(settings: ProviderSettings): (typeof MODEL_ID_FIELDS)[number] | undefined {
	return MODEL_ID_FIELDS.find((key) => settings[key])
}

const BASE_URL_FIELDS: Partial<Record<NonNullable<ProviderSettings["apiProvider"]>, keyof ProviderSettings>> = {
	anthropic: "anthropicBaseUrl",
	openrouter: "openRouterBaseUrl",
	openai: "openAiBaseUrl",
	"openai-native": "openAiNativeBaseUrl",
	ollama: "ollamaBaseUrl",
	lmstudio: "lmStudioBaseUrl",
	gemini: "googleGeminiBaseUrl",
	deepseek: "deepSeekBaseUrl",
	poe: "poeBaseUrl",
	moonshot: "moonshotBaseUrl",
	minimax: "minimaxBaseUrl",
	requesty: "requestyBaseUrl",
	mistral: "mistralCodestralUrl",
}

function getBaseUrlField(provider: ProviderSettings["apiProvider"]): keyof ProviderSettings | undefined {
	return provider ? BASE_URL_FIELDS[provider] : undefined
}

/**
 * Best-effort mirror write: read the existing file (if any), merge the mapped
 * settings, and write it back with a fresh mtime. Never throws — callers (the
 * extension save/activation paths) may fire-and-forget it.
 */
export async function writeCliSettingsMirror(apiConfiguration: ProviderSettings): Promise<void> {
	// Never touch the real ~/.roo when running the test suite — the spec tests
	// that exercise ClineProvider's save/activate paths would otherwise write
	// into the user's home directory (same guard pattern as McpHub/SkillsManager).
	if (process.env.NODE_ENV === "test" && !cliSettingsPathOverride) {
		return
	}

	try {
		const settingsPath = cliSettingsPathOverride ?? getCliSettingsPath()
		const patch = buildCliSettingsFromApiConfiguration(apiConfiguration)

		let existing: Record<string, unknown> = {}
		try {
			const raw = await fs.readFile(settingsPath, "utf-8")
			const parsed: unknown = JSON.parse(raw)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				existing = parsed as Record<string, unknown>
			}
		} catch {
			// No file yet (or unparseable) — start fresh.
		}

		await fs.mkdir(path.dirname(settingsPath), { recursive: true })
		await fs.writeFile(settingsPath, JSON.stringify({ ...existing, ...patch }, null, 2), {
			mode: 0o600,
		})
	} catch {
		// Best-effort only — a CLI-settings mirror failure must never break
		// extension startup or settings persistence.
	}
}
