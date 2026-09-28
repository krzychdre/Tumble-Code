/**
 * RetryHandler - Handles retry logic and exponential backoff
 *
 * This module owns the error→retry decisions for the task loop:
 * what a failed API request becomes (backoff retry, api_req_failed
 * ask, fail-fast, capped-retry task end) and the exponential
 * backoff, rate limit handling, and countdown UX behind the retries.
 * The delay ladder and the countdown loops come from the shared
 * helpers in `@roo-code/core` (D1).
 *
 * Extracted from: TaskApiLoop.ts (Phase 2A refactoring; error
 * dispatch moved in S3, see ai_plans/2026-09-28_s3-taskapiloop-error-dispatch.md)
 */

import delay from "delay"
import { backoffDelayMsNoJitter, countdown } from "@roo-code/core"
import { SETTINGS_DEFAULTS, type ProviderSettings, type ClineApiReqCancelReason } from "@roo-code/types"
import { serializeError } from "serialize-error"
import { type ApiHandler } from "../../api"
import { describeBackgroundApiFailure, getApiErrorStatus, isAutoRetryableApiError } from "../../api/apiErrors"
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskContextManager, MAX_CONTEXT_WINDOW_RETRIES } from "./TaskContextManager"
import { type ClineProvider } from "../webview/ClineProvider"
import { type ProviderState } from "../webview/ProviderStateBuilder"
import type { ApiStream } from "../../api/transform/stream"
import { logger } from "../../utils/logging"

/** The provider-state fields the backoff and rate-limit math read (a full ProviderState fits). */
type BackoffState = Partial<Pick<ProviderState, "apiConfiguration" | "requestDelaySeconds">>

/**
 * Module-level constant for exponential backoff limit
 */
const MAX_EXPONENTIAL_BACKOFF_SECONDS = 600 // 10 minutes

/**
 * Interface for access needed by RetryHandler.
 * This is a narrow interface to minimize coupling.
 */
export interface RetryHandlerAccess {
	// Core identifiers
	taskId: string
	instanceId: string

	// Abort state
	abort: boolean

	// Headless background task (parallel subagent / memory writer). Drives the
	// fail-fast (401/403/404) and capped-retry decisions.
	isBackground: boolean
	// Why a background task ended on a non-retryable API error; written by
	// endBackgroundTaskOnApiError (see Task#apiFailureMessage).
	apiFailureMessage?: string
	abortReason?: ClineApiReqCancelReason

	// API configuration and handler (the handler names the model in the
	// background failure line)
	apiConfiguration: ProviderSettings
	api: ApiHandler

	// Context manager for the context-window-exceeded truncation retry
	// (structural member: only handleContextWindowExceededError is called)
	contextManager: Pick<TaskContextManager, "handleContextWindowExceededError">

	// Provider reference
	providerRef: WeakRef<ClineProvider>

	// Communication
	askSay: TaskAskSay

	// End the task (written reason + failure message, then abort)
	abortTask(): Promise<void>
}

/** The fields of a Google API error that carry a RetryInfo delay on a 429. */
type GoogleRetryInfoError = {
	status?: unknown
	errorDetails?: Array<{ "@type"?: string; retryDelay?: string }>
}

/**
 * The text shown for a failed request: the error's `message`, else the whole
 * error serialized. Like the `any` code it replaces, it reads `message`
 * without a null check.
 */
export function apiErrorDisplayText(error: unknown): string {
	return (error as { message?: string }).message ?? JSON.stringify(serializeError(error), null, 2)
}

/**
 * Thrown out of the first-chunk error dispatch when the user answers the
 * api_req_failed ask with anything but Retry. TaskApiLoop's
 * handleStreamError recognises it and ends the task loop instead of
 * treating it as one more failed request to retry.
 */
class ApiRetryDeclinedError extends Error {
	constructor() {
		super("API request failed")
		this.name = "ApiRetryDeclinedError"
	}
}

/**
 * Retries a background task gets for a retryable API error (400, 5xx, no
 * status) before it ends: 6 backoffs of 5, 10, 20, 40, 80 and 160 s at the
 * default 5 s base (315 s in total), so 7 requests. Foreground tasks have no
 * cap (the user sees the countdown and can cancel). The first-chunk retry
 * recurses inside the request generator and never counts against maxAgentTurns,
 * so without this cap a background task would retry forever.
 *
 * HTTP 429 (too many requests) is not capped (owner decision 2026-09-25): the
 * provider is up and asks us to slow down, so the task keeps backing off (one
 * wait never exceeds MAX_EXPONENTIAL_BACKOFF_SECONDS, 600 s, unless a RetryInfo
 * delay on the 429 asks for more) until the provider answers or the task is
 * aborted. In a mixed sequence a 429 retry does not count toward the cap:
 * the task ends at the 7th failure that is not a 429 (see isCappedRetry).
 */
export const BACKGROUND_MAX_API_RETRIES = 6

/** HTTP 429: the one retryable status a background task retries without a cap. */
export function isRateLimitError(error: unknown): boolean {
	return getApiErrorStatus(error) === 429
}

/**
 * Thrown out of the first-chunk error dispatch when a background task used
 * up BACKGROUND_MAX_API_RETRIES. TaskApiLoop's handleStreamError recognises
 * it and ends the task with the original error and the number of requests
 * made.
 */
class BackgroundRetriesExhaustedError extends Error {
	constructor(
		readonly apiError: unknown,
		readonly attempts: number,
	) {
		// The request row (abortStream) shows this message: keep the provider's.
		const original = apiError instanceof Error ? apiError.message : String(apiError)
		super(`${original} (gave up after ${attempts} attempts)`)
		this.name = "BackgroundRetriesExhaustedError"
	}
}

/**
 * Module-level static for tracking last global API request time.
 * This is shared across all Task instances to enforce rate limiting.
 */
let lastGlobalApiRequestTime: number | undefined

/**
 * Reset the global API request timestamp. For testing only.
 * @internal
 */
export function resetGlobalApiRequestTime(): void {
	lastGlobalApiRequestTime = undefined
}

/**
 * Get the last global API request time (for testing/access)
 */
export function getLastGlobalApiRequestTime(): number | undefined {
	return lastGlobalApiRequestTime
}

/**
 * Set the last global API request time
 */
export function setLastGlobalApiRequestTime(time: number): void {
	lastGlobalApiRequestTime = time
}

/** Re-enters the caller's request generator for an automatic retry. */
export type RetryRequestFn = (
	retryAttempt: number,
	options: { contextAlreadyManaged?: boolean; rateLimitRetries?: number },
) => ApiStream

/**
 * RetryHandler owns the error→retry decisions for API requests: what a
 * failed request becomes (backoff retry, api_req_failed ask, task end) and
 * the exponential backoff/countdown behind the retries.
 */
export class RetryHandler {
	constructor(private readonly access: RetryHandlerAccess) {}

	/**
	 * Seconds left in the user-configured provider rate-limit window, 0 when
	 * the window has passed or no limit is set. One implementation, used by
	 * both the retry backoff and the pre-request wait (D1: was written twice).
	 */
	private providerRateLimitDelaySeconds(state: BackoffState | undefined): number {
		const rateLimit = (state?.apiConfiguration ?? this.access.apiConfiguration)?.rateLimitSeconds || 0
		if (!getLastGlobalApiRequestTime() || rateLimit <= 0) {
			return 0
		}
		const elapsed = performance.now() - getLastGlobalApiRequestTime()!
		return Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
	}

	/**
	 * Calculate the backoff delay for a retry attempt.
	 * @param retryAttempt - The current retry attempt number
	 * @param error - The error that triggered the retry
	 * @param state - The current provider state
	 * @returns The delay in seconds
	 */
	calculateBackoffDelay(retryAttempt: number, error: unknown, state: BackoffState | undefined): number {
		// `||` would mask a user-set 0 (no backoff): `??` keeps it.
		const baseDelay = state?.requestDelaySeconds ?? SETTINGS_DEFAULTS.requestDelaySeconds

		let exponentialDelay = Math.ceil(
			backoffDelayMsNoJitter(retryAttempt, {
				baseMs: baseDelay * 1000,
				capMs: MAX_EXPONENTIAL_BACKOFF_SECONDS * 1000,
			}) / 1000,
		)

		// Respect provider rate limit window
		const rateLimitDelay = this.providerRateLimitDelaySeconds(state)

		// Prefer RetryInfo on 429 if present
		const googleError = error as GoogleRetryInfoError | null | undefined
		if (googleError?.status === 429) {
			const retryInfo = googleError?.errorDetails?.find(
				(d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
			)
			const match = retryInfo?.retryDelay?.match?.(/^(\d+)s$/)
			if (match) {
				exponentialDelay = Number(match[1]) + 1
			}
		}

		return Math.max(exponentialDelay, rateLimitDelay)
	}

	/**
	 * Show countdown UX for retry delay.
	 * @param seconds - Number of seconds to count down
	 * @param headerText - Error text to display
	 */
	async showCountdownUX(seconds: number, headerText: string): Promise<void> {
		await countdown(seconds, {
			onTick: (i) =>
				this.access.askSay.say(
					"api_req_retry_delayed",
					`${headerText}<retry_timer>${i}</retry_timer>`,
					undefined,
					true,
				),
			isAborted: () => this.access.abort,
			abortError: new Error(`[Task#${this.access.taskId}] Aborted during retry countdown`),
			// The specs spy on the `delay` module to count countdown seconds.
			sleep: (ms) => delay(ms),
		})

		await this.access.askSay.say("api_req_retry_delayed", headerText, undefined, false)
	}

	/**
	 * Build error header text for display.
	 * @param error - The error to format
	 * @returns Formatted error text
	 */
	buildErrorHeaderText(error: unknown): string {
		const shown = error as { status?: unknown; message?: string } | null | undefined
		let headerText: string
		if (shown?.status) {
			const errorMessage = shown?.message || "Unknown error"
			headerText = `${shown.status}\n${errorMessage}`
		} else if (shown?.message) {
			headerText = shown.message
		} else {
			headerText = "Unknown error"
		}

		return headerText ? `${headerText}\n` : ""
	}

	/**
	 * Shared exponential backoff for retries with countdown UX.
	 * @param retryAttempt - The current retry attempt number
	 * @param error - The error that triggered the retry
	 */
	async backoffAndAnnounce(retryAttempt: number, error: unknown): Promise<void> {
		try {
			const state = await this.access.providerRef.deref()?.getState()
			const finalDelay = this.calculateBackoffDelay(retryAttempt, error, state)

			if (finalDelay <= 0) {
				return
			}

			// Build header text
			const headerText = this.buildErrorHeaderText(error)

			// Show countdown timer
			await this.showCountdownUX(finalDelay, headerText)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)

			if (this.access.abort && message.includes("Aborted during retry countdown")) {
				return
			}

			console.error("Exponential backoff failed:", err)
		}
	}

	/**
	 * Enforce user-configured provider rate limit.
	 * Shows countdown UX on first attempt, skips on retries.
	 * @param retryAttempt - The current retry attempt number
	 * @param cycleState - The request cycle's state snapshot (P5). The wait
	 *   only reads `rateLimitSeconds` (cycle-stable), so the cycle hands its
	 *   snapshot in; retry re-entries omit it and read live.
	 * @returns The seconds the countdown actually waited (0 when it did not
	 *   wait), so the cycle can re-snapshot afterwards — pre-P5 the cycle's
	 *   state read ran after this wait, and settings changed during a long
	 *   countdown must still be seen (same freshness as before).
	 */
	async maybeWaitForProviderRateLimit(retryAttempt: number, cycleState?: ProviderState): Promise<number> {
		const state = cycleState ?? (await this.access.providerRef.deref()?.getState())
		const rateLimitDelay = this.providerRateLimitDelaySeconds(state)

		// Only show countdown UX on first attempt
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			// D1: this countdown used to ignore abort, so a cancelled task
			// still waited out the whole rate-limit window.
			await countdown(rateLimitDelay, {
				onTick: (i) =>
					this.access.askSay.say("api_req_rate_limit_wait", JSON.stringify({ seconds: i }), undefined, true),
				isAborted: () => this.access.abort,
				// The specs spy on the `delay` module to count countdown seconds.
				sleep: (ms) => delay(ms),
			})
			await this.access.askSay.say("api_req_rate_limit_wait", undefined, undefined, false)
			return rateLimitDelay
		}
		return 0
	}

	/**
	 * Handle a first-chunk API request error: decide what the failed request
	 * becomes and either re-enter the request generator (retryRequest) or
	 * throw for the loop's stream-error path.
	 *
	 * Moved from TaskApiLoop (S3); the retry recursion is handed in by the
	 * caller because it re-enters TaskApiLoop's request generator.
	 */
	async *handleApiRequestError(
		error: unknown,
		retryAttempt: number,
		autoApprovalEnabled: boolean | undefined,
		iterator: AsyncIterator<any>,
		rateLimitRetries: number = 0,
		retryRequest: RetryRequestFn,
	): ApiStream {
		const isContextWindowExceededError = checkContextWindowExceededError(error)

		if (isContextWindowExceededError && retryAttempt < MAX_CONTEXT_WINDOW_RETRIES) {
			console.warn(
				`[Task#${this.access.taskId}] Context window exceeded for model ${this.access.api.getModel().id}. ` +
					`Retry attempt ${retryAttempt + 1}/${MAX_CONTEXT_WINDOW_RETRIES}. ` +
					`Attempting automatic truncation...`,
			)
			await this.access.contextManager.handleContextWindowExceededError()
			yield* retryRequest(retryAttempt + 1, { contextAlreadyManaged: true, rateLimitRetries })
			return
		}

		// A background task has nobody to ask (its approval policy answers
		// api_req_failed with an instant approve, which would retry in a tight
		// loop): for 401, 403 and 404 hand the error on unchanged, and the
		// loop's stream-error path ends the task.
		if (this.mustFailFast(error)) {
			throw error
		}
		if (this.isCappedRetry(error, retryAttempt, rateLimitRetries)) {
			throw new BackgroundRetriesExhaustedError(error, retryAttempt + 1)
		}

		// 401, 403 and 404 never fix themselves: even with auto-approval on they
		// go to the user (the api_req_failed ask below) instead of looping.
		// A background task never reaches that ask (its approval policy would
		// approve it at once, a retry with no delay): it always backs off.
		if ((autoApprovalEnabled || this.access.isBackground) && isAutoRetryableApiError(error)) {
			await this.backoffAndAnnounce(retryAttempt, error)

			if (this.access.abort) {
				throw new Error(
					`[Task#attemptApiRequest] task ${this.access.taskId}.${this.access.instanceId} aborted during retry`,
				)
			}

			yield* retryRequest(retryAttempt + 1, {
				rateLimitRetries: rateLimitRetries + (isRateLimitError(error) ? 1 : 0),
			})
			return
		} else {
			const { response } = await this.access.askSay.ask("api_req_failed", apiErrorDisplayText(error))

			if (response !== "yesButtonClicked") {
				throw new ApiRetryDeclinedError()
			}

			await this.access.askSay.say("api_req_retried")
			yield* retryRequest(0, {})
			return
		}
	}

	/**
	 * The terminal-error checks of the loop's stream-error path: whether a
	 * failed stream must END the task instead of being retried (declined
	 * retry, background fail-fast, exhausted retries, capped mid-stream
	 * retry). Returns "ended" (the caller stops the loop) or undefined (the
	 * caller falls through to its ask/backoff/requeue handling).
	 *
	 * The three background endings record the failure message and abort the
	 * task (endBackgroundTaskOnApiError); a declined retry ends the loop
	 * without touching the task state, exactly as before the move.
	 */
	async endTaskOnTerminalStreamError(
		error: unknown,
		retryAttempt: number,
		rateLimitRetries: number,
	): Promise<"ended" | undefined> {
		// The user declined the retry in the first-chunk api_req_failed ask
		// (handleApiRequestError): end the loop, do not send the request again.
		if (error instanceof ApiRetryDeclinedError) {
			return "ended"
		}

		// A background task never retries 401, 403 or 404 (first chunk,
		// rethrown by handleApiRequestError, or mid-stream): it ends now.
		if (this.mustFailFast(error)) {
			await this.endBackgroundTaskOnApiError(error)
			return "ended"
		}

		// A background task that used up its retries ends too: on the first
		// chunk (thrown by handleApiRequestError) or mid-stream. A 429 never
		// ends it (see BACKGROUND_MAX_API_RETRIES).
		if (error instanceof BackgroundRetriesExhaustedError) {
			await this.endBackgroundTaskOnApiError(error.apiError, error.attempts)
			return "ended"
		}
		if (this.isCappedRetry(error, retryAttempt, rateLimitRetries)) {
			await this.endBackgroundTaskOnApiError(error, retryAttempt + 1)
			return "ended"
		}

		return undefined
	}

	/**
	 * Whether a failed request must end the task instead of being retried: a
	 * background task (memory writer, parallel subagent) that got 401, 403 or
	 * 404 (see isAutoRetryableApiError). A foreground task asks the user
	 * instead; every other error keeps the backoff retry.
	 */
	private mustFailFast(error: unknown): boolean {
		return this.access.isBackground && !isAutoRetryableApiError(error)
	}

	/**
	 * Whether a background task has used up BACKGROUND_MAX_API_RETRIES and must
	 * end on this failure instead of retrying. `retryAttempt` is the number of
	 * retries already made, `rateLimitRetries` how many of them were for a 429.
	 * A 429 never ends the task, and earlier 429 retries do not count: only the
	 * other retryable failures (400, 5xx, no status) use up the cap.
	 */
	private isCappedRetry(error: unknown, retryAttempt: number, rateLimitRetries: number): boolean {
		if (!this.access.isBackground || isRateLimitError(error)) {
			return false
		}
		return retryAttempt - rateLimitRetries >= BACKGROUND_MAX_API_RETRIES
	}

	/**
	 * End a background task after a non-retryable API error, or a retryable
	 * one after BACKGROUND_MAX_API_RETRIES (`attempts` requests): record one line
	 * for whoever awaits it (BackgroundTaskRunner.awaitTaskCompletion hands it
	 * to the parallel-subagent parent and the memory-writer log) and abort as
	 * `streaming_failed`, so the memory runner keeps its one fallback run on
	 * the foreground profile.
	 */
	private async endBackgroundTaskOnApiError(error: unknown, attempts?: number): Promise<void> {
		let model: string | undefined
		try {
			model = this.access.api.getModel().id
		} catch (error) {
			// The message just omits the model.
			logger.debug(`[RetryHandler] model id unavailable for the background failure line: ${String(error)}`, {
				ctx: "RetryHandler",
			})
		}
		const message = describeBackgroundApiFailure(error, {
			provider: this.access.apiConfiguration?.apiProvider,
			model,
			attempts,
		})
		this.access.apiFailureMessage = message
		console.error(
			`[Task#${this.access.taskId}.${this.access.instanceId}] Background task stopped, not retrying: ${message}`,
		)
		this.access.abortReason = "streaming_failed"
		await this.access.abortTask()
	}
}
