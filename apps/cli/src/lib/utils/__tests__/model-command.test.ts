import { formatModelList } from "../model-command.js"

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
})
