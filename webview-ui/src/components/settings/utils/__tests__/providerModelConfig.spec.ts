import {
	PROVIDER_SERVICE_CONFIG,
	PROVIDER_DEFAULT_MODEL_IDS,
	getProviderServiceConfig,
	getDefaultModelIdForProvider,
	getStaticModelsForProvider,
	isStaticModelProvider,
	PROVIDERS_WITH_CUSTOM_MODEL_UI,
	shouldUseGenericModelPicker,
} from "../providerModelConfig"
import { MODELS_BY_PROVIDER } from "../../constants"

import * as types from "@roo-code/types"

describe("providerModelConfig", () => {
	describe("PROVIDER_SERVICE_CONFIG", () => {
		it("contains service config for anthropic", () => {
			expect(PROVIDER_SERVICE_CONFIG.anthropic).toEqual({
				serviceName: "Anthropic",
				serviceUrl: "https://console.anthropic.com",
			})
		})

		it("contains service config for bedrock", () => {
			expect(PROVIDER_SERVICE_CONFIG.bedrock).toEqual({
				serviceName: "Amazon Bedrock",
				serviceUrl: "https://aws.amazon.com/bedrock",
			})
		})

		it("contains service config for ollama", () => {
			expect(PROVIDER_SERVICE_CONFIG.ollama).toEqual({
				serviceName: "Ollama",
				serviceUrl: "https://ollama.ai",
			})
		})

		it("contains service config for lmstudio", () => {
			expect(PROVIDER_SERVICE_CONFIG.lmstudio).toEqual({
				serviceName: "LM Studio",
				serviceUrl: "https://lmstudio.ai/docs",
			})
		})

		it("contains service config for vscode-lm", () => {
			expect(PROVIDER_SERVICE_CONFIG["vscode-lm"]).toEqual({
				serviceName: "VS Code LM",
				serviceUrl: "https://code.visualstudio.com/api/extension-guides/language-model",
			})
		})
	})

	// Characterization (S4): the model picker's service link for every provider, pinned before the
	// map moved into the provider descriptors in packages/types.
	describe("getProviderServiceConfig for every provider", () => {
		const expected: Record<string, { serviceName: string; serviceUrl: string }> = {
			anthropic: { serviceName: "Anthropic", serviceUrl: "https://console.anthropic.com" },
			bedrock: { serviceName: "Amazon Bedrock", serviceUrl: "https://aws.amazon.com/bedrock" },
			deepseek: { serviceName: "DeepSeek", serviceUrl: "https://platform.deepseek.com" },
			"fake-ai": { serviceName: "fake-ai", serviceUrl: "" },
			gemini: { serviceName: "Google Gemini", serviceUrl: "https://ai.google.dev" },
			"gemini-cli": { serviceName: "gemini-cli", serviceUrl: "" },
			litellm: { serviceName: "litellm", serviceUrl: "" },
			lmstudio: { serviceName: "LM Studio", serviceUrl: "https://lmstudio.ai/docs" },
			minimax: { serviceName: "MiniMax", serviceUrl: "https://minimax.chat" },
			mistral: { serviceName: "Mistral", serviceUrl: "https://console.mistral.ai" },
			moonshot: { serviceName: "Moonshot", serviceUrl: "https://platform.moonshot.cn" },
			ollama: { serviceName: "Ollama", serviceUrl: "https://ollama.ai" },
			openai: { serviceName: "openai", serviceUrl: "" },
			"openai-codex": { serviceName: "openai-codex", serviceUrl: "" },
			"openai-native": { serviceName: "OpenAI", serviceUrl: "https://platform.openai.com" },
			openrouter: { serviceName: "openrouter", serviceUrl: "" },
			"qwen-code": { serviceName: "Qwen Code", serviceUrl: "https://dashscope.console.aliyun.com" },
			vertex: { serviceName: "GCP Vertex AI", serviceUrl: "https://console.cloud.google.com/vertex-ai" },
			"vscode-lm": {
				serviceName: "VS Code LM",
				serviceUrl: "https://code.visualstudio.com/api/extension-guides/language-model",
			},
			xai: { serviceName: "xAI", serviceUrl: "https://x.ai" },
			zai: { serviceName: "Z.ai", serviceUrl: "https://z.ai" },
		}

		it("covers every provider", () => {
			expect(Object.keys(expected).sort()).toEqual([...new Set(types.providerNames)].sort())
		})

		it.each(Object.entries(expected))("%s", (provider, config) => {
			expect(getProviderServiceConfig(provider as types.ProviderName)).toEqual(config)
		})
	})

	describe("getProviderServiceConfig", () => {
		it("returns correct config for known provider", () => {
			const config = getProviderServiceConfig("gemini")
			expect(config.serviceName).toBe("Google Gemini")
			expect(config.serviceUrl).toBe("https://ai.google.dev")
		})

		it("returns fallback config for unknown provider", () => {
			const config = getProviderServiceConfig("unknown-provider" as any)
			expect(config.serviceName).toBe("unknown-provider")
			expect(config.serviceUrl).toBe("")
		})
	})

	describe("PROVIDER_DEFAULT_MODEL_IDS", () => {
		it("contains default model IDs for static providers", () => {
			expect(PROVIDER_DEFAULT_MODEL_IDS.anthropic).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS.bedrock).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS.gemini).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS["openai-native"]).toBeDefined()
		})
	})

	describe("getDefaultModelIdForProvider", () => {
		it("returns default model ID for known provider", () => {
			const defaultId = getDefaultModelIdForProvider("anthropic")
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns empty string for unknown provider", () => {
			const defaultId = getDefaultModelIdForProvider("unknown" as any)
			expect(defaultId).toBe("")
		})

		it("returns international default for Z.ai without apiConfiguration", () => {
			const defaultId = getDefaultModelIdForProvider("zai")
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns mainland default for Z.ai with china_coding entrypoint", () => {
			const defaultId = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "china_coding",
			})
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			// Mainland model IDs should contain 'mainland' or be different from international
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns international default for Z.ai with international_coding entrypoint", () => {
			const defaultId = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "international_coding",
			})
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("uses mainland or international defaults based on zaiApiLine setting", () => {
			// Verify the function correctly routes to appropriate defaults
			const chinaDefault = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "china_coding",
			})
			const internationalDefault = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "international_coding",
			})
			// Both should return valid model IDs (they may or may not be the same)
			expect(chinaDefault).toBeDefined()
			expect(internationalDefault).toBeDefined()
			expect(chinaDefault.length).toBeGreaterThan(0)
			expect(internationalDefault.length).toBeGreaterThan(0)
		})
	})

	describe("getStaticModelsForProvider", () => {
		it("returns models for anthropic provider", () => {
			const models = getStaticModelsForProvider("anthropic")
			expect(Object.keys(models).length).toBeGreaterThan(0)
		})

		it("adds custom-arn option for bedrock provider", () => {
			const models = getStaticModelsForProvider("bedrock", "Use Custom ARN")
			expect(models["custom-arn"]).toBeDefined()
			expect(models["custom-arn"].description).toBe("Use Custom ARN")
		})

		it("returns empty object for providers without static models", () => {
			const models = getStaticModelsForProvider("openrouter")
			expect(Object.keys(models).length).toBe(0)
		})
	})

	describe("isStaticModelProvider", () => {
		it("returns true for providers with static models", () => {
			expect(isStaticModelProvider("anthropic")).toBe(true)
			expect(isStaticModelProvider("bedrock")).toBe(true)
			expect(isStaticModelProvider("gemini")).toBe(true)
			expect(isStaticModelProvider("openai-native")).toBe(true)
		})

		it("returns false for providers without static models", () => {
			expect(isStaticModelProvider("openrouter")).toBe(false)
			expect(isStaticModelProvider("ollama")).toBe(false)
			expect(isStaticModelProvider("lmstudio")).toBe(false)
		})
	})

	describe("PROVIDERS_WITH_CUSTOM_MODEL_UI", () => {
		it("includes providers that have their own model selection UI", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("openrouter")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("ollama")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("lmstudio")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("vscode-lm")
		})

		it("does not include static providers using generic picker", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("anthropic")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("gemini")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("bedrock")
		})
	})

	describe("shouldUseGenericModelPicker", () => {
		it("returns true for static providers without custom UI", () => {
			expect(shouldUseGenericModelPicker("anthropic")).toBe(true)
			expect(shouldUseGenericModelPicker("bedrock")).toBe(true)
			expect(shouldUseGenericModelPicker("gemini")).toBe(true)
			expect(shouldUseGenericModelPicker("deepseek")).toBe(true)
		})

		it("returns false for providers with custom model UI", () => {
			expect(shouldUseGenericModelPicker("openrouter")).toBe(false)
			expect(shouldUseGenericModelPicker("ollama")).toBe(false)
			expect(shouldUseGenericModelPicker("lmstudio")).toBe(false)
			expect(shouldUseGenericModelPicker("vscode-lm")).toBe(false)
		})

		it("returns false for providers without static models", () => {
			expect(shouldUseGenericModelPicker("openai")).toBe(false)
		})
	})

	// API-6: the static model lists and their defaults are derived from
	// providerModelDefinitions; these are the maps as they were hand-written.
	describe("derived from providerModelDefinitions", () => {
		it("MODELS_BY_PROVIDER holds the same static lists", () => {
			expect(MODELS_BY_PROVIDER).toEqual({
				anthropic: types.anthropicModels,
				bedrock: types.bedrockModels,
				deepseek: types.deepSeekModels,
				moonshot: types.moonshotModels,
				gemini: types.geminiModels,
				mistral: types.mistralModels,
				"openai-native": types.openAiNativeModels,
				"openai-codex": types.openAiCodexModels,
				"qwen-code": types.qwenCodeModels,
				vertex: types.vertexModels,
				xai: types.xaiModels,
				zai: types.internationalZAiModels,
				minimax: types.minimaxModels,
			})
		})

		it("PROVIDER_DEFAULT_MODEL_IDS names the default of every static list", () => {
			expect(PROVIDER_DEFAULT_MODEL_IDS).toEqual({
				anthropic: types.anthropicDefaultModelId,
				bedrock: types.bedrockDefaultModelId,
				deepseek: types.deepSeekDefaultModelId,
				moonshot: types.moonshotDefaultModelId,
				gemini: types.geminiDefaultModelId,
				mistral: types.mistralDefaultModelId,
				"openai-native": types.openAiNativeDefaultModelId,
				// Missing from the hand-written map; only the generic model
				// picker reads it and Codex has its own model UI.
				"openai-codex": types.openAiCodexDefaultModelId,
				"qwen-code": types.qwenCodeDefaultModelId,
				vertex: types.vertexDefaultModelId,
				xai: types.xaiDefaultModelId,
				zai: types.internationalZAiDefaultModelId,
				minimax: types.minimaxDefaultModelId,
			})
		})
	})
})
