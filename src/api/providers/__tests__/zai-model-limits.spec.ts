// DEF-C36: every Z.ai GLM entry must carry its documented output ceiling and context
// window, and the max_tokens the extension actually sends (through the shared
// getModelMaxOutputTokens rule) must follow from them.
//
// Sources (fetched 2026-09-24):
// - Output ceilings, international line: the "default / maximum max_tokens" table in
//   https://docs.z.ai/guides/overview/concept-param#max_tokens
//   (glm-5.x, glm-5, glm-4.7, glm-4.6: 131072; glm-4.5 family: 98304;
//   glm-4.6v family: 32768; glm-4.5v and glm-4-32b-0414-128k: 16384), repeated in the
//   max_tokens description of https://docs.z.ai/api-reference/llm/chat-completion
// - Output ceilings, mainland line: the same table in
//   https://docs.bigmodel.cn/cn/guide/start/concept-param#max_tokens
// - glm-4.7-flash / glm-4.7-flashx (not in the tables): the model cards on
//   https://docs.z.ai/guides/llm/glm-4.7 and https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash
//   (200K context, 128K maximum output)
// - Context windows: the model cards on https://docs.z.ai/guides/llm/<model> and
//   https://docs.z.ai/guides/vlm/<model>, plus the table in https://docs.z.ai/guides/overview/overview.
//   glm-4.5v is 64K there and on https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.5v
//   (not 128K). "200K" is stored as 200_000 on the international line and 204_800 on
//   the mainland line; that pre-existing difference is kept as is.
//
// supportsMaxTokens (the max-output slider) is set on every model whose documented
// ceiling is above the default 20%-of-context clamp, so the user can raise the output
// budget up to the documented ceiling. Models whose ceiling is already at or below the
// clamp (glm-4.5v, glm-4-32b-0414-128k) have nothing to raise and get no slider.

import { internationalZAiModels, mainlandZAiModels, type ModelInfo } from "@roo-code/types"

import { getModelMaxOutputTokens } from "../../../shared/api"

type Limits = {
	maxTokens: number
	contextWindow: number
	slider: boolean
	// max_tokens sent with no user override (20% clamp or the ceiling, whichever is lower)
	effective: number
}

const K128_OUT = 131_072
const K96_OUT = 98_304
const K32_OUT = 32_768
const K16_OUT = 16_384

const international: Record<keyof typeof internationalZAiModels, Limits> = {
	"glm-4.5": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-air": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-x": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-airx": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-flash": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5v": { maxTokens: K16_OUT, contextWindow: 65_536, slider: false, effective: 13_108 },
	"glm-4.6v": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.6": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-4.7": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-5": { maxTokens: K128_OUT, contextWindow: 202_752, slider: true, effective: 40_551 },
	"glm-5-turbo": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-5.1": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-5.2": { maxTokens: K128_OUT, contextWindow: 1_000_000, slider: true, effective: K128_OUT },
	"glm-5.3": { maxTokens: K128_OUT, contextWindow: 1_000_000, slider: true, effective: K128_OUT },
	"glm-4.7-flash": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-4.7-flashx": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-4.6v-flash": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.6v-flashx": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-5v-turbo": { maxTokens: K128_OUT, contextWindow: 200_000, slider: true, effective: 40_000 },
	"glm-4-32b-0414-128k": { maxTokens: K16_OUT, contextWindow: 131_072, slider: false, effective: K16_OUT },
}

const mainland: Record<keyof typeof mainlandZAiModels, Limits> = {
	"glm-4.5": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-air": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-x": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-airx": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5-flash": { maxTokens: K96_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.5v": { maxTokens: K16_OUT, contextWindow: 65_536, slider: false, effective: 13_108 },
	"glm-4.6": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-4.7": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-5": { maxTokens: K128_OUT, contextWindow: 202_752, slider: true, effective: 40_551 },
	"glm-5-turbo": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-5.1": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-5.2": { maxTokens: K128_OUT, contextWindow: 1_000_000, slider: true, effective: K128_OUT },
	"glm-5.3": { maxTokens: K128_OUT, contextWindow: 1_000_000, slider: true, effective: K128_OUT },
	"glm-4.7-flash": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-4.7-flashx": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
	"glm-4.6v": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.6v-flash": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-4.6v-flashx": { maxTokens: K32_OUT, contextWindow: 131_072, slider: true, effective: 26_215 },
	"glm-5v-turbo": { maxTokens: K128_OUT, contextWindow: 204_800, slider: true, effective: 40_960 },
}

const lines = [
	{ line: "international", models: internationalZAiModels as Record<string, ModelInfo>, expected: international },
	{ line: "mainland", models: mainlandZAiModels as Record<string, ModelInfo>, expected: mainland },
] as const

describe.each(lines)("Z.ai $line GLM limits (DEF-C36)", ({ models, expected }) => {
	it("has an expectation for every model in the table", () => {
		expect(Object.keys(expected).sort()).toEqual(Object.keys(models).sort())
	})

	describe.each(Object.entries(expected))("%s", (modelId, limits) => {
		const info = models[modelId]!

		it("carries the documented output ceiling and context window", () => {
			expect(info.maxTokens).toBe(limits.maxTokens)
			expect(info.contextWindow).toBe(limits.contextWindow)
		})

		it(limits.slider ? "exposes the max-output slider" : "has no max-output slider", () => {
			expect(info.supportsMaxTokens === true).toBe(limits.slider)
		})

		it(`sends max_tokens ${limits.effective} when the user has not set an override`, () => {
			expect(getModelMaxOutputTokens({ modelId, model: info, settings: {}, format: "openai" })).toBe(
				limits.effective,
			)
		})

		it("lets the user raise max_tokens to the documented ceiling, never past it", () => {
			const sent = getModelMaxOutputTokens({
				modelId,
				model: info,
				settings: { modelMaxTokens: 200_000 },
				format: "openai",
			})
			// Without the slider the override is ignored and the default applies.
			expect(sent).toBe(limits.slider ? limits.maxTokens : limits.effective)
		})
	})
})
