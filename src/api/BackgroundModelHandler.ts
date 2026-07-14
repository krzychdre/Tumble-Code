import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { ApiHandler, ApiHandlerCreateMessageMetadata } from "./index"
import { ApiStream, ApiStreamChunk } from "./transform/stream"
import { isRetryableApiError } from "./apiErrors"

/**
 * Error classification for background→foreground fallback decisions. A trigger
 * error is a condition under which the background model is unlikely to serve
 * the current call (outage, misconfigured credentials, payload it rejects) and
 * the foreground model should take over. Non-trigger errors (aborts,
 * programmer errors) propagate unchanged so cancellations and bugs are not
 * silently retried.
 *
 * Layered on top of {@linkcode isRetryableApiError} (shared with
 * `RetryHandler.shouldRetry`): transient server/network errors are always
 * fallback triggers, and on top of those we add conditions that warrant
 * switching handlers specifically (auth, payload-rejection).
 */
export function isFallbackTriggerError(error: unknown): boolean {
	if (error == null) return false

	// Transient server-side / network conditions → retry or fall back.
	if (isRetryableApiError(error)) return true

	const e = error as any

	// Auth / invalid credentials — the background profile is misconfigured;
	// fall back rather than surface a 401/403 to the user inside a condense.
	// (These are NOT in isRetryableApiError because retrying the SAME handler
	// won't help — but a DIFFERENT handler may have valid creds.)
	if (e.status === 401 || e.status === 403) return true

	// 400 — the background model rejected the payload. This is exactly the
	// "cheap small model for compaction" failure mode the feature targets:
	// a vision-foreground + text-only-background config sends image blocks the
	// background rejects, and a payload sized for the foreground's 200k window
	// blows an 8k background window → context_length_exceeded. Both surface as
	// 400, which is not retryable on the same handler but IS worth one attempt
	// on the foreground (which can accept the payload). Without this, a
	// mismatched config fails every condense until the circuit breaker trips.
	if (e.status === 400) return true

	return false
}

/** Stage at which a fallback event occurred. */
export type FallbackStage = "createMessage" | "countTokens" | "getModel"

/** Sink for fallback events (telemetry/log). Optional. */
export type FallbackSink = (reason: { stage: FallbackStage; error: unknown }) => void

export interface BackgroundModelHandlerOptions {
	/**
	 * The preferred background handler. If undefined, the wrapper is a
	 * passthrough to {@linkcode BackgroundModelHandlerOptions.fallback}.
	 */
	background?: ApiHandler
	/**
	 * The main task handler — always present. Used when background is absent or
	 * fails. Also the source of model/token math when no background is set.
	 */
	fallback: ApiHandler
	/** Sink for fallback events (telemetry/log). Optional. */
	onFallback?: FallbackSink
}

/**
 * A reusable {@link ApiHandler} wrapper that prefers a configured background
 * handler and, on a triggering error, retries the same call on the fallback
 * (main) handler.
 *
 * Mid-stream fallback: real providers implement `async *createMessage`, so
 * errors surface at the first `next()` inside the consumer's `for await` —
 * NOT at `createMessage` call time. This wrapper therefore buffers the
 * background stream: it consumes the background stream eagerly and, if a
 * trigger error surfaces mid-flight, discards the partial output and replays
 * the producer against the fallback. The consumer sees a single seamless
 * stream and never observes the partial background output or the fallback
 * switch. This means every consumer of the wrapper gets fallback for free —
 * no bespoke retry needed in the integration layer.
 *
 * Model/token math: `getModel()` / `countTokens()` report the handler that
 * will actually serve the call. When a background handler is configured they
 * report the BACKGROUND model, so payload sizing (context window) and
 * capability checks (`supportsImages`) match the model that receives the
 * request — preventing the "payload sized for 200k sent to an 8k model" and
 * "image blocks sent to a text-only model" failure modes. When no background
 * is configured (passthrough) they report the fallback, matching prior
 * behavior. See `ai_plans/2026-07-13_background-model-for-compaction-memory.md`.
 */
export class BackgroundModelHandler implements ApiHandler {
	private readonly bg?: ApiHandler
	private readonly fb: ApiHandler
	private readonly onFallback?: FallbackSink

	constructor(opts: BackgroundModelHandlerOptions) {
		this.bg = opts.background
		this.fb = opts.fallback
		this.onFallback = opts.onFallback
	}

	/**
	 * The underlying fallback (main) handler. Exposed for diagnostics and tests;
	 * production code should call `createMessage` and let the wrapper handle
	 * fallback internally.
	 */
	get fallback(): ApiHandler {
		return this.fb
	}

	/**
	 * The configured background handler, if any. Exposed for diagnostics and
	 * tests; production code should call `createMessage` and let the wrapper
	 * decide which handler to use.
	 */
	get background(): ApiHandler | undefined {
		return this.bg
	}

	getModel(): { id: string; info: ModelInfo } {
		// Report the handler that will actually serve the call so payload
		// sizing (context window) and capability checks (supportsImages) match
		// the model that receives the request. When a background handler is
		// configured it is the primary; the fallback is only used on a trigger
		// error, at which point the foreground's larger window / broader
		// capabilities can still accept the payload. Passthrough (no
		// background) reports the fallback, matching prior behavior.
		return (this.bg ?? this.fb).getModel()
	}

	async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Token counting must be consistent with the model that serves the
		// call (see getModel). Use the primary handler (background when
		// configured, fallback otherwise). A background model with a different
		// tokenizer is exactly the point — its count is what matters for its
		// own window. On fallback the foreground re-counts for its window.
		return (this.bg ?? this.fb).countTokens(content)
	}

	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Passthrough: no background configured → use the fallback directly.
		if (!this.bg) return this.fb.createMessage(systemPrompt, messages, metadata)
		// Buffered fallback: consume the background stream eagerly; on a
		// mid-stream trigger error, discard the partial output and replay the
		// producer against the fallback. The consumer sees one seamless stream.
		return this.createMessageWithFallback(systemPrompt, messages, metadata)
	}

	/**
	 * Eagerly buffer the background stream into an in-memory array. If
	 * consumption completes without a trigger error, replay the buffered
	 * chunks as the returned stream. If a trigger error surfaces mid-flight
	 * (at any `next()`), discard the buffer, fire `onFallback`, and replay the
	 * producer against the fallback handler — the returned stream is then the
	 * fallback's complete output. Non-trigger errors (aborts, programmer
	 * errors) re-throw so cancellations and bugs are not silently retried.
	 *
	 * Condense and memory extraction do not consume the stream incrementally
	 * (they accumulate the full summary before doing anything with it), so
	 * buffering the whole background stream has no behavioral cost and is what
	 * enables seamless mid-stream fallback.
	 */
	private async *createMessageWithFallback(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata: ApiHandlerCreateMessageMetadata | undefined,
	): ApiStream {
		let buffer: ApiStreamChunk[] = []
		let usedFallback = false
		// Spend of the discarded background attempt. Providers may emit usage
		// mid-stream (Anthropic's message_delta is cumulative), so a failed
		// attempt can carry real billed cost that must not vanish with the
		// buffer — it is folded into the fallback stream's usage below so the
		// consumer's cost accounting covers both attempts.
		let discardedCost = 0
		try {
			for await (const chunk of this.bg!.createMessage(systemPrompt, messages, metadata)) {
				buffer.push(chunk)
			}
		} catch (error) {
			if (isFallbackTriggerError(error)) {
				this.onFallback?.({ stage: "createMessage", error })
				// Discard the partial background output, keeping its cost.
				for (const chunk of buffer) {
					if (chunk.type === "usage") discardedCost = chunk.totalCost ?? discardedCost
				}
				buffer = []
				usedFallback = true
			} else {
				// Non-trigger: propagate (abort / programmer error / genuine
				// foreground-class failure on a passthrough).
				throw error
			}
		}
		if (usedFallback) {
			// Replay the producer against the fallback. Errors here propagate
			// (the foreground is the last resort — no further fallback).
			let usageSeen = false
			for await (const chunk of this.fb.createMessage(systemPrompt, messages, metadata)) {
				if (chunk.type === "usage" && discardedCost > 0) {
					// Usage totals are cumulative per stream; adding the failed
					// background attempt's cost to each keeps the LAST chunk —
					// which consumers treat as the call's total — correct.
					usageSeen = true
					yield { ...chunk, totalCost: (chunk.totalCost ?? 0) + discardedCost }
				} else {
					if (chunk.type === "usage") usageSeen = true
					yield chunk
				}
			}
			if (!usageSeen && discardedCost > 0) {
				// Fallback emitted no usage at all — surface the background
				// spend as a synthetic usage chunk so it is still accounted.
				yield { type: "usage", inputTokens: 0, outputTokens: 0, totalCost: discardedCost }
			}
		} else {
			// Background succeeded: replay the buffer.
			for (const chunk of buffer) yield chunk
		}
	}

	cancelRequest?(destroyClient?: boolean): void {
		this.bg?.cancelRequest?.(destroyClient)
		this.fb.cancelRequest?.(destroyClient)
	}
}
