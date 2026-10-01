import type { ModelInfo } from "../model.js"

import { claudeModels, oneMillionContextIds } from "./claude.js"

export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-opus-5"

export const anthropicModels = {
	"claude-opus-5-5": { ...claudeModels["opus-5-5"] },
	"claude-opus-5": { ...claudeModels["opus-5"] },
	"claude-sonnet-5": { ...claudeModels["sonnet-5"] },
	"claude-sonnet-4-6": { ...claudeModels["sonnet-4-6"] },
	"claude-sonnet-4-5": { ...claudeModels["sonnet-4-5"] },
	"claude-sonnet-4-20250514": { ...claudeModels["sonnet-4"] },
	"claude-opus-4-6": { ...claudeModels["opus-4-6"] },
	"claude-opus-4-7": { ...claudeModels["opus-4-7"] },
	"claude-opus-4-8": { ...claudeModels["opus-4-8"] },
	"claude-fable-5-1": { ...claudeModels["fable-5-1"] },
	"claude-fable-5": { ...claudeModels["fable-5"] },
	"claude-opus-4-5-20251101": { ...claudeModels["opus-4-5"] },
	"claude-opus-4-20250514": { ...claudeModels["opus-4"] },
	"claude-haiku-4-5-20251001": { ...claudeModels["haiku-4-5"] },
} as const satisfies Record<string, ModelInfo>

/**
 * Models the 1M context beta (header 'context-1m-2025-08-07') can be enabled for: the entries that
 * price its tier. The settings checkbox and the request header use the same list.
 */
export const ANTHROPIC_1M_CONTEXT_MODEL_IDS: readonly string[] = oneMillionContextIds(anthropicModels)

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192
