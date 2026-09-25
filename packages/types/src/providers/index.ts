export * from "./anthropic.js"
export * from "./bedrock.js"
export * from "./deepseek.js"
export * from "./gemini.js"
export * from "./lite-llm.js"
export * from "./lm-studio.js"
export * from "./mistral.js"
export * from "./moonshot.js"
export * from "./ollama.js"
export * from "./openai.js"
export * from "./openai-codex.js"
export * from "./openai-codex-rate-limits.js"
export * from "./openrouter.js"
export * from "./qwen-code.js"
export * from "./vertex.js"
export * from "./vscode-llm.js"
export * from "./xai.js"
export * from "./zai.js"
export * from "./minimax.js"

import { anthropicDefaultModelId } from "./anthropic.js"
import { mainlandZAiDefaultModelId } from "./zai.js"

import { getProviderModelDefinition } from "../provider-models.js"
// Import the ProviderName type from provider-settings to avoid duplication
import type { ProviderName } from "../provider-settings.js"

/**
 * Get the default model ID for a given provider.
 * This function returns only the provider's default model ID, without considering user configuration.
 * Used as a fallback when provider models are still loading.
 *
 * The ids come from `providerModelDefinitions`; "" means the user picks the
 * model (OpenAI Compatible, Ollama, LM Studio). Providers without a default
 * there (and unknown ids) get the Anthropic default, as the runtime falls back
 * to the Anthropic handler.
 */
export function getProviderDefaultModelId(
	provider: ProviderName,
	options: { isChina?: boolean } = { isChina: false },
): string {
	if (provider === "zai" && options?.isChina) {
		return mainlandZAiDefaultModelId
	}

	return getProviderModelDefinition(provider)?.defaultModelId ?? anthropicDefaultModelId
}
