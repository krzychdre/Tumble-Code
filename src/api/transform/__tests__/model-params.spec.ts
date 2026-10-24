// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/model-params.spec.ts
// The max tokens rule (getModelMaxOutputTokens) and the budget/effort decisions live in
// packages/core with their own specs, the per-format reasoning fields in reasoning.spec. This
// spec covers what getModelParams adds: temperature, the thinking budget arithmetic, the
// effort resolution and which reasoning field each format gets.

import { type ModelInfo, type ProviderSettings, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@tumble-code/types"

import { getModelParams } from "../model-params"

const base: ModelInfo = { contextWindow: 16_000, supportsPromptCache: true }
const budgetModel: ModelInfo = { ...base, maxTokens: 16_000, requiredReasoningBudget: true }
const effortModel: ModelInfo = { ...base, supportsReasoningEffort: true, reasoningEffort: "medium" }

type Format = "anthropic" | "openai" | "gemini" | "openrouter"

function params(format: Format, model: ModelInfo, settings: ProviderSettings = {}, modelId = "test-model") {
	return getModelParams({ format: format as "anthropic", modelId, model, settings, defaultTemperature: 0.5 })
}

describe("temperature", () => {
	it.each([
		["the provider default", base, {}, 0.5],
		["the model default over the provider's", { ...base, defaultTemperature: 0.7 }, {}, 0.7],
		["the user's over the model's", { ...base, defaultTemperature: 0.7 }, { modelTemperature: 0.2 }, 0.2],
		["the defaults for a null setting", base, { modelTemperature: null }, 0.5],
		["1.0 for budget thinking", budgetModel, { modelTemperature: 0.2 }, 1.0],
	])("is %s", (_label, model, settings, temperature) => {
		expect(params("openai", model, settings as ProviderSettings).temperature).toBe(temperature)
	})

	const noTemperature: ModelInfo = { ...base, supportsTemperature: false }

	it.each([
		["anthropic", noTemperature, "test-model", undefined],
		["openrouter", noTemperature, "test-model", undefined],
		["openrouter", base, "openai/o1-pro", undefined],
		["openai", base, "o1-preview", undefined],
		["openai", base, "o3-mini-high", undefined],
		// The openai format decides by id only.
		["openai", noTemperature, "gpt-4", 0.5],
		["gemini", noTemperature, "gemini-3-pro", 0.5],
	] as const)("%s format with %o and id %s sends %s", (format, model, modelId, temperature) => {
		expect(params(format, model, {}, modelId).temperature).toBe(temperature)
	})
})

describe("thinking budget", () => {
	it.each([
		["the user's budget", "test-model", 16_000, 3000, 3000],
		["the default budget", "test-model", 16_000, undefined, 8192],
		["at most 80% of the max tokens", "test-model", 4000, 5000, 3200],
		["at least 1024 tokens", "test-model", 16_000, 500, 1024],
		["128 by default for Gemini 2.5 Pro", "gemini-2.5-pro", 16_000, undefined, 128],
		["at least 128 tokens for Gemini 2.5 Pro", "gemini-2.5-pro-preview", 16_000, 50, 128],
	])("is %s", (_label, modelId, modelMaxTokens, modelMaxThinkingTokens, budget) => {
		const result = params("anthropic", budgetModel, { modelMaxTokens, modelMaxThinkingTokens }, modelId)
		expect(result.reasoningBudget).toBe(budget)
		expect(result.maxTokens).toBe(modelMaxTokens)
	})

	it("is not used for an optional budget with the toggle off", () => {
		const result = params("anthropic", { ...base, supportsReasoningBudget: true }, { modelMaxThinkingTokens: 3000 })
		expect(result.reasoningBudget).toBeUndefined()
		expect(result.reasoning).toBeUndefined()
		expect(result.maxTokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
	})

	it("wins over the effort for a model with both and the toggle on", () => {
		const both = { ...effortModel, supportsReasoningBudget: true, maxTokens: 16_000 }
		const result = params("anthropic", both, { enableReasoningEffort: true, reasoningEffort: "high" })
		expect(result.reasoningBudget).toBe(8192)
		expect(result.reasoningEffort).toBeUndefined()
	})
})

describe("reasoning effort", () => {
	it.each([
		["the user's effort", { reasoningEffort: "high" }, "high"],
		["the model default without a choice", {}, "medium"],
		["nothing for disable, without falling back", { reasoningEffort: "disable" }, undefined],
	])("is %s", (_label, settings, effort) => {
		expect(params("openai", effortModel, settings as ProviderSettings).reasoningEffort).toBe(effort)
	})
})

describe("reasoning field per format", () => {
	it.each([
		["anthropic", budgetModel, {}, { type: "enabled", budget_tokens: 8192 }],
		["openrouter", budgetModel, {}, { max_tokens: 8192 }],
		["openai", effortModel, {}, { reasoning_effort: "medium" }],
		["openrouter", effortModel, {}, { effort: "medium" }],
		[
			"gemini",
			{ ...effortModel, supportsReasoningEffort: ["low", "medium"] },
			{},
			{ thinkingLevel: "medium", includeThoughts: true },
		],
		["anthropic", effortModel, {}, undefined],
	] as const)("%s format with %o sends %o", (format, model, settings, reasoning) => {
		const result = params(format, model as ModelInfo, settings)
		expect(result.format).toBe(format)
		expect(result.reasoning).toEqual(reasoning)
	})
})

it("passes the verbosity through", () => {
	expect(params("openai", base, { verbosity: "high" }).verbosity).toBe("high")
	expect(params("openai", base).verbosity).toBeUndefined()
})
