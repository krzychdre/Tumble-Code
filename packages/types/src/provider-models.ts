import type { ModelInfo } from "./model.js"
import type { ModelIdKey } from "./provider-settings.js"
import type { ActiveProviderDefinition } from "./provider-registry.js"
import { anthropicDefaultModelId, anthropicModels } from "./providers/anthropic.js"
import { bedrockDefaultModelId, bedrockModels } from "./providers/bedrock.js"
import { deepSeekDefaultModelId, deepSeekModelAliases, deepSeekModels } from "./providers/deepseek.js"
import { geminiDefaultModelId, geminiModels } from "./providers/gemini.js"
import { litellmDefaultModelId } from "./providers/lite-llm.js"
import { minimaxDefaultModelId, minimaxModels } from "./providers/minimax.js"
import { mistralDefaultModelId, mistralModels } from "./providers/mistral.js"
import { moonshotDefaultModelId, moonshotModels } from "./providers/moonshot.js"
import { openAiCodexDefaultModelId, openAiCodexModels } from "./providers/openai-codex.js"
import { openAiNativeDefaultModelId, openAiNativeModels } from "./providers/openai.js"
import { openRouterDefaultModelId } from "./providers/openrouter.js"
import { qwenCodeDefaultModelId, qwenCodeModels } from "./providers/qwen-code.js"
import { vertexDefaultModelId, vertexModels } from "./providers/vertex.js"
import { vscodeLlmDefaultModelId } from "./providers/vscode-llm.js"
import { xaiDefaultModelId, xaiModels } from "./providers/xai.js"
import { internationalZAiDefaultModelId, internationalZAiModels } from "./providers/zai.js"

/**
 * What a provider does with a model id that is not in its model list. Owner
 * decision 5 (2026-09-25): an unknown id is always sent as is, never silently
 * replaced by the default model; the settings UI warns that the id is unknown.
 *
 * - `keep-id`: the id is sent with the default model's info (capabilities
 *   and prices).
 * - `honor-custom`: the id is sent with the info the provider derives from it
 *   (`customModelInfo`: Anthropic and Bedrock guess from the model family,
 *   Gemini drops the prices it cannot verify), or with the default model's
 *   info when it cannot.
 */
export const unknownModelPolicies = ["keep-id", "honor-custom"] as const

export type UnknownModelPolicy = (typeof unknownModelPolicies)[number]

/**
 * The settings field a provider reads its model id from. `vsCodeLmModelSelector`
 * holds a selector object whose `id` is the model id; `null` means the provider
 * takes no model id from settings (`fake-ai` gets its model from the injected
 * fake handler).
 */
export type ProviderModelIdField = ModelIdKey | "vsCodeLmModelSelector" | null

export type ProviderModelDefinition = {
	readonly modelIdField: ProviderModelIdField
	/** The static model list; absent when the list is fetched at runtime or configured by the user. */
	readonly models?: Readonly<Record<string, ModelInfo>>
	/**
	 * Other names the provider's API accepts for listed models (alias to model
	 * id). An alias is a known id: it is sent as configured, with the info of
	 * the model it names.
	 */
	readonly modelAliases?: Readonly<Record<string, string>>
	/** The model used when the profile names none; "" when the user must pick one. */
	readonly defaultModelId?: string
	readonly unknownModelPolicy: UnknownModelPolicy
}

/**
 * Model facts of every provider that can be executed (active and hidden
 * lifecycles), in one place. The runtime provider registry in the extension
 * extends each entry with its handler factory, capabilities and model
 * resolution; the organization allow list, `modelIdKeysByProvider`, the
 * default model ids and the settings UI model lists are derived from it.
 *
 * Z.ai lists the international models; the mainland line has its own list and
 * default (see `providers/zai.ts`).
 */
export const providerModelDefinitions = {
	openrouter: {
		modelIdField: "openRouterModelId",
		defaultModelId: openRouterDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	litellm: {
		modelIdField: "litellmModelId",
		defaultModelId: litellmDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	deepseek: {
		modelIdField: "apiModelId",
		models: deepSeekModels,
		modelAliases: deepSeekModelAliases,
		defaultModelId: deepSeekDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	ollama: { modelIdField: "ollamaModelId", defaultModelId: "", unknownModelPolicy: "keep-id" },
	lmstudio: { modelIdField: "lmStudioModelId", defaultModelId: "", unknownModelPolicy: "keep-id" },
	"vscode-lm": {
		modelIdField: "vsCodeLmModelSelector",
		defaultModelId: vscodeLlmDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	openai: { modelIdField: "openAiModelId", defaultModelId: "", unknownModelPolicy: "keep-id" },
	"fake-ai": { modelIdField: null, unknownModelPolicy: "keep-id" },
	anthropic: {
		modelIdField: "apiModelId",
		models: anthropicModels,
		defaultModelId: anthropicDefaultModelId,
		unknownModelPolicy: "honor-custom",
	},
	bedrock: {
		modelIdField: "apiModelId",
		models: bedrockModels,
		defaultModelId: bedrockDefaultModelId,
		// The handler guesses the info from the model family.
		unknownModelPolicy: "honor-custom",
	},
	gemini: {
		modelIdField: "apiModelId",
		models: geminiModels,
		defaultModelId: geminiDefaultModelId,
		unknownModelPolicy: "honor-custom",
	},
	// No runtime handler: the extension runs it on the Anthropic handler.
	"gemini-cli": {
		modelIdField: "apiModelId",
		defaultModelId: anthropicDefaultModelId,
		unknownModelPolicy: "honor-custom",
	},
	mistral: {
		modelIdField: "apiModelId",
		models: mistralModels,
		defaultModelId: mistralDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	moonshot: {
		modelIdField: "apiModelId",
		models: moonshotModels,
		defaultModelId: moonshotDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	minimax: {
		modelIdField: "apiModelId",
		models: minimaxModels,
		defaultModelId: minimaxDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	"openai-codex": {
		modelIdField: "apiModelId",
		models: openAiCodexModels,
		defaultModelId: openAiCodexDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	"openai-native": {
		modelIdField: "apiModelId",
		models: openAiNativeModels,
		defaultModelId: openAiNativeDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	"qwen-code": {
		modelIdField: "apiModelId",
		models: qwenCodeModels,
		defaultModelId: qwenCodeDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	vertex: {
		modelIdField: "apiModelId",
		models: vertexModels,
		defaultModelId: vertexDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	xai: {
		modelIdField: "apiModelId",
		models: xaiModels,
		defaultModelId: xaiDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
	zai: {
		modelIdField: "apiModelId",
		models: internationalZAiModels,
		defaultModelId: internationalZAiDefaultModelId,
		unknownModelPolicy: "keep-id",
	},
} as const satisfies Record<ActiveProviderDefinition["id"], ProviderModelDefinition>

export type ProviderModelDefinitionId = keyof typeof providerModelDefinitions

export const getProviderModelDefinition = (provider: string | undefined): ProviderModelDefinition | undefined =>
	provider && Object.hasOwn(providerModelDefinitions, provider)
		? providerModelDefinitions[provider as ProviderModelDefinitionId]
		: undefined

export type CatalogModelResolution = {
	id: string
	info: ModelInfo
	/** False when the configured id is not in the model list. */
	known: boolean
}

/**
 * Resolve a configured model id against a static model list. An absent or
 * empty id selects the default model. An id that is not in the list is kept
 * (owner decision 5) with the info `unknownModelPolicy` gives it; it is never
 * replaced by the default model.
 */
export const resolveCatalogModel = (
	modelId: string | undefined,
	catalog: {
		models: Readonly<Record<string, ModelInfo>>
		modelAliases?: Readonly<Record<string, string>>
		defaultModelId: string
		unknownModelPolicy: UnknownModelPolicy
	},
	options: { customModelInfo?: (modelId: string) => ModelInfo | undefined } = {},
): CatalogModelResolution => {
	const { models, modelAliases, defaultModelId, unknownModelPolicy } = catalog
	const defaultInfo = models[defaultModelId]!

	if (!modelId) {
		return { id: defaultModelId, info: defaultInfo, known: true }
	}

	if (Object.hasOwn(models, modelId)) {
		return { id: modelId, info: models[modelId]!, known: true }
	}

	const aliasedModelId = modelAliases && Object.hasOwn(modelAliases, modelId) ? modelAliases[modelId] : undefined
	if (aliasedModelId && Object.hasOwn(models, aliasedModelId)) {
		return { id: modelId, info: models[aliasedModelId]!, known: true }
	}

	const customInfo = unknownModelPolicy === "honor-custom" ? options.customModelInfo?.(modelId) : undefined

	return { id: modelId, info: customInfo ?? defaultInfo, known: false }
}
