/**
 * Read the extension's persisted provider configuration from VS Code so the
 * CLI can reuse it (keys and provider/model config chosen in the extension).
 *
 * The CLI runs the extension bundle in-process through @roo-code/vscode-shim,
 * which persists extension state in `~/.vscode-mock/global-storage/`:
 *  - `secrets.json` — FileSecretStorage. Holds the provider-profiles envelope
 *    under `roo_cline_config_api_config` (v2: { schemaVersion, data } with
 *    { currentApiConfigName, apiConfigs }) plus secrets, and legacy flat keys
 *    directly (e.g. "openRouterApiKey").
 *  - `global-state.json` — legacy flat global settings (apiProvider,
 *    openRouterModelId, ...).
 *
 * Our current config layout (verified by inspecting an existing install):
 *  - secrets.json:  { "openRouterApiKey": "123" } (legacy flat)
 *  - global-state.json: { "apiProvider": "openrouter", "openRouterModelId": ... }
 */

import fs from "fs"
import os from "os"
import path from "path"

import { classifyProvider } from "@roo-code/types"

import {
	getApiKeyField,
	getBaseUrlField,
	getModelField,
	supportedProviders,
	type SupportedProvider,
} from "./provider-types.js"

/**
 * Where the vscode-shim persists extension state. The `storageDir` passed to
 * createVSCodeAPI defaults to this location when not ephemeral.
 */
export function getShimGlobalStorageDir(): string {
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
	return path.join(home, ".vscode-mock", "global-storage")
}

export interface VsCodeProviderConfig {
	provider?: SupportedProvider
	model?: string
	apiKey?: string
	baseUrl?: string
}

export const VSCODE_CONFIG_SECRETS_FILE = "secrets.json"
export const VSCODE_CONFIG_GLOBAL_STATE_FILE = "global-state.json"

/** The ProviderSettingsManager secret-store key for the provider profiles. */
export const PROVIDER_PROFILES_SECRETS_KEY = "roo_cline_config_api_config"

function readJson(file: string): Record<string, unknown> | undefined {
	try {
		const content = fs.readFileSync(file, "utf-8")
		const parsed: unknown = JSON.parse(content)
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined
	} catch {
		return undefined
	}
}

/**
 * Read the provider config persisted by the extension (via the vscode-shim).
 * Returns undefined when no config exists.
 */
export function readVsCodeConfig(): VsCodeProviderConfig | undefined {
	const storageDir = getShimGlobalStorageDir()
	const secrets = readJson(path.join(storageDir, VSCODE_CONFIG_SECRETS_FILE))
	const globalState = readJson(path.join(storageDir, VSCODE_CONFIG_GLOBAL_STATE_FILE))

	if (!secrets && !globalState) {
		return undefined
	}

	const config: VsCodeProviderConfig = {}

	// 1. Provider id — v2 envelope first, then the legacy flat globalState key.
	let provider = readEnvelopeProvider(secrets)
	if (!provider && globalState && typeof globalState.apiProvider === "string") {
		provider = globalState.apiProvider
	}
	if (provider && isSupportedConfigProvider(provider)) {
		config.provider = provider as SupportedProvider
	} else {
		// No supported provider persisted in VS Code — nothing to reuse.
		return undefined
	}

	const providerId = config.provider

	const profileConfig = readEnvelopeProfile(secrets)
	const modelField = getModelField(providerId)
	config.model =
		typeof profileConfig?.[modelField] === "string"
			? (profileConfig[modelField] as string)
			: typeof globalState?.[modelField] === "string"
				? (globalState[modelField] as string)
				: undefined

	// 3. Base URL (profile config only; the schema may not have one).
	const baseUrlField = getBaseUrlField(providerId)
	if (baseUrlField && typeof profileConfig?.[baseUrlField] === "string") {
		config.baseUrl = profileConfig[baseUrlField] as string
	}

	// 4. API key — secret-store key (v2 profile secrets first, legacy flat
	// fallback), the v1-style per-key direct value, or the flat secrets key.
	const apiKeyField = getApiKeyField(providerId)
	if (apiKeyField) {
		config.apiKey = readSecret(secrets, apiKeyField) ?? readEnvelopeSecret(secrets)
	}

	return config
}

/** The provider id from a v2 envelope (or its legacy flat apiConfigs). */
function readEnvelopeProvider(secrets: Record<string, unknown> | undefined): string | undefined {
	const envelope = secrets?.[PROVIDER_PROFILES_SECRETS_KEY]
	if (typeof envelope !== "string" || !envelope) return undefined

	try {
		const parsed: unknown = JSON.parse(envelope)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined

		const data = (parsed as { data?: unknown }).data
		if (!data || typeof data !== "object" || Array.isArray(data)) return undefined

		const profiles = data as {
			currentApiConfigName?: string
			apiConfigs?: Record<string, { provider?: { providerId?: string } }>
		}

		const current = profiles.currentApiConfigName
		const apiConfigs = profiles.apiConfigs ?? {}
		const currentConfig = current ? apiConfigs[current] : undefined

		// v2 known profile shape: { provider: { providerId, config } }
		if (currentConfig?.provider?.providerId) {
			return currentConfig.provider.providerId
		}

		// v1 legacy flat shape: { apiProvider, ... }
		if (currentConfig && "apiProvider" in currentConfig) {
			return (currentConfig as { apiProvider?: string }).apiProvider
		}

		// Fall back to the first profile.
		const first = Object.values(apiConfigs)[0]
		if (first?.provider?.providerId) return first.provider.providerId
	} catch {
		// fall through
	}

	return undefined
}

/** The active profile's provider config (v2) — {} when absent. */
function readEnvelopeProfile(secrets: Record<string, unknown> | undefined): Record<string, unknown> {
	const envelope = secrets?.[PROVIDER_PROFILES_SECRETS_KEY]
	if (typeof envelope !== "string" || !envelope) return {}

	try {
		const parsed: unknown = JSON.parse(envelope)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

		const data = (parsed as { data?: { currentApiConfigName?: string; apiConfigs?: Record<string, unknown> } }).data
		if (!data || typeof data !== "object" || Array.isArray(data)) return {}

		const current = data.currentApiConfigName
		const apiConfigs = data.apiConfigs ?? {}
		const currentConfig = current ? (apiConfigs[current] as Record<string, unknown> | undefined) : undefined
		if (currentConfig?.provider && typeof currentConfig.provider === "object") {
			const provider = currentConfig.provider as { config?: Record<string, unknown> }
			return provider.config ?? {}
		}
		if (currentConfig && "apiProvider" in currentConfig) return currentConfig
	} catch {
		// fall through
	}

	return {}
}

/** Secret value scoped to the active profile id (v2), from
 *  `roo_cline_config_provider_profile_secrets_v2`. */
function readEnvelopeSecret(secrets: Record<string, unknown> | undefined): string | undefined {
	const envelope = secrets?.[PROVIDER_PROFILES_SECRETS_KEY]
	if (typeof envelope !== "string" || !envelope) return undefined

	try {
		const parsed: unknown = JSON.parse(envelope)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
		const data = (parsed as { data?: { currentApiConfigName?: string; apiConfigs?: Record<string, unknown> } }).data
		if (!data || typeof data !== "object") return undefined

		const current = data.currentApiConfigName
		const currentConfig = current ? (data.apiConfigs?.[current] as { id?: string } | undefined) : undefined
		const profileId = currentConfig?.id
		if (!profileId) return undefined

		// v2 secrets shape: { apiKey, openRouterApiKey, ... } per profile id,
		// stored under `roo_cline_config_provider_profile_secrets_v2`.
		const secretStoreKey = "roo_cline_config_provider_profile_secrets_v2"
		const envelopeValue = secrets[secretStoreKey]
		if (typeof envelopeValue !== "string") return undefined
		const secretMap = JSON.parse(envelopeValue) as Record<string, Record<string, unknown>>
		const profileSecrets = secretMap[profileId] ?? {}
		return Object.values(profileSecrets).find((v): v is string => typeof v === "string")
	} catch {
		return undefined
	}
}

/** Read a secret by its provider key field (v1 legacy flat or v2 profile). */
function readSecret(secrets: Record<string, unknown> | undefined, keyField: string): string | undefined {
	if (!secrets) return undefined
	const direct = secrets[keyField]
	if (typeof direct === "string") return direct
	return undefined
}

function isSupportedConfigProvider(id: string): id is SupportedProvider {
	return (supportedProviders as readonly string[]).includes(id) && classifyProvider(id) !== "retired"
}

/** Resolve the CLI provider config from the extension's persisted state. */
export function resolveVsCodeProviderConfig(): VsCodeProviderConfig | undefined {
	return readVsCodeConfig()
}
