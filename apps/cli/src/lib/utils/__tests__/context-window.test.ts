import {
	anthropicDefaultModelId,
	anthropicModels,
	deepSeekModelAliases,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	internationalZAiDefaultModelId,
	internationalZAiModels,
	litellmDefaultModelInfo,
	mainlandZAiModels,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	vertexModels,
} from "@roo-code/types"

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

	// DEF-C27: zai, anthropic and the other providers with a built-in model
	// table never appear in routerModels, so the lookup fell through to 200,000
	// although the extension sizes the model from the table (1,000,000 for
	// GLM-5.3), and the gauge read five times too full.
	it("reads the provider's built-in model table when routerModels has no entry", () => {
		expect(internationalZAiModels["glm-5.3"].contextWindow).toBe(1_000_000)

		expect(getContextWindow(null, { apiProvider: "zai", apiModelId: "glm-5.3" })).toBe(
			internationalZAiModels["glm-5.3"].contextWindow,
		)
		expect(getContextWindow({}, { apiProvider: "zai", apiModelId: "glm-5.3" })).toBe(
			internationalZAiModels["glm-5.3"].contextWindow,
		)
		expect(getContextWindow(null, { apiProvider: "zai", apiModelId: "glm-5.3", zaiApiLine: "china_coding" })).toBe(
			mainlandZAiModels["glm-5.3"].contextWindow,
		)
	})

	it("sizes the provider's default model when no model id is set", () => {
		expect(getContextWindow(null, { apiProvider: "anthropic" })).toBe(
			anthropicModels[anthropicDefaultModelId].contextWindow,
		)
	})

	// The extension keeps an unknown model id (owner decision 5) and sizes it
	// like the provider's default model, so condensing runs against that size.
	it("sizes an unknown model id like the extension: the provider's default model", () => {
		expect(getContextWindow(null, { apiProvider: "zai", apiModelId: "glm-unknown" })).toBe(
			internationalZAiModels[internationalZAiDefaultModelId].contextWindow,
		)
		expect(getContextWindow(null, { apiProvider: "mistral", apiModelId: "mistral-unknown" })).toBe(
			mistralModels[mistralDefaultModelId].contextWindow,
		)
		expect(getContextWindow(null, { apiProvider: "gemini", apiModelId: "gemini-unknown" })).toBe(
			geminiModels[geminiDefaultModelId].contextWindow,
		)
	})

	it("sizes an unknown router model with the provider's fallback info, as the handler does", () => {
		expect(getContextWindow({}, { apiProvider: "ollama", ollamaModelId: "not-pulled" })).toBe(
			openAiModelInfoSaneDefaults.contextWindow,
		)
		expect(getContextWindow({}, { apiProvider: "lmstudio", lmStudioModelId: "not-loaded" })).toBe(
			openAiModelInfoSaneDefaults.contextWindow,
		)
		expect(getContextWindow({}, { apiProvider: "litellm", litellmModelId: "missing" })).toBe(
			litellmDefaultModelInfo.contextWindow,
		)
	})

	it("resolves a DeepSeek alias to the model it names", () => {
		const [alias, target] = Object.entries(deepSeekModelAliases)[0]!
		expect(getContextWindow(null, { apiProvider: "deepseek", apiModelId: alias })).toBe(
			deepSeekModels[target as keyof typeof deepSeekModels].contextWindow,
		)
	})

	it("applies the 1M context tier when the profile enables it", () => {
		const sonnetTier = anthropicModels["claude-sonnet-4-5"].tiers![0]!.contextWindow
		expect(sonnetTier).toBe(1_000_000)
		expect(
			getContextWindow(null, {
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-5",
				anthropicBeta1MContext: true,
			}),
		).toBe(sonnetTier)
		expect(
			getContextWindow(null, {
				apiProvider: "vertex",
				apiModelId: "claude-sonnet-4-6",
				vertex1MContext: true,
			}),
		).toBe(vertexModels["claude-sonnet-4-6"].tiers![0]!.contextWindow)
	})

	it("reads fetched models only for providers whose handler reads them", () => {
		// DeepSeek's handler sizes from its built-in table, never from a fetched list.
		expect(
			getContextWindow(
				{ deepseek: { "deepseek-v4-pro": { contextWindow: 64_000 } } },
				{ apiProvider: "deepseek", apiModelId: "deepseek-v4-pro" },
			),
		).toBe(deepSeekModels["deepseek-v4-pro"].contextWindow)
	})

	it("keeps the generic default for a provider this version cannot run", () => {
		expect(getContextWindow(null, { apiProvider: "retired-or-unknown" as never, apiModelId: "x" })).toBe(
			DEFAULT_CONTEXT_WINDOW,
		)
	})
})
