/** Backoff after the first 429 from an endpoint; it doubles with every further 429. */
const BASE_BACKOFF_MS = 5_000
/** The backoff never grows past five minutes. */
const MAX_BACKOFF_MS = 300_000
/** A 429 more than a minute after the previous one starts the escalation again. */
const ESCALATION_WINDOW_MS = 60_000

/**
 * Shared backoff for one embedding endpoint.
 *
 * When a request gets a 429, every embedder instance that talks to the same endpoint waits
 * until the backoff is over before sending its next request, so parallel batches do not
 * keep hammering a server that already said "slow down". 429s that follow each other
 * within a minute double the backoff (5 s, 10 s, 20 s, ... up to 5 minutes).
 *
 * All state changes happen synchronously, so no lock is needed: JavaScript runs one
 * callback at a time and nothing here awaits between reading and writing the state.
 */
export class RateLimitGate {
	private resetAt = 0
	private consecutiveErrors = 0
	private lastErrorAt = 0

	/** Resolves once the current backoff, if any, is over. */
	async wait(): Promise<void> {
		const waitMs = this.remainingDelay()
		if (waitMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, waitMs))
		}
	}

	/** Records a 429 and starts (or extends) the backoff. */
	recordRateLimit(): void {
		const now = Date.now()
		this.consecutiveErrors = now - this.lastErrorAt < ESCALATION_WINDOW_MS ? this.consecutiveErrors + 1 : 1
		this.lastErrorAt = now
		this.resetAt = now + Math.min(BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1), MAX_BACKOFF_MS)
	}

	/** Milliseconds left in the current backoff, 0 when there is none. */
	remainingDelay(): number {
		return Math.max(0, this.resetAt - Date.now())
	}
}

const gates = new Map<string, RateLimitGate>()

/**
 * Returns the gate for an endpoint. Every embedder with the same key shares one gate, so a
 * rate limit at one provider never delays an embedder that talks to a different server.
 */
export function rateLimitGateFor(endpointKey: string): RateLimitGate {
	let gate = gates.get(endpointKey)
	if (!gate) {
		gate = new RateLimitGate()
		gates.set(endpointKey, gate)
	}
	return gate
}

/** Forgets every endpoint's backoff. For tests, which must not inherit each other's 429s. */
export function resetRateLimitGates(): void {
	gates.clear()
}
