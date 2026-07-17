// npx vitest run api/providers/__tests__/openai-codex.spec.ts

import { openAiCodexModels } from "@roo-code/types"

import { OpenAiCodexHandler } from "../openai-codex"

describe("OpenAiCodexHandler.getModel", () => {
	it.each(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
		"should expose current GPT-5.6 subscription model capabilities: %s",
		(apiModelId) => {
			const handler = new OpenAiCodexHandler({ apiModelId })
			const model = handler.getModel()

			expect(model.id).toBe(apiModelId)
			expect(model.info).toMatchObject({
				contextWindow: 1_050_000,
				maxTokens: 128_000,
				supportsImages: true,
				supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
				reasoningEffort: "medium",
			})
		},
	)

	it("should expose only the current ChatGPT subscription model catalog", () => {
		expect(Object.keys(openAiCodexModels)).toEqual([
			"gpt-5.6-sol",
			"gpt-5.6-terra",
			"gpt-5.6-luna",
			"gpt-5.5",
			"gpt-5.3-codex-spark",
			"gpt-5.4",
			"gpt-5.4-mini",
		])
	})

	it("should fall back to default model when an invalid model id is provided", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "not-a-real-model" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.6-sol")
		expect(model.info).toBeDefined()
	})

	it("should use Spark-specific limits and capabilities", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.3-codex-spark" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.3-codex-spark")
		expect(model.info.contextWindow).toBe(128000)
		expect(model.info.maxTokens).toBe(8192)
		expect(model.info.supportsImages).toBe(false)
	})

	it("should use GPT-5.4 Mini capabilities when selected", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4-mini" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.4-mini")
		expect(model.info).toBeDefined()
	})
})
