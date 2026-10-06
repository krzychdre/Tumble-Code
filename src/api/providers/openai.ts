import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@tumble-code/types"

import { type ApiHandlerOptions, shouldUseReasoningEffort } from "@tumble-code/core/browser"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { type ChatCompletionStreamOptions, streamChatCompletion } from "../transform/chat-completions-stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"
import { openAiCompletionUsage, openAiUsageChunk } from "./utils/completion-usage"
import { CONTROL_REQUEST_TIMEOUT_MS } from "./utils/timeout-config"
import { logger } from "../../utils/logging"
import { wireCaptureFetch } from "./utils/wire-capture"

/**
 * Custom interface for GLM params to support thinking mode.
 * GLM models (GLM-4.5, GLM-4.6, GLM-4.7, GLM-5) from z.ai support a thinking
 * object that enables chain-of-thought reasoning.
 *
 * - { type: "enabled" } - Thinking, earlier turns' reasoning is cleared
 * - { type: "enabled", clear_thinking: false } - Preserved thinking: the reasoning sent back is kept
 * - { type: "disabled" } - No thinking
 *
 * The depth of thinking travels separately, as `reasoning_effort`.
 *
 * @see https://docs.z.ai/guides/capabilities/thinking
 */
type GLMChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking?: { type: "enabled" | "disabled"; clear_thinking?: boolean }
}

/**
 * Detects if the model ID is a GLM model that supports thinking mode.
 * Matches GLM-4.5, GLM-4.6, GLM-4.7, GLM-5 and their variants.
 */
function isGLMThinkingModel(modelId: string): boolean {
	const normalized = modelId.toLowerCase()
	return (
		normalized.includes("glm-4.5") ||
		normalized.includes("glm-4.6") ||
		normalized.includes("glm-4.7") ||
		normalized.includes("glm-5")
	)
}

/**
 * Detects GLM models that always reason. These reject `thinking: { type: "disabled" }`
 * with an API error, so reasoning must stay enabled even when the user turns it off.
 *
 * Matched by model ID rather than by `supportsReasoningEffort`, because on this
 * OpenAI-compatible path the model metadata is supplied by the user and often carries
 * no capability flags at all.
 *
 * @see https://docs.z.ai/guides/capabilities/thinking
 */
function isGLMForcedThinkingModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("glm-5.3")
}

// TODO: Rename this to OpenAICompatibleHandler. Also, I think the
// `OpenAINativeHandler` can subclass from this, since it's obviously
// compatible with the OpenAI API. We can also rename it to `OpenAIHandler`.
export class OpenAiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected client: OpenAI | null = null
	// Protected so subclasses that build their own request (DeepSeek) hand the SDK the signal
	// that cancelRequest() aborts. Each request's controller is also tied to the task's signal
	// (metadata.signal), see createRequestAbortController.
	protected abortController?: AbortController
	private readonly providerName = "OpenAI"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Client is created lazily on first use via getClient()
	}

	/**
	 * Creates or recreates the OpenAI SDK client.
	 * Called lazily on first request or after client destruction.
	 */
	private createClient(): OpenAI {
		const baseURL = this.options.openAiBaseUrl || "https://api.openai.com/v1"
		// `||`, not `??`: openai 7 rejects an empty key before sending, openai 5 did not.
		const apiKey = this.options.openAiApiKey || "not-provided"
		const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
		const urlHost = this._getUrlHost(this.options.openAiBaseUrl)
		const isAzureOpenAi = urlHost === "azure.com" || urlHost.endsWith(".azure.com") || this.options.openAiUseAzure

		const headers = {
			...DEFAULT_HEADERS,
			...(this.options.openAiHeaders || {}),
		}

		const timeout = this.timeoutMs

		if (isAzureAiInference) {
			// Azure AI Inference Service (e.g., for DeepSeek) uses a different path structure
			return new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				defaultQuery: { "api-version": this.options.azureApiVersion || "2024-05-01-preview" },
				timeout,
				fetch: wireCaptureFetch,
			})
		} else if (isAzureOpenAi) {
			// Azure API shape slightly differs from the core API shape:
			// https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
			return new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: headers,
				timeout,
				fetch: wireCaptureFetch,
			})
		} else {
			return new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout,
				fetch: wireCaptureFetch,
			})
		}
	}

	/**
	 * Gets the client, creating it if necessary (lazy initialization).
	 */
	protected getClient(): OpenAI {
		if (!this.client) {
			this.client = this.createClient()
		}
		return this.client
	}

	/**
	 * Cancels the current in-flight request and optionally destroys the client.
	 *
	 * @param destroyClient - If true, nullify the client to force connection termination.
	 *                        The client will be lazily recreated on the next request.
	 */
	cancelRequest(destroyClient: boolean = false): void {
		// Abort any in-flight request
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = undefined
		}

		// Optionally destroy the client to sever HTTP connections
		if (destroyClient && this.client) {
			this.client = null
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelId = this.options.openAiModelId ?? ""
		const deepseekReasoner = modelId.includes("deepseek-reasoner")

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages, metadata)
			return
		}

		const convertedMessages = this.convertMessages(systemPrompt, messages, deepseekReasoner)

		if (this.options.openAiStreamingEnabled ?? true) {
			if (!deepseekReasoner && modelInfo.supportsPromptCache) {
				this.addCacheControl(convertedMessages)
			}

			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				// Some OpenAI-Compatible models (e.g. claude-opus-4-7, claude-opus-4-8) reject
				// `temperature` as deprecated/unsupported, so honor the model's `supportsTemperature`
				// flag and omit it when that flag is false. Beyond that, only send `temperature` when
				// the user set a custom value or the model needs a specific default (deepseek-reasoner);
				// otherwise omit it so the server's own default applies instead of forcing 0.
				...(modelInfo.supportsTemperature !== false &&
					(this.options.modelTemperature != null || deepseekReasoner) && {
						temperature: this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
					}),
				messages: convertedMessages,
				stream: true as const,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				...(reasoning && reasoning),
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			// Add GLM thinking parameter for GLM models (GLM-4.5, GLM-4.6, GLM-4.7, GLM-5)
			// when reasoning is enabled via settings
			this.addGLMThinkingIfNeeded(requestOptions as GLMChatCompletionParams, modelId, modelInfo)

			const stream = await this.openChatStream(requestOptions, metadata?.signal)

			yield* this.streamUntilDone(stream, {
				thinkTags: true,
				mapUsage: (usage) => this.processUsageMetrics(usage, modelInfo),
			})
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: convertedMessages,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			// Add GLM thinking parameter for GLM models (GLM-4.5, GLM-4.6, GLM-4.7, GLM-5)
			// when reasoning is enabled via settings
			this.addGLMThinkingIfNeeded(requestOptions as unknown as GLMChatCompletionParams, modelId, modelInfo)

			const response = await this.sendChatCompletion(requestOptions, metadata?.signal)

			const message = response.choices?.[0]?.message

			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}

			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	/**
	 * The request messages, system prompt first. deepseek-reasoner takes no system message, so
	 * its prompt goes first as a user message. With "Return reasoning to the model" on, each
	 * assistant message carries its reasoning under both names: DeepSeek, Z.ai and SGLang read
	 * `reasoning_content`, vLLM (0.10 and later) reads only `reasoning`. Text after tool results
	 * is merged into the last tool message, because a user message there makes these servers
	 * drop the reasoning of the turn.
	 */
	private convertMessages(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		deepseekReasoner: boolean,
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		if (deepseekReasoner) {
			return convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = { role: "system", content: systemPrompt }

		if (this.options.openAiPreserveReasoning) {
			return [
				systemMessage,
				...convertToR1Format(messages, {
					mergeToolResultText: true,
					reasoningFields: ["reasoning_content", "reasoning"],
				}),
			]
		}

		return [systemMessage, ...convertToOpenAiMessages(messages)]
	}

	/** Marks the system prompt and the last two user messages as prompt-cache breakpoints. */
	private addCacheControl(messages: OpenAI.Chat.ChatCompletionMessageParam[]): void {
		for (const msg of messages) {
			if (msg.role === "system" && typeof msg.content === "string") {
				msg.content = [
					{
						type: "text",
						text: msg.content,
						// @ts-expect-error-next-line
						cache_control: { type: "ephemeral" },
					},
				]
			}
		}

		// Note: the following logic is copied from openrouter:
		// Add cache_control to the last two user messages
		// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
		const lastTwoUserMessages = messages.filter((msg) => msg.role === "user").slice(-2)

		lastTwoUserMessages.forEach((msg) => {
			if (typeof msg.content === "string") {
				msg.content = [{ type: "text", text: msg.content }]
			}

			if (Array.isArray(msg.content)) {
				// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
				let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

				if (!lastTextPart) {
					lastTextPart = { type: "text", text: "..." }
					msg.content.push(lastTextPart)
				}

				// @ts-expect-error-next-line
				lastTextPart["cache_control"] = { type: "ephemeral" }
			}
		})
	}

	protected processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
		// Spike instrumentation: dump the endpoint's raw usage object so cache
		// reporting can be verified endpoint-by-endpoint (e.g. whether a local
		// vLLM server reports prefix-cache hits). Mirrors the same switch in
		// base-openai-compatible-provider.ts.
		if (process.env.ROO_LOG_RAW_USAGE === "1") {
			logger.info(`[openai-compatible] raw usage: ${JSON.stringify(usage)}`)
		}

		// Servers name the cache figures differently (nested under
		// `prompt_tokens_details` or Anthropic-style at the top level); the shared
		// reader knows every documented name, so this path and one-shot
		// completions report the same figures.
		return openAiUsageChunk(usage ?? {}, { modelInfo })
	}

	override getModel() {
		const { id, info } = resolveOpenAiModel(this.options)
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		try {
			const model = this.getModel()
			const modelInfo = model.info

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			this.abortController = new AbortController()
			let response
			try {
				response = await this.getClient().chat.completions.create(
					requestOptions,
					this.chatRequestOptions(this.abortController),
				)
			} finally {
				this.abortController = undefined
			}

			return {
				text: response.choices?.[0]?.message.content || "",
				usage: openAiCompletionUsage(response.usage),
			}
		} catch (error) {
			// One wrap for the whole method: the request error used to be wrapped here
			// and again by an inner catch ("OpenAI completion error: OpenAI completion
			// error: ..."), and the outer wrap dropped the HTTP status.
			throw handleProviderError(error, this.providerName)
		}
	}

	private async *handleO3FamilyMessage(
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelInfo = this.getModel().info

		if (this.options.openAiStreamingEnabled ?? true) {
			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			const stream = await this.openChatStream(requestOptions, metadata?.signal)

			// Reasoning-capable servers routed through this branch (DeepSeek-R1
			// distills, QwQ behind adapters) send reasoning_content (AP-8).
			yield* this.streamUntilDone(stream, {
				mapUsage: (usage) => this.processUsageMetrics(usage, modelInfo),
			})
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			const response = await this.sendChatCompletion(requestOptions, metadata?.signal)

			const message = response.choices?.[0]?.message
			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}
			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	/**
	 * Opens a streamed Chat Completions request that the task's signal (the Stop button) or
	 * cancelRequest() aborts, on the Azure AI Inference path when the base URL is one. A request
	 * that fails to start is rethrown through handleProviderError; streamUntilDone clears the
	 * controller once the stream ends.
	 */
	protected async openChatStream(
		params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
		taskSignal: AbortSignal | undefined,
		providerName: string = this.providerName,
	) {
		this.abortController = createRequestAbortController(taskSignal)
		try {
			return await this.getClient().chat.completions.create(params, this.chatRequestOptions(this.abortController))
		} catch (error) {
			this.abortController = undefined
			throw handleProviderError(error, providerName)
		}
	}

	/** Streams a response opened by openChatStream and releases its abort controller at the end. */
	protected async *streamUntilDone(
		stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
		options: ChatCompletionStreamOptions,
	): ApiStream {
		try {
			yield* streamChatCompletion(stream, options)
		} finally {
			this.abortController = undefined
		}
	}

	/** Same as openChatStream for a non-streamed request; the controller is released on return. */
	private async sendChatCompletion(
		params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		taskSignal: AbortSignal | undefined,
	) {
		this.abortController = createRequestAbortController(taskSignal)
		try {
			return await this.getClient().chat.completions.create(params, this.chatRequestOptions(this.abortController))
		} catch (error) {
			throw handleProviderError(error, this.providerName)
		} finally {
			this.abortController = undefined
		}
	}

	private chatRequestOptions(controller: AbortController): OpenAI.RequestOptions {
		return {
			...(this._isAzureAiInference(this.options.openAiBaseUrl) ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {}),
			signal: controller.signal,
		}
	}

	// The hostname, without the port, so a base URL with an explicit port
	// still matches the host checks below.
	protected _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").hostname
		} catch (error) {
			return ""
		}
	}

	private _isGrokXAI(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		// Match x.ai and its subdomains only: a substring test also caught hosts
		// such as box.ai, which then lost stream_options (and token usage).
		return urlHost === "x.ai" || urlHost.endsWith(".x.ai")
	}

	protected _isAzureAiInference(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.endsWith(".services.ai.azure.com")
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}

	/**
	 * Adds GLM thinking parameter for GLM models (GLM-4.5, GLM-4.6, GLM-4.7, GLM-5)
	 * when used through custom OpenAI-compatible providers.
	 *
	 * Thinking is enabled when reasoning is on (see {@link GLMChatCompletionParams}).
	 * `clear_thinking: false` is sent when the profile returns reasoning to the model
	 * (openAiPreserveReasoning), whatever the effort: without it the server drops the
	 * reasoning sent back. The effort itself goes as `reasoning_effort` (getModelParams).
	 *
	 * @see https://docs.z.ai/guides/capabilities/thinking
	 */
	protected addGLMThinkingIfNeeded(
		requestOptions: GLMChatCompletionParams,
		modelId: string,
		modelInfo: ModelInfo,
	): void {
		// Only apply to GLM models
		if (!isGLMThinkingModel(modelId)) {
			return
		}

		// Check if reasoning should be used based on model capabilities and settings
		const useReasoning = shouldUseReasoningEffort({ model: modelInfo, settings: this.options })

		// Reasoning turned off still leaves thinking on for a model that has no off switch:
		// sending "disabled" would fail the request outright.
		if (useReasoning || isGLMForcedThinkingModel(modelId)) {
			requestOptions.thinking = {
				type: "enabled",
				...(this.options.openAiPreserveReasoning && { clear_thinking: false }),
			}
		} else {
			// Reasoning is explicitly disabled
			// For GLM-4.7 and GLM-5, thinking is ON by default in the API,
			// so we need to explicitly disable it
			requestOptions.thinking = { type: "disabled" }
		}
	}
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	try {
		if (!baseUrl) {
			return []
		}

		// Trim whitespace from baseUrl to handle cases where users accidentally include spaces
		const trimmedBaseUrl = baseUrl.trim()

		if (!URL.canParse(trimmedBaseUrl)) {
			return []
		}

		const config: Record<string, any> = { timeout: CONTROL_REQUEST_TIMEOUT_MS }
		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			...(openAiHeaders || {}),
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		if (Object.keys(headers).length > 0) {
			config["headers"] = headers
		}

		const response = await axios.get(`${trimmedBaseUrl}/models`, config)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}

/**
 * The `{ id, info }` that `OpenAiHandler.getModel()` reports, without building a handler.
 * "Return reasoning to the model" sets `preserveReasoning`, so the task keeps the stored
 * reasoning blocks in the history it sends to this handler.
 */
export function resolveOpenAiModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	const info = options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
	return {
		id: options.openAiModelId ?? "",
		info: options.openAiPreserveReasoning ? { ...info, preserveReasoning: true } : info,
	}
}
