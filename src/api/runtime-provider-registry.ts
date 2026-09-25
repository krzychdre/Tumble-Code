import {
	type ActiveProviderDefinition,
	type ModelInfo,
	type ProviderModelDefinition,
	litellmDefaultModelId,
	litellmDefaultModelInfo,
	isVertexClaudeModel,
	providerModelDefinitions,
	resolveCatalogModel,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../shared/api"

import type { ApiHandler } from "./index"
import {
	AnthropicHandler,
	AnthropicVertexHandler,
	AwsBedrockHandler,
	DeepSeekHandler,
	FakeAIHandler,
	GeminiHandler,
	LiteLLMHandler,
	LmStudioHandler,
	MiniMaxHandler,
	MistralHandler,
	MoonshotHandler,
	OpenAiCodexHandler,
	OpenAiHandler,
	OpenAiNativeHandler,
	OpenRouterHandler,
	QwenCodeHandler,
	VertexHandler,
	VsCodeLmHandler,
	XAIHandler,
	ZAiHandler,
} from "./providers"
import { NativeOllamaHandler, resolveOllamaModel } from "./providers/native-ollama"
import { resolveAnthropicModel } from "./providers/anthropic"
import { resolveAnthropicVertexModel } from "./providers/anthropic-vertex"
import { resolveGeminiModel } from "./providers/gemini"
import { resolveLmStudioModel } from "./providers/lm-studio"
import { resolveOpenAiModel } from "./providers/openai"
import { resolveOpenRouterModel } from "./providers/openrouter"
import { resolveRouterModel } from "./providers/router-provider"
import { resolveVertexModel } from "./providers/vertex"
import { resolveVsCodeLmModel } from "./providers/vscode-lm"
import { resolveZAiModel } from "./providers/zai"
import { getModelsFromCache } from "./providers/fetchers/modelCache"
import { forceFullModelDetailsLoad, hasLoadedFullDetails } from "./providers/fetchers/lmstudio"

type PortableActiveProviderId = ActiveProviderDefinition["id"]

/**
 * Portable active/hidden providers that do not have a dedicated runtime handler.
 *
 * `gemini-cli` is retained in the portable inventory for profile compatibility,
 * but the pre-registry factory had no matching case and therefore used the
 * Anthropic fallback. Keeping it outside the runtime registry preserves that
 * behavior without claiming that it has a runtime implementation.
 */
export const providerIdsWithoutRuntimeHandler = ["gemini-cli"] as const satisfies readonly PortableActiveProviderId[]

export type RuntimeProviderId = Exclude<PortableActiveProviderId, (typeof providerIdsWithoutRuntimeHandler)[number]>

export type RuntimeProviderFactory = (options: ApiHandlerOptions) => ApiHandler

export type ResolvedModel = { id: string; info: ModelInfo }

export type RuntimeProviderCapabilities = {
	/**
	 * The provider can restrict which tools may be called while every tool
	 * stays declared (Gemini's `allowedFunctionNames`), so the request keeps
	 * all tool definitions across a mode switch.
	 */
	readonly allowedFunctionNames: boolean
	/**
	 * The model must be loaded before a task starts, because only a loaded
	 * model reports its real context window (LM Studio). See `preloadModel`.
	 */
	readonly needsModelPreload: boolean
}

/**
 * Everything the extension knows about one executable provider: its portable
 * model facts (`providerModelDefinitions`: model-id field, model list, default
 * model, unknown-model policy), how to build its handler, what it can do, and
 * how to resolve the configured model without building a handler.
 */
export type RuntimeProviderEntry = ProviderModelDefinition & {
	readonly factory: RuntimeProviderFactory
	readonly capabilities: RuntimeProviderCapabilities
	/**
	 * The `{ id, info }` the handler's `getModel()` reports, computed from the
	 * settings (and the synchronous model cache for providers with fetched
	 * model lists) without building a handler.
	 */
	readonly resolveModel: (options: ApiHandlerOptions) => ResolvedModel
	/** Present exactly when `capabilities.needsModelPreload` is set. */
	readonly preloadModel?: (options: ApiHandlerOptions) => Promise<void>
}

const withoutCapabilities: RuntimeProviderCapabilities = { allowedFunctionNames: false, needsModelPreload: false }

const defineRuntimeProvider = (
	id: RuntimeProviderId,
	entry: Omit<RuntimeProviderEntry, keyof ProviderModelDefinition | "capabilities"> & {
		capabilities?: Partial<RuntimeProviderCapabilities>
	},
): RuntimeProviderEntry => ({
	...providerModelDefinitions[id],
	...entry,
	capabilities: { ...withoutCapabilities, ...entry.capabilities },
})

/** A provider whose model is a plain entry of its static model list. */
const resolveListedModel =
	(id: "deepseek" | "mistral" | "moonshot" | "minimax" | "openai-codex" | "openai-native" | "qwen-code" | "xai") =>
	(options: ApiHandlerOptions): ResolvedModel => {
		const { id: modelId, info } = resolveCatalogModel(options.apiModelId, providerModelDefinitions[id])

		return { id: modelId, info }
	}

/**
 * Providers whose model depends on state set up by the handler constructor
 * (Bedrock parses a custom ARN there; fake-ai looks up its injected fake). The
 * handler is built, read, and dropped; neither holds a subscription.
 */
const resolveByBuilding =
	(factory: RuntimeProviderFactory) =>
	(options: ApiHandlerOptions): ResolvedModel => {
		const { id, info } = factory(options).getModel()

		return { id, info }
	}

const buildBedrockHandler: RuntimeProviderFactory = (options) => new AwsBedrockHandler(options)
const buildFakeAiHandler: RuntimeProviderFactory = (options) => new FakeAIHandler(options)

export const runtimeProviderRegistry = {
	openrouter: defineRuntimeProvider("openrouter", {
		factory: (options) => new OpenRouterHandler(options),
		resolveModel: (options) => resolveOpenRouterModel(options, getModelsFromCache("openrouter") ?? {}),
	}),
	litellm: defineRuntimeProvider("litellm", {
		factory: (options) => new LiteLLMHandler(options),
		resolveModel: (options) =>
			resolveRouterModel({
				modelId: options.litellmModelId,
				defaultModelId: litellmDefaultModelId,
				defaultModelInfo: litellmDefaultModelInfo,
				models: getModelsFromCache("litellm") ?? {},
			}),
	}),
	deepseek: defineRuntimeProvider("deepseek", {
		factory: (options) => new DeepSeekHandler(options),
		resolveModel: resolveListedModel("deepseek"),
	}),
	ollama: defineRuntimeProvider("ollama", {
		factory: (options) => new NativeOllamaHandler(options),
		resolveModel: (options) => resolveOllamaModel(options, getModelsFromCache("ollama") ?? {}),
	}),
	lmstudio: defineRuntimeProvider("lmstudio", {
		factory: (options) => new LmStudioHandler(options),
		capabilities: { needsModelPreload: true },
		resolveModel: resolveLmStudioModel,
		// We need to force model loading in order to read its context size.
		preloadModel: async (options) => {
			if (!hasLoadedFullDetails(options.lmStudioModelId!)) {
				await forceFullModelDetailsLoad(
					options.lmStudioBaseUrl ?? "http://localhost:1234",
					options.lmStudioModelId!,
				)
			}
		},
	}),
	"vscode-lm": defineRuntimeProvider("vscode-lm", {
		factory: (options) => new VsCodeLmHandler(options),
		resolveModel: resolveVsCodeLmModel,
	}),
	openai: defineRuntimeProvider("openai", {
		factory: (options) => new OpenAiHandler(options),
		resolveModel: resolveOpenAiModel,
	}),
	"fake-ai": defineRuntimeProvider("fake-ai", {
		factory: buildFakeAiHandler,
		resolveModel: resolveByBuilding(buildFakeAiHandler),
	}),
	anthropic: defineRuntimeProvider("anthropic", {
		factory: (options) => new AnthropicHandler(options),
		resolveModel: resolveAnthropicModel,
	}),
	bedrock: defineRuntimeProvider("bedrock", {
		factory: buildBedrockHandler,
		resolveModel: resolveByBuilding(buildBedrockHandler),
	}),
	gemini: defineRuntimeProvider("gemini", {
		factory: (options) => new GeminiHandler(options),
		capabilities: { allowedFunctionNames: true },
		resolveModel: resolveGeminiModel,
	}),
	mistral: defineRuntimeProvider("mistral", {
		factory: (options) => new MistralHandler(options),
		resolveModel: resolveListedModel("mistral"),
	}),
	moonshot: defineRuntimeProvider("moonshot", {
		factory: (options) => new MoonshotHandler(options),
		resolveModel: resolveListedModel("moonshot"),
	}),
	minimax: defineRuntimeProvider("minimax", {
		factory: (options) => new MiniMaxHandler(options),
		resolveModel: resolveListedModel("minimax"),
	}),
	"openai-codex": defineRuntimeProvider("openai-codex", {
		factory: (options) => new OpenAiCodexHandler(options),
		resolveModel: resolveListedModel("openai-codex"),
	}),
	"openai-native": defineRuntimeProvider("openai-native", {
		factory: (options) => new OpenAiNativeHandler(options),
		resolveModel: resolveListedModel("openai-native"),
	}),
	"qwen-code": defineRuntimeProvider("qwen-code", {
		factory: (options) => new QwenCodeHandler(options),
		resolveModel: resolveListedModel("qwen-code"),
	}),
	vertex: defineRuntimeProvider("vertex", {
		factory: (options) =>
			isVertexClaudeModel(options) ? new AnthropicVertexHandler(options) : new VertexHandler(options),
		resolveModel: (options) =>
			isVertexClaudeModel(options) ? resolveAnthropicVertexModel(options) : resolveVertexModel(options),
	}),
	xai: defineRuntimeProvider("xai", {
		factory: (options) => new XAIHandler(options),
		resolveModel: resolveListedModel("xai"),
	}),
	zai: defineRuntimeProvider("zai", {
		factory: (options) => new ZAiHandler(options),
		resolveModel: resolveZAiModel,
	}),
} satisfies Record<RuntimeProviderId, RuntimeProviderEntry>

export const defaultRuntimeProviderId = "anthropic" satisfies RuntimeProviderId

const runtimeProviderEntriesById: ReadonlyMap<string, RuntimeProviderEntry> = new Map(
	Object.entries(runtimeProviderRegistry),
)

export const getRuntimeProviderEntry = (providerId: string | undefined): RuntimeProviderEntry | undefined =>
	providerId ? runtimeProviderEntriesById.get(providerId) : undefined

/** The capabilities of a profile's provider; none for providers without a runtime handler. */
export const getRuntimeProviderCapabilities = (providerId: string | undefined): RuntimeProviderCapabilities =>
	getRuntimeProviderEntry(providerId)?.capabilities ?? withoutCapabilities
