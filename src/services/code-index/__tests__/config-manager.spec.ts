// CodeIndexConfigManager on the real embedding model table (shared/embeddingModels); only the
// settings store (ContextProxy) is replaced. Which embedder settings count as configured and
// which of them restart indexing is pinned per embedder in embedder-config.characterization.spec.ts.

import { CodeIndexConfigManager } from "../config-manager"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import { logger } from "../../../utils/logging"

type Config = Record<string, unknown>

const openAi = (overrides: Config = {}): Config => ({
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: "http://qdrant.local",
	codebaseIndexEmbedderProvider: "openai",
	codebaseIndexEmbedderModelId: "text-embedding-3-small",
	...overrides,
})

/** A settings store whose saved config and secrets the test changes between loads. */
function makeStore(config: Config | undefined, secrets: Record<string, string> = { codeIndexOpenAiKey: "sk" }) {
	const state = { config, secrets, refreshed: { ...secrets } }
	const proxy = {
		getGlobalState: vi.fn(() => state.config),
		getSecret: vi.fn((key: string) => state.secrets[key]),
		// Secrets saved elsewhere become visible only after a refresh.
		refreshSecrets: vi.fn(async () => {
			state.secrets = { ...state.refreshed }
		}),
	}
	return { state, manager: new CodeIndexConfigManager(proxy as any) }
}

async function reload(before: Config, after: Config, secretsAfter?: Record<string, string>) {
	const { state, manager } = makeStore(before)
	state.config = after
	if (secretsAfter) state.refreshed = secretsAfter
	return { manager, result: await manager.loadConfiguration() }
}

beforeEach(() => {
	vi.spyOn(logger, "warn").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("CodeIndexConfigManager reading the saved config", () => {
	it("uses the defaults when nothing is saved", async () => {
		const { manager } = makeStore(undefined, {})

		expect(manager.isFeatureEnabled).toBe(false)
		expect(manager.isFeatureConfigured).toBe(false)
		expect(manager.currentEmbedderProvider).toBe("openai")
		expect(manager.getConfig()).toMatchObject({ qdrantUrl: "http://localhost:6333", qdrantApiKey: "" })
		expect((await manager.loadConfiguration()).requiresRestart).toBe(false)
	})

	it("trims stray whitespace around the Qdrant URL, the base URL and the model id", () => {
		const { manager } = makeStore({
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "  http://qdrant.local  ",
			codebaseIndexEmbedderProvider: "ollama",
			codebaseIndexEmbedderBaseUrl: " http://ollama:11434\n",
			codebaseIndexEmbedderModelId: " nomic-embed-code ",
		})

		expect(manager.getConfig()).toMatchObject({
			qdrantUrl: "http://qdrant.local",
			ollamaOptions: { ollamaBaseUrl: "http://ollama:11434" },
			modelId: "nomic-embed-code",
		})
	})

	it("reads a config without the enabled flag as disabled", () => {
		expect(makeStore(openAi({ codebaseIndexEnabled: undefined })).manager.isFeatureEnabled).toBe(false)
	})

	it("treats a blank model id as no model id", () => {
		expect(makeStore(openAi({ codebaseIndexEmbedderModelId: "  " })).manager.getConfig().modelId).toBeUndefined()
	})

	it.each([
		[1024, 1024, false],
		["768", 768, false],
		[0, undefined, true],
		[-5, undefined, true],
		["abc", undefined, true],
		[null, undefined, false],
		[undefined, undefined, false],
	])("reads the custom dimension %j as %j (warns: %s)", (raw, expected, warns) => {
		const { manager } = makeStore(openAi({ codebaseIndexEmbedderModelDimension: raw }))

		expect(manager.getConfig().modelDimension).toBe(expected)
		expect(vi.mocked(logger.warn).mock.calls.length > 0).toBe(warns)
	})

	// Vercel AI Gateway was removed as an embedder. A config saved with it must not fall back to
	// OpenAI (that would send the code to a provider the user did not pick) and must not throw.
	describe("a saved embedder provider that this version does not have", () => {
		const removed = openAi({
			codebaseIndexEmbedderProvider: "vercel-ai-gateway",
			codebaseIndexEmbedderModelId: "openai/text-embedding-3-small",
		})
		const secrets = { codebaseIndexVercelAiGatewayApiKey: "vc-key", codeIndexOpenAiKey: "sk-openai" }

		it("leaves indexing unconfigured, even with an OpenAI key saved", async () => {
			const { manager } = makeStore(removed, secrets)

			expect(manager.isFeatureEnabled).toBe(true)
			expect(manager.isFeatureConfigured).toBe(false)
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"vercel-ai-gateway" is not available'))
			const { currentConfig, requiresRestart } = await manager.loadConfiguration()
			expect(currentConfig.isConfigured).toBe(false)
			expect(requiresRestart).toBe(false)
		})

		it("starts indexing once the user picks an available embedder", async () => {
			const { state, manager } = makeStore(removed, secrets)
			state.config = openAi()

			const { currentConfig, requiresRestart } = await manager.loadConfiguration()
			expect(currentConfig).toMatchObject({ isConfigured: true, embedderProvider: "openai" })
			expect(requiresRestart).toBe(true)
		})
	})

	it.each([
		["no custom dimension, known model", openAi(), 1536],
		[
			"a known model keeps its own dimension over a custom one",
			openAi({ codebaseIndexEmbedderModelDimension: 64 }),
			1536,
		],
		[
			"an unknown model uses the custom dimension",
			openAi({ codebaseIndexEmbedderModelId: "mine", codebaseIndexEmbedderModelDimension: 64 }),
			64,
		],
		["an unknown model without a custom dimension", openAi({ codebaseIndexEmbedderModelId: "mine" }), undefined],
		["no model id uses the provider's default model", openAi({ codebaseIndexEmbedderModelId: "" }), 1536],
	])("currentModelDimension: %s", (_, config, expected) => {
		expect(makeStore(config).manager.currentModelDimension).toBe(expected)
	})

	it.each([
		["the user's score, even 0", { codebaseIndexSearchMinScore: 0 }, 0],
		[
			"the model's own threshold",
			{ codebaseIndexEmbedderProvider: "ollama", codebaseIndexEmbedderModelId: "nomic-embed-code" },
			0.15,
		],
		["the default for a model without one", { codebaseIndexEmbedderModelId: "mine" }, DEFAULT_SEARCH_MIN_SCORE],
	])("currentSearchMinScore is %s", (_, overrides, expected) => {
		expect(makeStore(openAi(overrides)).manager.currentSearchMinScore).toBe(expected)
	})

	it.each([
		[undefined, DEFAULT_MAX_SEARCH_RESULTS],
		[7, 7],
	])("currentSearchMaxResults for a saved %j is %j", (saved, expected) => {
		expect(makeStore(openAi({ codebaseIndexSearchMaxResults: saved })).manager.currentSearchMaxResults).toBe(
			expected,
		)
	})
})

describe("CodeIndexConfigManager.loadConfiguration", () => {
	it("refreshes the secrets first and reports the previous state as the snapshot", async () => {
		const { manager, result } = await reload(openAi(), openAi(), {
			codeIndexOpenAiKey: "sk-new",
			codebaseIndexOpenRouterApiKey: "or",
		})

		expect(result.configSnapshot).toMatchObject({ enabled: true, configured: true, openAiKey: "sk" })
		expect(result.currentConfig).toMatchObject({
			openAiOptions: { openAiNativeApiKey: "sk-new" },
			openRouterOptions: { apiKey: "or", specificProvider: undefined },
		})
		expect(result.requiresRestart).toBe(true)
		expect(manager.getConfig().openAiOptions).toEqual({ openAiNativeApiKey: "sk-new" })
	})

	it.each([
		["nothing changes", openAi(), openAi(), false],
		["the feature is turned on", openAi({ codebaseIndexEnabled: false }), openAi(), true],
		["the feature is turned off", openAi(), openAi({ codebaseIndexEnabled: false }), true],
		["an enabled index becomes configured", openAi({ codebaseIndexQdrantUrl: undefined }), openAi(), true],
		["the Qdrant URL is removed", openAi(), openAi({ codebaseIndexQdrantUrl: undefined }), true],
		[
			"a disabled index changes provider",
			openAi({ codebaseIndexEnabled: false }),
			openAi({ codebaseIndexEnabled: false, codebaseIndexEmbedderProvider: "ollama" }),
			false,
		],
		[
			"an unconfigured index stays unconfigured",
			openAi({ codebaseIndexQdrantUrl: "" }),
			openAi({ codebaseIndexQdrantUrl: "", codebaseIndexEmbedderModelId: "text-embedding-3-large" }),
			false,
		],
		[
			"the provider changes",
			openAi(),
			openAi({ codebaseIndexEmbedderProvider: "ollama", codebaseIndexEmbedderBaseUrl: "http://o" }),
			true,
		],
		[
			"the custom dimension changes",
			openAi({ codebaseIndexEmbedderModelDimension: 64 }),
			openAi({ codebaseIndexEmbedderModelDimension: 128 }),
			true,
		],
		["the Qdrant URL changes", openAi(), openAi({ codebaseIndexQdrantUrl: "http://other" }), true],
		[
			"the model changes to one of the same dimension",
			openAi(),
			openAi({ codebaseIndexEmbedderModelId: "text-embedding-ada-002" }),
			false,
		],
		[
			"the model id is cleared to the same default model",
			openAi(),
			openAi({ codebaseIndexEmbedderModelId: "" }),
			false,
		],
		["the default model is named explicitly", openAi({ codebaseIndexEmbedderModelId: "" }), openAi(), false],
		[
			"the model changes to one of another dimension",
			openAi(),
			openAi({ codebaseIndexEmbedderModelId: "text-embedding-3-large" }),
			true,
		],
		[
			"the model changes to one of unknown dimension",
			openAi(),
			openAi({ codebaseIndexEmbedderModelId: "mine" }),
			true,
		],
		[
			"only the search settings change",
			openAi(),
			openAi({ codebaseIndexSearchMinScore: 0.9, codebaseIndexSearchMaxResults: 3 }),
			false,
		],
	])("restarts indexing when %s: %s", async (_, before, after, restarts) => {
		const { result } = await reload(before, after)
		expect(result.requiresRestart).toBe(restarts)
	})

	it("restarts when the Qdrant API key changes", async () => {
		const { result } = await reload(openAi(), openAi(), { codeIndexOpenAiKey: "sk", codeIndexQdrantApiKey: "q" })
		expect(result.requiresRestart).toBe(true)
	})
})
