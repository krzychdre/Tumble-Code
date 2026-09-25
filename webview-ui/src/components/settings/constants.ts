import {
	type ProviderName,
	type ModelInfo,
	getSelectableProviderDefinitions,
	providerModelDefinitions,
} from "@roo-code/types"

/**
 * The static model list of every provider that has one, from
 * `providerModelDefinitions` (Z.ai shows its international list). Providers
 * without an entry fetch their models or let the user configure them.
 */
export const MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = Object.fromEntries(
	Object.entries(providerModelDefinitions).flatMap(([provider, definition]) =>
		"models" in definition ? [[provider, definition.models]] : [],
	),
)

const PROXY_PROVIDER_IDS = new Set<ProviderName>(["openai", "lmstudio", "ollama", "litellm"])

// Compatibility view for webview consumers; provider inventory, labels, order, and lifecycle live in the portable registry.
export const PROVIDERS = getSelectableProviderDefinitions().map(({ id, label }) => ({
	value: id,
	label,
	proxy: PROXY_PROVIDER_IDS.has(id),
}))
