import type { ModelInfo } from "../model.js"

import { claudeModels, oneMillionContextIds, withoutTemperature } from "./claude.js"

export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-opus-5"

export const anthropicModels = {
	"claude-opus-5-5": withoutTemperature(claudeModels["opus-5-5"]),
	"claude-opus-5": withoutTemperature(claudeModels["opus-5"]),
	"claude-sonnet-5-5": withoutTemperature(claudeModels["sonnet-5-5"]),
	"claude-sonnet-5": withoutTemperature(claudeModels["sonnet-5"]),
	"claude-sonnet-4-6": withoutTemperature(claudeModels["sonnet-4-6"]),
	// Deprecated on the Claude API on 2026-09-30, retired on 2026-11-30 (model deprecations page).
	"claude-sonnet-4-5": { ...withoutTemperature(claudeModels["sonnet-4-5"]), deprecated: true },
	"claude-opus-4-6": withoutTemperature(claudeModels["opus-4-6"]),
	"claude-opus-4-7": withoutTemperature(claudeModels["opus-4-7"]),
	"claude-opus-4-8": withoutTemperature(claudeModels["opus-4-8"]),
	"claude-fable-5-1": withoutTemperature(claudeModels["fable-5-1"]),
	"claude-fable-5": withoutTemperature(claudeModels["fable-5"]),
	"claude-opus-4-5-20251101": withoutTemperature(claudeModels["opus-4-5"]),
	"claude-haiku-5-5": withoutTemperature(claudeModels["haiku-5-5"]),
	"claude-haiku-4-5-20251001": withoutTemperature(claudeModels["haiku-4-5"]),
} as const satisfies Record<string, ModelInfo>

/**
 * Models the 1M context beta (header 'context-1m-2025-08-07') can be enabled for: the entries that
 * price its tier. The settings checkbox and the request header use the same list.
 */
export const ANTHROPIC_1M_CONTEXT_MODEL_IDS: readonly string[] = oneMillionContextIds(anthropicModels)

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192
