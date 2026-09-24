import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	internationalZAiModels,
	mainlandZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	type ModelInfo,
	ZAI_DEFAULT_TEMPERATURE,
	zaiApiLineConfigs,
} from "@roo-code/types"

import { type ApiHandlerOptions, getModelMaxOutputTokens } from "../../shared/api"
import { convertToR1Format } from "../transform/r1-format"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { handleOpenAIError } from "./utils/openai-error-handler"

// Custom interface for Z.ai params to support thinking mode and reasoning effort tiers.
// Z.ai accepts the standard `reasoning_effort` ladder (none/minimal/low/medium/high/xhigh/max)
// alongside the GLM-specific `thinking` toggle. Omit the OpenAI-typed `reasoning_effort` so we
// can widen it to include provider-specific values such as "max".
type ZAiChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
}

export class ZAiHandler extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: ApiHandlerOptions) {
		const isChina = zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].isChina
		const models = (isChina ? mainlandZAiModels : internationalZAiModels) as unknown as Record<string, ModelInfo>
		const defaultModelId = (isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId) as string

		super({
			...options,
			providerName: "Z.ai",
			baseURL: zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].baseUrl,
			apiKey: options.zaiApiKey ?? "not-provided",
			defaultProviderModelId: defaultModelId,
			providerModels: models,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}

	/**
	 * Override createStream to handle GLM thinking mode.
	 * GLM-4.7 and the GLM-5 family have thinking enabled by default in the API, so we
	 * need to explicitly send { type: "disabled" } when the user turns off reasoning.
	 * GLM-5.3 is the exception: it cannot be turned off at all.
	 */
	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: modelId, info } = this.getModel()

		// Check if this is a model with thinking support (e.g. GLM-4.7, GLM-5)
		const isThinkingModel = Array.isArray(info.supportsReasoningEffort)

		if (isThinkingModel) {
			// Create the stream with our custom thinking parameter
			return this.createStreamWithThinking(systemPrompt, messages, metadata)
		}

		// For non-thinking models, use the default behavior
		return super.createStream(systemPrompt, messages, metadata, requestOptions)
	}

	/**
	 * Creates a stream with explicit thinking control for the GLM thinking models.
	 */
	private createStreamWithThinking(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	) {
		const { id: model, info } = this.getModel()

		// Some models always reason and reject `thinking: { type: "disabled" }` outright
		// (GLM-5.3). We detect them by the absence of "disable" in the supported effort
		// list, and then ignore both the global reasoning toggle and any stale "disable"
		// value still sitting in the user's settings from a previously selected model.
		// @see https://docs.z.ai/guides/capabilities/thinking
		const supported = info.supportsReasoningEffort
		const canDisableReasoning = !Array.isArray(supported) || supported.includes("disable")

		// Fall back to the model default when the resolved effort isn't supported by the model.
		const raw =
			canDisableReasoning && this.options.enableReasoningEffort === false
				? undefined
				: (this.options.reasoningEffort ?? info.reasoningEffort)
		const effort =
			raw && raw !== "disable" && Array.isArray(supported) && !supported.includes(raw)
				? info.reasoningEffort
				: raw
		const resolvedEffort = effort && effort !== "disable" ? effort : undefined
		// A model that cannot turn reasoning off falls back to its default effort rather
		// than sending an effort-less "disabled" request that the API would reject.
		const reasoningEffort = canDisableReasoning ? resolvedEffort : (resolvedEffort ?? info.reasoningEffort)
		const useReasoning = !canDisableReasoning || reasoningEffort !== undefined

		// Shared rule, the same one the task uses to reserve output space: the max-output
		// slider override is honored only on models that have the slider (supportsMaxTokens)
		// and is capped at the model's own limit; otherwise the 20% context-window clamp
		// applies. A stale override left over from another model never reaches the request.
		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const temperature = this.options.modelTemperature ?? this.defaultTemperature

		// Preserve reasoning_content and merge post-tool text into tool messages. Z.ai's interleaved
		// thinking has the same contract as DeepSeek's, so both use the shared R1 converter.
		const convertedMessages = convertToR1Format(messages, { mergeToolResultText: true })

		const params: ZAiChatCompletionParams = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertedMessages],
			stream: true,
			stream_options: { include_usage: true },
			// Thinking is ON by default for these models, so we explicitly disable when the
			// user asked for it and the model actually allows it.
			thinking: useReasoning ? { type: "enabled" } : { type: "disabled" },
			reasoning_effort: reasoningEffort,
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		// Same contract as the base createStream: cancelRequest() (the Stop button) aborts this
		// controller, and the base createMessage clears it once the stream ends.
		this.abortController = new AbortController()

		try {
			return this.getClient().chat.completions.create(
				params as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
				{ signal: this.abortController.signal },
			)
		} catch (error) {
			this.abortController = undefined
			throw handleOpenAIError(error, this.providerName)
		}
	}
}
