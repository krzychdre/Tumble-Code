// Characterization (S4 slice d): the model the settings UI resolves for a profile (`useSelectedModel`), for a
// known id, an unknown id, an empty id and an unset id per representative provider. Taken on main before this
// hook and the host resolvers (`resolvePortableProviderModel`, pinned in
// `packages/types/src/__tests__/provider-model-resolution.spec.ts`) were put on one shared resolver. Where the
// two sides differ on purpose (an unknown id has no info here, an empty id is kept here), the cases below are
// what the settings must keep showing.

import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { Mock } from "vitest"

import {
	type ModelInfo,
	type ProviderSettings,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	litellmDefaultModelId,
	litellmDefaultModelInfo,
	lMStudioDefaultModelInfo,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
	openAiModelInfoSaneDefaults,
	openRouterDefaultModelId,
	resolveProviderModelSelection,
	vertexModels,
	vscodeLlmDefaultModelId,
	vscodeLlmModels,
	xaiDefaultModelId,
	xaiModels,
} from "@roo-code/types"

import { useSelectedModel } from "../useSelectedModel"
import { useProviderModels } from "../useProviderModels"
import { useOpenRouterModelProviders } from "../useOpenRouterModelProviders"

vi.mock("../useProviderModels")
vi.mock("../useOpenRouterModelProviders")

const mockUseProviderModels = useProviderModels as Mock<typeof useProviderModels>
const mockUseOpenRouterModelProviders = useOpenRouterModelProviders as Mock<typeof useOpenRouterModelProviders>

const fetchedInfo: ModelInfo = { maxTokens: 1234, contextWindow: 56_789, supportsPromptCache: false, inputPrice: 1 }
const fetched: Record<string, ModelInfo> = { "fetched/known": fetchedInfo }
const endpointInfo: ModelInfo = { maxTokens: 99, contextWindow: 7_000, supportsPromptCache: true, outputPrice: 3 }

const models = <T>(record: T) => record as unknown as Record<string, ModelInfo>

/** The info of a model's first (1M context) pricing tier. */
const firstTier = (info: ModelInfo): ModelInfo => {
	const tier = info.tiers![0]!
	return {
		...info,
		contextWindow: tier.contextWindow,
		inputPrice: tier.inputPrice,
		outputPrice: tier.outputPrice,
		cacheWritesPrice: tier.cacheWritesPrice,
		cacheReadsPrice: tier.cacheReadsPrice,
	}
}

const xaiListed = Object.keys(xaiModels).find((id) => id !== xaiDefaultModelId)!
const vertexGemini = Object.keys(vertexModels).find((id) => id.startsWith("gemini"))!
const bedrockListed = Object.keys(bedrockModels)[0]!

type Expected = { id: string; info: ModelInfo | undefined; isUnknownModel: boolean }

const cases: [string, ProviderSettings, Expected][] = [
	// A static list (keep-id policy on the host).
	[
		"xai unset",
		{ apiProvider: "xai" },
		{ id: xaiDefaultModelId, info: models(xaiModels)[xaiDefaultModelId], isUnknownModel: false },
	],
	[
		"xai known",
		{ apiProvider: "xai", apiModelId: xaiListed },
		{ id: xaiListed, info: models(xaiModels)[xaiListed], isUnknownModel: false },
	],
	[
		"xai unknown",
		{ apiProvider: "xai", apiModelId: "grok-api6" },
		{ id: "grok-api6", info: undefined, isUnknownModel: true },
	],
	["xai empty", { apiProvider: "xai", apiModelId: "" }, { id: "", info: undefined, isUnknownModel: false }],

	// A static list with the honor-custom policy on the host, and the 1M tier.
	[
		"anthropic unset",
		{ apiProvider: "anthropic" },
		{ id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId], isUnknownModel: false },
	],
	[
		"anthropic known",
		{ apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5" },
		{ id: "claude-sonnet-4-5", info: anthropicModels["claude-sonnet-4-5"], isUnknownModel: false },
	],
	[
		"anthropic known with 1M",
		{ apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5", anthropicBeta1MContext: true },
		{ id: "claude-sonnet-4-5", info: firstTier(anthropicModels["claude-sonnet-4-5"]), isUnknownModel: false },
	],
	[
		"anthropic unknown",
		{ apiProvider: "anthropic", apiModelId: "claude-api6" },
		{ id: "claude-api6", info: undefined, isUnknownModel: true },
	],
	[
		"anthropic unknown naming a known model",
		{ apiProvider: "anthropic", apiModelId: "proxy/claude-sonnet-4-5-x" },
		{ id: "proxy/claude-sonnet-4-5-x", info: undefined, isUnknownModel: true },
	],
	[
		"anthropic empty",
		{ apiProvider: "anthropic", apiModelId: "" },
		{ id: "", info: undefined, isUnknownModel: false },
	],
	// fake-ai shows the plain Anthropic list: no 1M tier, no known-model check.
	[
		"fake-ai unset",
		{ apiProvider: "fake-ai" },
		{ id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId], isUnknownModel: false },
	],
	[
		"gemini unknown",
		{ apiProvider: "gemini", apiModelId: "gemini-api6" },
		{ id: "gemini-api6", info: undefined, isUnknownModel: true },
	],
	["gemini empty", { apiProvider: "gemini", apiModelId: "" }, { id: "", info: undefined, isUnknownModel: false }],
	[
		"gemini unset",
		{ apiProvider: "gemini" },
		{ id: geminiDefaultModelId, info: models(geminiModels)[geminiDefaultModelId], isUnknownModel: false },
	],

	// Vertex: Claude ids with the 1M tier, Gemini ids plain.
	[
		"vertex claude with 1M",
		{ apiProvider: "vertex", apiModelId: "claude-sonnet-4-5@20250929", vertex1MContext: true },
		{
			id: "claude-sonnet-4-5@20250929",
			info: firstTier(models(vertexModels)["claude-sonnet-4-5@20250929"]!),
			isUnknownModel: false,
		},
	],
	[
		"vertex gemini",
		{ apiProvider: "vertex", apiModelId: vertexGemini, vertex1MContext: true },
		{ id: vertexGemini, info: models(vertexModels)[vertexGemini], isUnknownModel: false },
	],
	// The settings show the default Claude model with its 1M tier (the host routes by the configured id and
	// does not apply it).
	[
		"vertex unset with 1M",
		{ apiProvider: "vertex", vertex1MContext: true },
		{
			id: "claude-sonnet-4-5@20250929",
			info: firstTier(models(vertexModels)["claude-sonnet-4-5@20250929"]!),
			isUnknownModel: false,
		},
	],
	[
		"vertex unknown",
		{ apiProvider: "vertex", apiModelId: "vertex-api6" },
		{ id: "vertex-api6", info: undefined, isUnknownModel: true },
	],
	["vertex empty", { apiProvider: "vertex", apiModelId: "" }, { id: "", info: undefined, isUnknownModel: false }],

	// Z.ai (per-line list).
	[
		"zai known (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "glm-4.5" },
		{ id: "glm-4.5", info: models(mainlandZAiModels)["glm-4.5"], isUnknownModel: false },
	],
	[
		"zai unknown (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "glm-api6" },
		{ id: "glm-api6", info: undefined, isUnknownModel: true },
	],
	[
		"zai empty (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "" },
		{ id: "", info: undefined, isUnknownModel: false },
	],
	[
		"zai unset (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api" },
		{
			id: mainlandZAiDefaultModelId,
			info: models(mainlandZAiModels)[mainlandZAiDefaultModelId],
			isUnknownModel: false,
		},
	],

	// DeepSeek: aliases, and an empty id that selects the default. Its model source is static, so the hook
	// fetches no list for it: an id only a fetched list would have is unknown.
	[
		"deepseek alias",
		{ apiProvider: "deepseek", apiModelId: "deepseek-v4-flash" },
		{ id: "deepseek-v4-flash", info: models(deepSeekModels)["deepseek-flash"], isUnknownModel: false },
	],
	[
		"deepseek fetched-only id",
		{ apiProvider: "deepseek", apiModelId: "fetched/known" },
		{ id: "fetched/known", info: undefined, isUnknownModel: true },
	],
	[
		"deepseek unknown",
		{ apiProvider: "deepseek", apiModelId: "deepseek-api6" },
		{ id: "deepseek-api6", info: undefined, isUnknownModel: true },
	],
	[
		"deepseek empty",
		{ apiProvider: "deepseek", apiModelId: "" },
		{ id: deepSeekDefaultModelId, info: models(deepSeekModels)[deepSeekDefaultModelId], isUnknownModel: false },
	],

	// Fetched lists.
	[
		"openrouter known",
		{ apiProvider: "openrouter", openRouterModelId: "fetched/known" },
		{ id: "fetched/known", info: fetchedInfo, isUnknownModel: false },
	],
	[
		"openrouter known with an endpoint",
		{ apiProvider: "openrouter", openRouterModelId: "fetched/known", openRouterSpecificProvider: "endpoint" },
		{ id: "fetched/known", info: { ...fetchedInfo, ...endpointInfo }, isUnknownModel: false },
	],
	[
		"openrouter unknown",
		{ apiProvider: "openrouter", openRouterModelId: "vendor/api6" },
		{ id: "vendor/api6", info: undefined, isUnknownModel: true },
	],
	[
		"openrouter empty",
		{ apiProvider: "openrouter", openRouterModelId: "" },
		{ id: openRouterDefaultModelId, info: undefined, isUnknownModel: true },
	],
	[
		"litellm known",
		{ apiProvider: "litellm", litellmModelId: "fetched/known" },
		{ id: "fetched/known", info: fetchedInfo, isUnknownModel: false },
	],
	[
		"litellm unknown",
		{ apiProvider: "litellm", litellmModelId: "vendor/api6" },
		{ id: "vendor/api6", info: litellmDefaultModelInfo, isUnknownModel: true },
	],
	[
		"litellm empty",
		{ apiProvider: "litellm", litellmModelId: "" },
		{ id: litellmDefaultModelId, info: litellmDefaultModelInfo, isUnknownModel: true },
	],
	[
		"ollama known (num_ctx caps the window)",
		{ apiProvider: "ollama", ollamaModelId: "fetched/known", ollamaNumCtx: 4096 },
		{ id: "fetched/known", info: { ...fetchedInfo, contextWindow: 4096 }, isUnknownModel: false },
	],
	[
		"ollama unknown",
		{ apiProvider: "ollama", ollamaModelId: "api6" },
		{ id: "api6", info: undefined, isUnknownModel: false },
	],
	["ollama empty", { apiProvider: "ollama", ollamaModelId: "" }, { id: "", info: undefined, isUnknownModel: false }],
	[
		"lmstudio known",
		{ apiProvider: "lmstudio", lmStudioModelId: "fetched/known" },
		{ id: "fetched/known", info: { ...lMStudioDefaultModelInfo, ...fetchedInfo }, isUnknownModel: false },
	],
	[
		"lmstudio unknown",
		{ apiProvider: "lmstudio", lmStudioModelId: "api6" },
		{ id: "api6", info: undefined, isUnknownModel: false },
	],
	[
		"lmstudio empty",
		{ apiProvider: "lmstudio", lmStudioModelId: "" },
		{ id: "", info: undefined, isUnknownModel: false },
	],

	// User-configured info, no list.
	[
		"openai custom info",
		{ apiProvider: "openai", openAiModelId: "anything", openAiCustomModelInfo: fetchedInfo },
		{ id: "anything", info: fetchedInfo, isUnknownModel: false },
	],
	[
		"openai no custom info",
		{ apiProvider: "openai", openAiModelId: "anything" },
		{ id: "anything", info: openAiModelInfoSaneDefaults, isUnknownModel: false },
	],
	["openai unset", { apiProvider: "openai" }, { id: "", info: openAiModelInfoSaneDefaults, isUnknownModel: false }],
	[
		"vscode-lm selector",
		{ apiProvider: "vscode-lm", vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4o" } },
		{
			id: "copilot/gpt-4o",
			info: { ...openAiModelInfoSaneDefaults, ...models(vscodeLlmModels)["gpt-4o"], supportsImages: false },
			isUnknownModel: false,
		},
	],
	[
		"vscode-lm unset",
		{ apiProvider: "vscode-lm" },
		{
			id: vscodeLlmDefaultModelId,
			info: {
				...openAiModelInfoSaneDefaults,
				...models(vscodeLlmModels)[vscodeLlmDefaultModelId],
				supportsImages: false,
			},
			isUnknownModel: false,
		},
	],

	// Bedrock (a handler-only provider on the host).
	[
		"bedrock known",
		{ apiProvider: "bedrock", apiModelId: bedrockListed },
		{ id: bedrockListed, info: models(bedrockModels)[bedrockListed], isUnknownModel: false },
	],
	[
		"bedrock custom ARN",
		{ apiProvider: "bedrock", apiModelId: "custom-arn" },
		{
			id: "custom-arn",
			info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: true, supportsImages: true },
			isUnknownModel: false,
		},
	],
	[
		"bedrock unknown",
		{ apiProvider: "bedrock", apiModelId: "bedrock-api6" },
		{ id: "bedrock-api6", info: undefined, isUnknownModel: true },
	],
	["bedrock empty", { apiProvider: "bedrock", apiModelId: "" }, { id: "", info: undefined, isUnknownModel: false }],
]

const createWrapper = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useSelectedModel model resolution (characterization)", () => {
	beforeEach(() => {
		// Every model source (router models, Ollama, LM Studio) lists the same fetched model.
		mockUseProviderModels.mockImplementation(
			(provider) =>
				({
					models: provider ? fetched : undefined,
					modelIds: provider ? Object.keys(fetched) : undefined,
					isLoading: false,
					error: undefined,
				}) as any,
		)
		mockUseOpenRouterModelProviders.mockReturnValue({
			data: { endpoint: endpointInfo },
			isLoading: false,
			isError: false,
		} as any)
	})

	it.each(cases)("%s", (_, apiConfiguration, expected) => {
		const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper: createWrapper() })

		expect({
			id: result.current.id,
			info: result.current.info,
			isUnknownModel: result.current.isUnknownModel,
		}).toEqual(expected)
	})

	// The settings side of the shared resolver's policies (owner decisions, S4 slice d); the request side is
	// pinned in packages/types provider-model-resolution.spec.ts.
	it("an unknown id: the shared resolver keeps stand-in info, the settings show none and warn", () => {
		const settings: ProviderSettings = { apiProvider: "anthropic", apiModelId: "proxy/claude-sonnet-4-5-x" }
		expect(resolveProviderModelSelection(settings)).toMatchObject({
			known: false,
			info: anthropicModels["claude-sonnet-4-5"],
		})

		const { result } = renderHook(() => useSelectedModel(settings), { wrapper: createWrapper() })
		expect(result.current).toMatchObject({ info: undefined, isUnknownModel: true })
	})

	it("an empty id: the request runs the default model, the settings keep the empty id", () => {
		const settings: ProviderSettings = { apiProvider: "xai", apiModelId: "" }
		expect(resolveProviderModelSelection(settings)?.id).toBe(xaiDefaultModelId)

		const { result } = renderHook(() => useSelectedModel(settings), { wrapper: createWrapper() })
		expect(result.current).toMatchObject({ id: "", info: undefined, isUnknownModel: false })
	})
})
