import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { GoogleAuth } from "google-auth-library"

import {
	type ModelInfo,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
	selectAnthropicVertexModel,
} from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { addCacheBreakpoints } from "../transform/caching/vertex"
import { getModelParams } from "../transform/model-params"
import { getAnthropicProviderReasoning } from "../transform/reasoning"
import { filterNonAnthropicBlocks } from "../transform/anthropic-filter"
import { processAnthropicStream } from "../transform/anthropic-stream"
import {
	convertOpenAIToolsToAnthropic,
	convertOpenAIToolChoiceToAnthropic,
} from "../../core/prompts/tools/native-tools/converters"

import { BaseProvider } from "./base-provider"
import { parseVertexJsonCredentials } from "./utils/vertex-credentials"
import { withoutThinkingSuffix } from "./utils/thinking-suffix"
import { handleProviderError } from "./utils/error-handler"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { anthropicCompletionUsage } from "./utils/completion-usage"

const VERTEX_AUTH_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

/**
 * AnthropicVertex calls `googleAuth.getClient()` in its constructor and keeps
 * the promise until the first request. When the Google credentials cannot be
 * loaded (missing key file, no application default credentials) that promise
 * rejects before anything awaits it, and Node reports an unhandled rejection:
 * the CLI exits on it and the extension host logs it, even when the handler was
 * only built to read model info. Mark each promise as handled here; the first
 * request still awaits the same promise and surfaces the error to the task.
 */
class DeferredErrorGoogleAuth extends GoogleAuth {
	override getClient(): ReturnType<GoogleAuth["getClient"]> {
		const client = super.getClient()
		client.catch(() => {})
		return client
	}
}

/**
 * Since vertex-sdk 0.19 a failed Google credential lookup reaches us as an
 * `APIConnectionError` "Failed to acquire Google OAuth credentials." with the
 * real reason (missing key file, no default credentials) only on `cause`. Put
 * the reason back into the message the task shows; the error keeps its class,
 * so retry decisions do not change.
 */
function withGoogleCredentialCause(error: unknown): unknown {
	if (
		error instanceof Error &&
		error.message.startsWith("Failed to acquire Google OAuth credentials") &&
		error.cause instanceof Error &&
		!error.message.includes(error.cause.message)
	) {
		error.message = `${error.message} ${error.cause.message}`
	}
	return error
}

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class AnthropicVertexHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: AnthropicVertex

	constructor(options: ApiHandlerOptions) {
		super()

		this.options = options

		// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
		const projectId = this.options.vertexProjectId ?? "not-provided"
		const region = this.options.vertexRegion ?? "us-east5"

		const parsedVertexCredentials = parseVertexJsonCredentials(this.options.vertexJsonCredentials)

		if (parsedVertexCredentials) {
			this.client = new AnthropicVertex({
				projectId,
				region,
				googleAuth: new DeferredErrorGoogleAuth({
					scopes: VERTEX_AUTH_SCOPES,
					credentials: parsedVertexCredentials,
				}),
				timeout: this.timeoutMs,
			})
		} else if (this.options.vertexKeyFile) {
			this.client = new AnthropicVertex({
				projectId,
				region,
				googleAuth: new DeferredErrorGoogleAuth({
					scopes: VERTEX_AUTH_SCOPES,
					keyFile: this.options.vertexKeyFile,
				}),
				timeout: this.timeoutMs,
			})
		} else {
			// Same default the SDK would build, wrapped so a failed lookup of the
			// application default credentials is not an unhandled rejection.
			this.client = new AnthropicVertex({
				projectId,
				region,
				googleAuth: new DeferredErrorGoogleAuth({ scopes: VERTEX_AUTH_SCOPES }),
				timeout: this.timeoutMs,
			})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		let { id, info, temperature, maxTokens, reasoning: thinking, betas } = this.getModel()

		const { supportsPromptCache } = info

		// Filter out non-Anthropic blocks (reasoning, thoughtSignature, etc.) before sending to the API
		const sanitizedMessages = filterNonAnthropicBlocks(messages)

		const nativeToolParams = {
			tools: convertOpenAIToolsToAnthropic(metadata?.tools ?? []),
			tool_choice: convertOpenAIToolChoiceToAnthropic(metadata?.tool_choice, metadata?.parallelToolCalls),
		}

		/**
		 * Vertex API has specific limitations for prompt caching:
		 * 1. Maximum of 4 blocks can have cache_control
		 * 2. Only text blocks can be cached (images and other content types cannot)
		 * 3. Cache control can only be applied to user messages, not assistant messages
		 *
		 * Our caching strategy:
		 * - Cache the system prompt (1 block)
		 * - Cache the last text block of the second-to-last user message (1 block)
		 * - Cache the last text block of the last user message (1 block)
		 * This ensures we stay under the 4-block limit while maintaining effective caching
		 * for the most relevant context.
		 */
		const params = {
			model: id,
			max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
			temperature,
			thinking,
			// Cache the system prompt if caching is enabled.
			system: supportsPromptCache
				? [{ text: systemPrompt, type: "text" as const, cache_control: { type: "ephemeral" } }]
				: systemPrompt,
			messages: supportsPromptCache ? addCacheBreakpoints(sanitizedMessages) : sanitizedMessages,
			stream: true,
			...nativeToolParams,
		} as Anthropic.Messages.MessageCreateParamsStreaming

		// and prompt caching. The task's signal: Stop closes the HTTP request.
		const requestOptions = {
			...(betas?.length ? { headers: { "anthropic-beta": betas.join(",") } } : {}),
			signal: metadata?.signal,
		}

		const stream = await this.client.messages.create(params, requestOptions).catch((error: unknown) => {
			throw withGoogleCredentialCause(error)
		})

		yield* processAnthropicStream(stream, info)
	}

	getModel() {
		const { id, info, enable1MContext } = selectAnthropicVertexModel(this.options)

		const params = getModelParams({
			format: "anthropic",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})

		// Adaptive-binary reasoning models (e.g. Opus 4.7/4.8, Fable 5) must send
		// `thinking: { type: "adaptive" }` rather than the budget-based config that
		// `getModelParams` produces for hybrid models. Recompute here so Vertex
		// matches the direct Anthropic provider.
		const thinking = getAnthropicProviderReasoning({
			model: info,
			reasoningBudget: params.reasoningBudget,
			reasoningEffort: params.reasoningEffort,
			settings: this.options,
		})

		// Build betas array for request headers
		const betas: string[] = []

		// Add 1M context beta flag if enabled for supported models
		if (enable1MContext) {
			betas.push("context-1m-2025-08-07")
		}

		return {
			id: withoutThinkingSuffix(id),
			info,
			betas: betas.length > 0 ? betas : undefined,
			...params,
			reasoning: thinking,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		try {
			let {
				id,
				info: { supportsPromptCache },
				temperature,
				maxTokens = ANTHROPIC_DEFAULT_MAX_TOKENS,
				reasoning: thinking,
			} = this.getModel()

			const params = {
				model: id,
				max_tokens: maxTokens,
				temperature,
				thinking,
				messages: [
					{
						role: "user",
						content: supportsPromptCache
							? [{ type: "text" as const, text: prompt, cache_control: { type: "ephemeral" } }]
							: prompt,
					},
				],
				stream: false,
			} as Anthropic.Messages.MessageCreateParamsNonStreaming

			const response = await this.client.messages.create(params)
			// The first block is not always text: it can be missing (empty
			// content) or be a thinking block, so look for the text block.
			const content = response.content.find(({ type }) => type === "text")

			return {
				text: content?.type === "text" ? content.text : "",
				usage: anthropicCompletionUsage(response.usage),
			}
		} catch (error) {
			throw handleProviderError(withGoogleCredentialCause(error), "Vertex")
		}
	}
}

/** The `{ id, info }` that `AnthropicVertexHandler.getModel()` reports, without building a handler. */
export function resolveAnthropicVertexModel(options: ApiHandlerOptions): { id: string; info: ModelInfo } {
	const { id, info } = selectAnthropicVertexModel(options)

	return { id: withoutThinkingSuffix(id), info }
}
