import { openAiModelInfoSaneDefaults } from "@roo-code/types"

import { DEFAULT_CONTEXT_WINDOW, getContextWindow } from "../context-window.js"

describe("getContextWindow", () => {
	it("uses the openai model's configured size, as the extension does", () => {
		expect(
			getContextWindow(null, {
				apiProvider: "openai",
				openAiModelId: "GLM-5.3-NVFP4",
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, contextWindow: 262_144 },
			}),
		).toBe(262_144)
	})

	// The provider's model source returns ids only, so routerModels never holds
	// an openai size; the old lookup fell through to 200,000 while the
	// extension condensed against 128,000.
	it("falls back to the openai provider's own default, not the generic one", () => {
		expect(getContextWindow(null, { apiProvider: "openai", openAiModelId: "GLM-5.3-NVFP4" })).toBe(128_000)
		expect(
			getContextWindow(
				{ openai: { "GLM-5.3-NVFP4": { contextWindow: 999 } } },
				{ apiProvider: "openai", openAiModelId: "GLM-5.3-NVFP4", openAiCustomModelInfo: null },
			),
		).toBe(openAiModelInfoSaneDefaults.contextWindow)
	})

	it("still reads router models for the providers that have them", () => {
		expect(
			getContextWindow(
				{ openrouter: { "some/model": { contextWindow: 100_000 } } },
				{ apiProvider: "openrouter", openRouterModelId: "some/model" },
			),
		).toBe(100_000)
		expect(getContextWindow(null, { apiProvider: "openrouter", openRouterModelId: "x" })).toBe(
			DEFAULT_CONTEXT_WINDOW,
		)
	})
})
