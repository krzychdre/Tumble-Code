import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	moonshotModels,
	moonshotDefaultModelId,
	type ModelInfo,
	providerModelDefinitions,
	resolveCatalogModel,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"

import type { ApiHandlerCreateMessageMetadata, CompletionResult } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"
import { openAiCompletionUsage } from "./utils/completion-usage"
import { flattenMessagesForTokenCount } from "../../utils/flattenMessagesForTokenCount"

const MOONSHOT_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"

/**
 * Moonshot documents cache reads and writes in prompt_tokens_details, which the
 * shared usage parser reads. Older responses carry the cache reads only as a
 * top-level `cached_tokens`; copy that into prompt_tokens_details when the
 * documented field has nothing, so both shapes are counted.
 */
function withLegacyCachedTokens<T>(usage: T): T {
	const raw = usage as { cached_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } | undefined
	const legacy = raw?.cached_tokens
	const documented = raw?.prompt_tokens_details?.cached_tokens

	if (typeof legacy !== "number" || (typeof documented === "number" && documented > 0)) {
		return usage
	}

	return { ...raw, prompt_tokens_details: { ...raw?.prompt_tokens_details, cached_tokens: legacy } } as T
}

/**
 * Moonshot (Kimi) Chat Completions API.
 * @see https://platform.kimi.ai/docs/api/chat.md
 *
 * Runs on the shared OpenAI-compatible base like Z.ai, so it gets the abort signal
 * (Stop button), the apiRequestTimeout setting, thrown stream errors and the
 * incremental tool-call chunks from there.
 */
export class MoonshotHandler extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Moonshot",
			baseURL: options.moonshotBaseUrl || MOONSHOT_DEFAULT_BASE_URL,
			apiKey: options.moonshotApiKey ?? "not-provided",
			defaultProviderModelId: moonshotDefaultModelId,
			providerModels: moonshotModels as Record<string, ModelInfo>,
			defaultTemperature: 0,
		})
	}

	/**
	 * An unknown model id is kept and sent as typed, with the default model's info.
	 * maxTokens comes from the shared getModelMaxOutputTokens rule (the one the task
	 * uses to reserve output space), so a stale modelMaxTokens left over from another
	 * model is capped (DEF-C22).
	 */
	override getModel() {
		const { id, info } = resolveCatalogModel(this.options.apiModelId, providerModelDefinitions.moonshot)
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: model, maxTokens, temperature } = this.getModel()

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens: maxTokens ?? undefined,
			temperature,
			// The R1 converter sends a preserved reasoning block back as reasoning_content,
			// which the Kimi thinking models expect on the assistant turns of a tool loop.
			messages: [{ role: "system", content: systemPrompt }, ...convertToR1Format(messages)],
			stream: true,
			// Without this the API sends no final usage chunk (and no cache figures).
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			// No parallel_tool_calls: the field is not in Moonshot's request schema.
		}

		// Same contract as the base createStream: the task's signal (the Stop button) or
		// cancelRequest() aborts this controller, and the base createMessage clears it once the
		// stream ends.
		this.abortController = createRequestAbortController(metadata?.signal)

		try {
			return this.getClient().chat.completions.create(params, {
				...requestOptions,
				signal: this.abortController.signal,
			})
		} catch (error) {
			this.abortController = undefined
			throw handleProviderError(error, this.providerName)
		}
	}

	/**
	 * The base stream, plus a local estimate when the server reports no usage (or
	 * only zeros), so the task always gets exactly one usage chunk (AP-4). This was
	 * the behavior of the AI SDK path and Moonshot-compatible gateways rely on it.
	 */
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		let assistantText = ""
		let reportedUsage = false

		for await (const chunk of super.createMessage(systemPrompt, messages, metadata)) {
			if (chunk.type === "usage") {
				if (chunk.inputTokens > 0 || chunk.outputTokens > 0) {
					reportedUsage = true
					yield chunk
				}
				continue
			}
			if (chunk.type === "text") {
				assistantText += chunk.text
			}
			yield chunk
		}

		if (!reportedUsage) {
			yield await this.estimateUsage(systemPrompt, messages, assistantText)
		}
	}

	private async estimateUsage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		assistantText: string,
	): Promise<ApiStreamUsageChunk> {
		let inputTokens = 0
		try {
			inputTokens = await this.countTokens([
				{ type: "text", text: systemPrompt },
				...flattenMessagesForTokenCount(messages),
			])
		} catch (err) {
			console.error(`[${this.providerName}] Failed to count input tokens:`, err)
		}

		let outputTokens = 0
		if (assistantText) {
			try {
				outputTokens = await this.countTokens([{ type: "text", text: assistantText }])
			} catch (err) {
				console.error(`[${this.providerName}] Failed to count output tokens:`, err)
			}
		}

		return { type: "usage", inputTokens, outputTokens }
	}

	protected override processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		return super.processUsageMetrics(withLegacyCachedTokens(usage), modelInfo)
	}

	/**
	 * One-shot completion (condensing, prompt enhancement). Like the AI SDK path it
	 * replaced: max_tokens always, temperature only when the user set one.
	 */
	override async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		const { id: model, maxTokens } = this.getModel()

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model,
			messages: [{ role: "user", content: prompt }],
			max_tokens: maxTokens ?? undefined,
			...(this.options.modelTemperature != null && { temperature: this.options.modelTemperature }),
		}

		this.abortController = new AbortController()
		try {
			const response = await this.getClient().chat.completions.create(params, {
				signal: this.abortController.signal,
			})

			return {
				text: response.choices?.[0]?.message.content || "",
				usage: openAiCompletionUsage(withLegacyCachedTokens(response.usage)),
			}
		} catch (error) {
			throw handleProviderError(error, this.providerName)
		} finally {
			this.abortController = undefined
		}
	}
}
