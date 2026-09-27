/**
 * Exponential backoff with equal jitter (R11).
 *
 * Many cloud clients (auth + settings refresh timers, telemetry and API
 * requests in the retry queue, the bridge reconnect) start at the same moment
 * — after a VS Code reload or a backend restart they would all fire on the
 * same tick, a thundering herd against the cloud. Equal jitter decorrelates
 * them: `delay = base/2 + random(base/2)`, so the delay always lies in
 * `[base/2, base]` with the exponential shape preserved and the cap never
 * exceeded.
 *
 * D1 (roadmap) will move this helper to `packages/core` and replace the other
 * backoff implementations; until then it lives here, next to its first users.
 */

/** Options for {@link backoffDelayMs}. */
export interface BackoffOptions {
	/** First-step delay in milliseconds. */
	baseMs: number
	/** Upper bound for the returned delay. */
	capMs: number
	/**
	 * Source of randomness in `[0, 1)`. Injectable so tests are deterministic;
	 * defaults to `Math.random`.
	 */
	random?: () => number
}

/**
 * Backoff delay for the given attempt (0-based), with equal jitter:
 * `min(base * 2^attempt, cap) / 2 + random * min(base * 2^attempt, cap) / 2`.
 */
export function backoffDelayMs(attempt: number, { baseMs, capMs, random = Math.random }: BackoffOptions): number {
	const raw = Math.min(baseMs * 2 ** attempt, capMs)
	return Math.floor(raw / 2 + random() * (raw / 2))
}
