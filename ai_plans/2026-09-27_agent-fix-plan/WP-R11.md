# WP-R11: Jittered, per-request backoff in the cloud client

Status: ready
Effort: M      Risk: low      Depends on: WP-D1 (needs `backoffDelayMs` in `@roo-code/core/browser` and the
`@roo-code/core` dependency of `packages/cloud`)
Branch name: fix/r11-cloud-client-backoff      Base: origin/main (after WP-D1 is merged)

## 1. Goal (2-4 sentences, plain words)

Make the cloud client's retries spread out and back off per request, using the D1 helper. `RefreshTimer` (token
and settings refresh) takes up to 20 % off each failure backoff at random; `RetryQueue` stops retrying every queued
request on every 60 s tick and instead gives each failed request its own doubling delay (`nextAttemptAt`);
`bridgeRetryDelayMs` gets the same 20 % jitter, and the bridge reconnects by hand after socket.io's
`reconnect_failed` instead of staying offline. Public APIs stay the same (only optional fields are added).

## 2. Why it matters (user-visible effect, 2-4 sentences)

After a cloud server restart every VS Code window retries at the same moments (1 s, 2 s, 4 s ...), which hits the
server in waves just when it comes back. The telemetry retry queue sends every failed request again once a minute
until it gives up after 5 tries, even when the server keeps failing. With jitter and per-request backoff the load
after an outage is spread out and a broken endpoint is tried less and less often.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `ai_plans/2026-09-27_d1-shared-backoff.md` and `packages/core/src/utils/backoff.ts` (`backoffDelayMs`: jitter only
  shortens the delay, result between `(1 - jitter) * d` and `d`; returns `d` exactly when `Math.random()` is 0).
- `packages/cloud/src/RefreshTimer.ts`: `RefreshTimerOptions`, constructor, `scheduleNextAttempt`.
- `packages/cloud/src/WebAuthService.ts` near line 118 and `packages/cloud/src/CloudSettingsService.ts` near line 68
  (the two `new RefreshTimer({...})` calls; do not change them).
- `packages/cloud/src/__tests__/WebAuthService.spec.ts` near line 133: asserts `RefreshTimer` was constructed with
  exactly `{ callback, successInterval: 50_000, initialBackoffMs: 1_000, maxBackoffMs: 300_000 }`. This is why the
  jitter is a default inside `RefreshTimer`, not a new argument at the call sites.
- `packages/cloud/src/retry-queue/RetryQueue.ts`: `retryAll`, `startRetryTimer`, `delay`; `types.ts`:
  `QueuedRequest`, `RetryQueueConfig` (`retryDelay` exists but is never read today).
- `packages/cloud/src/CloudService.ts` near line 147: `new RetryQueue(this.context.workspaceState, undefined, ...)`
  (default config: `maxRetries: 5`, `retryDelay: 60000`, `networkCheckInterval: 60000`).
- `packages/cloud/src/bridge/BridgeOrchestrator.ts`: `bridgeRetryDelayMs`, `start` (manager listeners
  `reconnect_attempt`, `reconnect_failed`), `scheduleRefusedRetry`.
- `src/extension/bridge.ts`: `start` (uses `bridgeRetryDelayMs` to retry a failed start; no edit needed).
- `packages/cloud/node_modules/socket.io-client/build/cjs/manager.js` near line 53 and `reconnect()` near line 362.
- Tests: `packages/cloud/src/__tests__/RefreshTimer.test.ts`, `packages/cloud/src/retry-queue/__tests__/RetryQueue.test.ts`,
  `packages/cloud/src/bridge/__tests__/BridgeOrchestrator.test.ts`, `src/extension/__tests__/bridge.spec.ts`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

The excerpts show `origin/main` before WP-D1. After WP-D1, `bridgeRetryDelayMs` already reads
`return backoffDelayMs(attempt, { baseMs: RETRY_BASE_MS, capMs: RETRY_MAX_MS })` and the file imports
`backoffDelayMs` from `@roo-code/core/browser`; everything else is as shown.

### 4.1 `packages/cloud/src/RefreshTimer.ts`, `scheduleNextAttempt` (near line 111)

```ts
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
			// Increment attempt count
			this.attemptCount++

			// Calculate backoff time with exponential increase
			// Formula: initialBackoff * 2^(attemptCount - 1)
			this.currentBackoffMs = Math.min(
				this.initialBackoffMs * Math.pow(2, this.attemptCount - 1),
				this.maxBackoffMs,
			)

			this.timerId = setTimeout(() => this.executeCallback(), this.currentBackoffMs)
		}
	}
```

### 4.2 `packages/cloud/src/retry-queue/RetryQueue.ts`, `retryAll` (near line 102) and `startRetryTimer` (near line 247)

```ts
	public async retryAll(): Promise<void> {
		if (this.isProcessing) {
			this.log("[RetryQueue] Already processing, skipping retry cycle")
			return
		}

		// Check if the queue is manually paused (e.g., due to auth state)
		if (this.isPaused) {
			this.log("[RetryQueue] Queue is manually paused")
			return
		}

		// Check if the entire queue is paused due to rate limiting
		if (this.queuePausedUntil && Date.now() < this.queuePausedUntil) {
			this.log(`[RetryQueue] Queue is paused until ${new Date(this.queuePausedUntil).toISOString()}`)
			return
		}

		const requests = Array.from(this.queue.values())
		if (requests.length === 0) {
			return
		}

		this.isProcessing = true

		try {
			// Sort by timestamp to process in FIFO order (oldest first)
			requests.sort((a, b) => a.timestamp - b.timestamp)

			// Process all requests in FIFO order
			for (const request of requests) {
				try {
					const response = await this.retryRequest(request)

					// Check if we got a 429 rate limiting response
					if (response && response.status === 429) {
						const retryAfter = response.headers.get("Retry-After")
						if (retryAfter) {
							// Parse Retry-After (could be seconds or a date)
							let delayMs: number
							const retryAfterSeconds = parseInt(retryAfter, 10)
							if (!isNaN(retryAfterSeconds)) {
								delayMs = retryAfterSeconds * 1000
							} else {
								// Try parsing as a date
								const retryDate = new Date(retryAfter)
								if (!isNaN(retryDate.getTime())) {
									delayMs = retryDate.getTime() - Date.now()
								} else {
									delayMs = 60000 // Default to 1 minute if we can't parse
								}
							}
							// Pause the entire queue
							this.queuePausedUntil = Date.now() + delayMs
							this.log(`[RetryQueue] Rate limited, pausing entire queue for ${delayMs}ms`)
							// Keep the request in the queue for later retry
							this.queue.set(request.id, request)
							// Stop processing further requests since the queue is paused
							break
						}
					}

					this.queue.delete(request.id)
					this.emit("request-retry-success", request)
				} catch (error) {
					request.retryCount++
					request.lastError = error instanceof Error ? error.message : String(error)

					// Check if we've exceeded max retries
					if (this.config.maxRetries > 0 && request.retryCount >= this.config.maxRetries) {
						this.log(
							`[RetryQueue] Max retries (${this.config.maxRetries}) reached for request: ${request.url}`,
						)
						this.queue.delete(request.id)
						this.emit("request-max-retries-exceeded", request, error as Error)
					} else {
						this.queue.set(request.id, request)
						this.emit("request-retry-failed", request, error as Error)
					}

					// Add a small delay between retry attempts
					await this.delay(100)
				}
			}

			await this.persistQueue()
		} finally {
			// Always reset the processing flag, even if an error occurs
			this.isProcessing = false
		}
	}
```

```ts
	private startRetryTimer(): void {
		if (this.retryTimer) {
			clearInterval(this.retryTimer)
		}

		this.retryTimer = setInterval(() => {
			this.retryAll().catch((error) => {
				this.log("[RetryQueue] Error during retry cycle:", error)
			})
		}, this.config.networkCheckInterval)
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
```

### 4.3 `packages/cloud/src/retry-queue/types.ts`, `QueuedRequest` and `RetryQueueConfig`

```ts
export interface QueuedRequest {
	id: string
	url: string
	options: RequestInit
	timestamp: number
	retryCount: number
	type: "api-call" | "telemetry" | "settings" | "other"
	operation?: string
	lastError?: string
}

export interface QueueStats {
	totalQueued: number
	byType: Record<string, number>
	oldestRequest?: Date
	newestRequest?: Date
	totalRetries: number
	failedRetries: number
}

export interface RetryQueueConfig {
	maxRetries: number // 0 means unlimited; default is 5
	retryDelay: number
	maxQueueSize: number // FIFO eviction when full
	persistQueue: boolean
	networkCheckInterval: number // milliseconds
	requestTimeout: number // milliseconds for request timeout
```

### 4.4 `packages/cloud/src/bridge/BridgeOrchestrator.ts`, `bridgeRetryDelayMs` (near line 20), manager listeners (near line 135), `scheduleRefusedRetry` (near line 177)

```ts
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000

/**
 * Delay before the given retry (0-based) of a bridge connection the server
 * refused: 1 s, 2 s, 4 s, ... capped at one minute. Also used by the extension
 * host to retry a bridge start that failed.
 */
export function bridgeRetryDelayMs(attempt: number): number {
	return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
}
```

```ts
		// Manager-level reconnection events: socket.io reconnect-loops silently
		// on repeated auth failures. Log with throttling so a long outage doesn't
		// spam the output channel <U+2014 em dash> log attempt 1, then every 5th.
		const manager = socket.io
		manager.on("reconnect_attempt", (attempt: number) => {
			this.reconnectAttempt = attempt
			if (attempt === 1 || attempt % 5 === 0) {
				this.log(`reconnect attempt #${attempt}`)
			}
		})
		manager.on("reconnect_failed", () => {
			this.log("reconnect failed <U+2014 em dash> giving up; remote control is offline")
		})

		this.subscribeToBus()
```

```ts
	private scheduleRefusedRetry(socket: Socket) {
		if (!this.started || this.refusedRetryTimer) return
		const delay = bridgeRetryDelayMs(this.refusedRetry++)
		this.log(`server refused the connection; retrying in ${Math.round(delay / 1000)} s`)
		this.refusedRetryTimer = setTimeout(() => {
			this.refusedRetryTimer = null
			if (this.started && this.socket === socket && !socket.connected) socket.connect()
		}, delay)
	}
```

(`<U+2014 em dash>` marks the one non-ASCII character in these lines; see step 4b for how to find that line.)

### 4.5 `socket.io-client` 4.8.3 `build/cjs/manager.js` (read only)

```js
        this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
...
    reconnect() {
        if (this._reconnecting || this.skipReconnect)
            return this;
        const self = this;
        if (this.backoff.attempts >= this._reconnectionAttempts) {
            debug("reconnect failed");
            this.backoff.reset();
            this.emitReserved("reconnect_failed");
            this._reconnecting = false;
        }
```

## 5. Root cause / analysis

VERIFIED:

- `RefreshTimer` computes `min(initialBackoffMs * 2^(n-1), maxBackoffMs)` with no randomness (4.1). Both users
  (`WebAuthService`: 1 s to 5 min; `CloudSettingsService`: 1 s to 1 h) therefore retry in lock step across windows.
- `RetryQueue` runs `retryAll()` on a fixed `setInterval(networkCheckInterval)` (60 s) and retries every queued
  request on every tick; a failure only increments `retryCount`. `config.retryDelay` (60 s) is never read
  (`grep -n "retryDelay" packages/cloud/src/retry-queue/RetryQueue.ts` shows only the default).
- `retryAll()` is public but no production code calls it (`grep -rn "retryAll" packages/cloud/src src --include=*.ts |
  grep -v __tests__` finds only the timer). Many tests call it several times in a row and expect a retry each time
  (for example "should enforce max retries limit", "should default to maxRetries=5 and discard after 5 failures").
  So `retryAll()` keeps "retry everything now"; only the timer path honors the per-request backoff.
- The bridge: `BridgeOrchestrator.start` creates the socket without `reconnectionAttempts`, so socket.io uses
  `Infinity` (4.5) and `reconnect_failed` never fires in the current setup; socket.io already reconnects transport
  failures forever with its own jitter (`randomizationFactor` 0.5, 1 s to 5 s). The case that used to leave the
  bridge offline, a refused handshake, is already handled by `scheduleRefusedRetry` (DEF-C50), and a failed start by
  `src/extension/bridge.ts`. The roadmap's "gives up after reconnect_failed" is therefore only a latent risk (it
  would bite as soon as someone sets `reconnectionAttempts`); this item makes that handler re-arm with
  `bridgeRetryDelayMs` instead of logging "giving up". The real gap on the bridge is the missing jitter in
  `bridgeRetryDelayMs`, used by both retry paths.
- A dry run in a scratch copy of `packages/core` + `packages/cloud` (with the D1 helper, cloud resolving
  `@roo-code/core/browser` through a `node_modules` link) passed: `tsc --noEmit` clean, eslint clean, 329 cloud tests
  pass (319 old + 10 new). With the pre-R11 sources the new cases fail (7 failures: 2 bridge, 2 RefreshTimer, 3
  RetryQueue). `src/extension/__tests__/bridge.spec.ts` fails 1 of 3 without the `Math.random` spy and passes 3 of 3
  with it.
- Existing `RefreshTimer.test.ts` cases pass unchanged with the default jitter, because jitter only shortens the
  wait and they advance by the full nominal delay.

HYPOTHESIS H1: 20 % is enough spread and does not slow recovery noticeably. It keeps every first retry within the
old delay (never later). If reviewers want a larger spread, change only the three constants
(`DEFAULT_BACKOFF_JITTER`, `RETRY_JITTER` in RetryQueue and in BridgeOrchestrator) and the jitter test numbers.

## 6. Step-by-step changes

### Step 1. `packages/cloud/src/RefreshTimer.ts`

1a. Find:

```ts
/**
 * Configuration options for the RefreshTimer
 */
```

Replace with:

```ts
import { backoffDelayMs } from "@roo-code/core/browser"

/** Default share of a failure backoff taken off at random (see RefreshTimerOptions.jitter). */
const DEFAULT_BACKOFF_JITTER = 0.2

/**
 * Configuration options for the RefreshTimer
 */
```

1b. Find (end of the options interface):

```ts
	maxBackoffMs?: number
}
```

Replace with:

```ts
	maxBackoffMs?: number

	/**
	 * Share of each failure backoff, 0 to 1, taken off at random so that clients
	 * that failed together (a server restart) do not retry together. The success
	 * interval is never jittered.
	 * @default 0.2
	 */
	jitter?: number
}
```

1c. Find:

```ts
	private maxBackoffMs: number
	private currentBackoffMs: number
```

Replace with:

```ts
	private maxBackoffMs: number
	private jitter: number
	private currentBackoffMs: number
```

1d. Find:

```ts
		this.maxBackoffMs = options.maxBackoffMs ?? 300000 // 5 minutes
```

Replace with:

```ts
		this.maxBackoffMs = options.maxBackoffMs ?? 300000 // 5 minutes
		this.jitter = options.jitter ?? DEFAULT_BACKOFF_JITTER
```

1e. Find:

```ts
			// Calculate backoff time with exponential increase
			// Formula: initialBackoff * 2^(attemptCount - 1)
			this.currentBackoffMs = Math.min(
				this.initialBackoffMs * Math.pow(2, this.attemptCount - 1),
				this.maxBackoffMs,
			)
```

Replace with:

```ts
			// initialBackoff * 2^(attemptCount - 1), capped, minus up to `jitter` of it
			this.currentBackoffMs = backoffDelayMs(this.attemptCount - 1, {
				baseMs: this.initialBackoffMs,
				capMs: this.maxBackoffMs,
				jitter: this.jitter,
			})
```

Do not touch the success branch (`setTimeout(..., this.successInterval)`), `WebAuthService.ts` or
`CloudSettingsService.ts`.

### Step 2. `packages/cloud/src/retry-queue/types.ts`

2a. Find:

```ts
	operation?: string
	lastError?: string
}
```

Replace with:

```ts
	operation?: string
	lastError?: string
	/** Epoch ms before which the retry timer skips this request (set after a failed retry). */
	nextAttemptAt?: number
}
```

2b. Find:

```ts
	retryDelay: number
```

Replace with:

```ts
	retryDelay: number // backoff after the first failed retry of a request; doubles per failure
```

### Step 3. `packages/cloud/src/retry-queue/RetryQueue.ts`

3a. Find:

```ts
import { EventEmitter } from "events"
import type { QueuedRequest, QueueStats, RetryQueueConfig, RetryQueueEvents, RetryQueueStorage } from "./types.js"
```

Replace with:

```ts
import { EventEmitter } from "events"

import { backoffDelayMs } from "@roo-code/core/browser"

import type { QueuedRequest, QueueStats, RetryQueueConfig, RetryQueueEvents, RetryQueueStorage } from "./types.js"

/** A failing request is retried at most this far apart. */
const MAX_RETRY_DELAY_MS = 30 * 60_000
/** Share of each per-request backoff taken off at random. */
const RETRY_JITTER = 0.2
```

3b. Find:

```ts
	public async retryAll(): Promise<void> {
		if (this.isProcessing) {
```

Replace with:

```ts
	/** Retries every queued request now, whatever its backoff. */
	public async retryAll(): Promise<void> {
		return this.processQueue(false)
	}

	/**
	 * Retries the requests whose backoff is over (`nextAttemptAt` in the past or
	 * unset). The timer calls this, so a request that keeps failing is tried less
	 * and less often instead of on every tick.
	 */
	private async processQueue(onlyDue: boolean): Promise<void> {
		if (this.isProcessing) {
```

(The rest of the old `retryAll` body becomes the body of `processQueue`, unchanged except 3c and 3d.)

3c. Find:

```ts
		const requests = Array.from(this.queue.values())
		if (requests.length === 0) {
			return
		}
```

Replace with:

```ts
		const now = Date.now()
		const requests = Array.from(this.queue.values()).filter(
			(request) => !onlyDue || (request.nextAttemptAt ?? 0) <= now,
		)
		if (requests.length === 0) {
			return
		}
```

3d. Find:

```ts
					} else {
						this.queue.set(request.id, request)
						this.emit("request-retry-failed", request, error as Error)
					}
```

Replace with:

```ts
					} else {
						request.nextAttemptAt =
							Date.now() +
							backoffDelayMs(request.retryCount - 1, {
								baseMs: this.config.retryDelay,
								capMs: MAX_RETRY_DELAY_MS,
								jitter: RETRY_JITTER,
							})
						this.queue.set(request.id, request)
						this.emit("request-retry-failed", request, error as Error)
					}
```

3e. Find:

```ts
		this.retryTimer = setInterval(() => {
			this.retryAll().catch((error) => {
```

Replace with:

```ts
		this.retryTimer = setInterval(() => {
			this.processQueue(true).catch((error) => {
```

With the defaults (`retryDelay` 60 s, tick 60 s, `maxRetries` 5) a failing request is tried at the next tick, then
again after about 1, 2, 4 and 8 minutes (5 tries in about 15 minutes), then dropped; before it was tried on 5
consecutive ticks (5 minutes). The 429 `Retry-After` pause
of the whole queue is unchanged. A request persisted by an older version has no `nextAttemptAt` and is due at once.

### Step 4. `packages/cloud/src/bridge/BridgeOrchestrator.ts` (on top of WP-D1)

4a. Find (as left by WP-D1):

```ts
const RETRY_MAX_MS = 60_000

/**
 * Delay before the given retry (0-based) of a bridge connection the server
 * refused: 1 s, 2 s, 4 s, ... capped at one minute. Also used by the extension
 * host to retry a bridge start that failed.
 */
export function bridgeRetryDelayMs(attempt: number): number {
	return backoffDelayMs(attempt, { baseMs: RETRY_BASE_MS, capMs: RETRY_MAX_MS })
}
```

Replace with:

```ts
const RETRY_MAX_MS = 60_000
/** Share of each delay taken off at random, so windows cut off together do not reconnect together. */
const RETRY_JITTER = 0.2

/**
 * Delay before the given retry (0-based) of a bridge connection the server
 * refused: 1 s, 2 s, 4 s, ... capped at one minute, each shortened at random by
 * up to 20 %. Also used by the extension host to retry a bridge start that failed.
 */
export function bridgeRetryDelayMs(attempt: number): number {
	return backoffDelayMs(attempt, { baseMs: RETRY_BASE_MS, capMs: RETRY_MAX_MS, jitter: RETRY_JITTER })
}
```

The signature stays `(attempt: number): number` (exported from `packages/cloud/src/index.ts`).

4b. Replace the `reconnect_failed` handler. It is three lines; the middle one contains an em dash (U+2014), so
locate it with the ASCII substring `giving up; remote control is offline` (unique in the repo) and replace the whole
three-line statement, from `manager.on("reconnect_failed", () => {` through its closing `})`, with:

```ts
		// Only fires when reconnectionAttempts is finite (the default is Infinity).
		// Do not stay offline: reconnect by hand like after a refused handshake.
		manager.on("reconnect_failed", () => {
			this.scheduleRefusedRetry(socket, "reconnect failed")
		})
```

4c. Find:

```ts
	private scheduleRefusedRetry(socket: Socket) {
		if (!this.started || this.refusedRetryTimer) return
		const delay = bridgeRetryDelayMs(this.refusedRetry++)
		this.log(`server refused the connection; retrying in ${Math.round(delay / 1000)} s`)
```

Replace with:

```ts
	private scheduleRefusedRetry(socket: Socket, reason = "server refused the connection") {
		if (!this.started || this.refusedRetryTimer) return
		const delay = bridgeRetryDelayMs(this.refusedRetry++)
		this.log(`${reason}; retrying in ${Math.round(delay / 1000)} s`)
```

Do not change the socket options, the `connect` handler (it resets `refusedRetry`), `stop()` or
`src/extension/bridge.ts`.

### Step 5. `docs/08-cloud.md`

5a. Find `  loop every 50 s (backoff on failure)` and replace with `  loop every 50 s (jittered backoff on failure)`.

5b. Find:

```
The API speaks the shapes of the original Roo Code Cloud (a Clerk-like auth API), so the extension's client code
did not have to change; the server's `auth/clerk_facade.py` produces those shapes.
```

Replace with:

```
The API speaks the shapes of the original Roo Code Cloud (a Clerk-like auth API), so the extension's client code
did not have to change; the server's `auth/clerk_facade.py` produces those shapes.

Retries use `backoffDelayMs` from `@roo-code/core` with up to 20 % jitter, so windows cut off together do not
retry together: `RefreshTimer` (token and settings refresh) doubles its failure backoff from 1 s; `RetryQueue` checks
every `networkCheckInterval` (60 s) but retries a failed request only after its own delay (`retryDelay`, 60 s,
doubled per failure, at most 30 minutes); the bridge reconnects after 1 s, 2 s, 4 s ... up to one minute after a
refused handshake, a failed start or socket.io's `reconnect_failed`.
```

## 7. Tests to add or change

### T1 (append): `packages/cloud/src/__tests__/RefreshTimer.test.ts`

Append at the end of the file (after the last `})`). The file already calls `vi.useFakeTimers()` at the top. Fails
without the fix: the first case sees the callback at 1000 ms, not 900 ms; the cap case likewise. The `jitter: 0` and
success-interval cases pin that nothing else changed.

```ts

describe("RefreshTimer failure backoff jitter (R11)", () => {
	afterEach(() => {
		vi.clearAllTimers()
		vi.restoreAllMocks()
	})

	it("takes up to 20 % off each failure backoff by default", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const callback = vi.fn().mockResolvedValue(false)
		const timer = new RefreshTimer({ callback, initialBackoffMs: 1000 })

		timer.start()
		await vi.advanceTimersByTimeAsync(0)
		expect(callback).toHaveBeenCalledTimes(1)

		// First failure: 1000 ms minus 10 % (0.2 * 0.5).
		await vi.advanceTimersByTimeAsync(899)
		expect(callback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(callback).toHaveBeenCalledTimes(2)

		// Second failure: 2000 ms minus 10 %.
		await vi.advanceTimersByTimeAsync(1799)
		expect(callback).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(callback).toHaveBeenCalledTimes(3)

		timer.stop()
	})

	it("keeps exact delays with jitter: 0", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const callback = vi.fn().mockResolvedValue(false)
		const timer = new RefreshTimer({ callback, initialBackoffMs: 1000, jitter: 0 })

		timer.start()
		await vi.advanceTimersByTimeAsync(999)
		expect(callback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(callback).toHaveBeenCalledTimes(2)

		timer.stop()
	})

	it("applies the jitter after the cap", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const callback = vi.fn().mockResolvedValue(false)
		const timer = new RefreshTimer({ callback, initialBackoffMs: 1000, maxBackoffMs: 1500 })

		timer.start()
		await vi.advanceTimersByTimeAsync(900) // attempt 2 (after 900 ms)
		await vi.advanceTimersByTimeAsync(1349) // second backoff: min(2000, 1500) * 0.9 = 1350 ms
		expect(callback).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(callback).toHaveBeenCalledTimes(3)

		timer.stop()
	})

	it("never jitters the success interval", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5)
		const callback = vi.fn().mockResolvedValue(true)
		const timer = new RefreshTimer({ callback, successInterval: 5000 })

		timer.start()
		await vi.advanceTimersByTimeAsync(4999)
		expect(callback).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(callback).toHaveBeenCalledTimes(2)

		timer.stop()
	})
})
```

### T2 (new): `packages/cloud/src/retry-queue/__tests__/RetryQueue.backoff.test.ts`

Fake timers and a fixed system time; `fetch` stubbed to fail; `Math.random` pinned. Fails without the fix: the timer
retries on every tick (3 fetches by t = 3 s instead of 2) and `nextAttemptAt` is undefined.

```ts
// npx vitest run src/retry-queue/__tests__/RetryQueue.backoff.test.ts

import type { Mock } from "vitest"

import { RetryQueue } from "../RetryQueue.js"
import type { QueuedRequest, RetryQueueStorage } from "../types.js"

function createStorage(initial: QueuedRequest[] = []) {
	const data = new Map<string, unknown>([["roo.retryQueue", initial]])
	const storage: RetryQueueStorage = {
		get: <T>(key: string) => data.get(key) as T | undefined,
		update: async (key: string, value: unknown) => {
			data.set(key, value)
		},
	}
	return { storage, persisted: () => data.get("roo.retryQueue") as QueuedRequest[] }
}

describe("RetryQueue per-request backoff (R11)", () => {
	let fetchMock: Mock
	let queue: RetryQueue | undefined

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-09-27T12:00:00Z"))
		vi.spyOn(Math, "random").mockReturnValue(0)
		fetchMock = vi.fn().mockRejectedValue(new Error("Network error"))
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		queue?.dispose()
		queue = undefined
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	function createQueue(storage: RetryQueueStorage) {
		queue = new RetryQueue(storage, { networkCheckInterval: 1_000, retryDelay: 1_000, maxRetries: 0 }, () => {})
		return queue
	}

	it("the timer waits longer after every failure instead of retrying on every tick", async () => {
		const { storage } = createStorage()
		const q = createQueue(storage)
		await q.enqueue("https://api.example.com/events", { method: "POST" }, "telemetry")

		// Tick 1 (t = 1 s): first retry fails, next attempt after 1 s.
		await vi.advanceTimersByTimeAsync(1_000)
		expect(fetchMock).toHaveBeenCalledTimes(1)

		// Tick 2 (t = 2 s): due again, fails, next attempt after 2 s (t = 4 s).
		await vi.advanceTimersByTimeAsync(1_000)
		expect(fetchMock).toHaveBeenCalledTimes(2)

		// Tick 3 (t = 3 s): still backing off.
		await vi.advanceTimersByTimeAsync(1_000)
		expect(fetchMock).toHaveBeenCalledTimes(2)

		// Tick 4 (t = 4 s): due, fails, next attempt after 4 s (t = 8 s).
		await vi.advanceTimersByTimeAsync(1_000)
		expect(fetchMock).toHaveBeenCalledTimes(3)

		await vi.advanceTimersByTimeAsync(3_000)
		expect(fetchMock).toHaveBeenCalledTimes(3)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(fetchMock).toHaveBeenCalledTimes(4)
	})

	it("retryAll() still retries every request at once, whatever its backoff", async () => {
		const { storage } = createStorage()
		const q = createQueue(storage)
		await q.enqueue("https://api.example.com/events", { method: "POST" }, "telemetry")

		const first = q.retryAll()
		await vi.advanceTimersByTimeAsync(100)
		await first
		const second = q.retryAll()
		await vi.advanceTimersByTimeAsync(100)
		await second

		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it("persists the next attempt time with the request", async () => {
		const { storage, persisted } = createStorage()
		const q = createQueue(storage)
		await q.enqueue("https://api.example.com/events", { method: "POST" }, "telemetry")

		const run = q.retryAll()
		await vi.advanceTimersByTimeAsync(100)
		await run

		expect(persisted()[0]!.nextAttemptAt).toBe(new Date("2026-09-27T12:00:01Z").getTime())
	})

	it("takes up to 20 % off each backoff at random", async () => {
		vi.mocked(Math.random).mockReturnValue(0.5)
		const { storage, persisted } = createStorage()
		const q = createQueue(storage)
		await q.enqueue("https://api.example.com/events", { method: "POST" }, "telemetry")

		const run = q.retryAll()
		await vi.advanceTimersByTimeAsync(100)
		await run

		expect(persisted()[0]!.nextAttemptAt).toBe(new Date("2026-09-27T12:00:00.900Z").getTime())
	})

	it("retries a request persisted by an older version (no nextAttemptAt) on the first tick", async () => {
		const { storage } = createStorage([
			{
				id: "old-1",
				url: "https://api.example.com/events",
				options: { method: "POST" },
				timestamp: Date.now() - 60_000,
				retryCount: 2,
				type: "telemetry",
			},
		])
		createQueue(storage)

		await vi.advanceTimersByTimeAsync(1_000)

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})
```

### T3 (change): `packages/cloud/src/bridge/__tests__/BridgeOrchestrator.test.ts`

The existing DEF-C50 cases pin 999/1 ms and 1999/1 ms, so pin `Math.random` to 0 (no jitter) for the whole file,
replace the `reconnect_failed` case (it asserted the old "giving up ... offline" log) and add a jitter case.

T3a. Find:

```ts
import { BridgeOrchestrator, type BridgeEventSource } from "../BridgeOrchestrator.js"
```

Replace with:

```ts
import { BridgeOrchestrator, bridgeRetryDelayMs, type BridgeEventSource } from "../BridgeOrchestrator.js"
```

T3b. Find:

```ts
	beforeEach(() => {
		vi.useFakeTimers()
		socket = new FakeEmitter()
```

Replace with:

```ts
	beforeEach(() => {
		vi.useFakeTimers()
		// No jitter, so the retry delays below are exact (R11 jitter has its own test).
		vi.spyOn(Math, "random").mockReturnValue(0)
		socket = new FakeEmitter()
```

T3c. Find:

```ts
	afterEach(() => {
		vi.useRealTimers()
	})

	function build() {
```

Replace with:

```ts
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	function build() {
```

T3d. Find `	it("logs reconnect_failed when manager gives up", async () => {` and replace that line with:

```ts
	it("reconnects by hand after reconnect_failed instead of staying offline (R11)", async () => {
```

T3e. In the same test, find:

```ts
		manager.fire("reconnect_failed")
		expect(logs.some((l) => l.includes("reconnect failed") && l.includes("offline"))).toBe(true)
	})
```

Replace with:

```ts
		socket.connected = false
		manager.fire("reconnect_failed")
		expect(logs.some((l) => l.includes("reconnect failed; retrying in 1 s"))).toBe(true)

		await vi.advanceTimersByTimeAsync(999)
		expect(socket.connectCalls).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(socket.connectCalls).toBe(1)
	})

	it("shortens each retry delay by up to 20 % at random (R11)", () => {
		vi.mocked(Math.random).mockReturnValue(0.5)
		expect([0, 1, 2, 10].map(bridgeRetryDelayMs)).toEqual([900, 1_800, 3_600, 54_000])

		vi.mocked(Math.random).mockReturnValue(0.999999)
		expect(bridgeRetryDelayMs(0)).toBe(800)
	})
```

Without step 4 the replaced case fails (no retry is scheduled) and the jitter case fails (1000, 2000, ...).

### T4 (change): `src/extension/__tests__/bridge.spec.ts`

It imports the real `bridgeRetryDelayMs` and pins 999/1 and 1999/1 ms. Without this change it fails 1 of 3 cases
once jitter is on (checked).

T4a. Find `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"` and replace with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
```

T4b. Find:

```ts
	let subscriptions: Array<{ dispose: () => void }>

	beforeEach(() => {
		vi.useFakeTimers()
```

Replace with:

```ts
	let subscriptions: Array<{ dispose: () => void }>
	let randomSpy: MockInstance<typeof Math.random>

	beforeEach(() => {
		vi.useFakeTimers()
		// No jitter, so the retry delays below are exact (R11).
		randomSpy = vi.spyOn(Math, "random").mockReturnValue(0)
```

T4c. Find:

```ts
		subscriptions.forEach((s) => s.dispose())
		vi.useRealTimers()
```

Replace with:

```ts
		subscriptions.forEach((s) => s.dispose())
		vi.useRealTimers()
		randomSpy.mockRestore()
```

### Existing tests that must pass unchanged

- `packages/cloud/src/retry-queue/__tests__/RetryQueue.test.ts` (all 31 cases; they use `retryAll()`, which still
  retries everything).
- `packages/cloud/src/__tests__/WebAuthService.spec.ts` (exact `RefreshTimer` constructor arguments),
  `CloudSettingsService.test.ts`, `CloudService.test.ts`, `TelemetryClient*.ts`.
- The rest of `BridgeOrchestrator.test.ts` (DEF-C50 cases rely on T3b).

## 8. Commands to run (exact, from which directory) and the expected result

1. Prove the tests: add T1, T2 and T3 first (steps 1-4 not applied), then `cd packages/cloud && npx vitest run`
   -> 7 failed (2 in BridgeOrchestrator.test, 2 in RefreshTimer.test, 3 in RetryQueue.backoff.test).
2. Apply steps 1-4, same command -> 329 passed (319 + 10).
3. `cd src && npx vitest run extension/__tests__/bridge.spec.ts` -> 3 passed (after T4; 1 fails before T4 once
   step 4 is in).
4. `pnpm --filter @roo-code/cloud check-types` -> no errors. `pnpm --filter tumble-code check-types` -> no errors.
5. `cd packages/cloud && npx eslint src/RefreshTimer.ts src/retry-queue src/bridge src/__tests__/RefreshTimer.test.ts --max-warnings=0`
   and `cd src && npx eslint extension/__tests__/bridge.spec.ts --max-warnings=0` -> no output.
6. Root: `npx prettier --check packages/cloud/src/RefreshTimer.ts packages/cloud/src/retry-queue packages/cloud/src/bridge packages/cloud/src/__tests__/RefreshTimer.test.ts src/extension/__tests__/bridge.spec.ts docs/08-cloud.md`
   -> all clean.
7. `cd src && npx vitest run extension core/webview/__tests__/CloudProfileSync.spec.ts` -> no new failures (these
   mock `@roo-code/cloud`; nothing they use changed).

## 9. Do not touch / pitfalls

- Public API: keep `RefreshTimerOptions` (only the optional `jitter` is added), `RetryQueue`'s public methods and
  `retryAll()` semantics ("retry everything now"), `RetryQueueConfig` fields, `QueuedRequest` (only the optional
  `nextAttemptAt`), and `bridgeRetryDelayMs(attempt)`. `packages/cloud/src/index.ts` exports stay the same.
- Do not pass `jitter` from `WebAuthService` or `CloudSettingsService`: `WebAuthService.spec.ts` pins the exact
  constructor argument.
- Never jitter the `RefreshTimer` success interval (token refresh at 50 s for a 60 s JWT).
- Keep `retryAll()` public and immediate; only the timer honors `nextAttemptAt`.
- Keep the 429 `Retry-After` queue pause as it is.
- Do not add socket.io options (`reconnectionAttempts`, `reconnectionDelayMax`); socket.io's own reconnection already
  has jitter.
- Cloud imports `@roo-code/core/browser` only (WP-D1 rule).
- `self-hosted-cloudapi/` (Python) is not part of this item; its do-not-touch entries (the `/bridge` socket path etc.)
  are unaffected.
- Tests that stub `Math.random` must restore it (`vi.restoreAllMocks()` or `mockRestore()`), or later tests get
  constant random ids (`RetryQueue.enqueue` uses `Math.random` for ids).
- Known flaky tests F1 and F2 are unrelated.

## 10. Acceptance checklist (checkboxes)

- [ ] WP-D1 is merged; `packages/cloud` depends on `@roo-code/core`.
- [ ] `RefreshTimer` uses `backoffDelayMs` with default jitter 0.2 on failures only.
- [ ] `RetryQueue`: timer uses `processQueue(true)`; failed requests get `nextAttemptAt`; `retryAll()` unchanged in
      behavior.
- [ ] `bridgeRetryDelayMs` jittered; `reconnect_failed` re-arms via `scheduleRefusedRetry`.
- [ ] T1-T4 in place; the 7 new cases failed before steps 1-4; all 329 cloud tests and the 3 bridge.spec cases pass.
- [ ] check-types, eslint, prettier clean; `docs/08-cloud.md` updated.
- [ ] `.changeset/cloud-client-backoff-jitter.md` and `ai_plans/2026-09-27_r11-cloud-client-backoff.md` added.

## 11. Commit, changeset and PR text

Commit title: `fix(cloud): jittered, per-request backoff in the cloud client (R11)`

Commit body:

```
After a cloud server restart every window retried at the same moments:
RefreshTimer and the bridge backed off without jitter, and RetryQueue
resent every queued request on each 60 s tick until it gave up.

- RefreshTimer: failure backoff via backoffDelayMs with up to 20 % jitter
  (new optional `jitter`, default 0.2); the success interval is unchanged.
- RetryQueue: each failed request gets nextAttemptAt (retryDelay doubled per
  failure, at most 30 minutes, 20 % jitter); the timer retries only due
  requests. retryAll() still retries everything at once.
- Bridge: bridgeRetryDelayMs has 20 % jitter, and reconnect_failed now
  schedules a manual reconnect instead of leaving remote control offline
  (it only fires with a finite reconnectionAttempts).

<the commit attribution trailers your harness requires>
```

`.changeset/cloud-client-backoff-jitter.md`:

```md
---
"tumble-code": patch
---

Spread out cloud retries after an outage. Token and settings refreshes and the remote-control bridge now wait a slightly random time before retrying, so many VS Code windows no longer hit a restarting cloud server at the same moment. Telemetry that could not be sent is retried with a growing delay per request (about 1, 2, 4 and 8 minutes) instead of every minute. If the bridge's automatic reconnection ever gives up, it now keeps trying instead of leaving remote control offline.
```

`ai_plans/2026-09-27_r11-cloud-client-backoff.md`:

```md
# R11: cloud client backoff

Item R11 of `2026-09-27_simplification-roadmap.md`. Builds on D1 (`backoffDelayMs`).

## Problem

- `RefreshTimer` and `bridgeRetryDelayMs` doubled their delay without jitter, so windows retried in lock step.
- `RetryQueue` retried every queued request on every 60 s tick; `retryDelay` was never used.
- The bridge logged "giving up" on socket.io's `reconnect_failed`. That event cannot fire with the current options
  (`reconnectionAttempts` defaults to Infinity), so this was a latent risk, not an observed failure.

## Change

- `RefreshTimer`: optional `jitter` (default 0.2) on failure backoff only.
- `RetryQueue`: `nextAttemptAt` per request (retryDelay * 2^(n-1), cap 30 min, jitter 0.2); the timer runs
  `processQueue(true)`, `retryAll()` still retries everything.
- `bridgeRetryDelayMs`: jitter 0.2; `reconnect_failed` calls `scheduleRefusedRetry`.

## Tests

- `RefreshTimer.test.ts`: jittered failure delay, cap then jitter, `jitter: 0` exact, success interval exact.
- `RetryQueue.backoff.test.ts`: timer backoff 1 s, 2 s, 4 s; `retryAll` immediate; `nextAttemptAt` persisted and
  jittered; old persisted requests due at once.
- `BridgeOrchestrator.test.ts`: `reconnect_failed` re-arms; jitter values. `bridge.spec.ts` pins `Math.random`.
```

PR body outline:

- Title = commit title; "Depends on #<D1 PR>".
- Problem, including the socket.io finding (reconnect_failed cannot fire today) so reviewers know the bridge part is
  defensive plus jitter.
- Change per class; retry timeline with defaults (before: 5 tries on 5 consecutive 60 s ticks; after: waits of about 1, 2, 4
  and 8 minutes between the 5 tries).
- Tests and commands with results.
- End with the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If WP-D1 is not merged or `@roo-code/core/browser` does not export `backoffDelayMs`, stop; do not copy the formula
  into `packages/cloud`.
- If an existing `RetryQueue.test.ts` case fails, check it calls `retryAll()` (must stay immediate). If it relies on
  the timer, report the case; do not weaken the per-request backoff.
- If `WebAuthService.spec.ts` fails on the `RefreshTimer` constructor arguments, a call site was changed by mistake;
  revert that call site.
- If fake-timer tests hang, check that the failure path's `await this.delay(100)` is advanced
  (`advanceTimersByTimeAsync`), and report the case with its output.
