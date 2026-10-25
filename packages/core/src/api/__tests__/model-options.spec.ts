import { type ModelInfo, type ProviderSettings, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@tumble-code/types"

import { getModelMaxOutputTokens, shouldUseReasoningBudget, shouldUseReasoningEffort } from "../model-options.js"

const model = (info: Partial<ModelInfo> = {}): ModelInfo => ({
	contextWindow: 200_000,
	supportsPromptCache: true,
	...info,
})

type Format = "anthropic" | "openai" | "gemini" | "openrouter" | undefined

describe("getModelMaxOutputTokens", () => {
	const hybrid = model({ maxTokens: 64_000, supportsReasoningBudget: true })

	it.each<[string, string, ModelInfo, ProviderSettings, Format, number | undefined]>([
		[
			"a maxTokens within 20 percent of the window",
			"claude-3-5-sonnet",
			model({ maxTokens: 8192 }),
			{},
			undefined,
			8192,
		],
		[
			"a maxTokens above 20 percent, clamped",
			"glm-4.6",
			model({ maxTokens: 64_000, contextWindow: 100_000 }),
			{},
			"openai",
			20_000,
		],
		[
			"a Claude maxTokens above 20 percent, clamped",
			"claude-x",
			model({ maxTokens: 64_000, contextWindow: 100_000 }),
			{},
			undefined,
			20_000,
		],
		["GPT-5, unclamped (any case)", "openai/GPT-5-chat", model({ maxTokens: 128_000 }), {}, "openai", 128_000],
		[
			"a required reasoning budget",
			"claude-3-7",
			model({ requiredReasoningBudget: true }),
			{ modelMaxTokens: 32_000 },
			undefined,
			32_000,
		],
		[
			"a required reasoning budget without modelMaxTokens",
			"x",
			model({ requiredReasoningBudget: true }),
			{},
			undefined,
			16_384,
		],
		[
			"an enabled reasoning budget",
			"claude-opus-4-8",
			hybrid,
			{ enableReasoningEffort: true, modelMaxTokens: 32_768 },
			undefined,
			32_768,
		],
		[
			"a hybrid model by Claude id, budget off",
			"claude-sonnet-4",
			hybrid,
			{ enableReasoningEffort: false },
			undefined,
			ANTHROPIC_DEFAULT_MAX_TOKENS,
		],
		["a hybrid model in the Anthropic format", "my-model", hybrid, {}, "anthropic", ANTHROPIC_DEFAULT_MAX_TOKENS],
		[
			"a hybrid model on OpenRouter's anthropic/",
			"anthropic/sonnet-x",
			hybrid,
			{},
			"openrouter",
			ANTHROPIC_DEFAULT_MAX_TOKENS,
		],
		["a hybrid model elsewhere, clamped", "gemini-2.5-flash", hybrid, {}, "gemini", 40_000],
		[
			"a hybrid model on OpenRouter from another vendor, clamped",
			"google/gemini-x",
			hybrid,
			{},
			"openrouter",
			40_000,
		],
		[
			"an Anthropic-format model with maxTokens 0",
			"my-model",
			model({ maxTokens: 0 }),
			{},
			"anthropic",
			ANTHROPIC_DEFAULT_MAX_TOKENS,
		],
		[
			"the user's max-output slider",
			"glm-4.6",
			model({ maxTokens: 131_072, supportsMaxTokens: true }),
			{ modelMaxTokens: 50_000 },
			"openai",
			50_000,
		],
		[
			"the slider, capped at the model's ceiling",
			"glm-4.6",
			model({ maxTokens: 131_072, supportsMaxTokens: true }),
			{ modelMaxTokens: 200_000 },
			"openai",
			131_072,
		],
		[
			"the slider without a ceiling",
			"x",
			model({ supportsMaxTokens: true }),
			{ modelMaxTokens: 3_000 },
			"openai",
			3_000,
		],
		[
			"a slider model without a value, clamped",
			"glm-4.6",
			model({ maxTokens: 131_072, supportsMaxTokens: true }),
			{},
			"openai",
			40_000,
		],
		["no maxTokens with a format", "x", model(), {}, "openai", undefined],
		["no maxTokens without a format", "x", model(), {}, undefined, ANTHROPIC_DEFAULT_MAX_TOKENS],
	])("for %s", (_name, modelId, info, settings, format, expected) => {
		expect(getModelMaxOutputTokens({ modelId, model: info, settings, format })).toBe(expected)
	})
})

it.each<[string, Partial<ModelInfo>, ProviderSettings | undefined, boolean]>([
	["a required budget", { requiredReasoningBudget: true }, undefined, true],
	[
		"a supported budget the settings enable",
		{ supportsReasoningBudget: true },
		{ enableReasoningEffort: true },
		true,
	],
	["a supported budget the settings leave off", { supportsReasoningBudget: true }, {}, false],
	["no budget support", {}, { enableReasoningEffort: true }, false],
])("shouldUseReasoningBudget: %s -> %s", (_name, info, settings, expected) => {
	expect(shouldUseReasoningBudget({ model: model(info), settings })).toBe(expected)
})

describe("shouldUseReasoningEffort", () => {
	const effort = (value: string) => value as ProviderSettings["reasoningEffort"]
	const levels = ["disable", "none", "minimal", "low"] as unknown as ModelInfo["supportsReasoningEffort"]

	it.each<[string, Partial<ModelInfo>, ProviderSettings | undefined, boolean]>([
		["a model default effort", { reasoningEffort: "medium" }, undefined, true],
		["the off switch over a model default", { reasoningEffort: "medium" }, { enableReasoningEffort: false }, false],
		[
			"the off switch over a selected effort",
			{ supportsReasoningEffort: true },
			{ enableReasoningEffort: false, reasoningEffort: "medium" },
			false,
		],
		["support with a selected effort", { supportsReasoningEffort: true }, { reasoningEffort: "high" }, true],
		[
			"support with none or minimal selected",
			{ supportsReasoningEffort: true },
			{ reasoningEffort: effort("minimal") },
			true,
		],
		["support without a selected effort", { supportsReasoningEffort: true }, {}, false],
		["a selection without support or a model default", {}, { reasoningEffort: "high" }, false],
		["a level in the model's list", { supportsReasoningEffort: levels }, { reasoningEffort: effort("none") }, true],
		["a level outside the model's list", { supportsReasoningEffort: levels }, { reasoningEffort: "high" }, false],
		["no level with a list", { supportsReasoningEffort: levels }, {}, false],
		[
			"disable, even when listed",
			{ supportsReasoningEffort: levels },
			{ enableReasoningEffort: true, reasoningEffort: effort("disable") },
			false,
		],
	])("%s -> %s", (_name, info, settings, expected) => {
		expect(shouldUseReasoningEffort({ model: model(info), settings })).toBe(expected)
	})
})
