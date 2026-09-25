import { v7 as uuidv7 } from "uuid"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ReasoningEffortExtended,
	ApiProviderError,
	providerModelDefinitions,
	resolveCatalogModel,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import { handleProviderError } from "./utils/error-handler"
import { getApiErrorStatus } from "../apiErrors"
import type { CompletionResult, SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { openAiCodexOAuthManager } from "../../integrations/openai-codex/oauth"
import { t } from "../../i18n"
import { REFUSAL_TEXT_PREFIX, ResponsesApiCore, type ResponsesApiErrorTexts } from "./responses-api/core"
import { buildResponsesApiRequestBody, responsesApiUserAgent, toResponsesApiInput } from "./responses-api/request"

export type OpenAiCodexModel = ReturnType<OpenAiCodexHandler["getModel"]>

/**
 * OpenAI Codex base URL for API requests
 * Per the implementation guide: requests are routed to chatgpt.com/backend-api/codex
 */
const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"

const CODEX_ERROR_TEXTS: ResponsesApiErrorTexts = {
	httpError: (status) => {
		switch (status) {
			case 400:
				return t("common:errors.openAiCodex.invalidRequest")
			case 401:
				return t("common:errors.openAiCodex.authenticationFailed")
			case 403:
				return t("common:errors.openAiCodex.accessDenied")
			case 404:
				return t("common:errors.openAiCodex.endpointNotFound")
			case 429:
				return t("common:errors.openAiCodex.rateLimitExceeded")
			case 500:
			case 502:
			case 503:
				return t("common:errors.openAiCodex.serviceError")
			default:
				return t("common:errors.openAiCodex.genericError", { status })
		}
	},
	get noResponseBody() {
		return t("common:errors.openAiCodex.noResponseBody")
	},
	ownTextMarker: "Codex API",
	connectionFailed: (message) => t("common:errors.openAiCodex.connectionFailed", { message }),
	get unexpectedConnectionError() {
		return t("common:errors.openAiCodex.unexpectedConnectionError")
	},
	streamErrorEvent: (message) => t("common:errors.openAiCodex.apiError", { message }),
	responseFailed: (message) => t("common:errors.openAiCodex.responseFailed", { message }),
	streamProcessingError: (message) => t("common:errors.openAiCodex.streamProcessingError", { message }),
	get unexpectedStreamError() {
		return t("common:errors.openAiCodex.unexpectedStreamError")
	},
}

/**
 * OpenAiCodexHandler - Uses OpenAI Responses API with OAuth authentication
 *
 * Key differences from OpenAiNativeHandler:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Routes requests to Codex backend (chatgpt.com/backend-api/codex)
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset
 * - Custom headers for Codex backend
 */
export class OpenAiCodexHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private readonly providerName = "OpenAI Codex"
	private client?: OpenAI
	// Session ID for the Codex API (persists for the lifetime of the handler)
	private readonly sessionId: string
	// Responses API plumbing shared with OpenAI Native. Subscription: no per-token cost.
	private readonly core = new ResponsesApiCore({
		providerName: this.providerName,
		texts: CODEX_ERROR_TEXTS,
		totalCost: () => 0,
	})

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Generate a new session ID for standalone handler usage (fallback)
		this.sessionId = uuidv7()
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = this.getModel()
		yield* this.handleResponsesApiMessage(model, systemPrompt, messages, metadata)
	}

	private async *handleResponsesApiMessage(
		model: OpenAiCodexModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		this.core.startResponse()

		// Get access token from OAuth manager
		let accessToken = await openAiCodexOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error(
				t("common:errors.openAiCodex.notAuthenticated", {
					defaultValue:
						"Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow.",
				}),
			)
		}

		// Per the implementation guide: the Codex backend may reject max_output_tokens and
		// prompt_cache_retention, so they are not sent; the reasoning summary always is.
		const requestBody = buildResponsesApiRequestBody({
			modelId: model.id,
			input: toResponsesApiInput(messages),
			instructions: systemPrompt,
			reasoningEffort: this.getReasoningEffort(model),
			reasoningSummary: true,
			metadata,
		})

		// Make the request with retry on auth failure
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				yield* this.executeRequest(requestBody, model, accessToken, metadata?.taskId)
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isAuthFailure =
					getApiErrorStatus(error) === 401 ||
					/unauthorized|invalid token|not authenticated|authentication|401/i.test(message)

				// Only retry while nothing has come back yet (see ResponsesApiCore.sawSdkEvent).
				if (attempt === 0 && isAuthFailure && !this.core.sawSdkEvent) {
					// Force refresh the token for retry
					const refreshed = await openAiCodexOAuthManager.forceRefreshAccessToken()
					if (!refreshed) {
						// Keeps the 401 of the failed request as `status`.
						throw handleProviderError(error, this.providerName, {
							messageTransformer: () =>
								t("common:errors.openAiCodex.notAuthenticated", {
									defaultValue:
										"Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow.",
								}),
						})
					}
					accessToken = refreshed
					continue
				}
				throw error
			}
		}
	}

	private executeRequest(requestBody: any, model: OpenAiCodexModel, accessToken: string, taskId?: string): ApiStream {
		const codexHeaders = async (): Promise<Record<string, string>> => {
			// ChatGPT account ID, needed for organization subscriptions
			const accountId = await openAiCodexOAuthManager.getAccountId()
			return {
				originator: "roo-code",
				session_id: taskId || this.sessionId,
				"User-Agent": responsesApiUserAgent(),
				...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
			}
		}

		return this.core.streamRequest({
			body: requestBody,
			modelId: model.id,
			info: model.info,
			openSdkStream: async (body, signal) => {
				const headers = await codexHeaders()
				// Tests inject a client; otherwise one is created per request. Authorization
				// is the SDK apiKey.
				const client =
					this.client ??
					new OpenAI({
						apiKey: accessToken,
						baseURL: CODEX_API_BASE_URL,
						defaultHeaders: headers,
						timeout: this.timeoutMs,
					})
				return (client as any).responses.create(body, { signal, headers })
			},
			// Per the implementation guide: the Codex backend with a Bearer token.
			fallbackRequest: async () => ({
				url: `${CODEX_API_BASE_URL}/responses`,
				headers: { Authorization: `Bearer ${accessToken}`, ...(await codexHeaders()) },
				body: requestBody,
			}),
		})
	}

	/**
	 * Cancels the in-flight request (the Stop button, via Task.cancelCurrentRequest).
	 *
	 * There is no long-lived client to destroy: a client is created per request.
	 */
	cancelRequest(): void {
		this.core.cancel()
	}

	private getReasoningEffort(model: OpenAiCodexModel): ReasoningEffortExtended | undefined {
		const selected = (this.options.reasoningEffort as any) ?? (model.info.reasoningEffort as any)
		return selected && selected !== "disable" && selected !== "none" ? (selected as any) : undefined
	}

	override getModel() {
		const { id, info } = resolveCatalogModel(this.options.apiModelId, providerModelDefinitions["openai-codex"])

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})

		return { id, info, ...params }
	}

	getEncryptedContent(): { encrypted_content: string; id?: string } | undefined {
		return this.core.getEncryptedContent()
	}

	getResponseId(): string | undefined {
		return this.core.getResponseId()
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	/**
	 * The Codex endpoint only accepts streaming requests (a body with `stream: false` is rejected
	 * with HTTP 400 "Stream must be set to true"), so a one-shot completion is the streaming
	 * request with its text chunks joined. Reusing `handleResponsesApiMessage` also reuses the
	 * OAuth refresh-and-retry and the SDK-then-SSE fallback.
	 */
	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		try {
			const model = this.getModel()
			let text = ""
			let usage: CompletionResult["usage"]

			for await (const chunk of this.handleResponsesApiMessage(model, "", [{ role: "user", content: prompt }])) {
				// Only the answer is wanted: reasoning is dropped, and so are refusals, which
				// are streamed as text for the chat but are not an answer.
				if (chunk.type === "text" && !chunk.text.startsWith(REFUSAL_TEXT_PREFIX)) {
					text += chunk.text
				} else if (chunk.type === "usage") {
					usage = {
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						...(chunk.cacheReadTokens ? { cacheReadTokens: chunk.cacheReadTokens } : {}),
					}
				}
			}

			return { text, usage }
		} catch (error) {
			const errorModel = this.getModel()
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, errorModel.id, "completePrompt")
			TelemetryService.instance.captureException(apiError)

			throw handleProviderError(error, this.providerName, {
				messageTransformer: (msg) => t("common:errors.openAiCodex.completionError", { message: msg }),
			})
		}
	}
}
