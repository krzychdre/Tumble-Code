import type { EmbedderProvider } from "@roo-code/types"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { IEmbedder, EmbeddingResponse, EmbedderInfo, EmbedderValidationResult } from "../interfaces/embedder"
import { MAX_BATCH_TOKENS, MAX_ITEM_TOKENS, MAX_BATCH_RETRIES, INITIAL_RETRY_DELAY_MS } from "../constants"
import { getModelQueryPrefix } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import {
	withValidationErrorHandling,
	formatEmbeddingError,
	sanitizeErrorMessage,
	measureEmbeddingDimension,
	HttpError,
} from "../shared/validation-helpers"
import { rateLimitGateFor } from "./rate-limit-gate"

/** What one request to the embedding backend returned: one vector per input, in input order. */
export interface EmbedBatchResult {
	embeddings: number[][]
	usage?: { promptTokens: number; totalTokens: number }
}

interface BaseHttpEmbedderOptions {
	/** Model used when a call does not name one. */
	defaultModelId: string
	/** Largest single input, in estimated tokens (defaults to MAX_ITEM_TOKENS). */
	maxItemTokens?: number
	/** Which provider table of EMBEDDING_MODEL_PROFILES holds the model's query prefix. */
	queryPrefixProvider: EmbedderProvider
	/** Identifies the endpoint for the shared 429 backoff (usually the base URL). */
	rateLimitKey: string
	/** Whether responses carry token usage; when false, results have no `usage` field. */
	reportsUsage?: boolean
}

/** Rough token estimate used for batching: four characters per token. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

/**
 * Turns one `embedding` field of an OpenAI-style response into a vector. OpenAI-compatible
 * requests ask for base64 (the SDK's float parser once truncated long vectors), so a string
 * is four-byte little-endian floats.
 */
export function decodeEmbedding(embedding: string | number[]): number[] {
	if (typeof embedding !== "string") {
		return embedding
	}
	const buffer = Buffer.from(embedding, "base64")
	return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4))
}

/**
 * Shared behavior of every code-index embedder. A subclass only says how one batch reaches
 * its backend (`embedBatch`); this class owns the rest, identically for all of them:
 *
 * - the model's query prefix, skipped when it would push an input over the item limit
 * - inputs over the item limit are cut to it (never dropped, so vector i always belongs
 *   to input i; callers pair vectors with code blocks by position)
 * - batching under MAX_BATCH_TOKENS, keeping input order
 * - retry: a rate-limited batch is tried MAX_BATCH_RETRIES times, waiting the larger of
 *   exponential backoff and the endpoint's shared backoff; any other error fails at once
 * - a response with a missing or extra vector fails instead of misaligning the rest
 * - one telemetry event per failed call, none for a retry that later succeeds
 * - validation with a one-item probe that reports the model's dimension
 */
export abstract class BaseHttpEmbedder implements IEmbedder {
	protected readonly defaultModelId: string
	protected readonly maxItemTokens: number
	private readonly queryPrefixProvider: EmbedderProvider
	private readonly rateLimitKey: string
	private readonly reportsUsage: boolean

	protected constructor(options: BaseHttpEmbedderOptions) {
		this.defaultModelId = options.defaultModelId
		this.maxItemTokens = options.maxItemTokens || MAX_ITEM_TOKENS
		this.queryPrefixProvider = options.queryPrefixProvider
		this.rateLimitKey = options.rateLimitKey
		this.reportsUsage = options.reportsUsage ?? true
	}

	abstract get embedderInfo(): EmbedderInfo

	/** Name used in telemetry locations and logs, e.g. "OpenAICompatibleEmbedder". */
	protected abstract get telemetryName(): string

	/** Sends one batch to the backend. Must return one vector per text, in order. */
	protected abstract embedBatch(texts: string[], model: string): Promise<EmbedBatchResult>

	/** Whether an error means "slow down" and the batch should be retried. */
	protected isRateLimitError(error: unknown): boolean {
		return (error as HttpError | undefined)?.status === 429
	}

	/** Turns the final error of a failed call into the message the user sees. */
	protected formatError(error: unknown): Error {
		return formatEmbeddingError(error, MAX_BATCH_RETRIES)
	}

	/** Message for a validation probe that came back without a vector. */
	protected invalidResponseMessage(): string {
		return t("embeddings:validation.invalidResponse")
	}

	/**
	 * Lets a subclass map a validation error it recognizes (for example a cloud SDK's
	 * credential error) to a result, without telemetry. Undefined means "not recognized".
	 */
	protected describeValidationError(_error: unknown): EmbedderValidationResult | undefined {
		return undefined
	}

	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.defaultModelId
		const prepared = this.prepareTexts(texts, modelToUse)

		const embeddings: number[][] = []
		const usage = this.reportsUsage ? { promptTokens: 0, totalTokens: 0 } : undefined

		for (const batch of this.splitIntoBatches(prepared)) {
			const result = await this.embedBatchWithRetries(batch, modelToUse)
			embeddings.push(...result.embeddings)
			if (usage && result.usage) {
				usage.promptTokens += result.usage.promptTokens
				usage.totalTokens += result.usage.totalTokens
			}
		}

		return usage ? { embeddings, usage } : { embeddings }
	}

	async validateConfiguration(): Promise<EmbedderValidationResult> {
		return withValidationErrorHandling(async () => {
			try {
				const { embeddings } = await this.embedBatch(["test"], this.defaultModelId)
				const dimension = measureEmbeddingDimension(embeddings?.[0])
				if (dimension === undefined) {
					return { valid: false, error: this.invalidResponseMessage() }
				}
				// Report the probe length so a configured dimension that disagrees is caught here
				return { valid: true, dimension }
			} catch (error) {
				const recognized = this.describeValidationError(error)
				if (recognized) {
					return recognized
				}
				this.captureError(error, "validateConfiguration")
				throw error
			}
		}, this.embedderInfo.name)
	}

	/** Reports one error to telemetry, with URLs, paths and addresses removed. */
	protected captureError(error: unknown, operation: string, attempt?: number): void {
		TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
			error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
			stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
			location: `${this.telemetryName}:${operation}`,
			...(attempt === undefined ? {} : { attempt }),
		})
	}

	private prepareTexts(texts: string[], model: string): string[] {
		const queryPrefix = getModelQueryPrefix(this.queryPrefixProvider, model)

		return texts.map((text, index) => {
			if (queryPrefix && !text.startsWith(queryPrefix)) {
				const prefixed = `${queryPrefix}${text}`
				const estimatedTokens = estimateTokens(prefixed)
				if (estimatedTokens <= this.maxItemTokens) {
					return prefixed
				}
				console.warn(
					t("embeddings:textWithPrefixExceedsTokenLimit", {
						index,
						estimatedTokens,
						maxTokens: this.maxItemTokens,
					}),
				)
			}

			const itemTokens = estimateTokens(text)
			if (itemTokens <= this.maxItemTokens) {
				return text
			}
			console.warn(
				t("embeddings:textTruncatedToTokenLimit", { index, itemTokens, maxTokens: this.maxItemTokens }),
			)
			return text.slice(0, this.maxItemTokens * 4)
		})
	}

	private splitIntoBatches(texts: string[]): string[][] {
		const batches: string[][] = []
		let current: string[] = []
		let currentTokens = 0

		for (const text of texts) {
			const itemTokens = estimateTokens(text)
			if (current.length > 0 && currentTokens + itemTokens > MAX_BATCH_TOKENS) {
				batches.push(current)
				current = []
				currentTokens = 0
			}
			current.push(text)
			currentTokens += itemTokens
		}

		if (current.length > 0) {
			batches.push(current)
		}
		return batches
	}

	private async embedBatchWithRetries(texts: string[], model: string): Promise<EmbedBatchResult> {
		const gate = rateLimitGateFor(this.rateLimitKey)

		for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
			await gate.wait()

			try {
				const result = await this.embedBatch(texts, model)
				const complete =
					result.embeddings?.length === texts.length &&
					result.embeddings.every((vector) => Array.isArray(vector) && vector.length > 0)
				if (!complete) {
					throw new Error(t("embeddings:validation.invalidResponse"))
				}
				return result
			} catch (error) {
				if (this.isRateLimitError(error)) {
					gate.recordRateLimit()
					if (attempt < MAX_BATCH_RETRIES - 1) {
						const delayMs = Math.max(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt), gate.remainingDelay())
						console.warn(
							t("embeddings:rateLimitRetry", {
								delayMs,
								attempt: attempt + 1,
								maxRetries: MAX_BATCH_RETRIES,
							}),
						)
						await new Promise((resolve) => setTimeout(resolve, delayMs))
						continue
					}
				}

				this.captureError(error, "createEmbeddings", attempt + 1)
				console.error(`${this.telemetryName} error (attempt ${attempt + 1}/${MAX_BATCH_RETRIES}):`, error)
				throw this.formatError(error)
			}
		}

		// Unreachable: the last attempt either returns or throws above.
		throw new Error(t("embeddings:failedMaxAttempts", { attempts: MAX_BATCH_RETRIES }))
	}
}
