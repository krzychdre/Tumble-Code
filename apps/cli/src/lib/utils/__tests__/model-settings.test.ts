import { findModelSettingsProblems, getConfiguredModelSettings, listSetModelSettings } from "../model-settings.js"

describe("getConfiguredModelSettings", () => {
	const models = { "GLM-5.3-NVFP4": { contextWindow: 262_144, inputPrice: 0.6 }, "Qwen3.8-27B": {} }

	it("finds the entry by the exact model id", () => {
		expect(getConfiguredModelSettings(models, "GLM-5.3-NVFP4")).toEqual({ contextWindow: 262_144, inputPrice: 0.6 })
		expect(getConfiguredModelSettings(models, "glm-5.3-nvfp4")).toBeUndefined()
	})

	it("is undefined without a models map", () => {
		expect(getConfiguredModelSettings(undefined, "GLM-5.3-NVFP4")).toBeUndefined()
	})
})

describe("listSetModelSettings", () => {
	it("names the keys an entry sets", () => {
		expect(listSetModelSettings({ contextWindow: 1, outputPrice: 2, inputPrice: undefined })).toEqual([
			"contextWindow",
			"outputPrice",
		])
		expect(listSetModelSettings({ preserveReasoning: true, trimOldReasoning: false })).toEqual([
			"preserveReasoning",
			"trimOldReasoning",
		])
		expect(listSetModelSettings({})).toEqual([])
		expect(listSetModelSettings(undefined)).toEqual([])
	})
})

describe("findModelSettingsProblems", () => {
	it("accepts no map, an empty map and whole positive sizes", () => {
		expect(findModelSettingsProblems(undefined)).toEqual([])
		expect(findModelSettingsProblems({})).toEqual([])
		expect(findModelSettingsProblems({ a: { contextWindow: 262_144 }, b: {} })).toEqual([])
	})

	it("names the model and shows the bad value", () => {
		expect(findModelSettingsProblems({ "GLM-5.3-NVFP4": { contextWindow: "262k" } })).toEqual([
			'models.GLM-5.3-NVFP4.contextWindow must be a whole number of tokens greater than 0, got "262k"',
		])
	})

	it.each([0, -1, 1.5])("rejects %s", (contextWindow) => {
		expect(findModelSettingsProblems({ m: { contextWindow } })).toHaveLength(1)
	})

	it("accepts prices of 0 or more, fractions included", () => {
		expect(
			findModelSettingsProblems({
				m: { inputPrice: 0.6, outputPrice: 2.2, cacheReadsPrice: 0.11, cacheWritesPrice: 0 },
			}),
		).toEqual([])
	})

	it.each([-1, "0.6", Number.POSITIVE_INFINITY, null])("rejects the price %s and names the field", (inputPrice) => {
		expect(findModelSettingsProblems({ m: { inputPrice } })).toEqual([
			`models.m.inputPrice must be a number of USD per million tokens, 0 or more, got ${JSON.stringify(inputPrice)}`,
		])
	})

	it.each(["preserveReasoning", "trimOldReasoning"])("accepts %s true or false and rejects anything else", (key) => {
		expect(findModelSettingsProblems({ m: { [key]: true }, n: { [key]: false } })).toEqual([])
		expect(findModelSettingsProblems({ m: { [key]: "true" } })).toEqual([
			`models.m.${key} must be true or false, got "true"`,
		])
	})

	it("rejects a map or an entry that is not an object", () => {
		expect(findModelSettingsProblems([])[0]).toMatch(/^models must be an object keyed by model id/)
		expect(findModelSettingsProblems({ m: 262_144 })).toEqual([
			'models.m must be an object, e.g. { "contextWindow": 262144 }',
		])
	})
})
