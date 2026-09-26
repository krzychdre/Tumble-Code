import { Anthropic } from "@anthropic-ai/sdk"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"
import OpenAI from "openai"

import { providerModelDefinitions, resolveCatalogModel } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { mergeEnvironmentDetailsForMiniMax } from "../transform/minimax-format"
import { addAnthropicCacheControl, processAnthropicStream } from "../transform/anthropic-stream"

import { BaseProvider } from "./base-provider"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { anthropicCompletionUsage } from "./utils/completion-usage"
import { convertOpenAIToolsToAnthropic } from "../../core/prompts/tools/native-tools/converters"

/**
 * Converts OpenAI tool_choice to Anthropic ToolChoice format
 */
function convertOpenAIToolChoice(
	toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
): Anthropic.Messages.MessageCreateParams["tool_choice"] | undefined {
	if (!toolChoice) {
		return undefined
	}

	if (typeof toolChoice === "string") {
		switch (toolChoice) {
			case "none":
				return undefined // Anthropic doesn't have "none", just omit tools
			case "auto":
				return { type: "auto" }
			case "required":
				return { type: "any" }
			default:
				return { type: "auto" }
		}
	}

	// Handle object form { type: "function", function: { name: string } }
	if (typeof toolChoice === "object" && "function" in toolChoice) {
		return {
			type: "tool",
			name: toolChoice.function.name,
		}
	}

	return { type: "auto" }
}

export class MiniMaxHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: Anthropic

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Use Anthropic-compatible endpoint
		// Default to international endpoint: https://api.minimax.io/anthropic
		// China endpoint: https://api.minimaxi.com/anthropic
		let baseURL = options.minimaxBaseUrl || "https://api.minimax.io/anthropic"

		// If user provided a /v1 endpoint, convert to /anthropic
		if (baseURL.endsWith("/v1")) {
			baseURL = baseURL.replace(/\/v1$/, "/anthropic")
		} else if (!baseURL.endsWith("/anthropic")) {
			baseURL = `${baseURL.replace(/\/$/, "")}/anthropic`
		}

		this.client = new Anthropic({
			baseURL,
			apiKey: options.minimaxApiKey,
			timeout: this.timeoutMs,
		})
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const cacheControl: CacheControlEphemeral = { type: "ephemeral" }
		const { id: modelId, info, maxTokens, temperature } = this.getModel()

		// MiniMax M2 models support prompt caching
		const supportsPromptCache = info.supportsPromptCache ?? false

		// Merge environment_details from messages that follow tool_result blocks
		// into the tool_result content. This preserves reasoning continuity for
		// thinking models by preventing user messages from interrupting the
		// reasoning context after tool use (similar to r1-format's mergeToolResultText).
		const processedMessages = mergeEnvironmentDetailsForMiniMax(messages)

		// Build the system blocks array
		const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
			supportsPromptCache
				? { text: systemPrompt, type: "text", cache_control: cacheControl }
				: { text: systemPrompt, type: "text" },
		]

		// Prepare request parameters
		const requestParams: Anthropic.Messages.MessageCreateParams = {
			model: modelId,
			max_tokens: maxTokens ?? 16_384,
			temperature: temperature ?? 1.0,
			system: systemBlocks,
			messages: supportsPromptCache
				? addAnthropicCacheControl(processedMessages, cacheControl)
				: processedMessages,
			stream: true,
			tools: convertOpenAIToolsToAnthropic(metadata?.tools ?? []),
			tool_choice: convertOpenAIToolChoice(metadata?.tool_choice),
		}

		// The task's signal: Stop closes the HTTP request.
		const stream = await this.client.messages.create(requestParams, { signal: metadata?.signal })

		yield* processAnthropicStream(stream, info)
	}

	getModel() {
		const { id, info } = resolveCatalogModel(this.options.apiModelId, providerModelDefinitions.minimax)

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 1.0,
		})

		return {
			id,
			info,
			...params,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		const { id: model, temperature } = this.getModel()

		const message = await this.client.messages.create({
			model,
			max_tokens: 16_384,
			temperature: temperature ?? 1.0,
			messages: [{ role: "user", content: prompt }],
			stream: false,
		})

		const content = message.content.find(({ type }) => type === "text")
		return {
			text: content?.type === "text" ? content.text : "",
			usage: anthropicCompletionUsage(message.usage),
		}
	}
}
