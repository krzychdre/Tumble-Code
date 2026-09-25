import { v7 as uuidv7 } from "uuid"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	OPENAI_NATIVE_DEFAULT_TEMPERATURE,
	type VerbosityLevel,
	type ReasoningEffortExtended,
	type ServiceTier,
	ApiProviderError,
	providerModelDefinitions,
	resolveCatalogModel,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions } from "../../shared/api"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { responsesApiCompletionUsage } from "./utils/completion-usage"
import { handleProviderError } from "./utils/error-handler"
import { ResponsesApiCore, type ResponsesApiErrorTexts } from "./responses-api/core"
import { buildResponsesApiRequestBody, responsesApiUserAgent, toResponsesApiInput } from "./responses-api/request"

export type OpenAiNativeModel = ReturnType<OpenAiNativeHandler["getModel"]>

const OPENAI_NATIVE_ERROR_TEXTS: ResponsesApiErrorTexts = {
	httpError: (status) => {
		switch (status) {
			case 400:
				return "Invalid request to Responses API. Please check your input parameters."
			case 401:
				return "Authentication failed. Please check your OpenAI API key."
			case 403:
				return "Access denied. Your API key may not have access to this endpoint."
			case 404:
				return "Responses API endpoint not found. The endpoint may not be available yet or requires a different configuration."
			case 429:
				return "Rate limit exceeded. Please try again later."
			case 500:
			case 502:
			case 503:
				return "OpenAI service error. Please try again later."
			default:
				return `Responses API error (${status})`
		}
	},
	noResponseBody: "Responses API error: No response body",
	ownTextMarker: "Responses API",
	connectionFailed: (message) => `Failed to connect to Responses API: ${message}`,
	unexpectedConnectionError: "Unexpected error connecting to Responses API",
	streamErrorEvent: (message) => `Responses API error: ${message}`,
	responseFailed: (message) => `Response failed: ${message}`,
	streamProcessingError: (message) => `Error processing response stream: ${message}`,
	unexpectedStreamError: "Unexpected error processing response stream",
}

export class OpenAiNativeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "OpenAI Native"
	// Session ID for request tracking (persists for the lifetime of the handler)
	private readonly sessionId: string
	// Responses API plumbing shared with Codex; priced here with the service tiers.
	private readonly core = new ResponsesApiCore({
		providerName: this.providerName,
		texts: OPENAI_NATIVE_ERROR_TEXTS,
		totalCost: (tokens, info, serviceTier) => {
			// Prefer the tier the server used; otherwise the requested one.
			const effectiveTier =
				serviceTier || (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
			// calculateApiCostOpenAI subtracts cache reads and writes from the input total itself.
			return calculateApiCostOpenAI(
				this.applyServiceTierPricing(info, effectiveTier),
				tokens.inputTokens,
				tokens.outputTokens,
				tokens.cacheWriteTokens,
				tokens.cacheReadTokens,
				effectiveTier,
			).totalCost
		},
	})

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Generate a session ID for request tracking
		this.sessionId = uuidv7()
		// Default to including reasoning.summary: "auto" for models that support Responses API
		// reasoning summaries unless explicitly disabled.
		if (this.options.enableResponsesReasoningSummary === undefined) {
			this.options.enableResponsesReasoningSummary = true
		}
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		// Include originator, session_id, and User-Agent headers for API tracking and debugging
		this.client = new OpenAI({
			baseURL: this.options.openAiNativeBaseUrl || undefined,
			apiKey,
			defaultHeaders: {
				originator: "roo-code",
				session_id: this.sessionId,
				"User-Agent": responsesApiUserAgent(),
			},
			timeout: this.timeoutMs,
		})
	}

	private normalizeUsage(usage: any, model: OpenAiNativeModel): ApiStreamUsageChunk | undefined {
		return this.core.normalizeUsage(usage, model.info)
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Use Responses API for ALL models
		const model = this.getModel()
		this.core.startResponse()

		const requestBody = this.buildRequestBody(
			model,
			toResponsesApiInput(messages),
			systemPrompt,
			model.verbosity,
			this.getReasoningEffort(model),
			metadata,
		)

		// Per-request headers: the task id when there is one, else the session id.
		const requestHeaders: Record<string, string> = {
			originator: "roo-code",
			session_id: metadata?.taskId || this.sessionId,
			"User-Agent": responsesApiUserAgent(),
		}

		yield* this.core.streamRequest({
			body: requestBody,
			modelId: model.id,
			info: model.info,
			openSdkStream: (body, signal) =>
				(this.client as any).responses.create(body, { signal, headers: requestHeaders }),
			fallbackRequest: async () => ({
				url: `${this.options.openAiNativeBaseUrl || "https://api.openai.com"}/v1/responses`,
				headers: {
					Authorization: `Bearer ${this.options.openAiNativeApiKey ?? "not-provided"}`,
					...requestHeaders,
				},
				body: requestBody,
			}),
		})
	}

	private buildRequestBody(
		model: OpenAiNativeModel,
		formattedInput: any,
		systemPrompt: string,
		verbosity: any,
		reasoningEffort: ReasoningEffortExtended | undefined,
		metadata?: ApiHandlerCreateMessageMetadata,
	): any {
		// Validate requested tier against model support; if not supported, omit.
		const requestedTier = (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
		const allowedTierNames = new Set(model.info.tiers?.map((t) => t.name).filter(Boolean) || [])

		// Decide whether to enable extended prompt cache retention for this request
		const promptCacheRetention = this.getPromptCacheRetention(model)

		const body = buildResponsesApiRequestBody({
			modelId: model.id,
			input: formattedInput,
			instructions: systemPrompt,
			reasoningEffort,
			reasoningSummary: !!this.options.enableResponsesReasoningSummary,
			settings: {
				// Only include temperature if the model supports it
				...(model.info.supportsTemperature !== false && {
					temperature: this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE,
				}),
				// The per-request reserved output computed by getModelParams.
				...(model.maxTokens ? { max_output_tokens: model.maxTokens } : {}),
				// Include tier when selected and supported by the model, or when explicitly "default"
				...(requestedTier &&
					(requestedTier === "default" || allowedTierNames.has(requestedTier)) && {
						service_tier: requestedTier,
					}),
				// Extended prompt cache retention for the models that support it.
				...(promptCacheRetention ? { prompt_cache_retention: promptCacheRetention } : {}),
			},
			metadata,
		})

		// Include text.verbosity only when the model explicitly supports it
		if (model.info.supportsVerbosity === true) {
			body.text = { verbosity: (verbosity || "medium") as VerbosityLevel }
		}

		return body
	}

	private getReasoningEffort(model: OpenAiNativeModel): ReasoningEffortExtended | undefined {
		// User setting overrides, else model default (from types). The saved setting
		// can come from a previously selected model, so it must be one the current
		// model accepts (GPT-6 Astra rejects `none` with a 400); otherwise fall back
		// to the model default. `disable` only turns reasoning off when the model
		// allows that.
		const configured = this.options.reasoningEffort as ReasoningEffortExtended | "disable" | undefined
		const fallback = model.info.reasoningEffort as ReasoningEffortExtended | undefined
		const supported = model.info.supportsReasoningEffort

		if (configured === "disable" && !model.info.requiredReasoningEffort) return undefined

		const selected = configured && configured !== "disable" ? configured : fallback
		if (Array.isArray(supported) && selected && !supported.includes(selected)) {
			return fallback && supported.includes(fallback) ? fallback : undefined
		}
		return selected
	}

	/**
	 * Returns the appropriate prompt cache retention policy for the given model, if any.
	 *
	 * The policy is driven by ModelInfo.promptCacheRetention so that model-specific details
	 * live in the shared types layer rather than this provider. When set to "24h" and the
	 * model supports prompt caching, extended prompt cache retention is requested.
	 */
	private getPromptCacheRetention(model: OpenAiNativeModel): "24h" | undefined {
		if (!model.info.supportsPromptCache) return undefined

		if (model.info.promptCacheRetention === "24h") {
			return "24h"
		}

		return undefined
	}

	/**
	 * Returns a shallow-cloned ModelInfo with pricing overridden for the given tier, if available.
	 * If no tier or no overrides exist, the original ModelInfo is returned.
	 */
	private applyServiceTierPricing(info: ModelInfo, tier?: ServiceTier): ModelInfo {
		if (!tier || tier === "default") return info

		// Find the tier with matching name in the tiers array
		const tierInfo = info.tiers?.find((t) => t.name === tier)
		if (!tierInfo) return info

		return {
			...info,
			inputPrice: tierInfo.inputPrice ?? info.inputPrice,
			outputPrice: tierInfo.outputPrice ?? info.outputPrice,
			cacheReadsPrice: tierInfo.cacheReadsPrice ?? info.cacheReadsPrice,
			cacheWritesPrice: tierInfo.cacheWritesPrice ?? info.cacheWritesPrice,
		}
	}

	// Removed isResponsesApiModel method as ALL models now use the Responses API

	override getModel() {
		const { id, info } = resolveCatalogModel(this.options.apiModelId, providerModelDefinitions["openai-native"])

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: OPENAI_NATIVE_DEFAULT_TEMPERATURE,
		})

		// Reasoning effort inclusion is handled by getModelParams/getOpenAiReasoning.
		// Do not re-compute or filter efforts here.

		return { id, info, ...params, verbosity: params.verbosity }
	}

	/**
	 * Extracts encrypted_content and id from the first reasoning item in the output array.
	 * This is the minimal data needed for stateless API continuity.
	 *
	 * @returns Object with encrypted_content and id, or undefined if not available
	 */
	getEncryptedContent(): { encrypted_content: string; id?: string } | undefined {
		return this.core.getEncryptedContent()
	}

	/**
	 * Cancels the in-flight request (the Stop button, via Task.cancelCurrentRequest).
	 *
	 * The client is not destroyed: it talks to a hosted API, so there is no local inference
	 * to sever, and aborting the signal already closes the HTTP connection.
	 */
	cancelRequest(): void {
		this.core.cancel()
	}

	getResponseId(): string | undefined {
		return this.core.getResponseId()
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		// Registered so that cancelRequest() aborts it
		const abortController = this.core.openRequest()

		try {
			const model = this.getModel()
			const { verbosity } = model

			// Resolve reasoning effort for models that support it
			const reasoningEffort = this.getReasoningEffort(model)

			// Build request body for Responses API
			const requestBody: any = {
				model: model.id,
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: prompt }],
					},
				],
				stream: false, // Non-streaming for completePrompt
				store: false, // Don't store prompt completions
				// Only include encrypted reasoning content when reasoning effort is set
				...(reasoningEffort ? { include: ["reasoning.encrypted_content"] } : {}),
			}

			// Include service tier if selected and supported
			const requestedTier = (this.options.openAiNativeServiceTier as ServiceTier | undefined) || undefined
			const allowedTierNames = new Set(model.info.tiers?.map((t) => t.name).filter(Boolean) || [])
			if (requestedTier && (requestedTier === "default" || allowedTierNames.has(requestedTier))) {
				requestBody.service_tier = requestedTier
			}

			// Add reasoning if supported
			if (reasoningEffort) {
				requestBody.reasoning = {
					effort: reasoningEffort,
					...(this.options.enableResponsesReasoningSummary ? { summary: "auto" as const } : {}),
				}
			}

			// Only include temperature if the model supports it
			if (model.info.supportsTemperature !== false) {
				requestBody.temperature = this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE
			}

			// Include max_output_tokens if available
			if (model.maxTokens) {
				requestBody.max_output_tokens = model.maxTokens
			}

			// Include text.verbosity only when the model explicitly supports it
			if (model.info.supportsVerbosity === true) {
				requestBody.text = { verbosity: (verbosity || "medium") as VerbosityLevel }
			}

			// Enable extended prompt cache retention for eligible models
			const promptCacheRetention = this.getPromptCacheRetention(model)
			if (promptCacheRetention) {
				requestBody.prompt_cache_retention = promptCacheRetention
			}

			// Make the non-streaming request
			const response = await (this.client as any).responses.create(requestBody, {
				signal: abortController.signal,
			})

			// The Responses API names its usage fields input_tokens/output_tokens.
			const usage = responsesApiCompletionUsage(response?.usage)

			// Extract text from the response
			if (response?.output && Array.isArray(response.output)) {
				for (const outputItem of response.output) {
					if (outputItem.type === "message" && outputItem.content) {
						for (const content of outputItem.content) {
							if (content.type === "output_text" && content.text) {
								return { text: content.text, usage }
							}
						}
					}
				}
			}

			// Fallback: check for direct text in response
			if (response?.text) {
				return { text: response.text, usage }
			}

			return { text: "", usage }
		} catch (error) {
			const errorModel = this.getModel()
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, errorModel.id, "completePrompt")
			TelemetryService.instance.captureException(apiError)

			throw handleProviderError(error, this.providerName)
		} finally {
			this.core.closeRequest()
		}
	}
}
