import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { z } from "zod"

import {
	type ModelInfo,
	type ModelRecord,
	ApiProviderError,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions } from "../../shared/api"

import {
	convertToOpenAiMessages,
	sanitizeGeminiMessages,
	consolidateReasoningDetails,
} from "../transform/openai-format"
import { normalizeMistralToolCallId } from "../transform/mistral-format"
import { ApiStreamChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { streamChatCompletion } from "../transform/chat-completions-stream"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import type { OpenRouterReasoningParams } from "../transform/reasoning"
import { getModelParams } from "../transform/model-params"

import { getModels } from "./fetchers/modelCache"
import { getModelEndpoints } from "./fetchers/modelEndpointCache"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { ApiHandlerCreateMessageMetadata, CompletionResult, SingleCompletionHandler } from "../index"
import { openAiCompletionUsage, openAiUsageChunk } from "./utils/completion-usage"
import { handleProviderError } from "./utils/error-handler"
import { generateImageWithProvider, ImageGenerationResult } from "./utils/image-generation"
import { applyRouterToolPreferences } from "./utils/router-tool-preferences"

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
}

// Zod schema for OpenRouter error response structure (for caught exceptions)
const OpenRouterErrorResponseSchema = z.object({
	error: z
		.object({
			message: z.string().optional(),
			code: z.number().optional(),
			metadata: z
				.object({
					raw: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
})

// Direct error object structure (for streaming errors passed directly)
interface OpenRouterError {
	message?: string
	/** Usually the HTTP status (429, 502, ...), sometimes a text code. */
	code?: number | string
	metadata?: { raw?: string }
}

/**
 * Helper function to parse and extract error message from metadata.raw
 * metadata.raw is often a JSON encoded string that may contain .message or .error fields
 * Example structures:
 * - {"message": "Error text"}
 * - {"error": "Error text"}
 * - {"error": {"message": "Error text"}}
 * - {"type":"error","error":{"type":"invalid_request_error","message":"tools: Tool names must be unique."}}
 */
function extractErrorFromMetadataRaw(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined
	}

	try {
		const parsed = JSON.parse(raw)
		// Check for common error message fields
		if (typeof parsed === "object" && parsed !== null) {
			// Check for direct message field
			if (typeof parsed.message === "string") {
				return parsed.message
			}
			// Check for nested error.message field (e.g., Anthropic error format)
			if (typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
				return parsed.error.message
			}
			// Check for error as a string
			if (typeof parsed.error === "string") {
				return parsed.error
			}
		}
		// If we can't extract a specific field, return the raw string
		return raw
	} catch {
		// If it's not valid JSON, return as-is
		return raw
	}
}

export class OpenRouterHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}
	protected endpoints: ModelRecord = {}
	private readonly providerName = "OpenRouter"
	private currentReasoningDetails: any[] = []

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"
		const apiKey = this.options.openRouterApiKey ?? "not-provided"

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: DEFAULT_HEADERS, timeout: this.timeoutMs })

		// Load models asynchronously to populate cache before getModel() is called
		this.loadDynamicModels().catch((error) => {
			console.error("[OpenRouterHandler] Failed to load dynamic models:", error)
		})
	}

	private async loadDynamicModels(): Promise<void> {
		try {
			const [models, endpoints] = await Promise.all([
				getModels({ provider: "openrouter" }),
				getModelEndpoints({
					router: "openrouter",
					modelId: this.options.openRouterModelId,
					endpoint: this.options.openRouterSpecificProvider,
				}),
			])

			this.models = models
			this.endpoints = endpoints
		} catch (error) {
			console.error("[OpenRouterHandler] Error loading dynamic models:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
		}
	}

	getReasoningDetails(): any[] | undefined {
		return this.currentReasoningDetails.length > 0 ? this.currentReasoningDetails : undefined
	}

	/**
	 * Handle OpenRouter streaming error response and report to telemetry.
	 * OpenRouter may include metadata.raw with the actual upstream provider error.
	 * @param error The error object (not wrapped - receives the error directly)
	 */
	private handleStreamingError(error: OpenRouterError, modelId: string, operation: string): never {
		const rawString = error?.metadata?.raw
		const parsedError = extractErrorFromMetadataRaw(rawString)
		const rawErrorMessage = parsedError || error?.message || "Unknown error"

		// Only an HTTP status counts as `status`: the retry loop, the chat error
		// row and the background-model fallback read it from the thrown error.
		const code = error?.code
		const status =
			typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599 ? code : undefined

		const apiError = Object.assign(
			new ApiProviderError(
				rawErrorMessage,
				this.providerName,
				modelId,
				operation,
				typeof code === "number" ? code : undefined,
			),
			{ status: error?.code, error },
		)

		TelemetryService.instance.captureException(apiError)

		const thrown = new Error(`OpenRouter API Error ${error?.code}: ${rawErrorMessage}`)
		if (status !== undefined) {
			;(thrown as Error & { status?: number }).status = status
		}
		throw thrown
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		let { id: modelId, maxTokens, temperature, topP, reasoning } = model

		// Reset reasoning_details accumulator for this request
		this.currentReasoningDetails = []

		// OpenRouter sends reasoning tokens by default for Gemini 2.5 Pro models
		// even if you don't request them. This is not the default for
		// other providers (including Gemini), so we need to explicitly disable
		// them unless the user has explicitly configured reasoning.
		// Note: Gemini 3 models use reasoning_details format with thought signatures,
		// but we handle this via skip_thought_signature_validator injection below.
		if (
			(modelId === "google/gemini-2.5-pro-preview" || modelId === "google/gemini-2.5-pro") &&
			typeof reasoning === "undefined"
		) {
			reasoning = { exclude: true }
		}

		// Convert Anthropic messages to OpenAI format.
		// Pass normalization function for Mistral compatibility (requires 9-char alphanumeric IDs)
		const isMistral = modelId.toLowerCase().includes("mistral")
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(
				messages,
				isMistral ? { normalizeToolCallId: normalizeMistralToolCallId } : undefined,
			),
		]

		// DeepSeek highly recommends using user instead of system role.
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// Process reasoning_details when switching models to Gemini.
		const isGemini = modelId.startsWith("google/gemini")

		// For Gemini models with native protocol:
		// 1. Sanitize messages to handle thought signature validation issues.
		//    This must happen BEFORE fake encrypted block injection to avoid injecting for
		//    tool calls that will be dropped due to missing/mismatched reasoning_details.
		// 2. Inject fake reasoning.encrypted block for tool calls without existing encrypted reasoning.
		//    This is required when switching from other models to Gemini to satisfy API validation.
		//    Per OpenRouter documentation (conversation with Toven, Nov 2025):
		//    - Create ONE reasoning_details entry per assistant message with tool calls
		//    - Set `id` to the FIRST tool call's ID from the tool_calls array
		//    - Set `data` to "skip_thought_signature_validator" to bypass signature validation
		//    - Set `index` to 0
		// See: https://github.com/cline/cline/issues/8214
		if (isGemini) {
			// Step 1: Sanitize messages - filter out tool calls with missing/mismatched reasoning_details
			openAiMessages = sanitizeGeminiMessages(openAiMessages, modelId)

			// Step 2: Inject fake reasoning.encrypted block for tool calls that survived sanitization
			openAiMessages = openAiMessages.map((msg) => {
				if (msg.role === "assistant") {
					const toolCalls = (msg as any).tool_calls as any[] | undefined
					const existingDetails = (msg as any).reasoning_details as any[] | undefined

					// Only inject if there are tool calls and no existing encrypted reasoning
					if (toolCalls && toolCalls.length > 0) {
						const hasEncrypted = existingDetails?.some((d) => d.type === "reasoning.encrypted") ?? false

						if (!hasEncrypted) {
							// Create ONE fake encrypted block with the FIRST tool call's ID
							// This is the documented format from OpenRouter for skipping thought signature validation
							const fakeEncrypted = {
								type: "reasoning.encrypted",
								data: "skip_thought_signature_validator",
								id: toolCalls[0].id,
								format: "google-gemini-v1",
								index: 0,
							}

							return {
								...msg,
								reasoning_details: [...(existingDetails ?? []), fakeEncrypted],
							}
						}
					}
				}
				return msg
			})
		}

		// https://openrouter.ai/docs/features/prompt-caching
		// TODO: Add a `promptCacheStratey` field to `ModelInfo`.
		if (OPEN_ROUTER_PROMPT_CACHING_MODELS.has(modelId)) {
			if (modelId.startsWith("google")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}

		// https://openrouter.ai/docs/transforms
		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
			temperature,
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(reasoning && { reasoning }),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
		}

		// Add Anthropic beta header for fine-grained tool streaming when using Anthropic models.
		// The task's signal: Stop closes the HTTP request.
		const requestOptions = {
			...(modelId.startsWith("anthropic/")
				? { headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } }
				: {}),
			signal: metadata?.signal,
		}

		let stream
		try {
			stream = await this.client.chat.completions.create(completionParams, requestOptions)
		} catch (error) {
			// Try to parse as OpenRouter error structure using Zod
			const parseResult = OpenRouterErrorResponseSchema.safeParse(error)

			if (parseResult.success && parseResult.data.error) {
				const openRouterError = parseResult.data
				const rawString = openRouterError.error?.metadata?.raw
				const parsedError = extractErrorFromMetadataRaw(rawString)
				const rawErrorMessage = parsedError || openRouterError.error?.message || "Unknown error"

				const apiError = Object.assign(
					new ApiProviderError(
						rawErrorMessage,
						this.providerName,
						modelId,
						"createMessage",
						openRouterError.error?.code,
					),
					{
						status: openRouterError.error?.code,
						error: openRouterError.error,
					},
				)

				TelemetryService.instance.captureException(apiError)
				throw handleProviderError(error, this.providerName)
			} else {
				// Fallback for non-OpenRouter errors
				const errorMessage = error instanceof Error ? error.message : String(error)
				const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "createMessage")
				TelemetryService.instance.captureException(apiError)
				throw handleProviderError(error, this.providerName)
			}
		}

		yield* streamChatCompletion(stream, {
			reasoning: "openrouter",
			// OpenRouter returns an error object inside the stream instead of the SDK throwing.
			onChunk: (chunk) => {
				if ("error" in chunk) {
					this.handleStreamingError(chunk.error as OpenRouterError, modelId, "createMessage")
				}
			},
			// Kept for the next request; corrupted encrypted blocks (no `data`) are dropped.
			onReasoningDetails: (details) => {
				this.currentReasoningDetails = consolidateReasoningDetails(details)
			},
			// OpenRouter bills the request itself: its cost, not one computed from model prices.
			mapUsage: (usage) => openAiUsageChunk(usage, { billedCost: true }),
		})
	}

	public async fetchModel() {
		const [models, endpoints] = await Promise.all([
			getModels({ provider: "openrouter" }),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.openRouterModelId,
				endpoint: this.options.openRouterSpecificProvider,
			}),
		])

		this.models = models
		this.endpoints = endpoints

		return this.getModel()
	}

	override getModel() {
		const { id, info } = resolveOpenRouterModel(this.options, this.models, this.endpoints)

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		let { id: modelId, maxTokens, temperature, reasoning } = await this.fetchModel()

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(reasoning && { reasoning }),
		}

		// Add Anthropic beta header for fine-grained tool streaming when using Anthropic models
		const requestOptions = modelId.startsWith("anthropic/")
			? { headers: { "x-anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } }
			: undefined

		let response

		try {
			response = await this.client.chat.completions.create(completionParams, requestOptions)
		} catch (error) {
			// Try to parse as OpenRouter error structure using Zod
			const parseResult = OpenRouterErrorResponseSchema.safeParse(error)

			if (parseResult.success && parseResult.data.error) {
				const openRouterError = parseResult.data
				const rawString = openRouterError.error?.metadata?.raw
				const parsedError = extractErrorFromMetadataRaw(rawString)
				const rawErrorMessage = parsedError || openRouterError.error?.message || "Unknown error"

				const apiError = Object.assign(
					new ApiProviderError(
						rawErrorMessage,
						this.providerName,
						modelId,
						"completePrompt",
						openRouterError.error?.code,
					),
					{
						status: openRouterError.error?.code,
						error: openRouterError.error,
					},
				)

				TelemetryService.instance.captureException(apiError)
				throw handleProviderError(error, this.providerName)
			} else {
				// Fallback for non-OpenRouter errors
				const errorMessage = error instanceof Error ? error.message : String(error)
				const apiError = new ApiProviderError(errorMessage, this.providerName, modelId, "completePrompt")
				TelemetryService.instance.captureException(apiError)
				throw handleProviderError(error, this.providerName)
			}
		}

		if ("error" in response) {
			this.handleStreamingError(response.error as OpenRouterError, modelId, "completePrompt")
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return {
			text: completion.choices[0]?.message?.content || "",
			usage: openAiCompletionUsage(completion.usage),
		}
	}

	/**
	 * Generate an image using OpenRouter's image generation API (chat completions with modalities)
	 * Note: OpenRouter only supports the chat completions approach, not the /images/generations endpoint
	 * @param prompt The text prompt for image generation
	 * @param model The model to use for generation
	 * @param apiKey The OpenRouter API key (must be explicitly provided)
	 * @param inputImage Optional base64 encoded input image data URL
	 * @returns The generated image data and format, or an error
	 */
	async generateImage(
		prompt: string,
		model: string,
		apiKey: string,
		inputImage?: string,
	): Promise<ImageGenerationResult> {
		if (!apiKey) {
			return {
				success: false,
				error: "OpenRouter API key is required for image generation",
			}
		}

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"

		// OpenRouter only supports chat completions approach for image generation
		return generateImageWithProvider({
			baseURL,
			authToken: apiKey,
			model,
			prompt,
			inputImage,
		})
	}
}

/**
 * The `{ id, info }` that `OpenRouterHandler.getModel()` reports for the given
 * model and endpoint lists (the handler's fetched lists), without building a
 * handler.
 */
export function resolveOpenRouterModel(
	options: ApiHandlerOptions,
	models: ModelRecord = {},
	endpoints: ModelRecord = {},
): { id: string; info: ModelInfo } {
	const id = options.openRouterModelId ?? openRouterDefaultModelId
	let info = models[id] ?? openRouterDefaultModelInfo

	// If a specific provider is requested, use the endpoint for that provider.
	if (options.openRouterSpecificProvider && endpoints[options.openRouterSpecificProvider]) {
		info = endpoints[options.openRouterSpecificProvider]
	}

	// Apply tool preferences for models accessed through routers (OpenAI, Gemini)
	return { id, info: applyRouterToolPreferences(id, info) }
}
