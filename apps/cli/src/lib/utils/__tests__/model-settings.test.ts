import {
	findModeBindingProblems,
	findModelSettingsProblems,
	getConfiguredModelSettings,
	getEffectiveModeSettings,
	listSetModelSettings,
} from "../model-settings.js"

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
		// Other providers take image support from their own model tables.
		expect(listSetModelSettings({ supportsImages: false })).toEqual(["supportsImages"])
		// Every provider takes these, so they are never reported as ignored.
		expect(listSetModelSettings({ reasoningEffort: "high", modelSize: "compact", hideMcp: false })).toEqual([])
		expect(listSetModelSettings({ maxConcurrentRequests: 4 })).toEqual([])
		expect(listSetModelSettings({ provider: "zai", baseUrl: "x", apiKey: "k", apiKeyEnv: "K" })).toEqual([])
		expect(listSetModelSettings({ modes: ["code"] })).toEqual([])
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

	it("accepts a whole number of concurrent requests from 1", () => {
		expect(findModelSettingsProblems({ a: { maxConcurrentRequests: 1 }, b: { maxConcurrentRequests: 8 } })).toEqual(
			[],
		)
	})

	it.each([0, -1, 1.5, "4"])("rejects %s concurrent requests and names the field", (maxConcurrentRequests) => {
		expect(findModelSettingsProblems({ m: { maxConcurrentRequests } })).toEqual([
			`models.m.maxConcurrentRequests must be a whole number of requests greater than 0, got ${JSON.stringify(maxConcurrentRequests)}`,
		])
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

	it.each(["preserveReasoning", "trimOldReasoning", "hideMcp", "supportsImages"])(
		"accepts %s true or false and rejects anything else",
		(key) => {
			expect(findModelSettingsProblems({ m: { [key]: true }, n: { [key]: false } })).toEqual([])
			expect(findModelSettingsProblems({ m: { [key]: "true" } })).toEqual([
				`models.m.${key} must be true or false, got "true"`,
			])
		},
	)

	it("accepts the three model sizes and rejects anything else", () => {
		expect(
			findModelSettingsProblems({
				a: { modelSize: "standard" },
				b: { modelSize: "slim" },
				c: { modelSize: "compact" },
			}),
		).toEqual([])
		expect(findModelSettingsProblems({ m: { modelSize: "small" } })).toEqual([
			'models.m.modelSize must be one of: standard, slim, compact, got "small"',
		])
	})

	it.each(["provider", "baseUrl", "apiKey", "apiKeyEnv"])("accepts %s as a non-empty string only", (key) => {
		expect(findModelSettingsProblems({ m: { [key]: "x" } })).toEqual([])
		expect(findModelSettingsProblems({ m: { [key]: "" } })).toEqual([
			`models.m.${key} must be a non-empty string, got ""`,
		])
		expect(findModelSettingsProblems({ m: { [key]: 1 } })).toHaveLength(1)
	})

	it("accepts modes as a list of mode slugs, repeats included, and rejects anything else", () => {
		expect(findModelSettingsProblems({ m: { modes: ["code", "debug", "code"] }, n: { modes: [] } })).toEqual([])
		expect(findModelSettingsProblems({ m: { modes: "code" } })).toEqual([
			'models.m.modes must be a list of mode slugs, e.g. ["code", "debug"], got "code"',
		])
		expect(findModelSettingsProblems({ m: { modes: ["code", ""] } })).toHaveLength(1)
		expect(findModelSettingsProblems({ m: { modes: ["code", 1] } })).toHaveLength(1)
	})

	it("rejects a map or an entry that is not an object", () => {
		expect(findModelSettingsProblems([])[0]).toMatch(/^models must be an object keyed by model id/)
		expect(findModelSettingsProblems({ m: 262_144 })).toEqual([
			'models.m must be an object, e.g. { "contextWindow": 262144 }',
		])
	})
})

describe("getEffectiveModeSettings", () => {
	it("is empty without modes or bindings", () => {
		expect(getEffectiveModeSettings({})).toEqual({})
		expect(getEffectiveModeSettings({ models: { "GLM-5.3-NVFP4": { contextWindow: 262_144 } } })).toEqual({})
	})

	it("keeps every modes entry as written", () => {
		expect(getEffectiveModeSettings({ modes: { ask: { provider: "anthropic" } } })).toEqual({
			ask: { settings: { provider: "anthropic" }, label: "modes.ask" },
		})
	})

	it("gives each mode a models entry lists that model, as if modes.<slug>.model named it", () => {
		expect(
			getEffectiveModeSettings({
				models: { "Qwen3.8-27B": { reasoningEffort: "xhigh", modes: ["code", "debug", "code"] } },
			}),
		).toEqual({
			code: { settings: { model: "Qwen3.8-27B" }, label: "models.Qwen3.8-27B.modes" },
			debug: { settings: { model: "Qwen3.8-27B" }, label: "models.Qwen3.8-27B.modes" },
		})
	})

	it("adds the model to a modes entry that names none, and names both places", () => {
		expect(
			getEffectiveModeSettings({
				modes: { debug: { baseUrl: "http://localhost:11111/v1" } },
				models: { "Qwen3.8-27B": { modes: ["debug"] } },
			}),
		).toEqual({
			debug: {
				settings: { baseUrl: "http://localhost:11111/v1", model: "Qwen3.8-27B" },
				label: "modes.debug and models.Qwen3.8-27B.modes",
			},
		})
	})

	it("never throws on a malformed file", () => {
		expect(getEffectiveModeSettings({ models: { m: { modes: "code" as never } } })).toEqual({})
		expect(getEffectiveModeSettings({ models: [] as never })).toEqual({})
		expect(getEffectiveModeSettings({ models: { m: 1 as never } })).toEqual({})
	})
})

describe("findModeBindingProblems", () => {
	it("accepts one model per mode, the same model in both places and repeats in one list", () => {
		expect(
			findModeBindingProblems({
				modes: { code: { model: "Qwen3.8-27B" }, ask: { model: "GLM-5.3-NVFP4" } },
				models: { "Qwen3.8-27B": { modes: ["code", "debug", "debug"] }, "GLM-5.3-NVFP4": { modes: [] } },
			}),
		).toEqual([])
	})

	it("names both models that list one mode", () => {
		expect(
			findModeBindingProblems({
				models: { "Qwen3.8-27B": { modes: ["debug"] }, "GLM-5.3-NVFP4": { modes: ["code", "debug"] } },
			}),
		).toEqual([
			'mode "debug" is listed in both models.Qwen3.8-27B.modes and models.GLM-5.3-NVFP4.modes; a mode runs one model, so keep it in one list',
		])
	})

	it("names both places when modes.<slug>.model names another model", () => {
		expect(
			findModeBindingProblems({
				modes: { debug: { model: "GLM-5.3-NVFP4" } },
				models: { "Qwen3.8-27B": { modes: ["debug", "debug"] } },
			}),
		).toEqual([
			'models.Qwen3.8-27B.modes lists "debug", but modes.debug.model names GLM-5.3-NVFP4; keep one of them',
		])
	})
})
