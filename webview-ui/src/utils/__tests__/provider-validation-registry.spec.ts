import type { ProviderName, ProviderSettings } from "@roo-code/types"

vi.mock("i18next", () => ({ default: { t: (key: string) => key } }))

import { validateApiConfiguration } from "../validate"

const dynamicModelIds: Partial<Record<ProviderName, keyof ProviderSettings>> = {
	openrouter: "openRouterModelId",
	litellm: "litellmModelId",
}

const validProviderConfigurations = {
	openrouter: { openRouterApiKey: "key" },
	litellm: { litellmApiKey: "key" },
	deepseek: { deepSeekApiKey: "key" },
	ollama: { ollamaModelId: "model" },
	lmstudio: { lmStudioModelId: "model" },
	"vscode-lm": { vsCodeLmModelSelector: { vendor: "vendor", family: "family" } },
	openai: { openAiBaseUrl: "https://example.com", openAiApiKey: "key", openAiModelId: "model" },
	"fake-ai": {},
	anthropic: { apiKey: "key" },
	bedrock: { awsRegion: "us-east-1" },
	gemini: { geminiApiKey: "key" },
	"gemini-cli": {},
	mistral: { mistralApiKey: "key" },
	moonshot: { moonshotApiKey: "key" },
	minimax: { minimaxApiKey: "key" },
	"openai-codex": {},
	"openai-native": { openAiNativeApiKey: "key" },
	"qwen-code": { qwenCodeOauthPath: "/oauth" },
	vertex: { vertexProjectId: "project", vertexRegion: "region" },
	xai: { xaiApiKey: "key" },
	zai: { zaiApiKey: "key" },
} as const satisfies Record<ProviderName, Partial<ProviderSettings>>

describe("validateApiConfiguration provider registry", () => {
	it.each(Object.entries(validProviderConfigurations) as [ProviderName, Partial<ProviderSettings>][])(
		"accepts a valid %s provider configuration",
		(apiProvider, configuration) => {
			const dynamicModelId = dynamicModelIds[apiProvider]
			const modelConfiguration = dynamicModelId
				? { [dynamicModelId]: "test/model" }
				: { apiModelId: "test/model" }

			expect(validateApiConfiguration({ apiProvider, ...configuration, ...modelConfiguration })).toBeUndefined()
		},
	)

	it.each([
		["openrouter", {}, "settings:validation.apiKey"],
		["litellm", {}, "settings:validation.apiKey"],
		["ollama", {}, "settings:validation.modelId"],
		["lmstudio", {}, "settings:validation.modelId"],
		["vscode-lm", {}, "settings:validation.modelSelector"],
		["openai", {}, "settings:validation.openAi"],
		["openai", { openAiBaseUrl: "url", openAiApiKey: "key" }, "settings:validation.openAi"],
		["anthropic", {}, "settings:validation.apiKey"],
		["bedrock", {}, "settings:validation.awsRegion"],
		["gemini", {}, "settings:validation.apiKey"],
		["mistral", {}, "settings:validation.apiKey"],
		["openai-native", {}, "settings:validation.apiKey"],
		// The hosted DeepSeek, Moonshot, MiniMax, xAI and Z.ai APIs reject a
		// request without a key; a profile without one used to pass.
		["deepseek", {}, "settings:validation.apiKey"],
		["moonshot", {}, "settings:validation.apiKey"],
		["minimax", {}, "settings:validation.apiKey"],
		["xai", {}, "settings:validation.apiKey"],
		["zai", {}, "settings:validation.apiKey"],
		["qwen-code", {}, "settings:validation.qwenCodeOauthPath"],
		["vertex", {}, "settings:validation.googleCloud"],
		["vertex", { vertexProjectId: "project" }, "settings:validation.googleCloud"],
	] as [ProviderName, Partial<ProviderSettings>, string][])(
		"returns the existing message for invalid %s configuration",
		(apiProvider, configuration, expected) => {
			expect(validateApiConfiguration({ apiProvider, ...configuration })).toBe(expected)
		},
	)
})
