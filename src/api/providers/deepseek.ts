import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	deepSeekModels,
	deepSeekDefaultModelId,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"

import { OpenAiHandler } from "./openai"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"
import { emitToolCallChunks, emitFinishReasonChunk } from "./utils/openai-stream-chunks"
import type { ApiHandlerCreateMessageMetadata } from "../index"

// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "high" | "max"
}

const deepSeekV4ThinkingModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])
const supportsDeepSeekThinkingToggle = (modelId: string) => deepSeekV4ThinkingModels.has(modelId)

// Only known V4 models and the legacy reasoner alias support DeepSeek's
// thinking fields. Custom model IDs still fall back to default metadata, but
// should not receive V4-only request parameters.
const isDeepSeekThinkingEnabled = (modelId: string, options: ApiHandlerOptions) => {
	if (options.enableReasoningEffort === false || options.reasoningEffort === "disable") {
		return false
	}

	return modelId === "deepseek-reasoner" || supportsDeepSeekThinkingToggle(modelId)
}

const normalizeDeepSeekReasoningEffort = (reasoningEffort?: string): "high" | "max" | undefined => {
	if (!reasoningEffort || reasoningEffort === "disable") {
		return undefined
	}

	// DeepSeek currently maps low/medium to high and xhigh to max in thinking mode.
	return reasoningEffort === "xhigh" ? "max" : "high"
}

// Use the computed maxTokens from getModelParams rather than raw model metadata.
// V4 advertises a 384K maximum output, but the project convention caps most
// models to 20% of context unless the user explicitly overrides modelMaxTokens.
const addDeepSeekMaxTokensIfNeeded = (
	requestOptions: DeepSeekChatCompletionParams,
	options: ApiHandlerOptions,
	computedMaxTokens?: number,
) => {
	if (options.includeMaxTokens === true) {
		requestOptions.max_completion_tokens = options.modelMaxTokens || computedMaxTokens
	}
}

export class DeepSeekHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.deepSeekApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? deepSeekDefaultModelId,
			openAiBaseUrl: options.deepSeekBaseUrl || "https://api.deepseek.com",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? deepSeekDefaultModelId
		const info = deepSeekModels[id as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: DEEP_SEEK_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
		const { info: modelInfo, temperature, reasoningEffort, maxTokens } = this.getModel()

		const isThinkingModel = isDeepSeekThinkingEnabled(modelId, this.options)
		const thinking = supportsDeepSeekThinkingToggle(modelId)
			? ({ type: isThinkingModel ? "enabled" : "disabled" } as const)
			: isThinkingModel
				? ({ type: "enabled" } as const)
				: undefined
		const deepSeekReasoningEffort = isThinkingModel ? normalizeDeepSeekReasoningEffort(reasoningEffort) : undefined

		// Convert messages to R1 format (merges consecutive same-role messages)
		// This is required for DeepSeek which does not support successive messages with the same role
		// For thinking models, enable mergeToolResultText to preserve reasoning_content
		// during tool call sequences. Without this, environment_details text after tool_results would
		// create user messages that cause DeepSeek to drop all previous reasoning_content.
		// See: https://api-docs.deepseek.com/guides/thinking_mode
		const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
			mergeToolResultText: isThinkingModel,
		})

		const requestOptions: DeepSeekChatCompletionParams = {
			model: modelId,
			...(!isThinkingModel && { temperature: temperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE }),
			messages: convertedMessages,
			stream: true as const,
			stream_options: { include_usage: true },
			...(thinking && { thinking }),
			...(deepSeekReasoningEffort && { reasoning_effort: deepSeekReasoningEffort }),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		addDeepSeekMaxTokensIfNeeded(requestOptions, this.options, maxTokens)

		// Check if base URL is Azure AI Inference (for DeepSeek via Azure)
		const isAzureAiInference = this._isAzureAiInference(this.options.deepSeekBaseUrl)

		// cancelRequest() (the Stop button) aborts this controller, which ends the HTTP request.
		this.abortController = new AbortController()

		let stream
		try {
			stream = await this.getClient().chat.completions.create(
				requestOptions as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
				{
					...(isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {}),
					signal: this.abortController.signal,
				},
			)
		} catch (error) {
			this.abortController = undefined
			const { handleOpenAIError } = await import("./utils/openai-error-handler")
			throw handleOpenAIError(error, "DeepSeek")
		}

		let lastUsage

		try {
			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta ?? {}

				// Handle reasoning_content from DeepSeek's interleaved thinking
				// This is the proper way DeepSeek sends thinking content in streaming.
				// It goes before the text: a delta carrying both is the end of the
				// thinking followed by the start of the answer.
				const reasoningText = extractReasoningFromDelta(delta)
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}

				// Handle regular text content
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Handle tool calls
				yield* emitToolCallChunks(delta)

				// Yield finish_reason so TaskStreamProcessor can handle it with per-task parser state.
				// DeepSeek may return "stop" or "tool_calls": both must trigger finalization (AP-6).
				const finishReason = chunk.choices?.[0]?.finish_reason
				yield* emitFinishReasonChunk(finishReason)

				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}

			if (lastUsage) {
				yield this.processUsageMetrics(lastUsage, modelInfo)
			}
		} finally {
			this.abortController = undefined
		}
	}

	// DeepSeek reports its prompt cache at the top level of `usage`:
	// prompt_cache_hit_tokens + prompt_cache_miss_tokens = prompt_tokens (both
	// required), with the hit count optionally mirrored in
	// prompt_tokens_details.cached_tokens. There are no cache writes: a miss is
	// ordinary input at the input price, so cacheWriteTokens stays undefined.
	// https://api-docs.deepseek.com/api/create-chat-completion
	protected override processUsageMetrics(usage: any, _modelInfo?: any): ApiStreamUsageChunk {
		const hits = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens

		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheReadTokens: typeof hits === "number" ? hits : undefined,
		}
	}
}
