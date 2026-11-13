import type { ModelInfo } from "../model.js"

// https://platform.kimi.ai/docs/models.md
// https://platform.kimi.ai/docs/pricing/chat.md
// https://platform.kimi.ai/docs/api/models-overview.md
//
// All of these fix temperature (and top_p) server-side and reject any other
// value, so none of them takes a temperature. They return reasoning_content,
// which the next turn must carry back (Preserved Thinking).
export type MoonshotModelId = keyof typeof moonshotModels

export const moonshotDefaultModelId: MoonshotModelId = "kimi-k3.1-pro"

// The info an unknown model id is sent with. Not the default's: Kimi K3's
// reasoning_effort is not accepted by the K2 line, so an unlisted id gets the
// plain K2.6 info (no temperature, no reasoning field).
export const moonshotUnknownModelStandInId: MoonshotModelId = "kimi-k2.6"

export const moonshotModels = {
	"kimi-k3.1-pro": {
		maxTokens: 131_072, // The API's default max_completion_tokens.
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0, // $2.00 per million tokens (cache miss)
		outputPrice: 10.0, // $10.00 per million tokens
		cacheWritesPrice: 2.0, // $2.00 per million tokens (5 min TTL, the default; the 1h TTL write is $4)
		cacheReadsPrice: 0.2, // $0.20 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		// Always thinks; reasoning_effort sets how much (the API's default is max).
		supportsReasoningEffort: ["low", "high", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "max",
		description:
			"Kimi K3.1 Pro is Moonshot AI's flagship model for long-horizon coding, knowledge work and deep reasoning, with vision and a 1M-token context window.",
	},
	"kimi-k3.1-pro-highspeed": {
		maxTokens: 131_072, // The API's default max_completion_tokens.
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 4.0, // $4.00 per million tokens (cache miss)
		outputPrice: 20.0, // $20.00 per million tokens
		cacheWritesPrice: 4.0, // $4.00 per million tokens (5 min TTL, the default; the 1h TTL write is $8)
		cacheReadsPrice: 0.2, // $0.20 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		// Always thinks; reasoning_effort sets how much (the API's default is max).
		supportsReasoningEffort: ["low", "high", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "max",
		description:
			"Kimi K3.1 Pro HighSpeed is the same model as Kimi K3.1 Pro with faster output, for latency-sensitive long-horizon coding and deep reasoning.",
	},
	"kimi-k3": {
		maxTokens: 131_072, // The API's default max_completion_tokens.
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3.00 per million tokens (cache miss)
		outputPrice: 15.0, // $15.00 per million tokens
		cacheWritesPrice: 3.0, // $3.00 per million tokens (5 min TTL, the default)
		cacheReadsPrice: 0.3, // $0.30 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		// Always thinks; reasoning_effort sets how much (the API's default is max).
		supportsReasoningEffort: ["low", "high", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "max",
		description:
			"Kimi K3 is Moonshot AI's flagship model for long-horizon coding, knowledge work and deep reasoning, with vision and a 1M-token context window.",
	},
	// The K2 line is closed to new users since 2026-10-31 and retires at the end
	// of 2026-12; the stand-in info above stays on kimi-k2.6 while it is served.
	"kimi-k2.7-code": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.95, // $0.95 per million tokens (cache miss)
		outputPrice: 4.0, // $4.00 per million tokens
		cacheReadsPrice: 0.19, // $0.19 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		description:
			"Kimi K2.7 Code is Moonshot AI's dedicated coding model, always thinking, with more reliable instruction following in long contexts. Closed to new users on 2026-10-31; retires at the end of 2026-12.",
		deprecated: true,
	},
	"kimi-k2.7-code-highspeed": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.9, // $1.90 per million tokens (cache miss)
		outputPrice: 8.0, // $8.00 per million tokens
		cacheReadsPrice: 0.38, // $0.38 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		description:
			"Kimi K2.7 Code HighSpeed is the same model as Kimi K2.7 Code with faster output (about 180 tokens per second). Closed to new users on 2026-10-31; retires at the end of 2026-12.",
		deprecated: true,
	},
	"kimi-k2.6": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.95, // $0.95 per million tokens (cache miss)
		outputPrice: 4.0, // $4.00 per million tokens
		cacheReadsPrice: 0.16, // $0.16 per million tokens (cache hit)
		supportsTemperature: false,
		preserveReasoning: true,
		description:
			"Kimi K2.6 is Moonshot AI's general-purpose model for coding and agent tasks, with text, image and video input; thinking is on by default. Closed to new users on 2026-10-31; retires at the end of 2026-12.",
		deprecated: true,
	},
} as const satisfies Record<string, ModelInfo>
