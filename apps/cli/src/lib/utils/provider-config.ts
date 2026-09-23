/**
 * Resolve the provider connection for a run: provider, model, base URL, API key
 * and reasoning effort, from layered sources.
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
 * ai_plans/2026-08-04_cli-bare-run-settings-sync.md). `reasoningEffort` is not
 * provider-bound: the highest layer that sets it wins.
 *
 * API key order: a layer's `apiKey`, else its `apiKeyEnv` (both only from
 * layers of the active provider, highest first), then the provider's
 * conventional env var (e.g. OPENAI_API_KEY), then the fallback's key.
 */

import { openAiCodexDefaultModelId, type ProviderSettings } from "@roo-code/types"

import type { ReasoningEffortFlagOptions } from "@/types/types.js"
import { DEFAULT_FLAGS } from "@/types/constants.js"

import {
	getApiKeyFromEnv,
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
	reasoningEffort?: ReasoningEffortFlagOptions
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
	reasoningEffort: ReasoningEffortFlagOptions
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

export function resolveProviderConfig({ fallback, layers }: ResolveProviderConfigInput): ResolvedProviderConfig {
	const present = layers.filter((layer): layer is ProviderConfigLayer => layer !== undefined)
	// Highest precedence first from here on.
	const scoped = scopeLayers(fallback, present).reverse()
	const highestFirst = scoped.map((entry) => entry.layer)

	const rawProvider =
		highestFirst.find((layer) => layer.provider !== undefined)?.provider ??
		fallback?.provider ??
		DEFAULT_FLAGS.provider
	const provider = resolveProviderIdAlias(rawProvider) as SupportedProvider

	const own = scoped.filter((entry) => entry.provider === provider).map((entry) => entry.layer)
	const fallbackIsOwn = fallback?.provider !== undefined && resolveProviderIdAlias(fallback.provider) === provider

	const pick = (key: "model" | "baseUrl"): string | undefined =>
		own.find((layer) => layer[key])?.[key] ?? (fallbackIsOwn ? fallback?.[key] || undefined : undefined)

	const model = pick("model") ?? (provider === "openai-codex" ? openAiCodexDefaultModelId : DEFAULT_FLAGS.model)

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
		baseUrl: pick("baseUrl"),
		apiKey,
		missingApiKeyEnv,
		reasoningEffort:
			highestFirst.find((layer) => layer.reasoningEffort)?.reasoningEffort ?? DEFAULT_FLAGS.reasoningEffort,
	}
}

/** The provider-connection fields of a settings object, without its other keys. */
export function pickProviderConfig(source: ProviderConfigLayer): ProviderConfigLayer {
	const { provider, model, baseUrl, apiKey, apiKeyEnv, reasoningEffort } = source
	return { provider, model, baseUrl, apiKey, apiKeyEnv, reasoningEffort }
}

/**
 * The extension's provider settings for a resolved configuration: the
 * provider's own model/base-url/key fields plus the reasoning switches
 * ("unspecified" leaves reasoning to the model's default, "disabled" turns it
 * off). Throws like getProviderSettings for a base URL the provider has no
 * field for.
 */
export function toProviderSettings(
	config: Pick<ResolvedProviderConfig, "provider" | "model" | "baseUrl" | "apiKey"> & {
		reasoningEffort?: ReasoningEffortFlagOptions
	},
): ProviderSettings {
	const settings = getProviderSettings(
		config.provider,
		config.apiKey,
		config.model,
		config.baseUrl,
	) as ProviderSettings

	if (config.reasoningEffort === "disabled") {
		settings.enableReasoningEffort = false
	} else if (config.reasoningEffort && config.reasoningEffort !== "unspecified") {
		settings.enableReasoningEffort = true
		settings.reasoningEffort = config.reasoningEffort
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
