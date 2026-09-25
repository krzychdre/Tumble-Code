import type { ModelInfo } from "./model.js"
import type { ProviderSettings } from "./provider-settings.js"
import { providerModelDefinitions, resolveCatalogModel } from "./provider-models.js"
import { anthropicDefaultModelId, anthropicModels, type AnthropicModelId } from "./providers/anthropic.js"
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
	zaiApiLineConfigs,
} from "./providers/zai.js"

/**
 * The settings a model selection reads. The extension's handlers pass their
 * options (the profile without `apiProvider`), so the provider is not needed.
 */
export type ModelSelectionSettings = Omit<ProviderSettings, "apiProvider">

export type SelectedModel = { id: string; info: ModelInfo }

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
	// claude-haiku-4-5), lowercased and longest first; the ":thinking" variant
	// only matches exactly.
	.filter((id) => !id.includes(":"))
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

const ANTHROPIC_1M_CONTEXT_MODEL_IDS: readonly string[] = [
	"claude-sonnet-4-20250514",
	"claude-sonnet-4-5",
	"claude-sonnet-4-6",
	"claude-opus-4-6",
]

/**
 * The model an Anthropic profile selects, before request parameters: a listed
 * model, a custom id with guessed info, or the default; with the 1M context
 * tier applied when enabled.
 */
export function selectAnthropicModel(settings: ModelSelectionSettings): SelectedModel {
	const { id, info } = resolveCatalogModel(settings.apiModelId, providerModelDefinitions.anthropic, {
		customModelInfo: guessAnthropicModelInfo,
	})

	return ANTHROPIC_1M_CONTEXT_MODEL_IDS.includes(id) && settings.anthropicBeta1MContext
		? { id, info: withFirstTier(info) }
		: { id, info }
}

/**
 * The Claude model a Vertex profile selects, before request parameters, with
 * the 1M context tier applied when that beta is enabled for the model.
 */
export function selectAnthropicVertexModel(
	settings: ModelSelectionSettings,
): SelectedModel & { enable1MContext: boolean } {
	const { id, info } = resolveCatalogModel(settings.apiModelId, providerModelDefinitions.vertex)
	const supports1MContext = (VERTEX_1M_CONTEXT_MODEL_IDS as readonly string[]).includes(id)
	const enable1MContext = Boolean(supports1MContext && settings.vertex1MContext)

	return { id, info: enable1MContext ? withFirstTier(info) : info, enable1MContext }
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
	const { id, info } = resolveCatalogModel(settings.apiModelId, providerModelDefinitions.gemini, {
		customModelInfo: unknownGeminiModelInfo,
	})

	return { id, info }
}

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
	const isChina = zaiApiLineConfigs[settings.zaiApiLine ?? "international_coding"].isChina

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
 * @param fetchedModels - The provider's fetched model list (OpenRouter,
 * LiteLLM, Ollama, LM Studio); ignored for the other providers, whose
 * handlers never read one.
 */
export function resolvePortableProviderModel(
	settings: ProviderSettings,
	fetchedModels: Readonly<Record<string, ModelInfo>> = {},
): SelectedModel | undefined {
	switch (settings.apiProvider) {
		case "openrouter": {
			const id = settings.openRouterModelId ?? openRouterDefaultModelId
			return { id, info: fetchedModels[id] ?? openRouterDefaultModelInfo }
		}
		case "litellm": {
			const id = settings.litellmModelId || litellmDefaultModelId
			return { id, info: fetchedModels[id] ?? litellmDefaultModelInfo }
		}
		case "ollama": {
			const id = settings.ollamaModelId || ""
			return { id, info: fetchedModels[id] || openAiModelInfoSaneDefaults }
		}
		case "lmstudio": {
			const id = settings.lmStudioModelId || ""
			return { id, info: (id && fetchedModels[id]) || openAiModelInfoSaneDefaults }
		}
		case "openai":
			return {
				id: settings.openAiModelId ?? "",
				info: settings.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults,
			}
		case "vscode-lm":
			return { id: "vscode-lm", info: openAiModelInfoSaneDefaults }
		// gemini-cli has no handler; the extension runs it on the Anthropic one.
		case "anthropic":
		case "gemini-cli":
			return selectAnthropicModel(settings)
		case "gemini":
			return selectGeminiModel(settings)
		case "vertex":
			return isVertexClaudeModel(settings) ? selectAnthropicVertexModel(settings) : selectVertexModel(settings)
		case "zai":
			return resolveCatalogModel(settings.apiModelId, zaiModelCatalog(settings))
		case "deepseek":
		case "mistral":
		case "moonshot":
		case "minimax":
		case "openai-codex":
		case "openai-native":
		case "qwen-code":
		case "xai":
			return resolveCatalogModel(settings.apiModelId, providerModelDefinitions[settings.apiProvider])
		default:
			return undefined
	}
}
