/**
 * Reading the core's automatic API retries (`say: api_req_retry_delayed`).
 *
 * While a failed request waits for its next attempt, `RetryHandler` says the
 * error once per second as one partial message,
 * `<status>\n<error>\n<retry_timer>N</retry_timer>` (the status line only when
 * the error had an HTTP status), and finalizes it without the timer when the
 * wait ends.
 */

import { UNATTENDED_MAX_API_RETRIES } from "@tumble-code/core/backoff"
import type { ClineMessage } from "@tumble-code/types"

const RETRY_TIMER = /<retry_timer>(\d+)<\/retry_timer>/

/** The error of a retry message on one line: `429 Rate limit exceeded`, `OpenAI completion error: ...`. */
function retryError(text: string): string {
	return text.replace(RETRY_TIMER, "").trim().split("\n").join(" ")
}

/** The retry message as the transcript shows it: the error and when the next attempt starts. */
export function describeApiRetry(text: string): string {
	const seconds = text.match(RETRY_TIMER)?.[1]
	const next = seconds ? `retrying in ${seconds} s` : "retrying now"
	return `API request failed: ${retryError(text)} - ${next}`
}

/**
 * Ends an unattended print run whose provider never answers, with the cap a
 * background task gets (UNATTENDED_MAX_API_RETRIES): the core retries a
 * foreground task forever, and nobody watches a print run to cancel it.
 *
 * It counts the retry messages of the current request (each retry is one
 * message, its ts); a new `api_req_started` is a new request and starts the
 * count again. A 429 retry does not count, like in the core.
 */
export class UnattendedRetryCap {
	private requestTs = 0
	private retries = new Set<number>()

	/** The run's failure when this message is the retry past the cap, else undefined. */
	observe(message: ClineMessage): string | undefined {
		if (message.type !== "say" || message.ts <= this.requestTs) {
			return undefined
		}
		if (message.say === "api_req_started") {
			this.requestTs = message.ts
			this.retries.clear()
			return undefined
		}
		const text = message.text ?? ""
		if (message.say !== "api_req_retry_delayed" || text.startsWith("429\n")) {
			return undefined
		}
		this.retries.add(message.ts)
		if (this.retries.size <= UNATTENDED_MAX_API_RETRIES) {
			return undefined
		}
		return `API request failed after ${this.retries.size} attempts: ${retryError(text)}`
	}
}
