import { backoffDelayMs } from "./backoff.js"

/**
 * RefreshTimer - A utility for executing a callback with configurable retry behavior
 *
 * This timer executes a callback function and schedules the next execution based on the result:
 * - If the callback succeeds (returns true), it schedules the next attempt after a fixed interval
 * - If the callback fails (returns false), it uses exponential backoff with equal jitter up to a
 *   maximum interval (R11: many clients restarting in sync must not retry on the same tick)
 */

/**
 * Configuration options for the RefreshTimer
 */
export interface RefreshTimerOptions {
	/**
	 * The callback function to execute
	 * Should return a Promise that resolves to a boolean indicating success (true) or failure (false)
	 */
	callback: () => Promise<boolean>

	/**
	 * Time in milliseconds to wait before next attempt after success
	 * @default 50000 (50 seconds)
	 */
	successInterval?: number

	/**
	 * Initial backoff time in milliseconds for the first failure
	 * @default 1000 (1 second)
	 */
	initialBackoffMs?: number

	/**
	 * Maximum backoff time in milliseconds
	 * @default 300000 (5 minutes)
	 */
	maxBackoffMs?: number

	/**
	 * Random source in [0, 1) used for the equal-jitter part of the backoff.
	 * Injectable for deterministic tests; defaults to Math.random.
	 */
	random?: () => number
}

/**
 * A timer utility that executes a callback with configurable retry behavior
 */
export class RefreshTimer {
	private callback: () => Promise<boolean>
	private successInterval: number
	private initialBackoffMs: number
	private maxBackoffMs: number
	private random: () => number
	private currentBackoffMs: number
	private attemptCount: number
	private timerId: NodeJS.Timeout | null
	private isRunning: boolean

	/**
	 * Creates a new RefreshTimer
	 *
	 * @param options Configuration options for the timer
	 */
	constructor(options: RefreshTimerOptions) {
		this.callback = options.callback
		this.successInterval = options.successInterval ?? 50000 // 50 seconds
		this.initialBackoffMs = options.initialBackoffMs ?? 1000 // 1 second
		this.maxBackoffMs = options.maxBackoffMs ?? 300000 // 5 minutes
		this.random = options.random ?? Math.random
		this.currentBackoffMs = this.initialBackoffMs
		this.attemptCount = 0
		this.timerId = null
		this.isRunning = false
	}

	/**
	 * Starts the timer and executes the callback immediately
	 */
	public start(): void {
		if (this.isRunning) {
			return
		}

		this.isRunning = true

		// Execute the callback immediately
		this.executeCallback()
	}

	/**
	 * Stops the timer and cancels any pending execution
	 */
	public stop(): void {
		if (!this.isRunning) {
			return
		}

		if (this.timerId) {
			clearTimeout(this.timerId)
			this.timerId = null
		}

		this.isRunning = false
	}

	/**
	 * Resets the backoff state and attempt count
	 * Does not affect whether the timer is running
	 */
	public reset(): void {
		this.currentBackoffMs = this.initialBackoffMs
		this.attemptCount = 0
	}

	/**
	 * Schedules the next attempt based on the success/failure of the current attempt
	 *
	 * @param wasSuccessful Whether the current attempt was successful
	 */
	private scheduleNextAttempt(wasSuccessful: boolean): void {
		if (!this.isRunning) {
			return
		}

		if (wasSuccessful) {
			// Reset backoff on success
			this.currentBackoffMs = this.initialBackoffMs
			this.attemptCount = 0

			this.timerId = setTimeout(() => this.executeCallback(), this.successInterval)
		} else {
			// Backoff step for this failure, with equal jitter so clients that
			// restart in sync do not all retry on the same tick (R11).
			this.currentBackoffMs = backoffDelayMs(this.attemptCount, {
				baseMs: this.initialBackoffMs,
				capMs: this.maxBackoffMs,
				random: this.random,
			})
			this.attemptCount++

			this.timerId = setTimeout(() => this.executeCallback(), this.currentBackoffMs)
		}
	}

	/**
	 * Executes the callback and handles the result
	 */
	private async executeCallback(): Promise<void> {
		if (!this.isRunning) {
			return
		}

		try {
			const result = await this.callback()

			this.scheduleNextAttempt(result)
		} catch (_error) {
			// Treat errors as failed attempts
			this.scheduleNextAttempt(false)
		}
	}
}
