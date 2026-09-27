/**
 * RetryHandler - Handles retry logic and exponential backoff
 *
 * This module extracts the retry/backoff logic from TaskApiLoop,
 * including exponential backoff calculation, rate limit handling,
 * and countdown UX. The delay ladder and the countdown loops come
 * from the shared helpers in `@roo-code/core` (D1).
 *
 * Extracted from: TaskApiLoop.ts (Phase 2A refactoring)
 */

import delay from "delay"
import { backoffDelayMsNoJitter, countdown } from "@roo-code/core"
import { SETTINGS_DEFAULTS, type ProviderSettings } from "@roo-code/types"
import { type TaskAskSay } from "./TaskAskSay"
import { type ClineProvider } from "../webview/ClineProvider"

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

	// API configuration
	apiConfiguration: ProviderSettings

	// Provider reference
	providerRef: WeakRef<ClineProvider>

	// Communication
	askSay: TaskAskSay
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

/**
 * RetryHandler handles exponential backoff and retry logic for API requests.
 */
export class RetryHandler {
	constructor(private readonly access: RetryHandlerAccess) {}

	/**
	 * Seconds left in the user-configured provider rate-limit window, 0 when
	 * the window has passed or no limit is set. One implementation, used by
	 * both the retry backoff and the pre-request wait (D1: was written twice).
	 */
	private providerRateLimitDelaySeconds(state: any): number {
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
	calculateBackoffDelay(retryAttempt: number, error: any, state: any): number {
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
		if (error?.status === 429) {
			const retryInfo = error?.errorDetails?.find(
				(d: any) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
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
	buildErrorHeaderText(error: any): string {
		let headerText: string
		if (error?.status) {
			const errorMessage = error?.message || "Unknown error"
			headerText = `${error.status}\n${errorMessage}`
		} else if (error?.message) {
			headerText = error.message
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
	async backoffAndAnnounce(retryAttempt: number, error: any): Promise<void> {
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
	 */
	async maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void> {
		const state = await this.access.providerRef.deref()?.getState()
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
		}
	}
}
