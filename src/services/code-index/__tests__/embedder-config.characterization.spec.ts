// Pins what a saved code-index configuration turns into, per embedder: the config the manager
// exposes, whether it counts as configured, which settings changes restart indexing, and which
// embedder class the factory builds with which arguments.

import type { EmbedderProvider } from "@tumble-code/types"

import { CodeIndexConfigManager } from "../config-manager"
import { CodeIndexServiceFactory } from "../service-factory"
import { OpenAiEmbedder } from "../embedders/openai"
import { CodeIndexOllamaEmbedder } from "../embedders/ollama"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { GeminiEmbedder } from "../embedders/gemini"
import { MistralEmbedder } from "../embedders/mistral"
import { BedrockEmbedder } from "../embedders/bedrock"
import { OpenRouterEmbedder } from "../embedders/openrouter"
import { logger } from "../../../utils/logging"

vi.mock("../embedders/openai", () => ({ OpenAiEmbedder: vi.fn() }))
vi.mock("../embedders/ollama", () => ({ CodeIndexOllamaEmbedder: vi.fn() }))
vi.mock("../embedders/openai-compatible", () => ({ OpenAICompatibleEmbedder: vi.fn() }))
vi.mock("../embedders/gemini", () => ({ GeminiEmbedder: vi.fn() }))
vi.mock("../embedders/mistral", () => ({ MistralEmbedder: vi.fn() }))
vi.mock("../embedders/bedrock", () => ({ BedrockEmbedder: vi.fn() }))
vi.mock("../embedders/openrouter", () => ({ OpenRouterEmbedder: vi.fn() }))
vi.mock("../vector-store/qdrant-client", () => ({ QdrantVectorStore: vi.fn() }))

const ALL_SECRETS: Record<string, string> = {
	codeIndexOpenAiKey: "sk-openai",
	codeIndexQdrantApiKey: "qdrant-key",
	codebaseIndexOpenAiCompatibleApiKey: "compat-key",
	codebaseIndexGeminiApiKey: "gemini-key",
	codebaseIndexMistralApiKey: "mistral-key",
	codebaseIndexOpenRouterApiKey: "openrouter-key",
}

const baseConfig = (provider: EmbedderProvider) => ({
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: "http://qdrant:6333",
	codebaseIndexEmbedderProvider: provider,
	codebaseIndexEmbedderBaseUrl: "http://ollama:11434",
	codebaseIndexEmbedderModelId: "some-model",
	codebaseIndexOpenAiCompatibleBaseUrl: "http://compat/v1",
	codebaseIndexBedrockRegion: "eu-west-1",
	codebaseIndexBedrockProfile: "work",
	codebaseIndexOpenRouterSpecificProvider: "together",
})

const PROVIDERS: EmbedderProvider[] = [
	"openai",
	"ollama",
	"openai-compatible",
	"gemini",
	"mistral",
	"bedrock",
	"openrouter",
]

function makeProxy(config: Record<string, unknown>, secrets: Record<string, string>) {
	const state = { config, secrets }
	return {
		state,
		proxy: {
			getGlobalState: vi.fn(() => state.config),
			getSecret: vi.fn((key: string) => state.secrets[key]),
			refreshSecrets: vi.fn().mockResolvedValue(undefined),
		} as any,
	}
}

function constructorCalls() {
	const classes = {
		OpenAiEmbedder,
		CodeIndexOllamaEmbedder,
		OpenAICompatibleEmbedder,
		GeminiEmbedder,
		MistralEmbedder,
		BedrockEmbedder,
		OpenRouterEmbedder,
	}
	return Object.fromEntries(
		Object.entries(classes)
			.map(([name, cls]) => [name, vi.mocked(cls).mock.calls] as const)
			.filter(([, calls]) => calls.length > 0),
	)
}

describe("code-index embedder configuration (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(logger, "warn").mockImplementation(() => {})
	})

	it("exposes the options of every embedder from one saved config", () => {
		const { proxy } = makeProxy(baseConfig("gemini"), ALL_SECRETS)
		const manager = new CodeIndexConfigManager(proxy)
		expect(manager.getConfig()).toMatchInlineSnapshot(`
			{
			  "bedrockOptions": {
			    "profile": "work",
			    "region": "eu-west-1",
			  },
			  "embedderProvider": "gemini",
			  "geminiOptions": {
			    "apiKey": "gemini-key",
			  },
			  "isConfigured": true,
			  "mistralOptions": {
			    "apiKey": "mistral-key",
			  },
			  "modelDimension": undefined,
			  "modelId": "some-model",
			  "ollamaOptions": {
			    "ollamaBaseUrl": "http://ollama:11434",
			  },
			  "openAiCompatibleOptions": {
			    "apiKey": "compat-key",
			    "baseUrl": "http://compat/v1",
			  },
			  "openAiOptions": {
			    "openAiNativeApiKey": "sk-openai",
			  },
			  "openRouterOptions": {
			    "apiKey": "openrouter-key",
			    "specificProvider": "together",
			  },
			  "qdrantApiKey": "qdrant-key",
			  "qdrantUrl": "http://qdrant:6333",
			  "searchMaxResults": 50,
			  "searchMinScore": 0.85,
			}
		`)
	})

	it("exposes empty options when nothing is saved", () => {
		const { proxy } = makeProxy({ codebaseIndexEnabled: true, codebaseIndexQdrantUrl: "http://q" } as any, {})
		const manager = new CodeIndexConfigManager(proxy)
		expect(manager.getConfig()).toMatchInlineSnapshot(`
			{
			  "bedrockOptions": {
			    "profile": undefined,
			    "region": "us-east-1",
			  },
			  "embedderProvider": "openai",
			  "geminiOptions": undefined,
			  "isConfigured": false,
			  "mistralOptions": undefined,
			  "modelDimension": undefined,
			  "modelId": undefined,
			  "ollamaOptions": {
			    "ollamaBaseUrl": undefined,
			  },
			  "openAiCompatibleOptions": undefined,
			  "openAiOptions": {
			    "openAiNativeApiKey": "",
			  },
			  "openRouterOptions": undefined,
			  "qdrantApiKey": "",
			  "qdrantUrl": "http://q",
			  "searchMaxResults": 50,
			  "searchMinScore": 0.4,
			}
		`)
	})

	it.each(PROVIDERS)("%s: configured state, embedder class and constructor arguments", (provider) => {
		const { proxy } = makeProxy(baseConfig(provider), ALL_SECRETS)
		const manager = new CodeIndexConfigManager(proxy)
		const factory = new CodeIndexServiceFactory(manager, "/ws", {} as any)

		expect(manager.isFeatureConfigured).toBe(true)
		factory.createEmbedder()
		expect(constructorCalls()).toMatchSnapshot()
	})

	it.each(PROVIDERS)("%s: without its credentials it is unconfigured and the factory refuses", (provider) => {
		const config: Record<string, unknown> = { ...baseConfig(provider) }
		delete config.codebaseIndexEmbedderBaseUrl
		delete config.codebaseIndexOpenAiCompatibleBaseUrl
		config.codebaseIndexBedrockRegion = ""
		const { proxy } = makeProxy(config, {})
		const manager = new CodeIndexConfigManager(proxy)
		const factory = new CodeIndexServiceFactory(manager, "/ws", {} as any)

		const result: Record<string, unknown> = { configured: manager.isFeatureConfigured }
		try {
			factory.createEmbedder()
			result.created = constructorCalls()
		} catch (error) {
			result.error = (error as Error).message
		}
		expect(result).toMatchSnapshot()
	})

	const CHANGES: Array<[string, (s: ReturnType<typeof makeProxy>["state"]) => void]> = [
		["openai key", (s) => (s.secrets.codeIndexOpenAiKey = "sk-other")],
		["ollama base url", (s) => (s.config.codebaseIndexEmbedderBaseUrl = "http://other:11434")],
		["openai-compatible base url", (s) => (s.config.codebaseIndexOpenAiCompatibleBaseUrl = "http://other/v1")],
		["openai-compatible key", (s) => (s.secrets.codebaseIndexOpenAiCompatibleApiKey = "other")],
		["gemini key", (s) => (s.secrets.codebaseIndexGeminiApiKey = "other")],
		["mistral key", (s) => (s.secrets.codebaseIndexMistralApiKey = "other")],
		["bedrock region", (s) => (s.config.codebaseIndexBedrockRegion = "us-east-2")],
		["bedrock profile", (s) => (s.config.codebaseIndexBedrockProfile = "other")],
		["openrouter key", (s) => (s.secrets.codebaseIndexOpenRouterApiKey = "other")],
		["openrouter specific provider", (s) => (s.config.codebaseIndexOpenRouterSpecificProvider = "other")],
		["qdrant key", (s) => (s.secrets.codeIndexQdrantApiKey = "other")],
		["nothing", () => {}],
	]

	it.each(PROVIDERS)("%s: which settings changes restart indexing", async (provider) => {
		const restarts: Record<string, boolean> = {}
		for (const [name, change] of CHANGES) {
			const { proxy, state } = makeProxy({ ...baseConfig(provider) }, { ...ALL_SECRETS })
			const manager = new CodeIndexConfigManager(proxy)
			state.config = { ...state.config }
			change(state)
			restarts[name] = (await manager.loadConfiguration()).requiresRestart
		}
		expect(restarts).toMatchSnapshot()
	})
})
