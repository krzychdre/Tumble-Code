import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, openAiModelInfoSaneDefaults, LMSTUDIO_DEFAULT_TEMPERATURE } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { flattenMessagesForTokenCount } from "../../utils/flattenMessagesForTokenCount"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { streamChatCompletion } from "../transform/chat-completions-stream"

import { BaseProvider } from "./base-provider"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { openAiCompletionUsage } from "./utils/completion-usage"
import { getModelsFromCache } from "./fetchers/modelCache"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"

/**
 * LM Studio reports most failures (model not loaded, context too small) only in its own
 * developer log, so every error shows this hint. The HTTP status still travels on the
 * error for the retry loop and the background-model fallback.
 */
const LM_STUDIO_ERROR_HINT =
	"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Roo Code's prompts."

export class LmStudioHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI | null = null
	private abortController?: AbortController
	private readonly providerName = "LM Studio"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// LM Studio uses "noop" as a placeholder API key
		const apiKey = "noop"

		this.client = new OpenAI({
			baseURL: (this.options.lmStudioBaseUrl || "http://localhost:1234") + "/v1",
			apiKey: apiKey,
			timeout: getApiRequestTimeout(),
		})
	}

	/**
	 * Gets the client, recreating it if it was previously destroyed.
	 */
	private getClient(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				baseURL: (this.options.lmStudioBaseUrl || "http://localhost:1234") + "/v1",
				apiKey: "noop",
				timeout: getApiRequestTimeout(),
			})
		}
		return this.client
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

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// -------------------------
		// Track token usage
		// -------------------------
		let inputTokens = 0
		try {
			inputTokens = await this.countTokens([
				{ type: "text", text: systemPrompt },
				...flattenMessagesForTokenCount(messages),
			])
		} catch (err) {
			console.error("[LmStudio] Failed to count input tokens:", err)
			inputTokens = 0
		}

		let assistantText = ""

		try {
			const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & { draft_model?: string } = {
				model: this.getModel().id,
				messages: openAiMessages,
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: true,
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			this.abortController = createRequestAbortController(metadata?.signal)
			let results
			try {
				results = await this.getClient().chat.completions.create(params, {
					signal: this.abortController.signal,
				})
			} catch (error) {
				this.abortController = undefined
				throw error
			}

			try {
				// Local reasoning models write their thoughts inline in <think> tags, or,
				// with LM Studio's "separate reasoning_content" setting, in reasoning_content.
				yield* streamChatCompletion(results, {
					thinkTags: true,
					// Output tokens are counted locally over the raw content, tags included.
					onChunk: (chunk) => {
						const content = chunk.choices?.[0]?.delta?.content
						if (content) {
							assistantText += content
						}
					},
				})

				let outputTokens = 0
				try {
					outputTokens = await this.countTokens([{ type: "text", text: assistantText }])
				} catch (err) {
					console.error("[LmStudio] Failed to count output tokens:", err)
					outputTokens = 0
				}

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
				} as const
			} finally {
				this.abortController = undefined
			}
		} catch (error) {
			throw handleProviderError(error, this.providerName, { messageTransformer: () => LM_STUDIO_ERROR_HINT })
		}
	}

	override getModel(): { id: string; info: ModelInfo } {
		return resolveLmStudioModel(this.options)
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		try {
			// Create params object with optional draft model
			const params: any = {
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
				temperature: this.options.modelTemperature ?? LMSTUDIO_DEFAULT_TEMPERATURE,
				stream: false,
			}

			// Add draft model if speculative decoding is enabled and a draft model is specified
			if (this.options.lmStudioSpeculativeDecodingEnabled && this.options.lmStudioDraftModelId) {
				params.draft_model = this.options.lmStudioDraftModelId
			}

			this.abortController = new AbortController()
			let response
			try {
				response = await this.getClient().chat.completions.create(params, {
					signal: this.abortController.signal,
				})
			} finally {
				this.abortController = undefined
			}
			return {
				text: response.choices?.[0]?.message?.content || "",
				usage: openAiCompletionUsage(response.usage),
			}
		} catch (error) {
			throw handleProviderError(error, this.providerName, { messageTransformer: () => LM_STUDIO_ERROR_HINT })
		}
	}
}

/** The `{ id, info }` that `LmStudioHandler.getModel()` reports, without building a handler. */
export function resolveLmStudioModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	const models = getModelsFromCache("lmstudio")
	if (models && options.lmStudioModelId && models[options.lmStudioModelId]) {
		return {
			id: options.lmStudioModelId,
			info: models[options.lmStudioModelId],
		}
	}

	return {
		id: options.lmStudioModelId || "",
		info: openAiModelInfoSaneDefaults,
	}
}
