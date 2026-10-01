import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	ZAI_DEFAULT_TEMPERATURE,
	getZaiApiLineConfig,
	resolveCatalogModel,
	zaiModelCatalog,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { convertToR1Format } from "../transform/r1-format"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

// Custom interface for Z.ai params to support thinking mode and reasoning effort tiers.
// Z.ai accepts the standard `reasoning_effort` ladder (none/minimal/low/medium/high/xhigh/max)
// alongside the GLM-specific `thinking` toggle. Omit the OpenAI-typed `reasoning_effort` so we
// can widen it to include provider-specific values such as "max".
type ZAiChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
}

/** The `{ id, info }` that `ZAiHandler.getModel()` reports, without building a handler. */
export function resolveZAiModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	const { id, info } = resolveCatalogModel(options.apiModelId, zaiModelCatalog(options))

	return { id, info }
}

export class ZAiHandler extends BaseOpenAiCompatibleProvider<string> {
	constructor(options: ApiHandlerOptions) {
		const { models, defaultModelId, unknownModelPolicy } = zaiModelCatalog(options)

		super({
			...options,
			providerName: "Z.ai",
			baseURL: getZaiApiLineConfig(options.zaiApiLine).baseUrl,
			apiKey: options.zaiApiKey ?? "not-provided",
			defaultProviderModelId: defaultModelId,
			providerModels: models,
			unknownModelPolicy,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}

	/** GLM-4.7 and the GLM-5 family take the `thinking` toggle and a reasoning effort. */
	private isThinkingModel(): boolean {
		return Array.isArray(this.getModel().info.supportsReasoningEffort)
	}

	/**
	 * The thinking models preserve reasoning_content and merge post-tool text into tool
	 * messages. Z.ai's interleaved thinking has the same contract as DeepSeek's, so both use
	 * the shared R1 converter.
	 */
	protected override convertMessages(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		if (!this.isThinkingModel()) {
			return super.convertMessages(systemPrompt, messages)
		}
		return [
			{ role: "system", content: systemPrompt },
			...convertToR1Format(messages, { mergeToolResultText: true }),
		]
	}

	/**
	 * GLM thinking mode. GLM-4.7 and the GLM-5 family have thinking enabled by default in the
	 * API, so we need to explicitly send { type: "disabled" } when the user turns off reasoning.
	 * GLM-5.3 is the exception: it cannot be turned off at all. Other models keep the base
	 * binary switch.
	 */
	protected override getExtraStreamParams(): Pick<ZAiChatCompletionParams, "thinking" | "reasoning_effort"> {
		if (!this.isThinkingModel()) {
			return super.getExtraStreamParams()
		}

		const { info } = this.getModel()

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

		return {
			// Thinking is ON by default for these models, so we explicitly disable when the
			// user asked for it and the model actually allows it.
			thinking: useReasoning ? { type: "enabled" } : { type: "disabled" },
			reasoning_effort: reasoningEffort as ZAiChatCompletionParams["reasoning_effort"],
		}
	}
}
