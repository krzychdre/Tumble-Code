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
import type { KnownProviderId } from "@roo-code/types"

/**
 * Per-provider model/base-url settings fields (what the CLI reads). Aligned
 * with the CLI's `getModelField()`/`getBaseUrlField()` provider map — the
 * authoritative source for which settings key holds the model/base URL.
 * Providers without an entry have no model/baseUrl mirrored at all (their
 * schema either has no such field or is not wired to the CLI).
 */
const providerFieldMap: Partial<
	Record<KnownProviderId, { modelField?: keyof ProviderSettings; baseUrlField?: keyof ProviderSettings }>
> = {
	anthropic: { modelField: "apiModelId", baseUrlField: "anthropicBaseUrl" },
	openrouter: { modelField: "openRouterModelId", baseUrlField: "openRouterBaseUrl" },
	bedrock: { modelField: "apiModelId", baseUrlField: "awsBedrockEndpoint" },
	vertex: { modelField: "apiModelId" },
	// "openai" (OpenAI Compatible) uses openAiModelId/openAiBaseUrl — NOT
	// apiModelId (which the ownership list also carries for migration).
	openai: { modelField: "openAiModelId", baseUrlField: "openAiBaseUrl" },
	ollama: { modelField: "ollamaModelId", baseUrlField: "ollamaBaseUrl" },
	"vscode-lm": {},
	lmstudio: { modelField: "lmStudioModelId", baseUrlField: "lmStudioBaseUrl" },
	gemini: { modelField: "apiModelId", baseUrlField: "googleGeminiBaseUrl" },
	"gemini-cli": { modelField: "apiModelId" },
	"openai-codex": { modelField: "apiModelId" },
	"openai-native": { modelField: "apiModelId", baseUrlField: "openAiNativeBaseUrl" },
	mistral: { modelField: "apiModelId", baseUrlField: "mistralCodestralUrl" },
	deepseek: { modelField: "apiModelId", baseUrlField: "deepSeekBaseUrl" },
	poe: { modelField: "apiModelId", baseUrlField: "poeBaseUrl" },
	moonshot: { modelField: "apiModelId", baseUrlField: "moonshotBaseUrl" },
	minimax: { modelField: "apiModelId", baseUrlField: "minimaxBaseUrl" },
	requesty: { modelField: "requestyModelId", baseUrlField: "requestyBaseUrl" },
	unbound: { modelField: "unboundModelId" },
	"fake-ai": {},
	xai: { modelField: "apiModelId" },
	baseten: { modelField: "apiModelId" },
	litellm: { modelField: "litellmModelId", baseUrlField: "litellmBaseUrl" },
	sambanova: { modelField: "apiModelId" },
	zai: { modelField: "apiModelId" },
	fireworks: { modelField: "apiModelId" },
	"qwen-code": { modelField: "apiModelId" },
	"vercel-ai-gateway": { modelField: "vercelAiGatewayModelId" },
}

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

	// Model/base-url are read from the ACTIVE PROVIDER'S OWN field
	// (openRouterModelId for openrouter, openAiModelId for openai,
	// apiModelId for most). Never fall back to "the first present key": a
	// stale model from another provider (e.g. a leftover openRouterModelId
	// "anthropic/claude-opus-4.6" while apiProvider=openai) must not be
	// mirrored — it would clobber the CLI's model.
	const fields = providerFieldMap[apiConfiguration.apiProvider as KnownProviderId]
	const modelField = fields?.modelField
	const modelValue = modelField ? apiConfiguration[modelField] : undefined
	if (typeof modelValue === "string" && modelValue) {
		settings.model = modelValue
	}

	// Base URL: the active provider's base-url field when the schema has one.
	const baseUrlField = fields?.baseUrlField
	const baseUrlValue = baseUrlField ? apiConfiguration[baseUrlField] : undefined
	if (typeof baseUrlValue === "string" && baseUrlValue) {
		settings.baseUrl = baseUrlValue
	}

	return settings
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
