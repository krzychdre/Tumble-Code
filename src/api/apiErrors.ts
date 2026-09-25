/**
 * Shared API error classification. Used by the background-model fallback
 * system ({@linkcode isFallbackTriggerError} in `BackgroundModelHandler.ts`)
 * and by `handleProviderError`, which copies the status onto the errors every
 * provider handler throws.
 *
 * The shared predicate covers *transient* errors: conditions under which the
 * same handler is likely to recover if retried (network blips, rate limits,
 * provider 5xx). Callers layer their own policy on top:
 * BackgroundModelHandler falls back to a DIFFERENT handler, so it uses this
 * predicate plus auth/payload conditions that warrant switching handlers
 * (401/403, 400).
 *
 * The task retry loop (`TaskApiLoop.handleApiRequestError` and
 * `handleStreamError`, with `RetryHandler` for the backoff) uses the lightest
 * policy, {@linkcode isAutoRetryableApiError}: apart from the context-window
 * case, with auto-approval on it retries every failed request except the
 * statuses that never fix themselves (401, 403, 404), for which it asks the
 * user, like it always does with auto-approval off. A background task (memory
 * writer, parallel subagent) has nobody to ask: it always backs off for
 * retryable errors, ends at once for those three statuses, and ends after
 * a retry cap otherwise, with the text of
 * {@linkcode describeBackgroundApiFailure} for whoever awaits it.
 */

/**
 * The HTTP status of a provider error, whatever the SDK calls it:
 * - `status`: OpenAI, Anthropic and Google GenAI SDKs, and the errors our own
 *   handlers throw through `handleProviderError`.
 * - `statusCode`: the Mistral SDK (`SDKError`).
 * - `status_code`: the ollama package (`ResponseError`).
 * - `$metadata.httpStatusCode`: the AWS SDK v3 (Bedrock).
 *
 * Only numbers count: some libraries put a text such as "RESOURCE_EXHAUSTED"
 * in `status`.
 */
export function getApiErrorStatus(error: unknown): number | undefined {
	if (error == null || typeof error !== "object") return undefined
	const e = error as any
	const candidates = [e.status, e.statusCode, e.status_code, e.$metadata?.httpStatusCode]
	return candidates.find((value): value is number => typeof value === "number")
}

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

	const status = getApiErrorStatus(error)

	// Rate limit / service unavailable.
	if (status === 429 || status === 503) return true

	// Generic 5xx server errors.
	if (status !== undefined && status >= 500 && status < 600) return true

	return false
}

/**
 * HTTP statuses that retrying the same request can never fix: 401 (invalid or
 * missing key), 403 (forbidden) and 404 (unknown model or endpoint). 400 is
 * deliberately NOT here: some providers and proxies (Z.ai among them) answer
 * 400 for transient trouble, so it stays auto-retried.
 */
const NEVER_AUTO_RETRIED_STATUSES = new Set([401, 403, 404])

/**
 * Whether the task loop may retry `error` on its own (auto-approval on). False
 * only for 401, 403 and 404; the loop then shows the failure to the user, who
 * can fix the key, profile or model and retry by hand. Every other error,
 * including errors without a status, stays auto-retryable.
 */
export function isAutoRetryableApiError(error: unknown): boolean {
	const status = getApiErrorStatus(error)
	return status === undefined || !NEVER_AUTO_RETRIED_STATUSES.has(status)
}

/** What each never-auto-retried status means, in words a weak model can act on. */
const NON_RETRYABLE_STATUS_REASONS: Record<number, string> = {
	401: "invalid or missing API key",
	403: "access forbidden",
	404: "model or endpoint not found",
}

/** Longest provider message quoted in {@linkcode describeBackgroundApiFailure}. */
const MAX_PROVIDER_MESSAGE_LENGTH = 300

/**
 * One short, factual line about the API error that ended a background task
 * (a 401, 403 or 404, or a retryable error after the background retry cap),
 * for the task that waits on it (a parallel subagent's parent) and for the
 * output channel (memory writers). Examples:
 * `API error 401 (invalid or missing API key) from provider "openai", model
 * "gpt-x". Provider message: Incorrect API key provided.`
 * `API error 500 from provider "openai", model "gpt-x" after 7 attempts.
 * Provider message: Internal server error.`
 */
export function describeBackgroundApiFailure(
	error: unknown,
	source: { provider?: string; model?: string; attempts?: number },
): string {
	const status = getApiErrorStatus(error)
	const reason = status !== undefined ? NON_RETRYABLE_STATUS_REASONS[status] : undefined
	const head = status !== undefined ? `API error ${status}${reason ? ` (${reason})` : ""}` : "API request failed"
	const from = [
		source.provider ? `from provider "${source.provider}"` : undefined,
		source.model ? `model "${source.model}"` : undefined,
	]
		.filter(Boolean)
		.join(", ")
	const after = source.attempts !== undefined ? ` after ${source.attempts} attempts` : ""
	const raw = error instanceof Error ? error.message : typeof error === "string" ? error : ""
	const providerMessage = raw.replace(/\s+/g, " ").trim()
	const quoted =
		providerMessage.length > MAX_PROVIDER_MESSAGE_LENGTH
			? `${providerMessage.slice(0, MAX_PROVIDER_MESSAGE_LENGTH)}...`
			: providerMessage
	return `${head}${from ? ` ${from}` : ""}${after}.${quoted ? ` Provider message: ${quoted}` : ""}`
}
