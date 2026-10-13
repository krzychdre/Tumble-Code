import { buildModelRows, formatModelList, hasOtherModel } from "../model-command.js"

describe("formatModelList", () => {
	it("names a slim or compact size and leaves standard out", () => {
		const list = formatModelList({
			mode: "code",
			currentModel: "Qwen3.8-4B",
			models: {
				"Qwen3.8-4B": { contextWindow: 32_768, modelSize: "compact" },
				"Qwen3.8-27B": { modelSize: "slim" },
				"GLM-5.3-NVFP4": { modelSize: "standard" },
			},
			settingsPath: "cli-settings.json",
		})

		expect(list).toContain("● Qwen3.8-4B (32,768 tokens, compact)")
		expect(list).toContain("  Qwen3.8-27B (slim)\n")
		expect(list).toContain("  GLM-5.3-NVFP4\n")
	})

	it("names the modes an entry lists", () => {
		const list = formatModelList({
			mode: "code",
			currentModel: "Qwen3.8-27B",
			models: { "Qwen3.8-27B": { reasoningEffort: "xhigh", modes: ["code", "debug", "code"] } },
			settingsPath: "cli-settings.json",
		})

		expect(list).toContain("● Qwen3.8-27B (reasoning xhigh, modes code, debug)")
	})

	it("marks a model that cannot see images as text only", () => {
		const list = formatModelList({
			mode: "code",
			currentModel: "GLM-5.3-NVFP4",
			models: {
				"GLM-5.3-NVFP4": { contextWindow: 262_144, supportsImages: false },
				"Qwen3.8-27B": { supportsImages: true, modes: ["vision"] },
			},
			settingsPath: "cli-settings.json",
		})

		expect(list).toContain("● GLM-5.3-NVFP4 (262,144 tokens, text only)")
		expect(list).toContain("  Qwen3.8-27B (modes vision)")
	})
})

describe("buildModelRows", () => {
	const models = {
		"GLM-5.3-NVFP4": { reasoningEffort: "max" as const, contextWindow: 262_144 },
		"Qwen3.8-27B": { modelSize: "slim" as const },
		"Qwen3.8-4B": {},
	}

	it("lists every entry in file order with the details of the printed list, the current one marked", () => {
		expect(buildModelRows("Qwen3.8-27B", models)).toEqual([
			{ key: "GLM-5.3-NVFP4", details: "reasoning max, 262,144 tokens", current: false },
			{ key: "Qwen3.8-27B", details: "slim", current: true },
			{ key: "Qwen3.8-4B", details: "", current: false },
		])
	})

	it("puts a current model without an entry first, so the list shows what runs", () => {
		const rows = buildModelRows("gpt-oss-120b", models)

		expect(rows[0]).toEqual({ key: "gpt-oss-120b", details: "no entry in models", current: true })
		expect(rows.slice(1).map((row) => row.key)).toEqual(["GLM-5.3-NVFP4", "Qwen3.8-27B", "Qwen3.8-4B"])
	})

	it("offers a choice only when something besides the current model is listed", () => {
		expect(hasOtherModel(buildModelRows("Qwen3.8-27B", models))).toBe(true)
		expect(hasOtherModel(buildModelRows("Qwen3.8-27B", {}))).toBe(false)
		expect(hasOtherModel(buildModelRows("Qwen3.8-27B", undefined))).toBe(false)
		expect(hasOtherModel(buildModelRows("Qwen3.8-27B", { "Qwen3.8-27B": {} }))).toBe(false)
		expect(hasOtherModel(buildModelRows(undefined, { "Qwen3.8-27B": {} }))).toBe(true)
	})
})
