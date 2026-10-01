import type { CodebaseIndexConfig, SecretState } from "@roo-code/types"

import type { CodeIndexConfig, PreviousConfigSnapshot } from "../interfaces/config"
import type { IEmbedder } from "../interfaces/embedder"
import type { EmbedderProvider } from "../interfaces/manager"
import { OpenAiEmbedder } from "./openai"
import { CodeIndexOllamaEmbedder } from "./ollama"
import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { GeminiEmbedder } from "./gemini"
import { MistralEmbedder } from "./mistral"
import { BedrockEmbedder } from "./bedrock"
import { OpenRouterEmbedder } from "./openrouter"

/** The per-embedder option groups of the code-index config, one group per embedder. */
export type EmbedderOptions = Pick<
	CodeIndexConfig,
	| "openAiOptions"
	| "ollamaOptions"
	| "openAiCompatibleOptions"
	| "geminiOptions"
	| "mistralOptions"
	| "bedrockOptions"
	| "openRouterOptions"
>

type EmbedderOptionsKey = keyof EmbedderOptions

/** What an embedder reads its options from: the saved config and the secret store. */
export interface SavedEmbedderSettings {
	config: CodebaseIndexConfig
	/** The saved base URL of the embedder, trimmed (only Ollama uses it). */
	embedderBaseUrl: string | undefined
	/** A secret's value, or "" when it is not set. */
	secret(key: keyof SecretState): string
}

/**
 * Everything the code index needs to know about one embedder: where its settings live, when
 * they are complete, which of them restart indexing when changed, and how to build it.
 */
export interface EmbedderDescriptor<K extends EmbedderOptionsKey = EmbedderOptionsKey> {
	id: EmbedderProvider
	/** The option group of this embedder in the code-index config. */
	optionsKey: K
	/** i18n key of the error the factory throws when the options are incomplete. */
	missingConfigMessage: string
	/** Builds the option group from the saved settings. */
	read(saved: SavedEmbedderSettings): EmbedderOptions[K]
	/** True when the options hold everything the embedder needs. */
	isConfigured(options: EmbedderOptions[K]): boolean
	/** The snapshot fields compared to decide whether a change restarts indexing. */
	snapshot(options: EmbedderOptions[K]): Partial<PreviousConfigSnapshot>
	create(options: NonNullable<EmbedderOptions[K]>, modelId: string | undefined): IEmbedder
}

function defineEmbedder<K extends EmbedderOptionsKey>(descriptor: EmbedderDescriptor<K>): EmbedderDescriptor<K> {
	return descriptor
}

/** The code-index embedders, in the order their settings are compared. */
export const EMBEDDER_DESCRIPTORS: Record<EmbedderProvider, EmbedderDescriptor> = {
	openai: defineEmbedder({
		id: "openai",
		optionsKey: "openAiOptions",
		missingConfigMessage: "embeddings:serviceFactory.openAiConfigMissing",
		read: (saved) => ({ openAiNativeApiKey: saved.secret("codeIndexOpenAiKey") }),
		isConfigured: (options) => !!options?.openAiNativeApiKey,
		snapshot: (options) => ({ openAiKey: options?.openAiNativeApiKey ?? "" }),
		create: (options, modelId) => new OpenAiEmbedder({ ...options, openAiEmbeddingModelId: modelId }),
	}),
	ollama: defineEmbedder({
		id: "ollama",
		optionsKey: "ollamaOptions",
		missingConfigMessage: "embeddings:serviceFactory.ollamaConfigMissing",
		read: (saved) => ({ ollamaBaseUrl: saved.embedderBaseUrl }),
		// The model has a default, so the base URL is all Ollama needs.
		isConfigured: (options) => !!options?.ollamaBaseUrl,
		snapshot: (options) => ({ ollamaBaseUrl: options?.ollamaBaseUrl ?? "" }),
		create: (options, modelId) => new CodeIndexOllamaEmbedder({ ...options, ollamaModelId: modelId }),
	}),
	"openai-compatible": defineEmbedder({
		id: "openai-compatible",
		optionsKey: "openAiCompatibleOptions",
		missingConfigMessage: "embeddings:serviceFactory.openAiCompatibleConfigMissing",
		read: (saved) => {
			const baseUrl = saved.config.codebaseIndexOpenAiCompatibleBaseUrl?.trim() ?? ""
			const apiKey = saved.secret("codebaseIndexOpenAiCompatibleApiKey")
			return baseUrl && apiKey ? { baseUrl, apiKey } : undefined
		},
		isConfigured: (options) => !!(options?.baseUrl && options?.apiKey),
		snapshot: (options) => ({
			openAiCompatibleBaseUrl: options?.baseUrl ?? "",
			openAiCompatibleApiKey: options?.apiKey ?? "",
		}),
		create: (options, modelId) => new OpenAICompatibleEmbedder(options.baseUrl, options.apiKey, modelId),
	}),
	gemini: defineEmbedder({
		id: "gemini",
		optionsKey: "geminiOptions",
		missingConfigMessage: "embeddings:serviceFactory.geminiConfigMissing",
		read: (saved) => apiKeyOptions(saved.secret("codebaseIndexGeminiApiKey")),
		isConfigured: (options) => !!options?.apiKey,
		snapshot: (options) => ({ geminiApiKey: options?.apiKey ?? "" }),
		create: (options, modelId) => new GeminiEmbedder(options.apiKey, modelId),
	}),
	mistral: defineEmbedder({
		id: "mistral",
		optionsKey: "mistralOptions",
		missingConfigMessage: "embeddings:serviceFactory.mistralConfigMissing",
		read: (saved) => apiKeyOptions(saved.secret("codebaseIndexMistralApiKey")),
		isConfigured: (options) => !!options?.apiKey,
		snapshot: (options) => ({ mistralApiKey: options?.apiKey ?? "" }),
		create: (options, modelId) => new MistralEmbedder(options.apiKey, modelId),
	}),
	bedrock: defineEmbedder({
		id: "bedrock",
		optionsKey: "bedrockOptions",
		missingConfigMessage: "embeddings:serviceFactory.bedrockConfigMissing",
		read: (saved) => {
			const region = saved.config.codebaseIndexBedrockRegion ?? "us-east-1"
			const profile = saved.config.codebaseIndexBedrockProfile ?? ""
			return region ? { region, profile: profile || undefined } : undefined
		},
		// The profile is optional: without it the default AWS credential chain is used.
		isConfigured: (options) => !!options?.region,
		snapshot: (options) => ({ bedrockRegion: options?.region ?? "", bedrockProfile: options?.profile ?? "" }),
		create: (options, modelId) => new BedrockEmbedder(options.region, options.profile, modelId),
	}),
	openrouter: defineEmbedder({
		id: "openrouter",
		optionsKey: "openRouterOptions",
		missingConfigMessage: "embeddings:serviceFactory.openRouterConfigMissing",
		read: (saved) => {
			const apiKey = saved.secret("codebaseIndexOpenRouterApiKey")
			const specificProvider = saved.config.codebaseIndexOpenRouterSpecificProvider ?? ""
			return apiKey ? { apiKey, specificProvider: specificProvider || undefined } : undefined
		},
		isConfigured: (options) => !!options?.apiKey,
		snapshot: (options) => ({
			openRouterApiKey: options?.apiKey ?? "",
			openRouterSpecificProvider: options?.specificProvider ?? "",
		}),
		create: (options, modelId) =>
			new OpenRouterEmbedder(options.apiKey, modelId, undefined, options.specificProvider),
	}),
}

function apiKeyOptions(apiKey: string): { apiKey: string } | undefined {
	return apiKey ? { apiKey } : undefined
}

/** The descriptor of a provider id, or undefined for an id this version does not have. */
export function findEmbedderDescriptor(provider: string | undefined): EmbedderDescriptor | undefined {
	return provider && Object.hasOwn(EMBEDDER_DESCRIPTORS, provider)
		? EMBEDDER_DESCRIPTORS[provider as EmbedderProvider]
		: undefined
}

/** Reads the option group of every embedder; groups with incomplete settings are undefined. */
export function readEmbedderOptions(saved: SavedEmbedderSettings): EmbedderOptions {
	const options: Record<string, unknown> = {}
	for (const descriptor of Object.values(EMBEDDER_DESCRIPTORS)) {
		options[descriptor.optionsKey] = descriptor.read(saved)
	}
	return options as EmbedderOptions
}

/** The restart-relevant snapshot fields of every embedder. */
export function snapshotEmbedderOptions(options: EmbedderOptions): Partial<PreviousConfigSnapshot> {
	return Object.assign(
		{},
		...Object.values(EMBEDDER_DESCRIPTORS).map((descriptor) => descriptor.snapshot(options[descriptor.optionsKey])),
	)
}
