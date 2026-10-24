// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/reasoning.spec.ts
// When a model uses a budget or an effort at all is decided by shouldUseReasoningBudget and
// shouldUseReasoningEffort (packages/core, own spec). This spec covers how each provider format
// turns that decision into its request field.

import type { ModelInfo, ProviderSettings } from "@tumble-code/types"

import {
	getAnthropicEffort,
	getAnthropicProviderReasoning,
	getAnthropicReasoning,
	getGeminiReasoning,
	getOpenAiReasoning,
	getOpenRouterReasoning,
	isGeminiThinkingLevel,
	type GetModelReasoningOptions,
} from "../reasoning"

const base: ModelInfo = { contextWindow: 16_000, supportsPromptCache: true }

// A model that must think with a budget, one that may (with the toggle), and one with effort levels.
const requiredBudget: ModelInfo = { ...base, requiredReasoningBudget: true }
const optionalBudget: ModelInfo = { ...base, supportsReasoningBudget: true }
const effortModel: ModelInfo = { ...base, supportsReasoningEffort: true }

function options(model: ModelInfo, settings: ProviderSettings = {}, extra: Partial<GetModelReasoningOptions> = {}) {
	return { model, settings, reasoningBudget: 2000, reasoningEffort: undefined, ...extra } as GetModelReasoningOptions
}

describe("getOpenRouterReasoning", () => {
	it.each([
		["a required budget", options(requiredBudget, {}, { reasoningEffort: "high" }), { max_tokens: 2000 }],
		[
			"an optional budget that is on",
			options(optionalBudget, { enableReasoningEffort: true }),
			{ max_tokens: 2000 },
		],
		["an optional budget that is off", options(optionalBudget, { enableReasoningEffort: false }), undefined],
		[
			"an effort",
			options(effortModel, { reasoningEffort: "minimal" }, { reasoningEffort: "minimal" }),
			{ effort: "minimal" },
		],
		["an effort model without an effort", options(effortModel, { reasoningEffort: "low" }), undefined],
		[
			"an effort of disable",
			options(effortModel, { reasoningEffort: "low" }, { reasoningEffort: "disable" }),
			undefined,
		],
		["a model without reasoning", options(base, {}, { reasoningEffort: "high" }), undefined],
	])("%s", (_label, input, expected) => {
		expect(getOpenRouterReasoning(input)).toEqual(expected)
	})
})

describe("getAnthropicReasoning", () => {
	it.each([
		["a required budget", options(requiredBudget), { type: "enabled", budget_tokens: 2000 }],
		[
			"an optional budget that is on",
			options(optionalBudget, { enableReasoningEffort: true }),
			{ type: "enabled", budget_tokens: 2000 },
		],
		["an optional budget that is off", options(optionalBudget), undefined],
		["an effort model", options(effortModel, { reasoningEffort: "high" }, { reasoningEffort: "high" }), undefined],
	])("%s", (_label, input, expected) => {
		expect(getAnthropicReasoning(input)).toEqual(expected)
	})
})

describe("getAnthropicProviderReasoning", () => {
	const adaptive: ModelInfo = { ...optionalBudget, supportsReasoningBinary: true }

	it.each([
		["adaptive thinking for a binary model with reasoning on", adaptive, true, { type: "adaptive" }],
		["nothing for a binary model with reasoning off", adaptive, false, undefined],
		["budget thinking for a budget model", optionalBudget, true, { type: "enabled", budget_tokens: 2000 }],
	])("sends %s", (_label, model, enableReasoningEffort, expected) => {
		expect(getAnthropicProviderReasoning(options(model, { enableReasoningEffort }))).toEqual(expected)
	})
})

describe("getAnthropicEffort", () => {
	const levels: ModelInfo = { ...base, supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"] }

	it.each([
		[
			"a listed level, with thinking off",
			levels,
			{ reasoningEffort: "xhigh", enableReasoningEffort: false },
			"xhigh",
		],
		["nothing without a chosen level (the model default runs)", levels, {}, undefined],
		["nothing for a level the model does not list", levels, { reasoningEffort: "minimal" }, undefined],
		[
			"nothing for a listed level the Messages API does not take",
			{ ...base, supportsReasoningEffort: ["none", "low"] },
			{ reasoningEffort: "none" },
			undefined,
		],
		["nothing for a model without a level list", effortModel, { reasoningEffort: "high" }, undefined],
	])("sends %s", (_label, model, settings, expected) => {
		expect(getAnthropicEffort({ model: model as ModelInfo, settings: settings as ProviderSettings })).toBe(expected)
	})
})

describe("getOpenAiReasoning", () => {
	it.each([
		[
			"the effort literally",
			options(effortModel, { reasoningEffort: "none" }, { reasoningEffort: "none" }),
			{ reasoning_effort: "none" },
		],
		["nothing without an effort", options(effortModel, { reasoningEffort: "low" }), undefined],
		[
			"nothing for disable",
			options(effortModel, { reasoningEffort: "low" }, { reasoningEffort: "disable" }),
			undefined,
		],
		["nothing for a budget model", options(requiredBudget, {}, { reasoningEffort: "high" }), undefined],
	])("sends %s", (_label, input, expected) => {
		expect(getOpenAiReasoning(input)).toEqual(expected)
	})
})

describe("getGeminiReasoning", () => {
	const gemini3: ModelInfo = { ...base, supportsReasoningEffort: ["low", "high"], reasoningEffort: "high" }

	it.each([
		[
			"a thinking budget for a budget model, even with an effort",
			requiredBudget,
			{ reasoningEffort: "low" },
			{ thinkingBudget: 2000, includeThoughts: true },
		],
		// Explicitly chosen efforts count even with the legacy boolean toggle off.
		[
			"the chosen level",
			gemini3,
			{ reasoningEffort: "low", enableReasoningEffort: false },
			{ thinkingLevel: "low", includeThoughts: true },
		],
		["the model default without a choice", gemini3, {}, { thinkingLevel: "high", includeThoughts: true }],
		[
			"the model default for a level it does not list",
			gemini3,
			{ reasoningEffort: "minimal" },
			{ thinkingLevel: "high", includeThoughts: true },
		],
		["nothing for disable", gemini3, { reasoningEffort: "disable" }, undefined],
		["nothing for a level Gemini does not have", gemini3, { reasoningEffort: "none" }, undefined],
		[
			"nothing when the model default is not a Gemini level either",
			{ ...gemini3, reasoningEffort: "none" },
			{ reasoningEffort: "minimal" },
			undefined,
		],
		[
			"any Gemini level when the model lists none",
			effortModel,
			{ reasoningEffort: "minimal" },
			{ thinkingLevel: "minimal", includeThoughts: true },
		],
		["nothing without any effort", base, {}, undefined],
	])("sends %s", (_label, model, settings, expected) => {
		expect(getGeminiReasoning(options(model as ModelInfo, settings as ProviderSettings))).toEqual(expected)
	})

	it.each([
		["minimal", true],
		["high", true],
		["none", false],
		["xhigh", false],
		[undefined, false],
	])("isGeminiThinkingLevel(%s) is %s", (value, expected) => {
		expect(isGeminiThinkingLevel(value)).toBe(expected)
	})
})
