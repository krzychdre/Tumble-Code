import { deepSeekDefaultModelId, deepSeekModelAliases, deepSeekModels, type ModelInfo } from "../index.js"

// The DeepSeek catalog as documented on 2026-09-25:
// https://api-docs.deepseek.com/quick_start/pricing (models, limits, prices),
// https://api-docs.deepseek.com/api/list-models (context 1048576, output 393216,
// input modalities), https://api-docs.deepseek.com/updates (2026-09-10 V4.1
// Flash release; 2026-04-24 retirement of deepseek-chat / deepseek-reasoner).

const models: Record<string, ModelInfo> = deepSeekModels

describe("DeepSeek model catalog", () => {
	it("defaults to deepseek-flash (DeepSeek-V4.1-Flash)", () => {
		expect(deepSeekDefaultModelId).toBe("deepseek-flash")
	})

	it("lists the two current models and the two retired legacy names", () => {
		expect(Object.keys(deepSeekModels).sort()).toEqual([
			"deepseek-chat",
			"deepseek-flash",
			"deepseek-reasoner",
			"deepseek-v4-pro",
		])
	})

	it.each(["deepseek-flash", "deepseek-v4-pro"])("%s has a 1M context and a 384K output limit", (id) => {
		expect(models[id]!.contextWindow).toBe(1_048_576)
		expect(models[id]!.maxTokens).toBe(393_216)
	})

	it("deepseek-flash reads images, deepseek-v4-pro does not", () => {
		expect(models["deepseek-flash"]!.supportsImages).toBe(true)
		expect(models["deepseek-v4-pro"]!.supportsImages).toBe(false)
	})

	// Standard (peak) rates; off-peak is half of these.
	it.each([
		["deepseek-flash", 0.3, 1.2, 0.006],
		["deepseek-v4-pro", 1.32, 3.96, 0.044],
	])("%s is priced at the peak rates (in %d, out %d, cache hit %d)", (id, input, output, cacheRead) => {
		const info = models[id]!
		expect(info.inputPrice).toBe(input)
		expect(info.outputPrice).toBe(output)
		expect(info.cacheReadsPrice).toBe(cacheRead)
		// A cache miss is ordinary input: DeepSeek has no separate cache write price.
		expect(info.cacheWritesPrice).toBe(input)
		expect(info.supportsPromptCache).toBe(true)
	})

	it.each(["deepseek-flash", "deepseek-v4-pro"])("%s thinks by default at high effort and keeps its reasoning", (id) => {
		const info = models[id]!
		expect(info.reasoningEffort).toBe("high")
		expect(info.preserveReasoning).toBe(true)
		expect(info.supportsReasoningEffort).toEqual(expect.arrayContaining(["disable", "low", "high"]))
		expect(info.deprecated).toBeUndefined()
	})

	// Retired on 2026-07-24 and no longer on the pricing page: kept only so an
	// existing profile still resolves, with the settings "no longer available"
	// warning, and hidden from the model picker.
	it.each(["deepseek-chat", "deepseek-reasoner"])("%s is marked deprecated", (id) => {
		expect(models[id]!.deprecated).toBe(true)
	})

	it("every alias names a current, non-deprecated model", () => {
		for (const target of Object.values(deepSeekModelAliases)) {
			expect(models[target]).toBeDefined()
			expect(models[target]!.deprecated).toBeUndefined()
		}
	})
})
