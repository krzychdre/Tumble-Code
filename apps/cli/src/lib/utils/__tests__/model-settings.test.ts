import { findModelSettingsProblems, getConfiguredContextWindow } from "../model-settings.js"

describe("getConfiguredContextWindow", () => {
	const models = { "GLM-5.3-NVFP4": { contextWindow: 262_144 }, "Qwen3.8-27B": {} }

	it("finds the entry by the exact model id", () => {
		expect(getConfiguredContextWindow(models, "GLM-5.3-NVFP4")).toBe(262_144)
		expect(getConfiguredContextWindow(models, "glm-5.3-nvfp4")).toBeUndefined()
	})

	it("is undefined for a model without a size, and without a models map", () => {
		expect(getConfiguredContextWindow(models, "Qwen3.8-27B")).toBeUndefined()
		expect(getConfiguredContextWindow(undefined, "GLM-5.3-NVFP4")).toBeUndefined()
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

	it("rejects a map or an entry that is not an object", () => {
		expect(findModelSettingsProblems([])[0]).toMatch(/^models must be an object keyed by model id/)
		expect(findModelSettingsProblems({ m: 262_144 })).toEqual([
			'models.m must be an object, e.g. { "contextWindow": 262144 }',
		])
	})
})
