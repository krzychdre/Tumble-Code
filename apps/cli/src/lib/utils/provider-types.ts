/**
 * Provider tables for the CLI.
 *
 * All provider IDs come from the shared @roo-code/types registry; the CLI never
 * hand-maintains its own provider allowlist. From the shared tables come:
 *  - the API-key settings field (`providerApiKeyFields`),
 *  - whether a run needs the key (`providerRequiresApiKey`, the rule the
 *    settings UI validates profiles with),
 *  - the model-id settings field (`providerModelDefinitions`).
 *
 * Only CLI data is written here: the conventional env-var names and the
 * base-url field the `--base-url` flag writes.
 *
 * Persisted aliases:
 *  - "tumble" — the cloud provider id shipped by BR-09 (rebrand). The CLI has
 *    no cloud handler, so it maps to the openrouter provider settings.
 */

import {
	activeProviderIds,
	getProviderApiKeyField,
	providerModelDefinitions,
	providerRequiresApiKey as sharedProviderRequiresApiKey,
	providerRequiresModelId as sharedProviderRequiresModelId,
} from "@roo-code/types"

/**
 * The providers excluded from the CLI, with the reason for each exclusion.
 *
 * - "vscode-lm": requires the real VS Code LM API (vscode.lm.selectChatModels).
 *   The CLI's @roo-code/vscode-shim mock exports no `lm` property, so the
 *   handler would throw at runtime.
 * - "fake-ai": hidden internal test provider, not an inference provider.
 * - "gemini-cli": hidden lifecycle without a runtime handler
 *   (providerIdsWithoutRuntimeHandler in src/api/runtime-provider-registry.ts);
 *   the extension falls back to the Anthropic handler, which is misleading.
 */
export const excludedProviderIds = ["vscode-lm", "fake-ai", "gemini-cli"] as const satisfies readonly string[]

export type ExcludedProviderId = (typeof excludedProviderIds)[number]

/**
 * Provider ids accepted from persisted CLI settings / VS Code config (or the
 * `--provider` flag) that do not exist in the shared registry. Each maps to the
 * real provider whose settings are used at runtime.
 */
export const providerIdAliases: Record<string, SupportedProvider> = {
	tumble: "openrouter",
}

/**
 * Resolve a user-facing provider id to the supported provider used for
 * settings/env/key resolution. Unknown ids pass through unchanged so the caller
 * can reject them with the normal "invalid provider" message.
 */
export function resolveProviderIdAlias(provider: string): string {
	return providerIdAliases[provider] ?? provider
}

/** True when the id is a supported provider OR a known persisted alias. */
export function isAcceptedProvider(provider: string): boolean {
	return isSupportedProvider(provider) || provider in providerIdAliases
}

/**
 * The CLI-supported provider list, derived from the shared registry:
 * every active (and hidden) provider id minus the excluded ids above.
 */
export const supportedProviders = activeProviderIds.filter(
	(id): id is Exclude<(typeof activeProviderIds)[number], ExcludedProviderId> =>
		!(excludedProviderIds as readonly string[]).includes(id),
)

export type SupportedProvider = (typeof supportedProviders)[number]

export function isSupportedProvider(provider: string): provider is SupportedProvider {
	return (supportedProviders as readonly string[]).includes(provider)
}

/**
 * Per-provider CLI data: env vars and the base-url field.
 *
 * `keyEnvVar` is the conventional env var holding the API key; it is null
 * exactly when the provider has no API-key field in the shared table.
 *
 * `baseUrlField` is set only where the schema has a base-url field.
 * The API-key and model-id fields are not listed here: they come from the
 * shared tables (`getApiKeyField`, `getModelField`).
 */
export interface ProviderEnvMapping {
	readonly keyEnvVar: string | null
	readonly baseUrlField?: string
	readonly baseUrlEnvVar?: string
}

export const providerEnvMap: Record<SupportedProvider, ProviderEnvMapping> = {
	anthropic: {
		keyEnvVar: "ANTHROPIC_API_KEY",
		baseUrlField: "anthropicBaseUrl",
		baseUrlEnvVar: "ANTHROPIC_BASE_URL",
	},
	"openai-native": {
		keyEnvVar: "OPENAI_API_KEY",
		baseUrlField: "openAiNativeBaseUrl",
		baseUrlEnvVar: "OPENAI_BASE_URL",
	},
	"openai-codex": {
		// OpenAI Codex uses ChatGPT subscription OAuth credentials persisted by
		// `tumble auth codex login`; the extension's OAuth manager resolves and
		// refreshes them from the CLI shim's SecretStorage at runtime.
		keyEnvVar: null,
	},
	gemini: {
		keyEnvVar: "GOOGLE_API_KEY",
		baseUrlField: "googleGeminiBaseUrl",
		baseUrlEnvVar: "GOOGLE_GEMINI_BASE_URL",
	},
	openrouter: {
		keyEnvVar: "OPENROUTER_API_KEY",
		baseUrlField: "openRouterBaseUrl",
		baseUrlEnvVar: "OPENROUTER_BASE_URL",
	},
	litellm: {
		keyEnvVar: "LITELLM_API_KEY",
		baseUrlField: "litellmBaseUrl",
		baseUrlEnvVar: "LITELLM_BASE_URL",
	},
	deepseek: {
		keyEnvVar: "DEEPSEEK_API_KEY",
		baseUrlField: "deepSeekBaseUrl",
		baseUrlEnvVar: "DEEPSEEK_BASE_URL",
	},
	ollama: {
		// Ollama runs without a key on localhost; a remote or cloud Ollama
		// takes an optional one (the handler sends it as a bearer token).
		keyEnvVar: "OLLAMA_API_KEY",
		baseUrlField: "ollamaBaseUrl",
		baseUrlEnvVar: "OLLAMA_BASE_URL",
	},
	lmstudio: {
		// LM Studio is keyless (the handler sends a hardcoded "noop" key).
		keyEnvVar: null,
		baseUrlField: "lmStudioBaseUrl",
		baseUrlEnvVar: "LMSTUDIO_BASE_URL",
	},
	openai: {
		// "openai" is the OpenAI-compatible provider. It shares OPENAI_* names
		// with "openai-native" (only one is active per run).
		keyEnvVar: "OPENAI_API_KEY",
		baseUrlField: "openAiBaseUrl",
		baseUrlEnvVar: "OPENAI_BASE_URL",
	},
	bedrock: {
		// Bedrock resolves credentials from the AWS SDK default chain
		// (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or ~/.aws). No CLI key needed.
		keyEnvVar: null,
		baseUrlField: "awsBedrockEndpoint",
		baseUrlEnvVar: "AWS_BEDROCK_ENDPOINT",
	},
	mistral: {
		keyEnvVar: "MISTRAL_API_KEY",
		baseUrlField: "mistralCodestralUrl",
		baseUrlEnvVar: "MISTRAL_BASE_URL",
	},
	moonshot: {
		keyEnvVar: "MOONSHOT_API_KEY",
		baseUrlField: "moonshotBaseUrl",
		baseUrlEnvVar: "MOONSHOT_BASE_URL",
	},
	minimax: {
		keyEnvVar: "MINIMAX_API_KEY",
		baseUrlField: "minimaxBaseUrl",
		baseUrlEnvVar: "MINIMAX_BASE_URL",
	},
	"qwen-code": {
		// Qwen Code uses OAuth credentials cached on disk (~/.qwen/oauth_creds.json
		// or qwenCodeOauthPath). No API-key env var.
		keyEnvVar: null,
	},
	vertex: {
		// Vertex resolves credentials from GOOGLE_APPLICATION_CREDENTIALS or the
		// gcloud default chain (vertexKeyFile/vertexJsonCredentials).
		keyEnvVar: null,
	},
	xai: {
		keyEnvVar: "XAI_API_KEY",
	},
	zai: {
		keyEnvVar: "ZAI_API_KEY",
	},
}

/** Providers a run can start without an API key (the shared rule, see below). */
export const keylessProviders: readonly SupportedProvider[] = supportedProviders.filter(
	(id) => !providerRequiresApiKey(id),
)

/**
 * True when a run needs the provider's API key: the rule the settings UI
 * validates profiles with (`providerValidationRegistry` in @roo-code/types).
 */
export function providerRequiresApiKey(provider: SupportedProvider): boolean {
	return sharedProviderRequiresApiKey(provider)
}

/** True when the provider has no default model, so a run must name one. */
export function providerRequiresModelId(provider: SupportedProvider): boolean {
	return sharedProviderRequiresModelId(provider)
}

/** The env var that holds the API key for a provider (null when it has no key field). */
export function getEnvVarName(provider: SupportedProvider): string | null {
	return providerEnvMap[provider]?.keyEnvVar ?? null
}

/** The base-url env var for a provider (undefined when the schema has none). */
export function getBaseUrlEnvVarName(provider: SupportedProvider): string | undefined {
	return providerEnvMap[provider]?.baseUrlEnvVar
}

/** The extension settings field for the provider's API key (null when it has none). */
export function getApiKeyField(provider: SupportedProvider): string | null {
	return getProviderApiKeyField(provider)
}

/** The extension settings field for the provider's base URL (undefined if none). */
export function getBaseUrlField(provider: SupportedProvider): string | undefined {
	return providerEnvMap[provider]?.baseUrlField
}

/** The extension settings field for the provider's model id (the one its handler reads). */
export function getModelField(provider: SupportedProvider): string {
	return providerModelDefinitions[provider].modelIdField
}

export function getApiKeyFromEnv(provider: SupportedProvider): string | undefined {
	const envVar = getEnvVarName(provider)
	if (!envVar) return undefined
	return process.env[envVar]
}

/** Read the base-url from the environment for a provider (if it has one). */
export function getBaseUrlFromEnv(provider: SupportedProvider): string | undefined {
	const envVar = getBaseUrlEnvVarName(provider)
	if (!envVar) return undefined
	return process.env[envVar]
}

/**
 * Compose the extension provider settings from CLI options.
 * Keys/base-urls are injected only when present; the model field follows the
 * provider's own field (routers use provider-specific model id fields).
 *
 * Throws when a `baseUrl` is given for a provider whose settings schema has
 * no base-url field (decision 5 of ai_plans/2026-08-04_cli-provider-parity.md) —
 * instead of silently dropping it.
 */
export function getProviderSettings(
	provider: SupportedProvider,
	apiKey: string | undefined,
	model: string | undefined,
	baseUrl?: string,
): Record<string, unknown> & { apiProvider: SupportedProvider } {
	const config: Record<string, unknown> & { apiProvider: SupportedProvider } = { apiProvider: provider }

	const modelField = getModelField(provider)
	if (model) config[modelField] = model

	if (baseUrl) {
		const baseUrlField = getBaseUrlField(provider)
		if (!baseUrlField) {
			throw new Error(`Provider '${provider}' does not support a base URL`)
		}
		config[baseUrlField] = baseUrl
	}

	if (apiKey) {
		// bedrock maps --api-key to the token credentials fields.
		if (provider === "bedrock") {
			config.awsUseApiKey = true
			config.awsApiKey = apiKey
		} else {
			const apiKeyField = getApiKeyField(provider)
			if (apiKeyField) {
				config[apiKeyField] = apiKey
			}
		}
	}

	return config
}
