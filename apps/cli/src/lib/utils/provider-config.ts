/**
 * Resolve the provider connection for a run: provider, model, base URL and API
 * key, from layered sources.
 *
 * Sources, highest precedence last in `layers`:
 *  - `fallback`: the CLI's own extension state (~/.vscode-mock, see
 *    vscode-config.ts); used only where no layer supplies a value.
 *  - `layers`: the settings file, then the flags.
 *
 * Provider-bound values (model, baseUrl, apiKey, apiKeyEnv) belong to the
 * provider of the layer they are written in. A layer that names no provider
 * inherits the provider of the layer below it. A value is used only while its
 * layer's provider is the active provider, so a model saved for openrouter is
 * never sent to openai after `--provider openai` (decision A3 of
 * ai_plans/2026-08-04_cli-bare-run-settings-sync.md). The reasoning effort is
 * not part of the connection: it belongs to the model (see
 * resolveReasoningEffort).
 *
 * API key order: a layer's `apiKey`, else its `apiKeyEnv` (both only from
 * layers of the active provider, highest first), then the provider's
 * conventional env var (e.g. OPENAI_API_KEY), then the fallback's key.
 *
 * Base URL order, the same without `apiKeyEnv`: a layer's `baseUrl`, then the
 * provider's base-url env var (e.g. OPENAI_BASE_URL), then the fallback's.
 */

import { getProviderDefaultModelId, openAiModelInfoSaneDefaults, type ProviderSettings } from "@tumble-code/types"

import type { CliModelSettings, ReasoningEffortFlagOptions } from "@/types/types.js"
import { DEFAULT_FLAGS } from "@/types/constants.js"

import {
	getApiKeyFromEnv,
	getBaseUrlFromEnv,
	getModelField,
	getProviderSettings,
	isSupportedProvider,
	resolveProviderIdAlias,
	type SupportedProvider,
} from "./provider-types.js"

export interface ProviderConfigLayer {
	/** Provider id as written; may be an alias such as "tumble". */
	provider?: string
	model?: string
	baseUrl?: string
	apiKey?: string
	/** Name of the environment variable that holds the API key. */
	apiKeyEnv?: string
}

export interface ResolvedProviderConfig {
	/** The provider id as written, before alias resolution (for error messages). */
	rawProvider: string
	/** The provider id after alias resolution (tumble -> openrouter). */
	provider: SupportedProvider
	model: string
	baseUrl?: string
	apiKey?: string
	/** Set when the chosen key source is an `apiKeyEnv` whose variable is empty or unset. */
	missingApiKeyEnv?: string
}

export interface ResolveProviderConfigInput {
	fallback?: ProviderConfigLayer
	layers: (ProviderConfigLayer | undefined)[]
}

type ScopedLayer = { layer: ProviderConfigLayer; provider: string | undefined }

function scopeLayers(fallback: ProviderConfigLayer | undefined, layers: ProviderConfigLayer[]): ScopedLayer[] {
	// Bottom-up: each layer is scoped to its own provider, else the one below.
	let provider = fallback?.provider !== undefined ? resolveProviderIdAlias(fallback.provider) : undefined
	return layers.map((layer) => {
		if (layer.provider !== undefined) {
			provider = resolveProviderIdAlias(layer.provider)
		}
		return { layer, provider }
	})
}

/**
 * The model a provider runs when no layer names one: the CLI's own OpenRouter
 * default, else the provider's default from the shared tables. openai, ollama
 * and lmstudio have no default model ("", the user names one); the run stops
 * with an error for them instead of sending another provider's model id.
 */
function defaultModelFor(provider: SupportedProvider): string {
	if (provider === "openrouter") {
		return DEFAULT_FLAGS.model
	}
	return getProviderDefaultModelId(provider)
}

/**
 * The reasoning effort a model runs with: the --reasoning-effort flag (one
 * level for every model of the run), else the model's own entry in `models`
 * of cli-settings.json, else the provider's default. It is looked up per
 * model, never shared between models, because the levels differ from model to
 * model: a level one model takes (GLM-5.3 and "max") is rejected by another.
 *
 * The default is "unspecified" (nothing is sent) for the openai provider,
 * which talks to any OpenAI-compatible server and knows nothing about its
 * model, and "medium" for every other provider.
 */
export function resolveReasoningEffort(
	provider: SupportedProvider,
	modelSettings: CliModelSettings | undefined,
	flagReasoningEffort?: ReasoningEffortFlagOptions,
): ReasoningEffortFlagOptions {
	return (
		flagReasoningEffort ??
		modelSettings?.reasoningEffort ??
		(provider === "openai" ? "unspecified" : DEFAULT_FLAGS.reasoningEffort)
	)
}

export function resolveProviderConfig({ fallback, layers }: ResolveProviderConfigInput): ResolvedProviderConfig {
	const present = layers.filter((layer): layer is ProviderConfigLayer => layer !== undefined)
	// Highest precedence first from here on.
	const scoped = scopeLayers(fallback, present).reverse()

	const rawProvider =
		scoped.map((entry) => entry.layer).find((layer) => layer.provider !== undefined)?.provider ??
		fallback?.provider ??
		DEFAULT_FLAGS.provider
	const provider = resolveProviderIdAlias(rawProvider) as SupportedProvider

	const own = scoped.filter((entry) => entry.provider === provider).map((entry) => entry.layer)
	const fallbackIsOwn = fallback?.provider !== undefined && resolveProviderIdAlias(fallback.provider) === provider

	const fromLayers = (key: "model" | "baseUrl"): string | undefined => own.find((layer) => layer[key])?.[key]
	const fromFallback = (key: "model" | "baseUrl"): string | undefined =>
		fallbackIsOwn ? fallback?.[key] || undefined : undefined

	const model = fromLayers("model") ?? fromFallback("model") ?? defaultModelFor(provider)
	const baseUrl = fromLayers("baseUrl") ?? (getBaseUrlFromEnv(provider) || undefined) ?? fromFallback("baseUrl")

	let apiKey: string | undefined
	let missingApiKeyEnv: string | undefined
	const keyLayer = own.find((layer) => layer.apiKey || layer.apiKeyEnv)
	if (keyLayer?.apiKey) {
		apiKey = keyLayer.apiKey
	} else if (keyLayer?.apiKeyEnv) {
		apiKey = process.env[keyLayer.apiKeyEnv] || undefined
		if (!apiKey) {
			missingApiKeyEnv = keyLayer.apiKeyEnv
		}
	} else {
		apiKey = getApiKeyFromEnv(provider) || (fallbackIsOwn ? fallback?.apiKey : undefined) || undefined
	}

	return {
		rawProvider,
		provider,
		model,
		baseUrl,
		apiKey,
		missingApiKeyEnv,
	}
}

/** The provider-connection fields of a settings object, without its other keys. */
export function pickProviderConfig(source: ProviderConfigLayer): ProviderConfigLayer {
	const { provider, model, baseUrl, apiKey, apiKeyEnv } = source
	return { provider, model, baseUrl, apiKey, apiKeyEnv }
}

/**
 * The extension's provider settings for a resolved configuration: the
 * provider's own model/base-url/key fields plus the reasoning switches
 * ("unspecified" leaves reasoning to the model's default, "disabled" turns it
 * off), and for the openai provider the model info that carries the model's
 * context window, its prices and the configured reasoning effort, plus whether
 * the model's earlier reasoning is sent back to it. Throws like
 * getProviderSettings for a base URL the provider has no field for.
 */
export function toProviderSettings(
	config: Pick<ResolvedProviderConfig, "provider" | "model" | "baseUrl" | "apiKey"> & {
		reasoningEffort?: ReasoningEffortFlagOptions
		/** The model's entry in `models` of cli-settings.json; only the openai provider has a field for it. */
		modelSettings?: CliModelSettings
	},
): ProviderSettings {
	const settings = getProviderSettings(
		config.provider,
		config.apiKey,
		config.model,
		config.baseUrl,
	) as ProviderSettings

	return applyModelSettings(settings, config.provider, config)
}

/**
 * The same provider settings running another model of the same provider (the
 * TUI's /model): the provider's model field, and what comes with the model
 * (its reasoning effort and, for the openai provider, its size, prices,
 * preserveReasoning and trimOldReasoning), replacing those of the previous model. The connection
 * (base URL, key) stays.
 */
export function withModel(
	settings: ProviderSettings,
	model: string,
	options: { reasoningEffort?: ReasoningEffortFlagOptions; modelSettings?: CliModelSettings },
): ProviderSettings {
	const provider = settings.apiProvider
	if (!provider || !isSupportedProvider(provider)) {
		throw new Error(`Cannot switch the model of provider ${provider ?? "(none)"}`)
	}

	const next: ProviderSettings = { ...settings, [getModelField(provider)]: model }
	// The previous model's level must not outlive it when the new one has none.
	delete next.enableReasoningEffort
	delete next.reasoningEffort

	return applyModelSettings(next, provider, options)
}

/** Writes the model-dependent fields of toProviderSettings onto `settings`. */
function applyModelSettings(
	settings: ProviderSettings,
	provider: SupportedProvider,
	config: { reasoningEffort?: ReasoningEffortFlagOptions; modelSettings?: CliModelSettings },
): ProviderSettings {
	const effort =
		config.reasoningEffort === "disabled" || config.reasoningEffort === "unspecified"
			? undefined
			: config.reasoningEffort
	if (config.reasoningEffort === "disabled") {
		settings.enableReasoningEffort = false
	} else if (effort) {
		settings.enableReasoningEffort = true
		settings.reasoningEffort = effort
	}

	// The openai provider sizes and prices its model from
	// openAiCustomModelInfo, else from openAiModelInfoSaneDefaults (128,000
	// tokens, $0): its model list has ids only. The same model info decides
	// whether a reasoning effort is sent: without supportsReasoningEffort or an
	// effort of its own the handler drops
	// the configured effort, so the effort is written there as well (the
	// settings UI's reasoning level control also stores it in this model
	// info). The fields are always written, because the startup
	// settings are merged into the extension's persisted state, where a size, a
	// price, an effort, a preserveReasoning or a trimOldReasoning from an
	// earlier run would otherwise outlive the entry that set it.
	if (provider === "openai") {
		const {
			contextWindow,
			inputPrice,
			outputPrice,
			cacheReadsPrice,
			cacheWritesPrice,
			preserveReasoning,
			trimOldReasoning,
		} = config.modelSettings ?? {}
		const configured = Object.fromEntries(
			Object.entries({ contextWindow, inputPrice, outputPrice, cacheReadsPrice, cacheWritesPrice }).filter(
				([, value]) => value !== undefined,
			),
		)

		settings.openAiCustomModelInfo =
			Object.keys(configured).length > 0 || effort
				? {
						...openAiModelInfoSaneDefaults,
						...configured,
						...(effort ? { supportsReasoningEffort: true, reasoningEffort: effort } : {}),
					}
				: null
		settings.openAiPreserveReasoning = preserveReasoning ?? false
		settings.openAiTrimOldReasoning = trimOldReasoning ?? false
	}

	return settings
}

/**
 * Provider, model and reasoning effort as the extension currently holds them,
 * for display. The model is read from the active provider's own field: the
 * extension state can still carry another provider's model id (e.g. a stale
 * `apiModelId` next to the live `openAiModelId`).
 */
export function summarizeProviderSettings(
	settings: ProviderSettings | null | undefined,
): { provider: SupportedProvider; model?: string; reasoningEffort?: string } | undefined {
	const provider = settings?.apiProvider
	if (!settings || !provider || !isSupportedProvider(provider)) {
		return undefined
	}

	const model = settings[getModelField(provider) as keyof ProviderSettings]
	const reasoningEffort =
		settings.enableReasoningEffort === false
			? "disabled"
			: settings.enableReasoningEffort
				? settings.reasoningEffort
				: undefined

	return { provider, model: typeof model === "string" && model ? model : undefined, reasoningEffort }
}
