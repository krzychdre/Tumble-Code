import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"

import {
	type ModelInfo,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
	ApiProviderError,
	selectAnthropicModel,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { filterNonAnthropicBlocks } from "../transform/anthropic-filter"
import { getAnthropicProviderReasoning } from "../transform/reasoning"
import { addAnthropicCacheControl, processAnthropicStream } from "../transform/anthropic-stream"

import { BaseProvider } from "./base-provider"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { anthropicCompletionUsage } from "./utils/completion-usage"
import {
	convertOpenAIToolsToAnthropic,
	convertOpenAIToolChoiceToAnthropic,
} from "../../core/prompts/tools/native-tools/converters"

export class AnthropicHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: Anthropic
	private readonly providerName = "Anthropic"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const apiKeyFieldName =
			this.options.anthropicBaseUrl && this.options.anthropicUseAuthToken ? "authToken" : "apiKey"

		this.client = new Anthropic({
			baseURL: this.options.anthropicBaseUrl || undefined,
			[apiKeyFieldName]: this.options.apiKey,
			timeout: this.timeoutMs,
		})
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>
		const cacheControl: CacheControlEphemeral = { type: "ephemeral" }
		let {
			id: modelId,
			betas = ["fine-grained-tool-streaming-2025-05-14"],
			maxTokens,
			temperature,
			info,
			reasoningBudget,
		} = this.getModel()
		const thinking = getAnthropicProviderReasoning({
			model: info,
			reasoningBudget,
			reasoningEffort: undefined,
			settings: this.options,
		})

		// Filter out non-Anthropic blocks (reasoning, thoughtSignature, etc.) before sending to the API
		const sanitizedMessages = filterNonAnthropicBlocks(messages)

		// Add 1M context beta flag if enabled for supported models (Claude Sonnet 4/4.5/4.6, Opus 4.6)
		if (
			(modelId === "claude-sonnet-4-20250514" ||
				modelId === "claude-sonnet-4-5" ||
				modelId === "claude-sonnet-4-6" ||
				modelId === "claude-opus-4-6") &&
			this.options.anthropicBeta1MContext
		) {
			betas.push("context-1m-2025-08-07")
		}

		const nativeToolParams = {
			tools: convertOpenAIToolsToAnthropic(metadata?.tools ?? []),
			tool_choice: convertOpenAIToolChoiceToAnthropic(metadata?.tool_choice, metadata?.parallelToolCalls),
		}

		// Every Anthropic model we define supports prompt caching. Deriving the
		// branch from the model info (as the Vertex handler does) keeps newly
		// added models from silently falling into the uncached path.
		if (info.supportsPromptCache) {
			try {
				const requestParams = {
					model: modelId,
					max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
					temperature,
					thinking,
					// Setting cache breakpoint for system prompt so new tasks can reuse it.
					system: [{ text: systemPrompt, type: "text", cache_control: cacheControl }],
					// Cache breakpoints on the last two user messages: the latest
					// one is cached for the next request, the one before tells the
					// server where this request's cached prefix ends.
					messages: addAnthropicCacheControl(sanitizedMessages, cacheControl),
					stream: true,
					...nativeToolParams,
				}
				stream = await this.client.messages.create(
					requestParams as Anthropic.Messages.MessageCreateParamsStreaming,
					// prompt caching: https://x.com/alexalbert__/status/1823751995901272068
					// https://github.com/anthropics/anthropic-sdk-typescript?tab=readme-ov-file#default-headers
					{
						headers: { "anthropic-beta": [...betas, "prompt-caching-2024-07-31"].join(",") },
						// The task's signal: Stop closes the HTTP request.
						signal: metadata?.signal,
					},
				)
			} catch (error) {
				TelemetryService.instance.captureException(
					new ApiProviderError(
						error instanceof Error ? error.message : String(error),
						this.providerName,
						modelId,
						"createMessage",
					),
				)
				throw error
			}
		} else {
			try {
				const requestParams = {
					model: modelId,
					max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
					temperature,
					thinking,
					system: [{ text: systemPrompt, type: "text" }],
					messages: sanitizedMessages,
					stream: true,
					...nativeToolParams,
				}
				stream = (await this.client.messages.create(
					requestParams as Anthropic.Messages.MessageCreateParamsStreaming,
					{ signal: metadata?.signal },
				)) as any
			} catch (error) {
				TelemetryService.instance.captureException(
					new ApiProviderError(
						error instanceof Error ? error.message : String(error),
						this.providerName,
						modelId,
						"createMessage",
					),
				)
				throw error
			}
		}

		yield* processAnthropicStream(stream, info)
	}

	getModel() {
		const { id, info } = selectAnthropicModel(this.options)

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})

		return {
			id: toAnthropicRequestModelId(id),
			info,
			betas: id === "claude-3-7-sonnet-20250219:thinking" ? ["output-128k-2025-02-19"] : undefined,
			...params,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		let { id: model, temperature } = this.getModel()

		let message
		try {
			message = await this.client.messages.create({
				model,
				max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
				thinking: undefined,
				temperature,
				messages: [{ role: "user", content: prompt }],
				stream: false,
			})
		} catch (error) {
			TelemetryService.instance.captureException(
				new ApiProviderError(
					error instanceof Error ? error.message : String(error),
					this.providerName,
					model,
					"completePrompt",
				),
			)
			throw error
		}

		const content = message.content.find(({ type }) => type === "text")
		return {
			text: content?.type === "text" ? content.text : "",
			usage: anthropicCompletionUsage(message.usage),
		}
	}
}

// The `:thinking` suffix indicates that the model is a "Hybrid" reasoning
// model and that reasoning is required to be enabled. The actual model ID
// honored by Anthropic's API does not have this suffix.
const toAnthropicRequestModelId = (id: string) =>
	id === "claude-3-7-sonnet-20250219:thinking" ? "claude-3-7-sonnet-20250219" : id

/** The `{ id, info }` that `AnthropicHandler.getModel()` reports, without building a handler. */
export function resolveAnthropicModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	const { id, info } = selectAnthropicModel(options)

	return { id: toAnthropicRequestModelId(id), info }
}
