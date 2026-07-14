/**
 * Shared API error classification. Used by both the background-model fallback
 * system ({@linkcode isFallbackTriggerError} in `BackgroundModelHandler.ts`)
 * and the task retry loop ({@linkcode RetryHandler.shouldRetry}) so the two
 * stay in sync instead of drifting.
 *
 * The shared predicate covers *transient* errors — conditions under which the
 * same handler is likely to recover if retried (network blips, rate limits,
 * provider 5xx). Callers layer their own policy on top:
 * - RetryHandler retries the SAME handler → uses this predicate directly.
 * - BackgroundModelHandler falls back to a DIFFERENT handler → uses this
 *   predicate plus auth/payload/construction conditions that warrant switching
 *   handlers (401/403, 400).
 */

/**
 * True iff `error` represents a transient server-side or network condition
 * that warrants either a retry (same handler) or a fallback (different
 * handler). Covers:
 * - Network connectivity: ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN.
 * - Rate limiting: 429.
 * - Service unavailable: 503.
 * - Generic 5xx server errors.
 *
 * Does NOT cover: 400 (payload problem — retrying the same handler won't help,
 * and whether to fall back is a policy decision), 401/403 (auth — retrying the
 * same handler won't help, but a different handler may have valid creds),
 * aborts, or programmer errors.
 */
export function isRetryableApiError(error: unknown): boolean {
	if (error == null) return false
	const e = error as any

	// Network / connectivity (provider offline, DNS, timeout).
	if (e.code === "ECONNRESET" || e.code === "ETIMEDOUT" || e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") {
		return true
	}

	// Rate limit / service unavailable.
	if (e.status === 429 || e.status === 503) return true

	// Generic 5xx server errors.
	if (typeof e.status === "number" && e.status >= 500 && e.status < 600) return true

	return false
}
