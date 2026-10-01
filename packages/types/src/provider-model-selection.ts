import type { ModelInfo } from "./model.js"
import type { ProviderSettings } from "./provider-settings.js"
import { type CatalogModelResolution, providerModelDefinitions, resolveCatalogModel } from "./provider-models.js"
import {
	ANTHROPIC_1M_CONTEXT_MODEL_IDS,
	anthropicDefaultModelId,
	anthropicModels,
	type AnthropicModelId,
} from "./providers/anthropic.js"
import { geminiDefaultModelId, geminiModels } from "./providers/gemini.js"
import { litellmDefaultModelId, litellmDefaultModelInfo } from "./providers/lite-llm.js"
import { openAiModelInfoSaneDefaults } from "./providers/openai.js"
import { openRouterDefaultModelId, openRouterDefaultModelInfo } from "./providers/openrouter.js"
import { VERTEX_1M_CONTEXT_MODEL_IDS } from "./providers/vertex.js"
import {
	internationalZAiDefaultModelId,
	internationalZAiModels,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
	isZaiChinaLine,
} from "./providers/zai.js"

/**
 * The settings a model selection reads. The extension's handlers pass their
 * options (the profile without `apiProvider`), so the provider is not needed.
 */
export type ModelSelectionSettings = Omit<ProviderSettings, "apiProvider">

export type SelectedModel = { id: string; info: ModelInfo }

/**
 * What an empty ("") configured model id selects on a provider with a static model list. The request
 * runs the default model (`"default-model"`, what `resolveCatalogModel` does); the settings UI keeps the
 * empty id and shows no model info (`"keep-empty"`). Both behaviours are intended (owner decision,
 * S4 slice d). Providers with a fetched list or user-configured info have their own empty-id rule and
 * ignore this policy.
 */
export type EmptyModelIdPolicy = "default-model" | "keep-empty"

/**
 * A resolved model. `known` is false when the provider has a model list and the id is not in it (or is
 * an empty id kept by `"keep-empty"`); `info` is then a stand-in: the default model's info, or a guess
 * from the id where the provider honors custom ids. The request sizes and prices the model with the
 * stand-in; the settings UI shows no info for it and warns (owner decision, S4 slice d). Providers
 * without a list (OpenAI Compatible, VS Code LM) are always known.
 */
export type ProviderModelResolution = CatalogModelResolution

export type ProviderModelResolutionOptions = {
	/** The provider's fetched model list (OpenRouter, LiteLLM, Ollama, LM Studio); ignored for the others. */
	fetchedModels?: Readonly<Record<string, ModelInfo>>
	/** Default `"default-model"` (the request's rule). */
	emptyModelId?: EmptyModelIdPolicy
}

type ModelCatalog = Parameters<typeof resolveCatalogModel>[1]

/** `resolveCatalogModel` with the empty-id policy applied first. */
function resolveFromCatalog(
	modelId: string | undefined,
	catalog: ModelCatalog,
	emptyModelId: EmptyModelIdPolicy,
	options?: Parameters<typeof resolveCatalogModel>[2],
): ProviderModelResolution {
	if (modelId === "" && emptyModelId === "keep-empty") {
		return { id: "", info: catalog.models[catalog.defaultModelId]!, known: false }
	}

	return resolveCatalogModel(modelId, catalog, options)
}

/**
 * Model info for an id that is not in `anthropicModels`: the closest known
 * model when the id contains one (custom base URL proxies, dated snapshots,
 * cli-settings.json model ids), otherwise the default model's limits and
 * capabilities without its pricing, so cost is not billed at the rates of a
 * model we are not talking to.
 */
const anthropicModelIdMatchers: ReadonlyArray<readonly [string, AnthropicModelId]> = (
	Object.keys(anthropicModels) as AnthropicModelId[]
)
	// Known ids plus their undated aliases (claude-haiku-4-5-20251001 also as
	// claude-haiku-4-5), lowercased and longest first.
	.flatMap((id) => {
		const undated = id.replace(/-\d{8}$/, "")
		return undated === id ? [[id, id] as const] : [[id, id] as const, [undated, id] as const]
	})
	.map(([alias, id]) => [alias.toLowerCase(), id] as const)
	.sort((a, b) => b[0].length - a[0].length)

export function guessAnthropicModelInfo(modelId: string): ModelInfo {
	const lowerModelId = modelId.toLowerCase()
	const match = anthropicModelIdMatchers.find(([alias]) => lowerModelId.includes(alias))

	if (match) {
		return anthropicModels[match[1]]
	}

	return {
		...anthropicModels[anthropicDefaultModelId],
		inputPrice: undefined,
		outputPrice: undefined,
		cacheWritesPrice: undefined,
		cacheReadsPrice: undefined,
		tiers: undefined,
		longContextPricing: undefined,
	}
}

/** The info of the model's first pricing tier (the 1M context tier), or the info unchanged. */
function withFirstTier(info: ModelInfo): ModelInfo {
	const tier = info.tiers?.[0]

	return tier
		? {
				...info,
				contextWindow: tier.contextWindow,
				inputPrice: tier.inputPrice,
				outputPrice: tier.outputPrice,
				cacheWritesPrice: tier.cacheWritesPrice,
				cacheReadsPrice: tier.cacheReadsPrice,
			}
		: info
}

/**
 * The model an Anthropic profile selects, before request parameters: a listed
 * model, a custom id with guessed info, or the default; with the 1M context
 * tier applied when enabled.
 */
export function selectAnthropicModel(settings: ModelSelectionSettings): SelectedModel {
	const { id, info } = resolveAnthropicModel(settings, "default-model")

	return { id, info }
}

function resolveAnthropicModel(
	settings: ModelSelectionSettings,
	emptyModelId: EmptyModelIdPolicy,
): ProviderModelResolution {
	const resolved = resolveFromCatalog(settings.apiModelId, providerModelDefinitions.anthropic, emptyModelId, {
		customModelInfo: guessAnthropicModelInfo,
	})

	return ANTHROPIC_1M_CONTEXT_MODEL_IDS.includes(resolved.id) && settings.anthropicBeta1MContext
		? { ...resolved, info: withFirstTier(resolved.info) }
		: resolved
}

/**
 * The Claude model a Vertex profile selects, before request parameters, with
 * the 1M context tier applied when that beta is enabled for the model.
 */
export function selectAnthropicVertexModel(
	settings: ModelSelectionSettings,
): SelectedModel & { enable1MContext: boolean } {
	const { id, info, enable1MContext } = resolveAnthropicVertexModel(settings, "default-model")

	return { id, info, enable1MContext }
}

function resolveAnthropicVertexModel(
	settings: ModelSelectionSettings,
	emptyModelId: EmptyModelIdPolicy,
): ProviderModelResolution & { enable1MContext: boolean } {
	const resolved = resolveFromCatalog(settings.apiModelId, providerModelDefinitions.vertex, emptyModelId)
	const supports1MContext = (VERTEX_1M_CONTEXT_MODEL_IDS as readonly string[]).includes(resolved.id)
	const enable1MContext = Boolean(supports1MContext && settings.vertex1MContext)

	return { ...resolved, info: enable1MContext ? withFirstTier(resolved.info) : resolved.info, enable1MContext }
}

/**
 * An unlisted Gemini model id (e.g. a newly released model not yet in
 * `geminiModels`) is kept (owner decision 5). The default model's structural
 * info is the baseline, without the pricing fields we can't verify for an
 * unknown model, so cost reporting shows "unknown" instead of charging the
 * default model's rates against a different model.
 */
const unknownGeminiModelInfo = (): ModelInfo => ({
	...geminiModels[geminiDefaultModelId],
	inputPrice: undefined,
	outputPrice: undefined,
	cacheReadsPrice: undefined,
	cacheWritesPrice: undefined,
	tiers: undefined,
})

/** The model a Gemini profile selects, before request parameters. */
export function selectGeminiModel(settings: ModelSelectionSettings): SelectedModel {
	const { id, info } = resolveGeminiModel(settings, "default-model")

	return { id, info }
}

const resolveGeminiModel = (settings: ModelSelectionSettings, emptyModelId: EmptyModelIdPolicy) =>
	resolveFromCatalog(settings.apiModelId, providerModelDefinitions.gemini, emptyModelId, {
		customModelInfo: unknownGeminiModelInfo,
	})

/** The Gemini model a Vertex profile selects, before request parameters. */
export function selectVertexModel(settings: ModelSelectionSettings): SelectedModel {
	const { id, info } = resolveCatalogModel(settings.apiModelId, providerModelDefinitions.vertex)

	return { id, info }
}

/** Whether a Vertex profile runs a Claude model (on the Anthropic Vertex handler). */
export const isVertexClaudeModel = (settings: ModelSelectionSettings): boolean =>
	settings.apiModelId?.startsWith("claude") ?? false

/** The Z.ai model list of the profile's API line: the mainland line has its own list and default. */
export function zaiModelCatalog(settings: ModelSelectionSettings) {
	const isChina = isZaiChinaLine(settings.zaiApiLine)

	return {
		models: (isChina ? mainlandZAiModels : internationalZAiModels) as unknown as Record<string, ModelInfo>,
		defaultModelId: (isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId) as string,
		unknownModelPolicy: providerModelDefinitions.zai.unknownModelPolicy,
	}
}

/**
 * The model a profile selects and the info its handler sizes it with,
 * computed from the settings and the provider's fetched model list, for the
 * providers whose handler needs nothing else: everything except Bedrock (its
 * handler parses a custom ARN and guesses from the model family) and fake-ai.
 * `undefined` for those and for providers this version cannot run.
 *
 * The id is the configured one: handler-only request adjustments (the
 * `:thinking` suffix, tool preferences, OpenRouter endpoints) are not applied.
 * The extension's registry tests pin that `info.contextWindow` equals what
 * `resolveProviderModel` reports.
 *
 * This is the request side of `resolveProviderModelSelection` (empty id selects
 * the default model, an unknown id keeps its stand-in info); the settings UI
 * (`useSelectedModel`) is the other adapter.
 *
 * @param fetchedModels - The provider's fetched model list (OpenRouter,
 * LiteLLM, Ollama, LM Studio); ignored for the other providers, whose
 * handlers never read one.
 */
export function resolvePortableProviderModel(
	settings: ProviderSettings,
	fetchedModels: Readonly<Record<string, ModelInfo>> = {},
): SelectedModel | undefined {
	return resolveProviderModelSelection(settings, { fetchedModels })
}

/**
 * The model a profile selects, shared by the request side
 * (`resolvePortableProviderModel`, the handlers' own resolvers) and the
 * settings UI (`useSelectedModel`). The two differ only by policy: what an
 * empty id selects (`emptyModelId`), and what they do with an unknown id's
 * stand-in info (`known: false`, which the settings UI turns into no info).
 * `undefined` for Bedrock, fake-ai and providers this version cannot run.
 */
export function resolveProviderModelSelection(
	settings: ProviderSettings,
	{ fetchedModels = {}, emptyModelId = "default-model" }: ProviderModelResolutionOptions = {},
): ProviderModelResolution | undefined {
	const isFetched = (id: string) => Object.hasOwn(fetchedModels, id)

	switch (settings.apiProvider) {
		case "openrouter": {
			const id = settings.openRouterModelId ?? openRouterDefaultModelId
			return { id, info: fetchedModels[id] ?? openRouterDefaultModelInfo, known: isFetched(id) }
		}
		case "litellm": {
			const id = settings.litellmModelId || litellmDefaultModelId
			return { id, info: fetchedModels[id] ?? litellmDefaultModelInfo, known: isFetched(id) }
		}
		case "ollama": {
			const id = settings.ollamaModelId || ""
			return { id, info: fetchedModels[id] || openAiModelInfoSaneDefaults, known: isFetched(id) }
		}
		case "lmstudio": {
			const id = settings.lmStudioModelId || ""
			return { id, info: (id && fetchedModels[id]) || openAiModelInfoSaneDefaults, known: isFetched(id) }
		}
		case "openai":
			return {
				id: settings.openAiModelId ?? "",
				info: settings.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults,
				known: true,
			}
		case "vscode-lm":
			return { id: "vscode-lm", info: openAiModelInfoSaneDefaults, known: true }
		case "anthropic":
			return resolveAnthropicModel(settings, emptyModelId)
		case "gemini":
			return resolveGeminiModel(settings, emptyModelId)
		case "vertex":
			return isVertexClaudeModel(settings)
				? resolveAnthropicVertexModel(settings, emptyModelId)
				: resolveFromCatalog(settings.apiModelId, providerModelDefinitions.vertex, emptyModelId)
		case "zai":
			return resolveFromCatalog(settings.apiModelId, zaiModelCatalog(settings), emptyModelId)
		case "deepseek":
		case "mistral":
		case "moonshot":
		case "minimax":
		case "openai-codex":
		case "openai-native":
		case "qwen-code":
		case "xai":
			return resolveFromCatalog(settings.apiModelId, providerModelDefinitions[settings.apiProvider], emptyModelId)
		default:
			return undefined
	}
}
