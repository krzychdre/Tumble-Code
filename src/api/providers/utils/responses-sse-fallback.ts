import OpenAI from "openai"

import { getApiErrorStatus } from "../../apiErrors"

/**
 * OpenAI Native and OpenAI Codex send a Responses API request through the
 * openai SDK and, when the SDK cannot be used, send it through a hand-written
 * SSE fetch instead. The fallback dates from an SDK without streaming support
 * for the Responses API (cda67a86f).
 *
 * True only when the SDK failed without talking to the server: `responses`
 * is missing (TypeError), the SDK returned something that is not a stream, or
 * the request could not even be built. Every other failure means the request
 * already reached (or may have reached) the server, and sending it again
 * would make the server see it twice:
 * - an error with an HTTP status: the server answered (429, 401, 5xx, ...);
 * - any other SDK `APIError` (connection error, timeout, user abort): the SDK
 *   sent the request and already applied its own retry policy.
 *
 * Callers must also refuse the fallback once the stream produced an event or
 * the request was aborted.
 */
export function isSdkUnusableError(error: unknown): boolean {
	if (getApiErrorStatus(error) !== undefined) {
		return false
	}
	// Read through the default export: specs that mock the "openai" module
	// replace it with a bare constructor that has no error classes.
	const APIError = (OpenAI as unknown as { APIError?: unknown }).APIError
	if (typeof APIError === "function" && error instanceof APIError) {
		return false
	}
	return true
}
