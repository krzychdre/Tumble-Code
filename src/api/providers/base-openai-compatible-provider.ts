import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, type UnknownModelPolicy, resolveCatalogModel } from "@tumble-code/types"

import { type ApiHandlerOptions, getModelMaxOutputTokens } from "@tumble-code/core/browser"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { streamChatCompletion } from "../transform/chat-completions-stream"

import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"
import { openAiCompletionUsage, openAiUsageChunk } from "./utils/completion-usage"
import { logger } from "../../utils/logging"
import { wireCaptureFetch } from "./utils/wire-capture"

/** Binary reasoning switch some OpenAI-compatible APIs (e.g. Z.ai) accept next to the standard params. */
type ThinkingParam = { thinking?: { type: "enabled" } }

/**
 * Provider-specific fields of a streamed request (reasoning switches and the like), sent next
 * to the standard Chat Completions params.
 */
type ExtraStreamParams = Record<string, unknown>

type BaseOpenAiCompatibleProviderOptions<ModelName extends string> = ApiHandlerOptions & {
	providerName: string
	baseURL: string
	defaultProviderModelId: ModelName
	providerModels: Record<ModelName, ModelInfo>
	/** What `getModel` does with an id missing from `providerModels`; keeps the id unless set. */
	unknownModelPolicy?: UnknownModelPolicy
	defaultTemperature?: number
}

export abstract class BaseOpenAiCompatibleProvider<ModelName extends string>
	extends BaseProvider
	implements SingleCompletionHandler
{
	protected readonly providerName: string
	protected readonly baseURL: string
	protected readonly defaultTemperature: number
	protected readonly defaultProviderModelId: ModelName
	protected readonly providerModels: Record<ModelName, ModelInfo>
	protected readonly unknownModelPolicy: UnknownModelPolicy

	protected readonly options: ApiHandlerOptions

	protected client: OpenAI | null = null
	protected abortController?: AbortController

	constructor({
		providerName,
		baseURL,
		defaultProviderModelId,
		providerModels,
		unknownModelPolicy,
		defaultTemperature,
		...options
	}: BaseOpenAiCompatibleProviderOptions<ModelName>) {
		super()

		this.providerName = providerName
		this.baseURL = baseURL
		this.defaultProviderModelId = defaultProviderModelId
		this.providerModels = providerModels
		this.unknownModelPolicy = unknownModelPolicy ?? "keep-id"
		this.defaultTemperature = defaultTemperature ?? 0

		this.options = options

		if (!this.options.apiKey) {
			throw new Error("API key is required")
		}

		this.client = new OpenAI({
			baseURL,
			apiKey: this.options.apiKey,
			defaultHeaders: DEFAULT_HEADERS,
			timeout: this.timeoutMs,
			fetch: wireCaptureFetch,
		})
	}

	/**
	 * Gets the client, recreating it if it was previously destroyed.
	 */
	protected getClient(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				baseURL: this.baseURL,
				apiKey: this.options.apiKey,
				defaultHeaders: DEFAULT_HEADERS,
				timeout: this.timeoutMs,
				fetch: wireCaptureFetch,
			})
		}
		return this.client
	}

	/**
	 * Whether a streamed request carries `parallel_tool_calls`. Off for APIs whose request
	 * schema does not have the field.
	 */
	protected readonly sendsParallelToolCalls: boolean = true

	/** The conversation in Chat Completions form, system prompt first. */
	protected convertMessages(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		return [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
	}

	/** `max_tokens` and `temperature` of a streamed request. */
	protected getSamplingParams(): { max_tokens?: number; temperature?: number } {
		const { id: model, info } = this.getModel()

		return {
			// Centralized cap: clamp to 20% of the context window (unless provider-specific exceptions apply)
			max_tokens:
				getModelMaxOutputTokens({
					modelId: model,
					model: info,
					settings: this.options,
					format: "openai",
				}) ?? undefined,
			temperature: this.options.modelTemperature ?? info.defaultTemperature ?? this.defaultTemperature,
		}
	}

	/** Provider-specific fields of a streamed request; the default is the binary reasoning switch. */
	protected getExtraStreamParams(): ExtraStreamParams {
		return this.binaryThinkingParam()
	}

	/** `thinking: { type: "enabled" }` when reasoning is on and the model has the binary switch. */
	private binaryThinkingParam(): ThinkingParam {
		return this.options.enableReasoningEffort && this.getModel().info.supportsReasoningBinary
			? { thinking: { type: "enabled" } }
			: {}
	}

	protected createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	) {
		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: this.getModel().id,
			...this.getSamplingParams(),
			messages: this.convertMessages(systemPrompt, messages),
			stream: true,
			// Without this the API sends no final usage chunk (and no cache figures).
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			...(this.sendsParallelToolCalls && { parallel_tool_calls: metadata?.parallelToolCalls ?? true }),
			...this.getExtraStreamParams(),
		}

		// A fresh controller for this request: the task's signal (the Stop button) or
		// cancelRequest() aborts it, and createMessage clears it once the stream ends.
		this.abortController = createRequestAbortController(metadata?.signal)

		try {
			return this.getClient().chat.completions.create(params, { signal: this.abortController.signal })
		} catch (error) {
			this.abortController = undefined
			throw handleProviderError(error, this.providerName)
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const stream = await this.createStream(systemPrompt, messages, metadata)

		try {
			yield* streamChatCompletion(stream, {
				thinkTags: true,
				mapUsage: (usage) => this.processUsageMetrics(usage, this.getModel().info),
			})
		} finally {
			this.abortController = undefined
		}
	}

	protected processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		// Spike instrumentation: dump the provider's raw usage object so cache
		// reporting can be verified endpoint-by-endpoint (e.g. whether Z.ai's
		// coding plan returns prompt_tokens_details.cached_tokens). See
		// ai_plans/archive/2026-07/2026-07-12_glm-agent-loop-efficiency-implementation.md (WS-6).
		if (process.env.ROO_LOG_RAW_USAGE === "1") {
			logger.info(`[${this.providerName}] raw usage: ${JSON.stringify(usage)}`)
		}

		return openAiUsageChunk(usage ?? {}, { modelInfo })
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & ThinkingParam = {
			model: this.getModel().id,
			messages: [{ role: "user", content: prompt }],
			...this.binaryThinkingParam(),
		}

		const response = await this.sendCompletion(params)

		return {
			text: response.choices?.[0]?.message.content || "",
			usage: openAiCompletionUsage(response.usage),
		}
	}

	/**
	 * Sends a one-shot (non-streamed) request that cancelRequest() can abort; errors are
	 * rethrown through handleProviderError.
	 */
	protected async sendCompletion(
		params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
	): Promise<OpenAI.Chat.Completions.ChatCompletion> {
		this.abortController = new AbortController()
		try {
			return await this.getClient().chat.completions.create(params, { signal: this.abortController.signal })
		} catch (error) {
			throw handleProviderError(error, this.providerName)
		} finally {
			this.abortController = undefined
		}
	}

	cancelRequest(destroyClient: boolean = false): void {
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = undefined
		}

		if (destroyClient && this.client) {
			this.client = null
		}
	}

	override getModel() {
		const { id, info } = resolveCatalogModel(this.options.apiModelId, {
			models: this.providerModels,
			defaultModelId: this.defaultProviderModelId,
			unknownModelPolicy: this.unknownModelPolicy,
		})

		return { id: id as ModelName, info }
	}
}
