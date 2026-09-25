import type { ModelInfo } from "./model.js"
import type { ModelIdKey } from "./provider-settings.js"
import type { ActiveProviderDefinition } from "./provider-registry.js"
import { anthropicDefaultModelId, anthropicModels } from "./providers/anthropic.js"
import { bedrockDefaultModelId, bedrockModels } from "./providers/bedrock.js"
import { deepSeekDefaultModelId, deepSeekModels } from "./providers/deepseek.js"
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
 * What a provider does with a model id that is not in its model list.
 *
 * - `keep-id`: the id is sent as is, with the default model's info.
 * - `substitute-default`: the default model is sent instead, silently.
 * - `honor-custom`: the id is sent as is when the provider can describe it
 *   (`customModelInfo`), otherwise the default model is sent.
 */
export const unknownModelPolicies = ["keep-id", "substitute-default", "honor-custom"] as const

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
		unknownModelPolicy: "substitute-default",
	},
	deepseek: {
		modelIdField: "apiModelId",
		models: deepSeekModels,
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
		unknownModelPolicy: "substitute-default",
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
		unknownModelPolicy: "substitute-default",
	},
	"openai-codex": {
		modelIdField: "apiModelId",
		models: openAiCodexModels,
		defaultModelId: openAiCodexDefaultModelId,
		unknownModelPolicy: "substitute-default",
	},
	"openai-native": {
		modelIdField: "apiModelId",
		models: openAiNativeModels,
		defaultModelId: openAiNativeDefaultModelId,
		unknownModelPolicy: "substitute-default",
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
		unknownModelPolicy: "substitute-default",
	},
	xai: {
		modelIdField: "apiModelId",
		models: xaiModels,
		defaultModelId: xaiDefaultModelId,
		unknownModelPolicy: "substitute-default",
	},
	zai: {
		modelIdField: "apiModelId",
		models: internationalZAiModels,
		defaultModelId: internationalZAiDefaultModelId,
		unknownModelPolicy: "substitute-default",
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
 * Resolve a configured model id against a static model list, applying the
 * provider's unknown-model policy. An absent id selects the default model; an
 * id that is not in the list (including "") follows `unknownModelPolicy`.
 * `customModelInfo` describes an unknown id for `honor-custom`; returning
 * `undefined` means the provider does not recognize it.
 */
export const resolveCatalogModel = (
	modelId: string | undefined,
	catalog: {
		models: Readonly<Record<string, ModelInfo>>
		defaultModelId: string
		unknownModelPolicy: UnknownModelPolicy
	},
	options: { customModelInfo?: (modelId: string) => ModelInfo | undefined } = {},
): CatalogModelResolution => {
	const { models, defaultModelId, unknownModelPolicy } = catalog
	const defaultInfo = models[defaultModelId]!

	if (modelId === undefined) {
		return { id: defaultModelId, info: defaultInfo, known: true }
	}

	if (Object.hasOwn(models, modelId)) {
		return { id: modelId, info: models[modelId]!, known: true }
	}

	switch (unknownModelPolicy) {
		case "keep-id":
			return { id: modelId, info: defaultInfo, known: false }
		case "honor-custom": {
			const customInfo = modelId ? options.customModelInfo?.(modelId) : undefined

			return customInfo
				? { id: modelId, info: customInfo, known: false }
				: { id: defaultModelId, info: defaultInfo, known: false }
		}
		case "substitute-default":
			return { id: defaultModelId, info: defaultInfo, known: false }
	}
}
