import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	deepSeekDefaultModelId,
	deepSeekModelAliases,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
	providerModelDefinitions,
	resolveCatalogModel,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"
import { streamChatCompletion } from "../transform/chat-completions-stream"

import { OpenAiHandler } from "./openai"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"
import { openAiUsageChunk } from "./utils/completion-usage"
import type { ApiHandlerCreateMessageMetadata } from "../index"

// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "low" | "high" | "max"
}

// The models that take DeepSeek's thinking toggle. A legacy name DeepSeek still
// serves (deepseek-v4-flash, deepseek-v4-flash-vision-exp: both answered by
// V4.1 Flash) counts as the model it aliases.
const deepSeekThinkingModels = new Set(["deepseek-flash", "deepseek-v4-pro"])
const supportsDeepSeekThinkingToggle = (modelId: string) =>
	deepSeekThinkingModels.has(
		Object.hasOwn(deepSeekModelAliases, modelId)
			? deepSeekModelAliases[modelId as keyof typeof deepSeekModelAliases]
			: modelId,
	)

// Only the known thinking models and the retired reasoner name (kept for
// compatible endpoints that may still serve it) support DeepSeek's thinking
// fields. Custom model IDs still fall back to default metadata, but should
// not receive these request parameters.
const isDeepSeekThinkingEnabled = (modelId: string, options: ApiHandlerOptions) => {
	if (options.enableReasoningEffort === false || options.reasoningEffort === "disable") {
		return false
	}

	return modelId === "deepseek-reasoner" || supportsDeepSeekThinkingToggle(modelId)
}

const normalizeDeepSeekReasoningEffort = (reasoningEffort?: string): "low" | "high" | "max" | undefined => {
	if (!reasoningEffort || reasoningEffort === "disable") {
		return undefined
	}

	// DeepSeek's thinking levels are low / high / max (since 2026-08-13). Our
	// "xhigh" is the top option of the settings list, so it asks for max.
	if (reasoningEffort === "low" || reasoningEffort === "minimal") {
		return "low"
	}
	return reasoningEffort === "xhigh" || reasoningEffort === "max" ? "max" : "high"
}

// Use the computed maxTokens from getModelParams rather than raw model metadata.
// DeepSeek advertises a 384K maximum output, but the project convention caps most
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
		const { id, info } = resolveCatalogModel(this.options.apiModelId, providerModelDefinitions.deepseek)
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

		// The task's signal (the Stop button) or cancelRequest() aborts this controller, which ends
		// the HTTP request.
		this.abortController = createRequestAbortController(metadata?.signal)

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
			throw handleProviderError(error, "DeepSeek")
		}

		try {
			// DeepSeek sends its thinking in reasoning_content, before the answer
			// text, and may finish with "stop" or "tool_calls" (AP-6).
			yield* streamChatCompletion(stream, {
				mapUsage: (usage) => this.processUsageMetrics(usage, modelInfo),
			})
		} finally {
			this.abortController = undefined
		}
	}

	// DeepSeek reports its prompt cache at the top level of `usage`:
	// prompt_cache_hit_tokens + prompt_cache_miss_tokens = prompt_tokens (both
	// required), with the hit count optionally mirrored in
	// prompt_tokens_details.cached_tokens; the shared reader knows both names.
	// There are no cache writes: a miss is ordinary input at the input price.
	// https://api-docs.deepseek.com/api/create-chat-completion
	protected override processUsageMetrics(usage: any, modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return openAiUsageChunk(usage ?? {}, { modelInfo })
	}
}
