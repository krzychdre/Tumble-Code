import type { ModelInfo } from "../model.js"

// https://docs.anthropic.com/en/docs/about-claude/models
// https://platform.claude.com/docs/en/about-claude/pricing

/**
 * Prices with the 1M context beta (header 'context-1m-2025-08-07'), above 200K tokens of context.
 * A table entry that carries one of these tiers is a model the beta can be enabled for.
 */
const SONNET_4_1M_CONTEXT_TIER = {
	contextWindow: 1_000_000, // 1M tokens with beta flag
	inputPrice: 6.0, // $6 per million input tokens (>200K context)
	outputPrice: 22.5, // $22.50 per million output tokens (>200K context)
	cacheWritesPrice: 7.5, // $7.50 per million tokens (>200K context)
	cacheReadsPrice: 0.6, // $0.60 per million tokens (>200K context)
} as const

/**
 * One record per Claude model as the direct Anthropic API serves it: limits, capabilities and
 * Anthropic's prices. The Anthropic, Vertex and Bedrock tables spread these records and add or
 * replace their platform fields, so a price or limit change is made once here.
 */
export const claudeModels = {
	"opus-5-5": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M native, both the default and the maximum.
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 4.0, // $4 per million input tokens
		outputPrice: 20.0, // $20 per million output tokens
		cacheWritesPrice: 5.0, // $5 per million tokens (1.25x input, 5-minute TTL)
		cacheReadsPrice: 0.2, // $0.20 per million tokens
		// Thinking cannot be disabled on Opus 5.5: `{type: "disabled"}` and
		// `budget_tokens` are both rejected. Turning the toggle off omits the
		// parameter, which the API runs as adaptive thinking, so no request is
		// rejected. Forced tool_choice (`any`/`tool`) is also rejected; we only
		// ever send `auto`.
		supportsReasoningBudget: true,
		supportsReasoningBinary: true,
		supportsTemperature: false,
		description:
			"Claude Opus 5.5 succeeds Opus 5 for long-running agentic coding and knowledge work, at a lower price.",
	},
	"opus-5": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M native, both the default and the maximum.
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		// Thinking is on by default on Opus 5 (omitting the parameter runs adaptive),
		// and disabling it is only accepted at effort `high` or below. Keep the
		// existing token-cap handling and expose reasoning as a binary toggle, the
		// same convention Opus 4.7+ uses on the direct Anthropic provider path.
		supportsReasoningBudget: true,
		supportsReasoningBinary: true,
		supportsTemperature: false,
		description:
			"Claude Opus 5 is Anthropic's model for complex agentic coding and enterprise work, strongest on deep reasoning and long-horizon tasks.",
	},
	"sonnet-5": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0, // $2 per million input tokens
		outputPrice: 10.0, // $10 per million output tokens
		cacheWritesPrice: 2.5, // $2.50 per million tokens
		cacheReadsPrice: 0.2, // $0.20 per million tokens
		// Adaptive thinking is on by default; manual budget_tokens payloads are
		// rejected, so the UI presents a binary toggle here too.
		supportsReasoningBudget: true,
		supportsReasoningBinary: true,
		supportsTemperature: false,
		description:
			"Claude Sonnet 5 offers the best combination of speed and intelligence in the Sonnet tier, reaching near-Opus quality on coding and agentic work.",
	},
	"sonnet-4-6": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M native at standard prices, no beta header.
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
	},
	"sonnet-4-5": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens (≤200K context)
		outputPrice: 15.0, // $15 per million output tokens (≤200K context)
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		tiers: [SONNET_4_1M_CONTEXT_TIER],
	},
	"sonnet-4": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens (≤200K context)
		outputPrice: 15.0, // $15 per million output tokens (≤200K context)
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		tiers: [SONNET_4_1M_CONTEXT_TIER],
	},
	"opus-4-6": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M native at standard prices, no beta header.
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
	},
	"opus-4-7": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		// Keep the hybrid-reasoning capability so Anthropic token-cap handling and
		// stored max-token overrides behave the same as before.
		supportsReasoningBudget: true,
		// Direct Anthropic Opus 4.7 no longer accepts budget-token thinking payloads,
		// so the UI should still present a simple on/off toggle on this provider path.
		supportsReasoningBinary: true,
		supportsTemperature: false,
	},
	"opus-4-8": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M native at standard prices, no beta header (same as 4.7)
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens (regular tier)
		outputPrice: 25.0, // $25 per million output tokens (regular tier)
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		// 4.8 inherits the adaptive-thinking model introduced in 4.7, no breaking
		// API changes. supportsReasoningBudget is kept true so the existing token-cap
		// handling and max-token overrides behave identically.
		supportsReasoningBudget: true,
		// 4.8 still rejects budget_tokens-style thinking payloads, so the UI must
		// expose reasoning as a binary on/off toggle on this provider path.
		supportsReasoningBinary: true,
		supportsTemperature: false,
	},
	"fable-5-1": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0, // $10 per million input tokens
		outputPrice: 50.0, // $50 per million output tokens
		cacheWritesPrice: 12.5, // $12.50 per million tokens
		cacheReadsPrice: 0.25, // $0.25 per million tokens (a quarter of Fable 5's rate)
		// Same always-on thinking contract as Fable 5; additionally rejects forced
		// tool_choice (`any`/`tool`), which we never send.
		supportsReasoningBudget: true,
		supportsReasoningBinary: true,
		supportsTemperature: false,
		description:
			"Claude Fable 5.1 is Anthropic's most capable widely released model, succeeding Fable 5 with stronger long-running agentic coding and research.",
	},
	"fable-5": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 10.0, // $10 per million input tokens
		outputPrice: 50.0, // $50 per million output tokens
		cacheWritesPrice: 12.5, // $12.50 per million tokens
		cacheReadsPrice: 1.0, // $1.00 per million tokens
		// Fable 5 uses the same adaptive-thinking / binary-toggle convention as
		// Opus 4.7+ on the direct Anthropic provider path.
		supportsReasoningBudget: true,
		supportsReasoningBinary: true,
		supportsTemperature: false,
		description:
			"Claude Fable 5 is Anthropic's most capable widely released model for the most demanding reasoning and long-horizon agentic work.",
	},
	"opus-4-5": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
	},
	"opus-4": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0, // $15 per million input tokens
		outputPrice: 75.0, // $75 per million output tokens
		cacheWritesPrice: 18.75, // $18.75 per million tokens
		cacheReadsPrice: 1.5, // $1.50 per million tokens
		supportsReasoningBudget: true,
	},
	"haiku-4-5": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25, // 5m cache writes
		cacheReadsPrice: 0.1, // cache hits / refreshes
		supportsReasoningBudget: true,
		description:
			"Claude Haiku 4.5 delivers near-frontier intelligence at lightning speeds with extended thinking, vision, and multilingual support.",
	},
} as const satisfies Record<string, ModelInfo>

/** A copy of a model record without the named fields, for a platform that does not offer them. */
export function withoutFields<T extends object, K extends keyof T>(info: T, ...fields: K[]): Omit<T, K> {
	const copy = { ...info }
	for (const field of fields) {
		delete copy[field]
	}
	return copy
}

/** The ids of a table's entries that price the 1M context beta, in table order. */
export function oneMillionContextIds<T extends Record<string, ModelInfo>>(table: T): (keyof T & string)[] {
	return Object.entries(table)
		.filter(([, info]) => info.tiers?.some((tier) => tier.contextWindow === 1_000_000 && !tier.name))
		.map(([id]) => id)
}
