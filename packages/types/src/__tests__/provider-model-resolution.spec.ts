// Characterization (S4 slice d): the model the host resolves for a profile (`resolvePortableProviderModel`,
// which the CLI's context gauge reads and `src/api/__tests__/portable-model-resolution.spec.ts` pins against
// the handlers), for a known id, an unknown id, an empty id and an unset id per representative provider.
// Taken on main before the webview hook `useSelectedModel` and these resolvers were put on one shared
// resolver; the webview side is pinned in `webview-ui/.../useSelectedModel.resolution.spec.ts`.

import type { ModelInfo, ProviderSettings } from "../index.js"
import {
	anthropicDefaultModelId,
	anthropicModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	guessAnthropicModelInfo,
	litellmDefaultModelId,
	litellmDefaultModelInfo,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
	openAiModelInfoSaneDefaults,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	resolvePortableProviderModel,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
} from "../index.js"

const fetchedInfo: ModelInfo = { maxTokens: 1234, contextWindow: 56_789, supportsPromptCache: false, inputPrice: 1 }
const fetched: Record<string, ModelInfo> = { "fetched/known": fetchedInfo }

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

const withoutPricing = (info: ModelInfo): ModelInfo => ({
	...info,
	inputPrice: undefined,
	outputPrice: undefined,
	cacheReadsPrice: undefined,
	cacheWritesPrice: undefined,
	tiers: undefined,
})

const xaiListed = Object.keys(xaiModels).find((id) => id !== xaiDefaultModelId)!
const vertexGemini = Object.keys(vertexModels).find((id) => id.startsWith("gemini"))!
const models = <T>(record: T) => record as unknown as Record<string, ModelInfo>

const cases: [string, ProviderSettings, { id: string; info: ModelInfo } | undefined][] = [
	// A static list with the keep-id policy.
	["xai unset", { apiProvider: "xai" }, { id: xaiDefaultModelId, info: models(xaiModels)[xaiDefaultModelId]! }],
	[
		"xai known",
		{ apiProvider: "xai", apiModelId: xaiListed },
		{ id: xaiListed, info: models(xaiModels)[xaiListed]! },
	],
	[
		"xai unknown",
		{ apiProvider: "xai", apiModelId: "grok-api6" },
		{ id: "grok-api6", info: models(xaiModels)[xaiDefaultModelId]! },
	],
	[
		"xai empty",
		{ apiProvider: "xai", apiModelId: "" },
		{ id: xaiDefaultModelId, info: models(xaiModels)[xaiDefaultModelId]! },
	],

	// A static list with the honor-custom policy and the 1M tier.
	[
		"anthropic unset",
		{ apiProvider: "anthropic" },
		{ id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId] },
	],
	[
		"anthropic known",
		{ apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5" },
		{ id: "claude-sonnet-4-5", info: anthropicModels["claude-sonnet-4-5"] },
	],
	[
		"anthropic known with 1M",
		{ apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5", anthropicBeta1MContext: true },
		{ id: "claude-sonnet-4-5", info: firstTier(anthropicModels["claude-sonnet-4-5"]) },
	],
	[
		"anthropic unknown",
		{ apiProvider: "anthropic", apiModelId: "claude-api6" },
		{ id: "claude-api6", info: withoutPricing(anthropicModels[anthropicDefaultModelId]) },
	],
	[
		"anthropic unknown naming a known model",
		{ apiProvider: "anthropic", apiModelId: "proxy/claude-sonnet-4-5-x" },
		{ id: "proxy/claude-sonnet-4-5-x", info: anthropicModels["claude-sonnet-4-5"] },
	],
	[
		"anthropic empty",
		{ apiProvider: "anthropic", apiModelId: "" },
		{ id: anthropicDefaultModelId, info: anthropicModels[anthropicDefaultModelId] },
	],
	// gemini-cli runs on the Anthropic handler, 1M flag included.
	[
		"gemini-cli known with 1M",
		{ apiProvider: "gemini-cli", apiModelId: "claude-sonnet-4-5", anthropicBeta1MContext: true },
		{ id: "claude-sonnet-4-5", info: firstTier(anthropicModels["claude-sonnet-4-5"]) },
	],
	[
		"gemini unknown",
		{ apiProvider: "gemini", apiModelId: "gemini-api6" },
		{ id: "gemini-api6", info: withoutPricing(models(geminiModels)[geminiDefaultModelId]!) },
	],
	[
		"gemini empty",
		{ apiProvider: "gemini", apiModelId: "" },
		{ id: geminiDefaultModelId, info: models(geminiModels)[geminiDefaultModelId]! },
	],

	// Vertex: Claude ids with the 1M tier, Gemini ids plain.
	[
		"vertex claude with 1M",
		{ apiProvider: "vertex", apiModelId: "claude-sonnet-4-5@20250929", vertex1MContext: true },
		{ id: "claude-sonnet-4-5@20250929", info: firstTier(models(vertexModels)["claude-sonnet-4-5@20250929"]!) },
	],
	[
		"vertex gemini",
		{ apiProvider: "vertex", apiModelId: vertexGemini, vertex1MContext: true },
		{ id: vertexGemini, info: models(vertexModels)[vertexGemini]! },
	],
	[
		"vertex unknown",
		{ apiProvider: "vertex", apiModelId: "vertex-api6" },
		{ id: "vertex-api6", info: models(vertexModels)[vertexDefaultModelId]! },
	],
	[
		"vertex empty",
		{ apiProvider: "vertex", apiModelId: "" },
		{ id: vertexDefaultModelId, info: models(vertexModels)[vertexDefaultModelId]! },
	],

	// Z.ai (per-line list).
	[
		"zai known (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "glm-4.5" },
		{ id: "glm-4.5", info: models(mainlandZAiModels)["glm-4.5"]! },
	],
	[
		"zai unknown (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "glm-api6" },
		{ id: "glm-api6", info: models(mainlandZAiModels)[mainlandZAiDefaultModelId]! },
	],
	[
		"zai empty (mainland)",
		{ apiProvider: "zai", zaiApiLine: "china_api", apiModelId: "" },
		{ id: mainlandZAiDefaultModelId, info: models(mainlandZAiModels)[mainlandZAiDefaultModelId]! },
	],

	// DeepSeek: aliases, and a fetched list the host does not read.
	[
		"deepseek alias",
		{ apiProvider: "deepseek", apiModelId: "deepseek-v4-flash" },
		{ id: "deepseek-v4-flash", info: models(deepSeekModels)["deepseek-flash"]! },
	],
	[
		"deepseek fetched-only id",
		{ apiProvider: "deepseek", apiModelId: "fetched/known" },
		{ id: "fetched/known", info: models(deepSeekModels)[deepSeekDefaultModelId]! },
	],
	[
		"deepseek empty",
		{ apiProvider: "deepseek", apiModelId: "" },
		{ id: deepSeekDefaultModelId, info: models(deepSeekModels)[deepSeekDefaultModelId]! },
	],

	// Fetched lists.
	[
		"openrouter known",
		{ apiProvider: "openrouter", openRouterModelId: "fetched/known" },
		{ id: "fetched/known", info: fetchedInfo },
	],
	[
		"openrouter unknown",
		{ apiProvider: "openrouter", openRouterModelId: "vendor/api6" },
		{ id: "vendor/api6", info: openRouterDefaultModelInfo },
	],
	[
		"openrouter empty",
		{ apiProvider: "openrouter", openRouterModelId: "" },
		{ id: "", info: openRouterDefaultModelInfo },
	],
	[
		"openrouter unset",
		{ apiProvider: "openrouter" },
		{ id: openRouterDefaultModelId, info: openRouterDefaultModelInfo },
	],
	[
		"litellm known",
		{ apiProvider: "litellm", litellmModelId: "fetched/known" },
		{ id: "fetched/known", info: fetchedInfo },
	],
	[
		"litellm unknown",
		{ apiProvider: "litellm", litellmModelId: "vendor/api6" },
		{ id: "vendor/api6", info: litellmDefaultModelInfo },
	],
	[
		"litellm empty",
		{ apiProvider: "litellm", litellmModelId: "" },
		{ id: litellmDefaultModelId, info: litellmDefaultModelInfo },
	],
	[
		"ollama known (num_ctx not applied)",
		{ apiProvider: "ollama", ollamaModelId: "fetched/known", ollamaNumCtx: 4096 },
		{ id: "fetched/known", info: fetchedInfo },
	],
	[
		"ollama unknown",
		{ apiProvider: "ollama", ollamaModelId: "api6" },
		{ id: "api6", info: openAiModelInfoSaneDefaults },
	],
	["ollama empty", { apiProvider: "ollama", ollamaModelId: "" }, { id: "", info: openAiModelInfoSaneDefaults }],
	[
		"lmstudio known",
		{ apiProvider: "lmstudio", lmStudioModelId: "fetched/known" },
		{ id: "fetched/known", info: fetchedInfo },
	],
	[
		"lmstudio unknown",
		{ apiProvider: "lmstudio", lmStudioModelId: "api6" },
		{ id: "api6", info: openAiModelInfoSaneDefaults },
	],
	["lmstudio empty", { apiProvider: "lmstudio", lmStudioModelId: "" }, { id: "", info: openAiModelInfoSaneDefaults }],

	// User-configured info, no list.
	[
		"openai custom info",
		{ apiProvider: "openai", openAiModelId: "anything", openAiCustomModelInfo: fetchedInfo },
		{ id: "anything", info: fetchedInfo },
	],
	[
		"openai no custom info",
		{ apiProvider: "openai", openAiModelId: "anything" },
		{ id: "anything", info: openAiModelInfoSaneDefaults },
	],
	["openai unset", { apiProvider: "openai" }, { id: "", info: openAiModelInfoSaneDefaults }],
	[
		"vscode-lm",
		{ apiProvider: "vscode-lm", vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4o" } },
		{ id: "vscode-lm", info: openAiModelInfoSaneDefaults },
	],

	// Handler-only providers.
	["bedrock", { apiProvider: "bedrock", apiModelId: "anthropic.claude-sonnet-4-6" }, undefined],
	["fake-ai", { apiProvider: "fake-ai" }, undefined],
]

describe("host model resolution (characterization)", () => {
	it.each(cases)("%s", (_, settings, expected) => {
		const resolved = resolvePortableProviderModel(settings, fetched)

		expect(resolved && { id: resolved.id, info: resolved.info }).toEqual(expected)
	})

	it("the guessed Anthropic info is the named model's", () => {
		expect(guessAnthropicModelInfo("proxy/claude-sonnet-4-5-x")).toBe(anthropicModels["claude-sonnet-4-5"])
	})
})
