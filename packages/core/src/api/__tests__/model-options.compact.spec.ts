import { type ModelInfo, type ProviderSettings, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@tumble-code/types"

import { getCompactOutputReservation, getModelMaxOutputTokens } from "../model-options.js"

/** The OpenAI-compatible custom model info a local llama.cpp profile saves: maxTokens left at -1. */
const localModel: ModelInfo = {
	maxTokens: -1,
	contextWindow: 40960,
	supportsPromptCache: false,
}

const profile: ProviderSettings = { apiProvider: "openai", openAiModelId: "qwen3.5-4b-q4_k_m" }
const compact: ProviderSettings = { ...profile, compactProfile: true }

describe("getCompactOutputReservation", () => {
	it("reserves min(4096, floor(contextWindow * 0.15))", () => {
		expect(getCompactOutputReservation(40960)).toBe(4096)
		expect(getCompactOutputReservation(16384)).toBe(2457)
		expect(getCompactOutputReservation(131072)).toBe(4096)
	})

	it("falls back to 4096 for an unknown window", () => {
		expect(getCompactOutputReservation(0)).toBe(4096)
	})
})

describe("getModelMaxOutputTokens under the compact profile", () => {
	it.each([
		["-1", -1],
		["0", 0],
		["missing", undefined],
	])("reserves the compact output when maxTokens is %s", (_label, maxTokens) => {
		const model = { ...localModel, maxTokens }
		for (const format of [undefined, "openai"] as const) {
			expect(getModelMaxOutputTokens({ modelId: "qwen3.5-4b-q4_k_m", model, settings: compact, format })).toBe(
				4096,
			)
		}
	})

	it("keeps today's 20 percent clamp for a positive maxTokens", () => {
		const model = { ...localModel, maxTokens: 16384 }
		expect(getModelMaxOutputTokens({ modelId: "qwen3.5-4b-q4_k_m", model, settings: compact })).toBe(8192)
		expect(
			getModelMaxOutputTokens({
				modelId: "qwen3.5-4b-q4_k_m",
				model: { ...model, maxTokens: 2000 },
				settings: compact,
			}),
		).toBe(2000)
	})

	it("keeps an explicit modelMaxTokens on a model with a max-output slider", () => {
		const model = { ...localModel, maxTokens: undefined, supportsMaxTokens: true }
		expect(
			getModelMaxOutputTokens({
				modelId: "qwen3.5-4b-q4_k_m",
				model,
				settings: { ...compact, modelMaxTokens: 1500 },
				format: "openai",
			}),
		).toBe(1500)
	})

	it("replaces the 8192 Anthropic fallback for a model without maxTokens", () => {
		const model = { ...localModel, maxTokens: undefined }
		expect(getModelMaxOutputTokens({ modelId: "claude-local", model, settings: compact })).toBe(4096)
	})

	describe("flag off: today's values", () => {
		for (const [label, settings] of [
			["absent", profile],
			["false", { ...profile, compactProfile: false }],
		] as const) {
			it(`with the flag ${label}`, () => {
				// -1 wins the min against the 20 percent clamp: no output space is reserved.
				expect(getModelMaxOutputTokens({ modelId: "qwen3.5-4b-q4_k_m", model: localModel, settings })).toBe(-1)
				expect(
					getModelMaxOutputTokens({
						modelId: "qwen3.5-4b-q4_k_m",
						model: localModel,
						settings,
						format: "openai",
					}),
				).toBe(-1)
				const noMax = { ...localModel, maxTokens: undefined }
				expect(
					getModelMaxOutputTokens({ modelId: "qwen3.5-4b-q4_k_m", model: noMax, settings, format: "openai" }),
				).toBe(undefined)
				expect(getModelMaxOutputTokens({ modelId: "qwen3.5-4b-q4_k_m", model: noMax, settings })).toBe(
					ANTHROPIC_DEFAULT_MAX_TOKENS,
				)
			})
		}
	})
})
