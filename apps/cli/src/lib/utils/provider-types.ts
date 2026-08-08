/**
 * Provider tables for the CLI.
 *
 * All provider IDs come from the shared @roo-code/types registry — the CLI never
 * hand-maintains its own provider allowlist. This module maps each supported
 * provider to:
 *  - its API-key settings field (from the extension's zod schemas),
 *  - its base-url settings field (where the schema has one),
 *  - its model settings field,
 *  - conventional env-var names.
 *
 * Keyless providers (no API-key field, or credentials resolved by an SDK) are
 * marked with `keyField: null`; the API-key gate in run.ts derives from this
 * table rather than a second hand-maintained list.
 *
 * Persisted aliases:
 *  - "tumble" — the cloud provider id shipped by BR-09 (rebrand). The CLI has
 *    no cloud handler, so it maps to the openrouter provider settings.
 */

import { activeProviderIds } from "@roo-code/types"

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
 * Per-provider mapping: settings field names + env vars.
 *
 * `keyField` is the extension's settings field that holds the API key
 * (from each provider's zod schema in packages/types/src/provider-config).
 * `null` means the provider needs no API key — the gate never requires one.
 *
 * `baseUrlField` is set only where the schema has a base-url field.
 * `modelField` is the settings field the extension reads the model id from
 * (`apiModelId` covers most providers; the routers use provider-specific ones).
 */
export interface ProviderEnvMapping {
	readonly apiKeyField: string | null
	readonly keyEnvVar: string | null
	readonly baseUrlField?: string
	readonly baseUrlEnvVar?: string
	readonly modelField: string
}

export const providerEnvMap: Record<SupportedProvider, ProviderEnvMapping> = {
	anthropic: {
		apiKeyField: "apiKey",
		keyEnvVar: "ANTHROPIC_API_KEY",
		baseUrlField: "anthropicBaseUrl",
		baseUrlEnvVar: "ANTHROPIC_BASE_URL",
		modelField: "apiModelId",
	},
	"openai-native": {
		apiKeyField: "openAiNativeApiKey",
		keyEnvVar: "OPENAI_API_KEY",
		baseUrlField: "openAiNativeBaseUrl",
		baseUrlEnvVar: "OPENAI_BASE_URL",
		modelField: "apiModelId",
	},
	"openai-codex": {
		// OpenAI Codex uses ChatGPT subscription OAuth credentials persisted by
		// `tumble auth codex login`; the extension's OAuth manager resolves and
		// refreshes them from the CLI shim's SecretStorage at runtime.
		apiKeyField: null,
		keyEnvVar: null,
		modelField: "apiModelId",
	},
	gemini: {
		apiKeyField: "geminiApiKey",
		keyEnvVar: "GOOGLE_API_KEY",
		baseUrlField: "googleGeminiBaseUrl",
		baseUrlEnvVar: "GOOGLE_GEMINI_BASE_URL",
		modelField: "apiModelId",
	},
	openrouter: {
		apiKeyField: "openRouterApiKey",
		keyEnvVar: "OPENROUTER_API_KEY",
		baseUrlField: "openRouterBaseUrl",
		baseUrlEnvVar: "OPENROUTER_BASE_URL",
		modelField: "openRouterModelId",
	},
	"vercel-ai-gateway": {
		apiKeyField: "vercelAiGatewayApiKey",
		keyEnvVar: "VERCEL_AI_GATEWAY_API_KEY",
		modelField: "vercelAiGatewayModelId",
	},
	litellm: {
		apiKeyField: "litellmApiKey",
		keyEnvVar: "LITELLM_API_KEY",
		baseUrlField: "litellmBaseUrl",
		baseUrlEnvVar: "LITELLM_BASE_URL",
		modelField: "litellmModelId",
	},
	poe: {
		apiKeyField: "poeApiKey",
		keyEnvVar: "POE_API_KEY",
		baseUrlField: "poeBaseUrl",
		baseUrlEnvVar: "POE_BASE_URL",
		modelField: "apiModelId",
	},
	requesty: {
		apiKeyField: "requestyApiKey",
		keyEnvVar: "REQUESTY_API_KEY",
		baseUrlField: "requestyBaseUrl",
		baseUrlEnvVar: "REQUESTY_BASE_URL",
		modelField: "requestyModelId",
	},
	unbound: {
		apiKeyField: "unboundApiKey",
		keyEnvVar: "UNBOUND_API_KEY",
		modelField: "unboundModelId",
	},
	deepseek: {
		apiKeyField: "deepSeekApiKey",
		keyEnvVar: "DEEPSEEK_API_KEY",
		baseUrlField: "deepSeekBaseUrl",
		baseUrlEnvVar: "DEEPSEEK_BASE_URL",
		modelField: "apiModelId",
	},
	ollama: {
		// Ollama is keyless: localhost-first, and the settings schema has no
		// key field (the handler sends no Authorization header at all).
		apiKeyField: null,
		keyEnvVar: null,
		baseUrlField: "ollamaBaseUrl",
		baseUrlEnvVar: "OLLAMA_BASE_URL",
		modelField: "ollamaModelId",
	},
	lmstudio: {
		// LM Studio is keyless (the handler sends a hardcoded "noop" key).
		apiKeyField: null,
		keyEnvVar: null,
		baseUrlField: "lmStudioBaseUrl",
		baseUrlEnvVar: "LMSTUDIO_BASE_URL",
		modelField: "lmStudioModelId",
	},
	openai: {
		// "openai" is the OpenAI-compatible provider. It shares OPENAI_* names
		// with "openai-native" (only one is active per run).
		apiKeyField: "openAiApiKey",
		keyEnvVar: "OPENAI_API_KEY",
		baseUrlField: "openAiBaseUrl",
		baseUrlEnvVar: "OPENAI_BASE_URL",
		modelField: "openAiModelId",
	},
	bedrock: {
		// Bedrock resolves credentials from the AWS SDK default chain
		// (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or ~/.aws). No CLI key needed.
		apiKeyField: null,
		keyEnvVar: null,
		baseUrlField: "awsBedrockEndpoint",
		baseUrlEnvVar: "AWS_BEDROCK_ENDPOINT",
		modelField: "apiModelId",
	},
	baseten: {
		apiKeyField: "basetenApiKey",
		keyEnvVar: "BASETEN_API_KEY",
		modelField: "apiModelId",
	},
	fireworks: {
		apiKeyField: "fireworksApiKey",
		keyEnvVar: "FIREWORKS_API_KEY",
		modelField: "apiModelId",
	},
	mistral: {
		apiKeyField: "mistralApiKey",
		keyEnvVar: "MISTRAL_API_KEY",
		baseUrlField: "mistralCodestralUrl",
		baseUrlEnvVar: "MISTRAL_BASE_URL",
		modelField: "apiModelId",
	},
	moonshot: {
		apiKeyField: "moonshotApiKey",
		keyEnvVar: "MOONSHOT_API_KEY",
		baseUrlField: "moonshotBaseUrl",
		baseUrlEnvVar: "MOONSHOT_BASE_URL",
		modelField: "apiModelId",
	},
	minimax: {
		apiKeyField: "minimaxApiKey",
		keyEnvVar: "MINIMAX_API_KEY",
		baseUrlField: "minimaxBaseUrl",
		baseUrlEnvVar: "MINIMAX_BASE_URL",
		modelField: "apiModelId",
	},
	"qwen-code": {
		// Qwen Code uses OAuth credentials cached on disk (~/.qwen/oauth_creds.json
		// or qwenCodeOauthPath). No API-key env var.
		apiKeyField: null,
		keyEnvVar: null,
		modelField: "apiModelId",
	},
	sambanova: {
		apiKeyField: "sambaNovaApiKey",
		keyEnvVar: "SAMBANOVA_API_KEY",
		// SAMBANOVA_URL overrides the base URL at the handler level; the CLI's
		// generic `--base-url`/`SAMBANOVA_BASE_URL` do not apply to it.
		modelField: "apiModelId",
	},
	vertex: {
		// Vertex resolves credentials from GOOGLE_APPLICATION_CREDENTIALS or the
		// gcloud default chain (vertexKeyFile/vertexJsonCredentials).
		apiKeyField: null,
		keyEnvVar: null,
		modelField: "apiModelId",
	},
	xai: {
		apiKeyField: "xaiApiKey",
		keyEnvVar: "XAI_API_KEY",
		modelField: "apiModelId",
	},
	zai: {
		apiKeyField: "zaiApiKey",
		keyEnvVar: "ZAI_API_KEY",
		modelField: "apiModelId",
	},
}

/**
 * Providers whose settings schema has no required API key — the run gate must
 * not hard-exit for them. Derived from providerEnvMap (apiKeyField === null),
 * plus ollama/lmstudio which run keyless by design.
 */
export const keylessProviders: readonly SupportedProvider[] = supportedProviders.filter(
	(id) => providerEnvMap[id].apiKeyField === null,
)

/** True when the provider's own schema requires an API key. */
export function providerRequiresApiKey(provider: SupportedProvider): boolean {
	const mapping = providerEnvMap[provider]
	return !mapping || mapping.apiKeyField !== null
}

/** The env var that holds the API key for a provider (null when keyless). */
export function getEnvVarName(provider: SupportedProvider): string | null {
	return providerEnvMap[provider]?.keyEnvVar ?? null
}

/** The base-url env var for a provider (undefined when the schema has none). */
export function getBaseUrlEnvVarName(provider: SupportedProvider): string | undefined {
	return providerEnvMap[provider]?.baseUrlEnvVar
}

/** The extension settings field for the provider's API key (null when keyless). */
export function getApiKeyField(provider: SupportedProvider): string | null {
	return providerEnvMap[provider]?.apiKeyField ?? null
}

/** The extension settings field for the provider's base URL (undefined if none). */
export function getBaseUrlField(provider: SupportedProvider): string | undefined {
	return providerEnvMap[provider]?.baseUrlField
}

/** The extension settings field for the provider's model id. */
export function getModelField(provider: SupportedProvider): string {
	return providerEnvMap[provider].modelField
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
