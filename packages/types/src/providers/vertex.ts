import type { ModelInfo } from "../model.js"

import { claudeModels, oneMillionContextIds, withoutFields, withoutTemperature } from "./claude.js"
import { geminiModels } from "./gemini.js"

// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
export type VertexModelId = keyof typeof vertexModels

export const vertexDefaultModelId: VertexModelId = "claude-opus-5"

// Info stand-ins for a model id that is not in the table, one per handler (see `vertexModelFamily`).
// Only the info is used, never the id. An unknown Claude id gets Claude Sonnet 4.5: it lists no effort
// levels, so a newer Claude we know nothing about gets no effort. An unknown Gemini (or open) id gets
// Gemini 3.1 Pro: Vertex serves no Gemini older than 3 any more, and its default thinking level `low` is one
// every Gemini 3 model accepts.
export const vertexUnknownClaudeModelStandInId: VertexModelId = "claude-sonnet-4-5@20250929"
export const vertexUnknownGeminiModelStandInId: VertexModelId = "gemini-3.1-pro-preview"

export const vertexModels = {
	"gemini-3.5-flash": { ...geminiModels["gemini-3.5-flash"] },
	"gemini-3.1-pro-preview": { ...geminiModels["gemini-3.1-pro-preview"] },
	"gemini-3.1-pro-preview-customtools": { ...geminiModels["gemini-3.1-pro-preview-customtools"] },
	"gemini-3-flash-preview": { ...geminiModels["gemini-3-flash-preview"] },
	"claude-sonnet-4@20250514": withoutTemperature(claudeModels["sonnet-4"]),
	"claude-sonnet-4-5@20250929": withoutTemperature(claudeModels["sonnet-4-5"]),
	"claude-sonnet-4-6": withoutTemperature(claudeModels["sonnet-4-6"]),
	"claude-haiku-5-5": withoutTemperature(claudeModels["haiku-5-5"]),
	"claude-haiku-4-5@20251001": withoutTemperature(withoutFields(claudeModels["haiku-4-5"], "description")),
	"claude-opus-4-6": withoutTemperature(claudeModels["opus-4-6"]),
	"claude-opus-4-7": withoutTemperature(claudeModels["opus-4-7"]),
	"claude-opus-4-8": withoutTemperature(claudeModels["opus-4-8"]),
	"claude-opus-5-5": withoutTemperature(claudeModels["opus-5-5"]),
	"claude-opus-5": withoutTemperature(claudeModels["opus-5"]),
	"claude-sonnet-5-5": withoutTemperature(claudeModels["sonnet-5-5"]),
	"claude-sonnet-5": withoutTemperature(claudeModels["sonnet-5"]),
	"claude-fable-5-1": withoutTemperature(claudeModels["fable-5-1"]),
	"claude-fable-5": withoutTemperature(claudeModels["fable-5"]),
	"claude-opus-4-5@20251101": withoutTemperature(claudeModels["opus-4-5"]),
	"claude-opus-4@20250514": withoutTemperature(withoutFields(claudeModels["opus-4"], "supportsReasoningBudget")),
} as const satisfies Record<string, ModelInfo>

// Vertex AI models that support 1M context window beta: the Claude entries that price its tier.
// Uses the same beta header 'context-1m-2025-08-07' as Anthropic and Bedrock
export const VERTEX_1M_CONTEXT_MODEL_IDS: readonly string[] = oneMillionContextIds(vertexModels)

export const VERTEX_REGIONS = [
	{ value: "global", label: "global" },
	{ value: "us", label: "us" },
	{ value: "eu", label: "eu" },
	{ value: "us-central1", label: "us-central1" },
	{ value: "us-east1", label: "us-east1" },
	{ value: "us-east4", label: "us-east4" },
	{ value: "us-east5", label: "us-east5" },
	{ value: "us-south1", label: "us-south1" },
	{ value: "us-west1", label: "us-west1" },
	{ value: "us-west2", label: "us-west2" },
	{ value: "us-west3", label: "us-west3" },
	{ value: "us-west4", label: "us-west4" },
	{ value: "northamerica-northeast1", label: "northamerica-northeast1" },
	{ value: "northamerica-northeast2", label: "northamerica-northeast2" },
	{ value: "southamerica-east1", label: "southamerica-east1" },
	{ value: "europe-west1", label: "europe-west1" },
	{ value: "europe-west2", label: "europe-west2" },
	{ value: "europe-west3", label: "europe-west3" },
	{ value: "europe-west4", label: "europe-west4" },
	{ value: "europe-west6", label: "europe-west6" },
	{ value: "europe-central2", label: "europe-central2" },
	{ value: "asia-east1", label: "asia-east1" },
	{ value: "asia-east2", label: "asia-east2" },
	{ value: "asia-northeast1", label: "asia-northeast1" },
	{ value: "asia-northeast2", label: "asia-northeast2" },
	{ value: "asia-northeast3", label: "asia-northeast3" },
	{ value: "asia-south1", label: "asia-south1" },
	{ value: "asia-south2", label: "asia-south2" },
	{ value: "asia-southeast1", label: "asia-southeast1" },
	{ value: "asia-southeast2", label: "asia-southeast2" },
	{ value: "australia-southeast1", label: "australia-southeast1" },
	{ value: "australia-southeast2", label: "australia-southeast2" },
	{ value: "me-west1", label: "me-west1" },
	{ value: "me-central1", label: "me-central1" },
	{ value: "africa-south1", label: "africa-south1" },
]
