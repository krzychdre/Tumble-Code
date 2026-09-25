import OpenAI from "openai"

import { type ModelInfo, type ModelRecord } from "@roo-code/types"

import type { ApiHandlerOptions, FetchableModelSourceId } from "../../shared/api"

import { BaseProvider } from "./base-provider"
import { getModels, getModelsFromCache } from "./fetchers/modelCache"

import { DEFAULT_HEADERS } from "./constants"

type RouterProviderOptions = {
	name: FetchableModelSourceId
	baseURL: string
	apiKey?: string
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	options: ApiHandlerOptions
}

export abstract class RouterProvider extends BaseProvider {
	protected readonly options: ApiHandlerOptions
	protected readonly name: FetchableModelSourceId
	protected models: ModelRecord = {}
	protected readonly modelId?: string
	protected readonly defaultModelId: string
	protected readonly defaultModelInfo: ModelInfo
	protected readonly client: OpenAI

	constructor({
		options,
		name,
		baseURL,
		apiKey = "not-provided",
		modelId,
		defaultModelId,
		defaultModelInfo,
	}: RouterProviderOptions) {
		super()

		this.options = options
		this.name = name
		this.modelId = modelId
		this.defaultModelId = defaultModelId
		this.defaultModelInfo = defaultModelInfo

		this.client = new OpenAI({
			baseURL,
			apiKey,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(options.openAiHeaders || {}),
			},
			timeout: this.timeoutMs,
		})
	}

	public async fetchModel() {
		this.models = await getModels({ provider: this.name, apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		return this.getModel()
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.modelId ?? this.defaultModelId

		// Instance models are populated by fetchModel. Before that, fall back to
		// the global (synchronous disk/memory) cache and keep it for future calls.
		if (!this.models[id]) {
			const cachedModels = getModelsFromCache(this.name)
			if (cachedModels?.[id]) {
				this.models = cachedModels
			}
		}

		return resolveRouterModel({
			modelId: this.modelId,
			defaultModelId: this.defaultModelId,
			defaultModelInfo: this.defaultModelInfo,
			models: this.models,
		})
	}

	protected supportsTemperature(modelId: string): boolean {
		return !modelId.startsWith("openai/o3-mini")
	}
}

/**
 * The model a router provider reports for a model list. The configured id is
 * always kept (owner decision 5); an id missing from the list (unknown, or the
 * list is not loaded yet) gets the default model's info.
 */
export function resolveRouterModel({
	modelId,
	defaultModelId,
	defaultModelInfo,
	models,
}: {
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	models: Record<string, ModelInfo>
}): { id: string; info: ModelInfo } {
	const id = modelId || defaultModelId

	return { id, info: models[id] ?? defaultModelInfo }
}
