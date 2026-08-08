import { classifyProvider, retiredProviderIds } from "@roo-code/types"

import {
	supportedProviders,
	isSupportedProvider,
	providerRequiresApiKey,
	getEnvVarName,
	getApiKeyField,
	getApiKeyFromEnv,
	getBaseUrlField,
	getBaseUrlFromEnv,
	getModelField,
	getProviderSettings,
	keylessProviders,
	providerIdAliases,
	resolveProviderIdAlias,
	isAcceptedProvider,
} from "@/lib/utils/provider-types.js"

import { activeProviderIds } from "@roo-code/types"

const EXCLUDED = ["vscode-lm", "fake-ai", "gemini-cli"]

describe("supportedProviders derivation", () => {
	it("contains every active provider except the documented exclusions", () => {
		const expected = activeProviderIds.filter((id) => !EXCLUDED.includes(id))
		expect(supportedProviders).toEqual(expected)
		expect(supportedProviders).toHaveLength(activeProviderIds.length - EXCLUDED.length)
	})

	it("does not contain any excluded provider", () => {
		for (const id of EXCLUDED) {
			expect(supportedProviders).not.toContain(id)
		}
	})

	it("does not contain retired providers", () => {
		for (const id of retiredProviderIds) {
			expect(supportedProviders).not.toContain(id)
			expect(isSupportedProvider(id)).toBe(false)
		}
	})

	it("isSupportedProvider rejects unknown ids", () => {
		expect(isSupportedProvider("not-a-provider")).toBe(false)
		expect(isSupportedProvider("anthropic")).toBe(true)
		expect(isSupportedProvider("ollama")).toBe(true)
	})

	it("classifyProvider agrees with the registry (retired/unknown produce clear errors at runtime)", () => {
		for (const id of retiredProviderIds) {
			expect(classifyProvider(id)).toBe("retired")
		}
		expect(classifyProvider("vscode-lm")).not.toBe("retired")
		expect(classifyProvider("garbage")).toBe("unknown")
	})
})

describe("env-var map coverage", () => {
	it("has a mapping entry for every supported provider", () => {
		for (const id of supportedProviders) {
			expect(typeof getModelField(id)).toBe("string")
		}
	})

	it("keyed providers have a key env var and key field", () => {
		for (const id of supportedProviders) {
			if (providerRequiresApiKey(id)) {
				expect(getEnvVarName(id)).toBeTruthy()
				expect(getApiKeyField(id)).toBeTruthy()
			}
		}
	})

	it("keyless providers have no key env var and are not required", () => {
		for (const id of keylessProviders) {
			expect(getEnvVarName(id)).toBeNull()
			expect(providerRequiresApiKey(id)).toBe(false)
		}
	})

	it("ollama and lmstudio are keyless", () => {
		expect(keylessProviders).toContain("ollama")
		expect(keylessProviders).toContain("lmstudio")
		expect(providerRequiresApiKey("ollama")).toBe(false)
		expect(providerRequiresApiKey("lmstudio")).toBe(false)
	})

	it("openai-codex is supported and uses OAuth instead of an API key", () => {
		expect(supportedProviders).toContain("openai-codex")
		expect(keylessProviders).toContain("openai-codex")
		expect(providerRequiresApiKey("openai-codex")).toBe(false)
		expect(getEnvVarName("openai-codex")).toBeNull()
	})

	it("conventional env vars exist for the flagship providers", () => {
		expect(getEnvVarName("anthropic")).toBe("ANTHROPIC_API_KEY")
		expect(getEnvVarName("openrouter")).toBe("OPENROUTER_API_KEY")
		expect(getEnvVarName("gemini")).toBe("GOOGLE_API_KEY")
		expect(getEnvVarName("deepseek")).toBe("DEEPSEEK_API_KEY")
		expect(getEnvVarName("zai")).toBe("ZAI_API_KEY")
		expect(getEnvVarName("xai")).toBe("XAI_API_KEY")
	})

	it("reads keys and base urls from the environment", () => {
		const old = process.env.ANTHROPIC_API_KEY
		process.env.ANTHROPIC_API_KEY = "env-key"
		try {
			expect(getApiKeyFromEnv("anthropic")).toBe("env-key")
		} finally {
			if (old === undefined) delete process.env.ANTHROPIC_API_KEY
			else process.env.ANTHROPIC_API_KEY = old
		}

		const oldBase = process.env.ANTHROPIC_BASE_URL
		process.env.ANTHROPIC_BASE_URL = "https://proxy.example"
		try {
			expect(getBaseUrlFromEnv("anthropic")).toBe("https://proxy.example")
			expect(getBaseUrlField("anthropic")).toBe("anthropicBaseUrl")
		} finally {
			if (oldBase === undefined) delete process.env.ANTHROPIC_BASE_URL
			else process.env.ANTHROPIC_BASE_URL = oldBase
		}
	})
})

describe("provider id aliases", () => {
	it("maps the persisted 'tumble' cloud id to openrouter", () => {
		expect(providerIdAliases).toHaveProperty("tumble", "openrouter")
		expect(resolveProviderIdAlias("tumble")).toBe("openrouter")
		expect(isAcceptedProvider("tumble")).toBe(true)
		// The alias resolves to a real supported provider for settings resolution.
		expect(getProviderSettings(resolveProviderIdAlias("tumble") as never, "k", "m")).toEqual({
			apiProvider: "openrouter",
			openRouterApiKey: "k",
			openRouterModelId: "m",
		})
	})

	it("passes through real provider ids and rejects unknown ids", () => {
		expect(resolveProviderIdAlias("anthropic")).toBe("anthropic")
		expect(isAcceptedProvider("anthropic")).toBe(true)
		expect(isAcceptedProvider("not-a-provider")).toBe(false)
	})
})

describe("getProviderSettings", () => {
	it("openai-native maps base url + model to the extension fields", () => {
		const settings = getProviderSettings("openai-native", "sk-test", "gpt-5", "https://openai.example")
		expect(settings.apiProvider).toBe("openai-native")
		expect(settings.openAiNativeApiKey).toBe("sk-test")
		expect(settings.openAiNativeBaseUrl).toBe("https://openai.example")
		expect(settings.apiModelId).toBe("gpt-5")
	})

	it("openai-codex maps only provider and model; credentials stay in OAuth storage", () => {
		expect(getProviderSettings("openai-codex", undefined, "gpt-5.6-sol")).toEqual({
			apiProvider: "openai-codex",
			apiModelId: "gpt-5.6-sol",
		})
	})

	it("mistral maps base url to mistralCodestralUrl", () => {
		const settings = getProviderSettings("mistral", undefined, "codestral-latest", "https://codestral.example")
		expect(settings.mistralCodestralUrl).toBe("https://codestral.example")
	})

	it("rejects --base-url for a provider without a base-url field", () => {
		expect(() => getProviderSettings("vercel-ai-gateway", "k", "m", "https://proxy.example")).toThrow(
			"Provider 'vercel-ai-gateway' does not support a base URL",
		)
		// Custom base-url of "" is treated as absent.
		expect(() => getProviderSettings("vercel-ai-gateway", "k", "m", "")).not.toThrow()
	})
	it("maps the model to the provider-specific model field", () => {
		const settings = getProviderSettings("openrouter", "key", "anthropic/claude-sonnet-4")
		expect(settings.apiProvider).toBe("openrouter")
		expect(settings.openRouterModelId).toBe("anthropic/claude-sonnet-4")
	})

	it("maps the api key to the provider key field", () => {
		const settings = getProviderSettings("anthropic", "sk-test", "claude-opus-4")
		expect(settings.apiKey).toBe("sk-test")
	})

	it("applies the base url to the provider base-url field", () => {
		const settings = getProviderSettings("ollama", undefined, "llama3", "http://localhost:11434")
		expect(settings.ollamaBaseUrl).toBe("http://localhost:11434")
		expect(settings.ollamaModelId).toBe("llama3")
	})

	it("leaves the apiKey field unset when no key is passed", () => {
		const settings = getProviderSettings("anthropic", undefined, "claude-opus-4")
		expect(settings.apiKey).toBeUndefined()
	})
})
