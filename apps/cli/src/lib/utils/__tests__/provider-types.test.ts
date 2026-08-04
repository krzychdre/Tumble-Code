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
} from "@/lib/utils/provider-types.js"

import { activeProviderIds } from "@roo-code/types"

const EXCLUDED = ["vscode-lm", "openai-codex", "fake-ai", "gemini-cli"]

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

describe("getProviderSettings", () => {
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
