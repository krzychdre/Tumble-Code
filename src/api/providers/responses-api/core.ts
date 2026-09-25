import { type ModelInfo, type ServiceTier, ApiProviderError } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiStream, ApiStreamUsageChunk } from "../../transform/stream"
import { handleProviderError } from "../utils/error-handler"
import { isSdkUnusableError } from "../utils/responses-sse-fallback"
import { createRequestAbortController } from "../utils/request-abort"

/**
 * The token counts of one usage report, as read from the Responses API usage block.
 */
export interface ResponsesApiUsageTokens {
	/** Total input, cache reads and writes included. */
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

/**
 * The texts a handler shows for failures of the fetch fallback and of the SSE stream.
 * OpenAI Native has English texts, Codex translated ones.
 */
export interface ResponsesApiErrorTexts {
	/** A refused request, by HTTP status; the server's reason is appended. */
	httpError(status: number): string
	noResponseBody: string
	/**
	 * Words every text of this handler contains. A fallback error whose message contains
	 * them is already the handler's own text and is not wrapped a second time.
	 */
	ownTextMarker: string
	connectionFailed(message: string): string
	unexpectedConnectionError: string
	/** An `error` event in the stream. */
	streamErrorEvent(message: string): string
	/** A `response.failed` event in the stream. */
	responseFailed(message: string): string
	streamProcessingError(message: string): string
	unexpectedStreamError: string
}

export interface ResponsesApiCoreOptions {
	providerName: string
	texts: ResponsesApiErrorTexts
	/**
	 * The price of one usage report. `serviceTier` is the tier the server says it used, when
	 * it says so. Returning undefined leaves `totalCost` out of the usage chunk, so the task
	 * prices the tokens itself.
	 */
	totalCost(
		tokens: ResponsesApiUsageTokens,
		info: ModelInfo,
		serviceTier: ServiceTier | undefined,
	): number | undefined
}

export interface ResponsesApiFallbackRequest {
	url: string
	/** Sent after Content-Type; they carry the authorization. */
	headers: Record<string, string>
	body: unknown
}

export interface ResponsesApiStreamParams {
	body: unknown
	modelId: string
	info: ModelInfo
	/** The task's signal for this request (metadata.signal); Stop aborts it. */
	signal?: AbortSignal
	/** Starts the request through the openai SDK. */
	openSdkStream(body: unknown, signal: AbortSignal): Promise<unknown>
	/** The same request for a plain fetch, used only when the SDK cannot be used at all. */
	fallbackRequest(): Promise<ResponsesApiFallbackRequest>
}

/**
 * Event types the shared processor ({@link ResponsesApiCore.processEvent}) handles. The SSE
 * fallback hands them to it; other events get the fallback-only handling.
 */
const PROCESSED_EVENT_TYPES = new Set<string>([
	"response.text.delta",
	"response.output_text.delta",
	"response.text.done",
	"response.output_text.done",
	"response.content_part.added",
	"response.content_part.done",
	"response.reasoning.delta",
	"response.reasoning_text.delta",
	"response.reasoning_summary.delta",
	"response.reasoning_summary_text.delta",
	"response.refusal.delta",
	"response.output_item.added",
	"response.output_item.done",
	"response.done",
	"response.completed",
	"response.tool_call_arguments.delta",
	"response.function_call_arguments.delta",
	"response.tool_call_arguments.done",
	"response.function_call_arguments.done",
])

/**
 * Status events of the SSE fallback that carry nothing to show. Without the list their
 * fields (for example `item.text`) would be taken for answer text by the fallbacks below.
 */
const IGNORED_SSE_EVENT_TYPES = new Set<string>([
	"response.reasoning.done",
	"response.reasoning_text.done",
	"response.reasoning_summary.done",
	"response.reasoning_summary_text.done",
	"response.refusal.done",
	"response.audio.delta",
	"response.audio.done",
	"response.audio_transcript.done",
	"response.mcp_call_arguments.delta",
	"response.mcp_call_arguments.done",
	"response.mcp_call.in_progress",
	"response.mcp_call.completed",
	"response.mcp_call.failed",
	"response.mcp_list_tools.in_progress",
	"response.mcp_list_tools.completed",
	"response.mcp_list_tools.failed",
	"response.web_search_call.searching",
	"response.web_search_call.in_progress",
	"response.web_search_call.completed",
	"response.code_interpreter_call_code.delta",
	"response.code_interpreter_call_code.done",
	"response.code_interpreter_call.interpreting",
	"response.code_interpreter_call.in_progress",
	"response.code_interpreter_call.completed",
	"response.file_search_call.searching",
	"response.file_search_call.in_progress",
	"response.file_search_call.completed",
	"response.image_gen_call.generating",
	"response.image_gen_call.in_progress",
	"response.image_gen_call.partial_image",
	"response.image_gen_call.completed",
	"response.computer_tool_call.output_item",
	"response.computer_tool_call.output_screenshot",
	"response.output_text_annotation.added",
	"response.text_annotation.added",
	"response.incomplete",
	"response.queued",
	"response.in_progress",
	"response.created",
])

/**
 * A refusal is streamed as text so the chat shows why the model declined. Codex's one-shot
 * completion recognizes (and drops) refusals by this prefix.
 */
export const REFUSAL_TEXT_PREFIX = "[Refusal] "

/**
 * The OpenAI Responses API plumbing shared by the handlers that speak it: the event
 * processor, the SSE parser of the fetch fallback, the usage normalizer and the
 * SDK-then-fetch request flow. It keeps the state of the response being streamed (the
 * output items, the response id, the tool call whose arguments are streaming) and the
 * abort controller of the request in flight.
 *
 * Handlers keep what differs: authentication (Codex refreshes an OAuth token and retries),
 * the request body settings and the price of the tokens (OpenAI Native's service tiers).
 */
export class ResponsesApiCore {
	private lastServiceTier: ServiceTier | undefined
	// Complete output array of the last response (includes reasoning items with encrypted_content).
	private lastResponseOutput: any[] | undefined
	private lastResponseId: string | undefined
	/**
	 * Some streams emit tool-call argument deltas without a stable call id or name. The last
	 * tool identity seen in an output_item event is used for them, so tool-call-only streams
	 * still produce `tool_call_partial` chunks.
	 */
	private pendingToolCallId: string | undefined
	private pendingToolCallName: string | undefined
	// This response already emitted text: a done event must not repeat it.
	private sawTextOutput = false
	// Text arrived through delta events: content_part events are then fallback-only.
	private sawTextDelta = false
	// Tool call ids streamed as partials: a done event must not emit them again.
	private streamedToolCallIds = new Set<string>()
	/**
	 * The SDK stream produced an event. From then on the service has accepted the request
	 * and its output is with the caller, so neither the SSE fallback nor a retry may send it
	 * again: that would append a second generation to the first.
	 */
	private sawSdkEventInResponse = false
	private abortController: AbortController | undefined

	constructor(private readonly options: ResponsesApiCoreOptions) {}

	/** Forgets the previous response. Call once per message, before the first attempt. */
	startResponse(): void {
		this.lastServiceTier = undefined
		this.lastResponseOutput = undefined
		this.lastResponseId = undefined
		this.pendingToolCallId = undefined
		this.pendingToolCallName = undefined
		this.sawTextOutput = false
		this.sawTextDelta = false
		this.sawSdkEventInResponse = false
		this.streamedToolCallIds.clear()
	}

	get sawSdkEvent(): boolean {
		return this.sawSdkEventInResponse
	}

	getResponseId(): string | undefined {
		return this.lastResponseId
	}

	/**
	 * The encrypted_content and id of the first reasoning item of the last response: the
	 * minimal data needed to continue the conversation statelessly.
	 */
	getEncryptedContent(): { encrypted_content: string; id?: string } | undefined {
		if (!this.lastResponseOutput) return undefined

		const reasoningItem = this.lastResponseOutput.find(
			(item) => item.type === "reasoning" && item.encrypted_content,
		)
		if (!reasoningItem?.encrypted_content) return undefined

		return {
			encrypted_content: reasoningItem.encrypted_content,
			...(reasoningItem.id ? { id: reasoningItem.id } : {}),
		}
	}

	/**
	 * Registers the abort controller of a new request (the one `cancel` aborts). It also
	 * aborts with the task's signal, which stays with this request even when another request
	 * of the same handler registers its own controller.
	 */
	openRequest(taskSignal?: AbortSignal): AbortController {
		const controller = createRequestAbortController(taskSignal)
		this.abortController = controller
		return controller
	}

	/** Forgets the abort controller: the given one only if it is still current, or any. */
	closeRequest(controller?: AbortController): void {
		if (!controller || this.abortController === controller) {
			this.abortController = undefined
		}
	}

	/** Cancels the request in flight (the Stop button). */
	cancel(): void {
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = undefined
		}
	}

	/** Reads a Responses API usage block (Chat Completions and Anthropic names accepted). */
	normalizeUsage(usage: any, info: ModelInfo): ApiStreamUsageChunk | undefined {
		if (!usage) return undefined

		const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details

		const cachedFromDetails = typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens : 0
		const missFromDetails = typeof inputDetails?.cache_miss_tokens === "number" ? inputDetails.cache_miss_tokens : 0
		// GPT-5.6+ report billed cache writes only here (1.25x input rate).
		const writesFromDetails =
			typeof inputDetails?.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0

		// Derive the input total from the details when it is missing.
		let totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		if (
			totalInputTokens === 0 &&
			inputDetails &&
			(cachedFromDetails > 0 || missFromDetails > 0 || writesFromDetails > 0)
		) {
			totalInputTokens = cachedFromDetails + missFromDetails + writesFromDetails
		}

		const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0

		// Cache misses are part of the input, not writes, so they never count as writes.
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? writesFromDetails
		const cacheReadTokens =
			usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? cachedFromDetails ?? 0

		const totalCost = this.options.totalCost(
			{ inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cacheWriteTokens, cacheReadTokens },
			info,
			this.lastServiceTier,
		)

		const reasoningTokens =
			typeof usage.output_tokens_details?.reasoning_tokens === "number"
				? usage.output_tokens_details.reasoning_tokens
				: undefined

		return {
			type: "usage",
			// Total input, so the context length stays right.
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
			...(typeof totalCost === "number" ? { totalCost } : {}),
		}
	}

	/**
	 * Sends the request through the openai SDK and streams its events. Only when the SDK
	 * cannot be used at all (see isSdkUnusableError) is the same request sent once more
	 * through a plain fetch; never after the request was cancelled or the stream produced an
	 * event, and never when the server answered (DEF-C44).
	 */
	async *streamRequest(params: ResponsesApiStreamParams): ApiStream {
		const abortController = this.openRequest(params.signal)

		try {
			try {
				const stream = await params.openSdkStream(params.body, abortController.signal)

				if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
					throw new Error(
						"OpenAI SDK did not return an AsyncIterable for Responses API streaming. Falling back to SSE.",
					)
				}

				for await (const event of stream as AsyncIterable<any>) {
					if (abortController.signal.aborted) {
						break
					}

					// Set before the event is processed: a throw from processing must not
					// replay the request either.
					this.sawSdkEventInResponse = true

					yield* this.processEvent(event, params.info)
				}
			} catch (sdkErr) {
				if (abortController.signal.aborted || this.sawSdkEventInResponse || !isSdkUnusableError(sdkErr)) {
					throw sdkErr
				}
				yield* this.fetchSse(
					await params.fallbackRequest(),
					params.modelId,
					params.info,
					abortController.signal,
				)
			}
		} finally {
			this.closeRequest(abortController)
		}
	}

	/** The plain-fetch fallback: sends the request and parses the SSE answer. */
	private async *fetchSse(
		request: ResponsesApiFallbackRequest,
		modelId: string,
		info: ModelInfo,
		signal: AbortSignal,
	): ApiStream {
		const { texts, providerName } = this.options

		try {
			const response = await fetch(request.url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...request.headers },
				body: JSON.stringify(request.body),
				signal,
			})

			if (!response.ok) {
				const errorText = await response.text()

				let errorDetails = ""
				try {
					const errorJson = JSON.parse(errorText)
					errorDetails = errorJson.error?.message || errorJson.message || errorJson.detail || errorText
				} catch {
					errorDetails = errorText
				}

				let errorMessage = texts.httpError(response.status)
				if (errorDetails) {
					errorMessage += ` - ${errorDetails}`
				}

				// The status travels on the error for the retry loop and the background-model fallback.
				throw Object.assign(new Error(errorMessage), { status: response.status })
			}

			if (!response.body) {
				throw new Error(texts.noResponseBody)
			}

			yield* this.readSse(response.body, modelId, info, signal)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			TelemetryService.instance.captureException(
				new ApiProviderError(errorMessage, providerName, modelId, "createMessage"),
			)

			// Already this handler's own text.
			if (error instanceof Error && error.message.includes(texts.ownTextMarker)) {
				throw error
			}
			// Otherwise wrapped with context, keeping the HTTP status.
			throw handleProviderError(error, providerName, {
				messageTransformer: (msg) =>
					error instanceof Error ? texts.connectionFailed(msg) : texts.unexpectedConnectionError,
			})
		}
	}

	/** Parses an SSE body (`data:` lines of JSON events, or bare JSON lines) into chunks. */
	private async *readSse(
		body: ReadableStream<Uint8Array>,
		modelId: string,
		info: ModelInfo,
		signal: AbortSignal,
	): ApiStream {
		const { texts, providerName } = this.options
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				if (signal.aborted) {
					break
				}

				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							continue
						}

						let parsed: any
						try {
							parsed = JSON.parse(data)
						} catch {
							// Not JSON: skipped.
							continue
						}
						yield* this.processSseEvent(parsed, info)
					} else if (line.trim() && !line.startsWith(":")) {
						// A bare JSON line: take its text from the usual places.
						try {
							const parsed = JSON.parse(line)
							if (parsed.content || parsed.text || parsed.message) {
								this.sawTextOutput = true
								yield { type: "text", text: parsed.content || parsed.text || parsed.message }
							}
						} catch {
							// Not JSON: ignored.
						}
					}
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			TelemetryService.instance.captureException(
				new ApiProviderError(errorMessage, providerName, modelId, "createMessage"),
			)

			throw handleProviderError(error, providerName, {
				messageTransformer: (msg) =>
					error instanceof Error ? texts.streamProcessingError(msg) : texts.unexpectedStreamError,
			})
		} finally {
			reader.releaseLock()
		}
	}

	/** One event of the SSE fallback. */
	private async *processSseEvent(parsed: any, info: ModelInfo): ApiStream {
		const { texts } = this.options

		this.captureResponse(parsed)

		if (parsed?.type && PROCESSED_EVENT_TYPES.has(parsed.type)) {
			yield* this.processEvent(parsed, info)
			return
		}

		// A complete (non-streaming) response in one event.
		if (parsed.response && Array.isArray(parsed.response.output)) {
			for (const outputItem of parsed.response.output) {
				if (outputItem.type === "text" && outputItem.content) {
					for (const content of outputItem.content) {
						if (content.type === "text" && content.text) {
							this.sawTextOutput = true
							yield { type: "text", text: content.text }
						}
					}
				}
				if (outputItem.type === "reasoning" && Array.isArray(outputItem.summary)) {
					for (const summary of outputItem.summary) {
						if (summary?.type === "summary_text" && typeof summary.text === "string") {
							yield { type: "reasoning", text: summary.text }
						}
					}
				}
			}
			if (parsed.response.usage) {
				const usageData = this.normalizeUsage(parsed.response.usage, info)
				if (usageData) {
					yield usageData
				}
			}
			return
		}

		if (parsed.type === "response.audio_transcript.delta") {
			if (parsed.delta) {
				this.sawTextOutput = true
				yield { type: "text", text: parsed.delta }
			}
			return
		}

		if (parsed.type === "response.error" || parsed.type === "error") {
			if (parsed.error || parsed.message) {
				throw new Error(texts.streamErrorEvent(parsed.error?.message || parsed.message || "Unknown error"))
			}
			return
		}

		if (parsed.type === "response.failed") {
			if (parsed.error || parsed.message) {
				throw new Error(texts.responseFailed(parsed.error?.message || parsed.message || "Unknown failure"))
			}
			return
		}

		if (IGNORED_SSE_EVENT_TYPES.has(parsed.type)) {
			return
		}

		// Fallbacks for older formats or unexpected events.
		if (parsed.choices?.[0]?.delta?.content) {
			this.sawTextOutput = true
			yield { type: "text", text: parsed.choices[0].delta.content }
		} else if (parsed.item && typeof parsed.item.text === "string" && parsed.item.text.length > 0) {
			this.sawTextOutput = true
			yield { type: "text", text: parsed.item.text }
		} else if (parsed.usage) {
			const usageData = this.normalizeUsage(parsed.usage, info)
			if (usageData) {
				yield usageData
			}
		}
	}

	/** Keeps the service tier, output items and id a response event carries. */
	private captureResponse(event: any): void {
		if (event?.response?.service_tier) {
			this.lastServiceTier = event.response.service_tier as ServiceTier
		}
		if (event?.response?.output && Array.isArray(event.response.output)) {
			this.lastResponseOutput = event.response.output
		}
		if (event?.response?.id) {
			this.lastResponseId = event.response.id as string
		}
	}

	/**
	 * Turns one Responses API event into chunks. Text can arrive as deltas, as done events,
	 * as content parts, as output items or only in the final response; each later form is
	 * used only when no earlier one produced text, so nothing is shown twice.
	 */
	async *processEvent(event: any, info: ModelInfo): ApiStream {
		this.captureResponse(event)

		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				this.sawTextDelta = true
				this.sawTextOutput = true
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Done-only text, for variants that skip the delta events.
		if (event?.type === "response.text.done" || event?.type === "response.output_text.done") {
			const doneText =
				typeof event?.text === "string"
					? event.text
					: typeof event?.output_text === "string"
						? event.output_text
						: typeof event?.delta === "string"
							? event.delta
							: undefined
			if (!this.sawTextOutput && doneText) {
				this.sawTextOutput = true
				yield { type: "text", text: doneText }
			}
			return
		}

		// Content-part text, for structured streaming payloads.
		if (event?.type === "response.content_part.added" || event?.type === "response.content_part.done") {
			const part = event?.part
			if (
				!this.sawTextDelta &&
				(part?.type === "text" || part?.type === "output_text") &&
				(typeof part?.text === "string" || typeof part?.text?.value === "string")
			) {
				const partText = typeof part.text === "string" ? part.text : part.text.value
				if (partText) {
					this.sawTextOutput = true
					yield { type: "text", text: partText }
				}
			}
			return
		}

		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", text: event.delta }
			}
			return
		}

		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				this.sawTextOutput = true
				yield { type: "text", text: `${REFUSAL_TEXT_PREFIX}${event.delta}` }
			}
			return
		}

		if (
			event?.type === "response.tool_call_arguments.delta" ||
			event?.type === "response.function_call_arguments.delta"
		) {
			// Deltas without a stable identity use the last one seen in an output_item event.
			const callId = event.call_id || event.tool_call_id || event.id || this.pendingToolCallId
			const name = event.name || event.function_name || this.pendingToolCallName
			const args = event.delta || event.arguments

			// NativeToolCallParser needs a name to start a call: no incomplete partials.
			if (typeof callId === "string" && callId.length > 0 && typeof name === "string" && name.length > 0) {
				this.streamedToolCallIds.add(callId)
				yield {
					type: "tool_call_partial",
					index: event.index ?? 0,
					id: callId,
					name,
					arguments: typeof args === "string" ? args : "",
				}
			}
			return
		}

		// NativeToolCallParser completes streamed calls itself.
		if (
			event?.type === "response.tool_call_arguments.done" ||
			event?.type === "response.function_call_arguments.done"
		) {
			return
		}

		if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
			const item = event?.item
			if (item) {
				// Remember the tool identity so the argument deltas that follow can be attributed.
				if (item.type === "function_call" || item.type === "tool_call") {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name || item.function?.name || item.function_name
					if (typeof callId === "string" && callId.length > 0) {
						this.pendingToolCallId = callId
						this.pendingToolCallName = typeof name === "string" ? name : undefined
					}
				}

				if (event.type === "response.output_item.added") {
					if ((item.type === "text" || item.type === "output_text") && item.text) {
						this.sawTextOutput = true
						yield { type: "text", text: item.text }
					} else if (item.type === "reasoning" && item.text) {
						yield { type: "reasoning", text: item.text }
					} else if (item.type === "message" && Array.isArray(item.content)) {
						for (const content of item.content) {
							// Some implementations send 'text', others 'output_text'.
							if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
								this.sawTextOutput = true
								yield { type: "text", text: content.text }
							}
						}
					}
				} else if (item.type === "function_call" || item.type === "tool_call") {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name || item.function?.name || item.function_name
					const argsRaw = item.arguments || item.function?.arguments || item.input
					const args =
						typeof argsRaw === "string"
							? argsRaw
							: argsRaw && typeof argsRaw === "object"
								? JSON.stringify(argsRaw)
								: ""

					// For models that send a function call only complete, in output_item.done.
					// A call already streamed as partials is not emitted again (it would run twice).
					if (
						typeof callId === "string" &&
						callId.length > 0 &&
						typeof name === "string" &&
						name.length > 0 &&
						!this.streamedToolCallIds.has(callId)
					) {
						yield { type: "tool_call", id: callId, name, arguments: args }
					}
				} else if (!this.sawTextOutput) {
					// Some models send the assistant text only in the done event.
					if ((item.type === "text" || item.type === "output_text") && item.text) {
						this.sawTextOutput = true
						yield { type: "text", text: item.text }
					} else if (item.type === "message" && Array.isArray(item.content)) {
						for (const content of item.content) {
							if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
								this.sawTextOutput = true
								yield { type: "text", text: content.text }
							}
						}
					}
				}
			}
			return
		}

		if (event?.type === "response.done" || event?.type === "response.completed") {
			// Some variants send the assistant text only in the final payload.
			if (!this.sawTextOutput && Array.isArray(event?.response?.output)) {
				for (const outputItem of event.response.output) {
					if ((outputItem?.type === "text" || outputItem?.type === "output_text") && outputItem?.text) {
						this.sawTextOutput = true
						yield { type: "text", text: outputItem.text }
						continue
					}

					if (outputItem?.type === "message" && Array.isArray(outputItem.content)) {
						for (const content of outputItem.content) {
							if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
								this.sawTextOutput = true
								yield { type: "text", text: content.text }
							}
						}
					}
				}
			}

			const usageData = this.normalizeUsage(event?.response?.usage || event?.usage || undefined, info)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for older formats or unexpected objects.
		if (event?.choices?.[0]?.delta?.content) {
			this.sawTextDelta = true
			this.sawTextOutput = true
			yield { type: "text", text: event.choices[0].delta.content }
			return
		}

		if (event?.usage) {
			const usageData = this.normalizeUsage(event.usage, info)
			if (usageData) {
				yield usageData
			}
		}
	}
}
