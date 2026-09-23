import { openAiCodexDefaultModelId, openAiModelInfoSaneDefaults } from "@roo-code/types"

import { DEFAULT_FLAGS } from "@/types/constants.js"

import {
	pickProviderConfig,
	resolveProviderConfig,
	summarizeProviderSettings,
	toProviderSettings,
} from "../provider-config.js"

describe("resolveProviderConfig", () => {
	const savedEnv = { ...process.env }

	beforeEach(() => {
		delete process.env.OPENAI_API_KEY
		delete process.env.OPENROUTER_API_KEY
		delete process.env.LOCAL_LLM_KEY
	})

	afterEach(() => {
		process.env = { ...savedEnv }
	})

	describe("provider and model (decision A3)", () => {
		it("uses the model written for the active provider", () => {
			const resolved = resolveProviderConfig({ layers: [{ provider: "openrouter", model: "openai/gpt-4o" }] })

			expect(resolved.provider).toBe("openrouter")
			expect(resolved.model).toBe("openai/gpt-4o")
		})

		it("never sends a model written for another provider", () => {
			// Settings hold an openrouter model; the flag switches the run to openai.
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openrouter", model: "openai/gpt-4o" }, { provider: "openai" }],
			})

			expect(resolved.provider).toBe("openai")
			expect(resolved.model).toBe(DEFAULT_FLAGS.model)
		})

		it("keeps the settings model when a flag names the same provider", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", model: "GLM-5.3" }, { provider: "openai" }],
			})

			expect(resolved.model).toBe("GLM-5.3")
		})

		it("applies a layer without a provider to the provider below it", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", model: "GLM-5.3" }, { model: "GLM-5.3-Flash" }],
			})

			expect(resolved.provider).toBe("openai")
			expect(resolved.model).toBe("GLM-5.3-Flash")
		})

		it("resolves aliases before comparing providers", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "tumble", model: "openai/gpt-4o" }, { provider: "openrouter" }],
			})

			expect(resolved.rawProvider).toBe("openrouter")
			expect(resolved.provider).toBe("openrouter")
			expect(resolved.model).toBe("openai/gpt-4o")
		})

		it("keeps the raw alias for error messages", () => {
			expect(resolveProviderConfig({ layers: [{ provider: "tumble" }] }).rawProvider).toBe("tumble")
		})

		it("falls back to the defaults, with the Codex default model for openai-codex", () => {
			expect(resolveProviderConfig({ layers: [] })).toMatchObject({
				provider: DEFAULT_FLAGS.provider,
				model: DEFAULT_FLAGS.model,
				reasoningEffort: DEFAULT_FLAGS.reasoningEffort,
			})
			expect(resolveProviderConfig({ layers: [{ provider: "openai-codex" }] }).model).toBe(
				openAiCodexDefaultModelId,
			)
		})

		it("uses the fallback model only for the fallback's own provider", () => {
			const fallback = { provider: "openai-codex", model: "gpt-5.6-sol", baseUrl: undefined }

			expect(resolveProviderConfig({ fallback, layers: [] }).model).toBe("gpt-5.6-sol")
			expect(resolveProviderConfig({ fallback, layers: [{ provider: "openai" }] }).model).toBe(
				DEFAULT_FLAGS.model,
			)
		})
	})

	describe("base URL", () => {
		it("belongs to the provider it was written for", () => {
			const settings = { provider: "openai", baseUrl: "http://localhost:1234/v1" }

			expect(resolveProviderConfig({ layers: [settings] }).baseUrl).toBe("http://localhost:1234/v1")
			expect(resolveProviderConfig({ layers: [settings, { provider: "openai-codex" }] }).baseUrl).toBeUndefined()
		})

		it("a flag base URL wins over the settings one", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", baseUrl: "http://a/v1" }, { baseUrl: "http://b/v1" }],
			})

			expect(resolved.baseUrl).toBe("http://b/v1")
		})
	})

	describe("reasoning effort", () => {
		it("the highest layer wins and it survives a provider switch", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", reasoningEffort: "max" }, { provider: "openrouter" }],
			})

			expect(resolved.reasoningEffort).toBe("max")
		})
	})

	describe("API key", () => {
		it("uses apiKey from the settings", () => {
			expect(resolveProviderConfig({ layers: [{ provider: "openai", apiKey: "1111" }] }).apiKey).toBe("1111")
		})

		it("reads apiKeyEnv from the environment", () => {
			process.env.LOCAL_LLM_KEY = "from-env"

			const resolved = resolveProviderConfig({ layers: [{ provider: "openai", apiKeyEnv: "LOCAL_LLM_KEY" }] })

			expect(resolved.apiKey).toBe("from-env")
			expect(resolved.missingApiKeyEnv).toBeUndefined()
		})

		it("reports an unset apiKeyEnv instead of falling back to another source", () => {
			process.env.OPENAI_API_KEY = "ambient"

			const resolved = resolveProviderConfig({ layers: [{ provider: "openai", apiKeyEnv: "LOCAL_LLM_KEY" }] })

			expect(resolved.apiKey).toBeUndefined()
			expect(resolved.missingApiKeyEnv).toBe("LOCAL_LLM_KEY")
		})

		it("apiKey wins over apiKeyEnv in the same layer", () => {
			process.env.LOCAL_LLM_KEY = "from-env"

			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", apiKey: "literal", apiKeyEnv: "LOCAL_LLM_KEY" }],
			})

			expect(resolved.apiKey).toBe("literal")
		})

		it("the --api-key flag wins over the settings key", () => {
			const resolved = resolveProviderConfig({
				layers: [{ provider: "openai", apiKey: "1111" }, { apiKey: "from-flag" }],
			})

			expect(resolved.apiKey).toBe("from-flag")
		})

		it("the settings key wins over the provider's env var", () => {
			process.env.OPENAI_API_KEY = "ambient"

			expect(resolveProviderConfig({ layers: [{ provider: "openai", apiKey: "1111" }] }).apiKey).toBe("1111")
		})

		it("falls back to the provider's env var, then the fallback's key of the same provider", () => {
			const fallback = { provider: "openai", apiKey: "shim-key" }

			expect(resolveProviderConfig({ fallback, layers: [] }).apiKey).toBe("shim-key")

			process.env.OPENAI_API_KEY = "ambient"
			expect(resolveProviderConfig({ fallback, layers: [] }).apiKey).toBe("ambient")
		})

		it("uses a key only for the provider it was written for", () => {
			const resolved = resolveProviderConfig({
				fallback: { provider: "openrouter", apiKey: "openrouter-key" },
				layers: [
					{ provider: "openai", model: "GLM-5.3" },
					{ provider: "openrouter", apiKey: undefined },
				],
			})
			expect(resolved.apiKey).toBe("openrouter-key")

			const switched = resolveProviderConfig({
				fallback: { provider: "openrouter", apiKey: "openrouter-key" },
				layers: [{ provider: "openai", apiKey: "1111" }, { provider: "anthropic" }],
			})
			expect(switched.apiKey).toBeUndefined()
		})
	})
})

describe("pickProviderConfig", () => {
	it("keeps only the provider-connection keys", () => {
		expect(
			pickProviderConfig({
				provider: "openai",
				model: "m",
				apiKeyEnv: "K",
				requireApproval: true,
				mode: "code",
			} as Parameters<typeof pickProviderConfig>[0]),
		).toEqual({
			provider: "openai",
			model: "m",
			baseUrl: undefined,
			apiKey: undefined,
			apiKeyEnv: "K",
			reasoningEffort: undefined,
		})
	})
})

describe("toProviderSettings", () => {
	const connection = { provider: "openai" as const, model: "GLM-5.3", baseUrl: "http://x/v1", apiKey: "1111" }

	it("maps to the provider's own fields and switches reasoning on for an effort", () => {
		expect(toProviderSettings({ ...connection, reasoningEffort: "high" })).toEqual({
			apiProvider: "openai",
			openAiModelId: "GLM-5.3",
			openAiBaseUrl: "http://x/v1",
			openAiApiKey: "1111",
			enableReasoningEffort: true,
			reasoningEffort: "high",
			openAiCustomModelInfo: null,
		})
	})

	it("sizes an openai model from its contextWindow, keeping the provider's other defaults", () => {
		expect(toProviderSettings({ ...connection, contextWindow: 262_144 }).openAiCustomModelInfo).toEqual({
			...openAiModelInfoSaneDefaults,
			contextWindow: 262_144,
		})
	})

	it("clears a size an earlier run left in the extension state when no contextWindow is set", () => {
		// The startup settings are merged key by key into persisted state, so an
		// absent key would keep the old value.
		expect(toProviderSettings(connection)).toHaveProperty("openAiCustomModelInfo", null)
	})

	it("sends no model info to providers that size their models themselves", () => {
		const settings = toProviderSettings({ provider: "anthropic", model: "claude-x", apiKey: "k", contextWindow: 1 })
		expect(settings).not.toHaveProperty("openAiCustomModelInfo")
	})

	it("turns reasoning off for disabled and leaves it out for unspecified", () => {
		expect(toProviderSettings({ ...connection, reasoningEffort: "disabled" })).toMatchObject({
			enableReasoningEffort: false,
		})

		const unspecified = toProviderSettings({ ...connection, reasoningEffort: "unspecified" })
		expect(unspecified).not.toHaveProperty("enableReasoningEffort")
		expect(unspecified).not.toHaveProperty("reasoningEffort")
	})
})

describe("summarizeProviderSettings", () => {
	it("reads the model from the active provider's field, not a stale one", () => {
		expect(
			summarizeProviderSettings({
				apiProvider: "openai",
				apiModelId: "gpt-5.6-sol",
				openAiModelId: "GLM-5.3-Flash-NVFP4",
				enableReasoningEffort: true,
				reasoningEffort: "max",
			}),
		).toEqual({ provider: "openai", model: "GLM-5.3-Flash-NVFP4", reasoningEffort: "max" })
	})

	it("reports disabled reasoning, and nothing before the extension state arrives", () => {
		expect(
			summarizeProviderSettings({ apiProvider: "openrouter", enableReasoningEffort: false })?.reasoningEffort,
		).toBe("disabled")
		expect(summarizeProviderSettings(null)).toBeUndefined()
	})
})
