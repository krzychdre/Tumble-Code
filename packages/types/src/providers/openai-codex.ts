import type { ModelInfo } from "../model.js"

/**
 * OpenAI Codex Provider
 *
 * This provider uses OAuth authentication via ChatGPT Plus/Pro subscription
 * instead of direct API keys. Requests are routed to the Codex backend at
 * https://chatgpt.com/backend-api/codex/responses
 */

export type OpenAiCodexModelId = keyof typeof openAiCodexModels

export const openAiCodexDefaultModelId: OpenAiCodexModelId = "gpt-5.6-sol"

const commonSubscriptionModelInfo = {
	includedTools: ["apply_patch"],
	excludedTools: ["apply_diff", "write_to_file"],
	supportsPromptCache: true,
	inputPrice: 0,
	outputPrice: 0,
	supportsTemperature: false,
} satisfies Partial<ModelInfo>

/** Models currently documented for Codex with ChatGPT sign-in. */
export const openAiCodexModels = {
	"gpt-5.6-sol": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
		reasoningEffort: "medium",
		supportsVerbosity: true,
		description:
			"GPT-5.6 Sol: Flagship model for complex coding, computer use, research, and cybersecurity via ChatGPT subscription",
	},
	"gpt-5.6-terra": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
		reasoningEffort: "medium",
		supportsVerbosity: true,
		description: "GPT-5.6 Terra: Balanced model for everyday coding and knowledge work via ChatGPT subscription",
	},
	"gpt-5.6-luna": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
		reasoningEffort: "medium",
		supportsVerbosity: true,
		description: "GPT-5.6 Luna: Fast model for clear, repeatable, high-volume work via ChatGPT subscription",
	},
	"gpt-5.5": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		supportsVerbosity: true,
		description: "GPT-5.5: Previous-generation frontier model via ChatGPT subscription",
	},
	"gpt-5.3-codex-spark": {
		...commonSubscriptionModelInfo,
		maxTokens: 8_192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		description: "GPT-5.3 Codex Spark: Fast, text-only preview available to ChatGPT Pro users",
	},
	"gpt-5.4": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "none",
		supportsVerbosity: true,
		description: "GPT-5.4: Frontier model for professional work via ChatGPT subscription",
	},
	"gpt-5.4-mini": {
		...commonSubscriptionModelInfo,
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "none",
		supportsVerbosity: true,
		description: "GPT-5.4 Mini: Fast model for responsive coding tasks and subagents via ChatGPT subscription",
	},
} as const satisfies Record<string, ModelInfo>
