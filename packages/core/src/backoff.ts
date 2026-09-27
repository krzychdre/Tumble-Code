/**
 * One exponential-backoff helper for the whole repo (D1, roadmap 2026-09-27).
 *
 * Two shapes:
 * - {@link backoffDelayMs}: equal jitter — `raw/2 + random() * raw/2`, so the
 *   delay always lies in `[raw/2, raw]`. Many clients that start at the same
 *   moment (after a VS Code reload or a backend restart) must not all fire on
 *   the same tick; jitter decorrelates them (R11).
 * - {@link backoffDelayMsNoJitter}: the plain ladder `min(base * 2^attempt, cap)`.
 *   For callers whose tests assert exact delays, and for gates that escalate
 *   deterministically on purpose (a shared 429 gate that every embedder on the
 *   same endpoint waits on must not randomly shorten the wait).
 *
 * {@link countdown} is the one abortable seconds-countdown loop; before D1 the
 * retry and rate-limit countdowns were written twice in `RetryHandler` and the
 * rate-limit one ignored abort.
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

/** Options for {@link backoffDelayMsNoJitter}. */
export interface BackoffLadderOptions {
	/** First-step delay in milliseconds. */
	baseMs: number
	/** Upper bound for the returned delay. */
	capMs: number
}

/**
 * Backoff delay for the given attempt (0-based), with equal jitter:
 * `min(base * 2^attempt, cap) / 2 + random * min(base * 2^attempt, cap) / 2`.
 */
export function backoffDelayMs(attempt: number, { baseMs, capMs, random = Math.random }: BackoffOptions): number {
	const raw = Math.min(baseMs * 2 ** attempt, capMs)
	return Math.floor(raw / 2 + random() * (raw / 2))
}

/**
 * Backoff delay without jitter: `min(base * 2^attempt, cap)`, 0-based attempt.
 * Exact integers, so specs can assert the ladder.
 */
export function backoffDelayMsNoJitter(attempt: number, { baseMs, capMs }: BackoffLadderOptions): number {
	return Math.min(baseMs * 2 ** attempt, capMs)
}

/** Options for {@link countdown}. */
export interface CountdownOptions {
	/** Called once per second with the seconds remaining (counting down). */
	onTick: (secondsRemaining: number) => Promise<void> | void
	/** Step between ticks. Milliseconds; defaults to 1000. Injectable for tests. */
	stepMs?: number
	/** Checked before every tick; when true the countdown rejects with `abortError`. */
	isAborted?: () => boolean
	/** Rejection error when `isAborted()` fires. Defaults to `new Error("Countdown aborted")`. */
	abortError?: Error
	/**
	 * Sleep between ticks. Injectable for tests; defaults to a `setTimeout` promise.
	 * Receives the step duration in milliseconds.
	 */
	sleep?: (ms: number) => Promise<void>
}

/**
 * Counts `seconds` down to 0, calling `onTick(i)` for each `i` in `[seconds .. 1]`,
 * then resolves. Rejects with `abortError` when `isAborted()` returns true before
 * any tick — an aborted task never waits out the countdown.
 */
export async function countdown(seconds: number, options: CountdownOptions): Promise<void> {
	const { onTick, stepMs = 1000, isAborted, abortError, sleep = defaultSleep } = options

	for (let i = seconds; i > 0; i--) {
		if (isAborted?.()) {
			throw abortError ?? new Error("Countdown aborted")
		}

		await onTick(i)
		await sleep(stepMs)
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
