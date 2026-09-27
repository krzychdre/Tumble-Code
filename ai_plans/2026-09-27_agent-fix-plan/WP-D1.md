# WP-D1: One shared exponential backoff and countdown helper

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/d1-shared-backoff      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Add one pure helper `backoffDelayMs(attempt, { baseMs, capMs, jitter })` and one abortable `countdown(seconds,
onTick, { isAborted, sleep })` to `packages/core`, with unit tests there. Replace the eight hand-written
exponential backoff formulas (RetryHandler, RemoteConfigLoader, base-http-embedder, rate-limit-gate, code-index
scanner, file-watcher, CodeIndexManager, and the bridge retry in `@roo-code/cloud` that `src/extension/bridge.ts`
uses) with calls to it. Inside `RetryHandler`, the rate-limit delay math and the two countdown loops become one
function each. Every delay stays exactly what it is today (jitter defaults to 0); the only behavior change is that
the provider rate-limit countdown now stops as soon as the task is aborted.

## 2. Why it matters (user-visible effect, 2-4 sentences)

Today a backoff change (for example adding jitter, item R11) has to be made in eight places with eight slightly
different formulas. After this item there is one function to read, test and change. Users see no difference
except that pressing Stop during a provider rate-limit wait ends the wait before the next tick instead of after
it (today the wait already ends one tick later, because `say()` throws on an aborted task).

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md` (test placement rules) and `docs/architecture.md` (section "Allowed dependency directions" and "Do not
  touch without a dedicated item": `lastGlobalApiRequestTime` is listed there).
- `packages/core/package.json` (`exports`: `.`, `./browser`, `./cli`, `./fs`, `./path`) and
  `packages/core/src/utils/index.ts`, `packages/core/src/browser.ts`, `packages/core/src/index.ts`.
- `packages/core/src/__tests__/browser-entry.spec.ts` (everything reachable from `./browser` may import only
  `@roo-code/types`; the new file imports nothing).
- `src/core/task/RetryHandler.ts`: `calculateBackoffDelay`, `showCountdownUX`, `backoffAndAnnounce`,
  `maybeWaitForProviderRateLimit`, `getLastGlobalApiRequestTime`.
- `src/core/task/TaskAskSay.ts`: `say` (first lines: throws when `this.access.abort` is true).
- `src/core/task/__tests__/Task.spec.ts`: `vi.mock("delay", ...)` near line 22, tests "should handle API retry with
  countdown", "should not apply retry delay twice", describe "Subtask Rate Limiting".
- `src/services/marketplace/RemoteConfigLoader.ts`: `fetchWithRetry`.
- `src/services/code-index/embedders/rate-limit-gate.ts`: `RateLimitGate.recordRateLimit`.
- `src/services/code-index/embedders/base-http-embedder.ts`: `embedBatchWithRetries`.
- `src/services/code-index/processors/scanner.ts`: the retry loop in `processBatch` (near line 497).
- `src/services/code-index/processors/file-watcher.ts`: the `upsertPoints` retry loop (near line 447).
- `src/services/code-index/manager.ts`: `_scheduleAutoRetry`.
- `packages/cloud/src/bridge/BridgeOrchestrator.ts`: `bridgeRetryDelayMs`, `RETRY_BASE_MS`, `RETRY_MAX_MS`.
- `src/extension/bridge.ts`: `setupRemoteControlBridge` (calls `bridgeRetryDelayMs`; needs no edit).
- `packages/cloud/package.json` (`dependencies`: today only `@roo-code/types`, `jwt-decode`, `socket.io-client`,
  `zod`).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

### 4.1 `src/core/task/RetryHandler.ts`, `calculateBackoffDelay` (near line 84)

```ts
	calculateBackoffDelay(retryAttempt: number, error: any, state: any): number {
		const baseDelay = state?.requestDelaySeconds || 5

		let exponentialDelay = Math.min(
			Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
			MAX_EXPONENTIAL_BACKOFF_SECONDS,
		)

		// Respect provider rate limit window
		let rateLimitDelay = 0
		const rateLimit = (state?.apiConfiguration ?? this.access.apiConfiguration)?.rateLimitSeconds || 0
		if (getLastGlobalApiRequestTime() && rateLimit > 0) {
			const elapsed = performance.now() - getLastGlobalApiRequestTime()!
			rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
		}

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
```

### 4.2 `src/core/task/RetryHandler.ts`, `showCountdownUX` (near line 119)

```ts
	async showCountdownUX(seconds: number, headerText: string): Promise<void> {
		for (let i = seconds; i > 0; i--) {
			if (this.access.abort) {
				throw new Error(`[Task#${this.access.taskId}] Aborted during retry countdown`)
			}

			await this.access.askSay.say(
				"api_req_retry_delayed",
				`${headerText}<retry_timer>${i}</retry_timer>`,
				undefined,
				true,
			)
			await delay(1000)
		}

		await this.access.askSay.say("api_req_retry_delayed", headerText, undefined, false)
	}
```

### 4.3 `src/core/task/RetryHandler.ts`, `maybeWaitForProviderRateLimit` (near line 191)

```ts
	async maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void> {
		const state = await this.access.providerRef.deref()?.getState()
		const rateLimitSeconds =
			state?.apiConfiguration?.rateLimitSeconds ?? this.access.apiConfiguration?.rateLimitSeconds ?? 0

		if (rateLimitSeconds <= 0 || !getLastGlobalApiRequestTime()) {
			return
		}

		const now = performance.now()
		const timeSinceLastRequest = now - getLastGlobalApiRequestTime()!
		const rateLimitDelay = Math.ceil(
			Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - timeSinceLastRequest) / 1000),
		)

		// Only show countdown UX on first attempt
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			for (let i = rateLimitDelay; i > 0; i--) {
				const delayMessage = JSON.stringify({ seconds: i })
				await this.access.askSay.say("api_req_rate_limit_wait", delayMessage, undefined, true)
				await delay(1000)
			}
			await this.access.askSay.say("api_req_rate_limit_wait", undefined, undefined, false)
		}
	}
```

The rate-limit math `Math.ceil(Math.min(r, Math.max(0, r * 1000 - elapsed) / 1000))` is written twice (4.1 and
4.3), the countdown loop is written twice (4.2 and 4.3), and the loop in 4.3 never looks at `this.access.abort`.

### 4.4 `src/services/marketplace/RemoteConfigLoader.ts`, `fetchWithRetry` (near line 99)

```ts
			} catch (error) {
				lastError = error as Error
				if (i < maxRetries - 1) {
					// Exponential backoff: 1s, 2s, 4s
					const delay = Math.pow(2, i) * 1000
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
```

### 4.5 `src/services/code-index/embedders/rate-limit-gate.ts`, `recordRateLimit` (near line 32)

```ts
	/** Records a 429 and starts (or extends) the backoff. */
	recordRateLimit(): void {
		const now = Date.now()
		this.consecutiveErrors = now - this.lastErrorAt < ESCALATION_WINDOW_MS ? this.consecutiveErrors + 1 : 1
		this.lastErrorAt = now
		this.resetAt = now + Math.min(BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1), MAX_BACKOFF_MS)
	}
```

### 4.6 `src/services/code-index/embedders/base-http-embedder.ts`, `embedBatchWithRetries` (near line 247)

```ts
				if (this.isRateLimitError(error)) {
					gate.recordRateLimit()
					if (attempt < MAX_BATCH_RETRIES - 1) {
						const delayMs = Math.max(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt), gate.remainingDelay())
						console.warn(
							t("embeddings:rateLimitRetry", {
								delayMs,
								attempt: attempt + 1,
								maxRetries: MAX_BATCH_RETRIES,
							}),
						)
						await new Promise((resolve) => setTimeout(resolve, delayMs))
						continue
```

`INITIAL_RETRY_DELAY_MS = 500` and `MAX_BATCH_RETRIES = 3` come from `src/services/code-index/constants/index.ts`.

### 4.7 `src/services/code-index/processors/scanner.ts`, `processBatch` retry (near line 497)

```ts
				if (attempts < MAX_BATCH_RETRIES) {
					const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
```

### 4.8 `src/services/code-index/processors/file-watcher.ts`, upsert retry (near line 448)

```ts
							await new Promise((resolve) =>
								setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)),
							)
```

### 4.9 `src/services/code-index/manager.ts`, `_scheduleAutoRetry` (near line 393)

```ts
		if (this._retryTimer) {
			return
		}

		const delay = Math.min(
			CodeIndexManager.AUTO_RETRY_MAX_DELAY_MS,
			CodeIndexManager.AUTO_RETRY_INITIAL_DELAY_MS * 2 ** this._retryAttempt,
		)
```

### 4.10 `packages/cloud/src/bridge/BridgeOrchestrator.ts`, `bridgeRetryDelayMs` (near line 20)

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

### 4.11 `src/extension/bridge.ts`, `start` (near line 118); the eighth site, which delegates to 4.10

```ts
		try {
			await orchestrator.start()
			startRetry = 0
			log("[bridge] remote control bridge connected")
		} catch (error) {
			orchestrator = null
			const delay = bridgeRetryDelayMs(startRetry++)
			log(
				`[bridge] failed to start: ${error instanceof Error ? error.message : String(error)}; ` +
					`retrying in ${Math.round(delay / 1000)} s`,
			)
			startRetryTimer = setTimeout(() => {
				startRetryTimer = null
				if (isAuthenticated()) void start()
			}, delay)
		}
```

### 4.12 Not in scope

- `packages/cloud/src/RefreshTimer.ts` `scheduleNextAttempt` (`Math.min(initialBackoffMs * Math.pow(2,
  attemptCount - 1), maxBackoffMs)`): moved onto the helper by WP-R11 together with jitter.
- `packages/build/src/esbuild.ts` near line 71 (`Math.min(baseDelay * Math.pow(2, attempt - 1), 2000)`): build
  tooling, `packages/build` does not depend on `packages/core` and must not start to. Leave it.

## 5. Root cause / analysis

VERIFIED (read or run on the working tree at `aa173b9`):

- `grep -rn --include=*.ts -E "Math\.pow|2 \*\*|[bB]ackoff" src packages apps` lists exactly the eight sites above
  plus `RefreshTimer.ts` and `packages/build/src/esbuild.ts` (see 4.12). `src/extension/bridge.ts` has no formula of
  its own: it calls `bridgeRetryDelayMs` from `@roo-code/cloud` (4.11), so the formula to replace is 4.10.
- Old formulas and their exact new equivalents (all without jitter):

  | Site | Old | New |
  | --- | --- | --- |
  | RetryHandler (seconds) | `min(ceil(b * 2^n), 600)` | `ceil(backoffDelayMs(n, { baseMs: b, capMs: 600 }))` |
  | RemoteConfigLoader | `2^i * 1000` | `backoffDelayMs(i, { baseMs: 1000 })` |
  | rate-limit-gate | `min(5000 * 2^(k-1), 300000)` | `backoffDelayMs(k - 1, { baseMs: 5000, capMs: 300000 })` |
  | base-http-embedder | `max(500 * 2^n, gate)` | `max(backoffDelayMs(n, { baseMs: 500 }), gate)` |
  | scanner | `500 * 2^(a-1)` | `backoffDelayMs(a - 1, { baseMs: 500 })` |
  | file-watcher | `500 * 2^(r-1)` | `backoffDelayMs(r - 1, { baseMs: 500 })` |
  | CodeIndexManager | `min(300000, 5000 * 2^n)` | `backoffDelayMs(n, { baseMs: 5000, capMs: 300000 })` |
  | bridgeRetryDelayMs | `min(1000 * 2^n, 60000)` | `backoffDelayMs(n, { baseMs: 1000, capMs: 60000 })` |

  RetryHandler: `ceil(min(x, 600)) == min(ceil(x), 600)` for every x because 600 is a whole number, and
  multiplying by a power of two is exact in floating point, so the seconds are identical, including fractional
  `requestDelaySeconds` (checked by the new spec: 2.5 -> 3, 0.3 * 2 -> 1).
- The helper returns the unrounded value when jitter is 0, so no caller changes by rounding.
- `say()` (`TaskAskSay.say`) throws `[RooCode#say] task ... aborted` when the task is aborted, so the rate-limit
  countdown already stops one tick after an abort. After the change it stops before the next tick with
  `Error("[Task#<id>] Aborted during rate limit wait")`. Callers of `maybeWaitForProviderRateLimit`
  (`TaskApiLoop.ts` near lines 550 and 1314) let the error propagate either way; nothing matches its text
  (`grep -rn "Aborted during" src` finds only RetryHandler's own retry-countdown text).
- `Task.spec.ts` mocks the `delay` npm package and asserts `delay` was called 3 times with `1000` and the exact
  `say` calls. The helper therefore takes an injectable `sleep`; RetryHandler passes `(ms) => delay(ms)` so the mock
  still sees every tick.
- `packages/cloud` does not depend on `packages/core` today. It must, for 4.10. It imports
  `@roo-code/core/browser` (the entry that may only reach `@roo-code/types`, enforced by `browser-entry.spec.ts`),
  so cloud does not pull in `execa`, `openai` or `proper-lockfile`. `src/shared/*` already imports that entry in 9
  files. The new graph edge `cloud --> core/browser` has no cycle (`packages/core` imports only
  `@roo-code/types`).
- A dry run in a scratch copy (not in the repo) confirmed: the new core spec passes (14 tests) and
  `browser-entry.spec.ts` still passes with the helper exported from `utils/index.ts`; `tsc --noEmit` passes for
  `packages/core` and for `packages/cloud` importing `@roo-code/core/browser` through a `node_modules` link; all 319
  `packages/cloud` tests pass with the new `bridgeRetryDelayMs`; the new `RetryHandler.spec.ts` passes 10/10 on the
  new code and fails exactly 1 case ("stops the countdown when the task is aborted (D1)") on the old code.
- Baseline on the unchanged tree: `packages/core` 488 tests pass, `packages/cloud` 319 pass, and
  `cd src && npx vitest run core/task/__tests__/Task.spec.ts core/task/__tests__/grace-retry-errors.spec.ts
  core/task/__tests__/build-tools-slim-toolset.spec.ts services/code-index services/marketplace extension
  core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts
  core/tools/__tests__/RunParallelTasksTool.spec.ts` passes 883 tests in 49 files.

HYPOTHESIS H1: four specs replace the whole `@roo-code/core` module with a factory that has no
`backoffDelayMs`/`countdown`/`CountdownAbortedError`: `src/core/task/__tests__/build-tools-slim-toolset.spec.ts`,
`src/core/task/__tests__/grace-retry-errors.spec.ts`,
`src/core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts`,
`src/core/tools/__tests__/RunParallelTasksTool.spec.ts`. They import RetryHandler indirectly. Vitest only throws
(`[vitest] No "backoffDelayMs" export is defined on the "@roo-code/core" mock`) when the missing export is used, and
none of them is expected to reach a backoff. Confirm with the command in section 8 step 6. If one fails with that
message, change only that spec's factory from `vi.mock("@roo-code/core", () => ({` to
`vi.mock("@roo-code/core", async (importOriginal) => ({ ...(await importOriginal<typeof import("@roo-code/core")>()),`
(keep the existing keys after the spread; this is the pattern `webviewMessageHandler.routing.spec.ts` already uses).

HYPOTHESIS H2: `pnpm install --offline` can link the new workspace dependency without network. If it fails with a
fetch error, run `pnpm install` (the proxy allows the registry). Either way only `pnpm-lock.yaml` and
`node_modules` change; see the expected lockfile diff in step 12.

## 6. Step-by-step changes

Apply in this order. Tabs for indentation (prettier: `useTabs`, width 120).

### Step 1. Create `packages/core/src/utils/backoff.ts` with exactly this content

```ts
/**
 * Exponential backoff and a one-second countdown, shared by every retry loop (D1).
 *
 * The math has no unit of its own. Every caller passes milliseconds except
 * `RetryHandler`, which counts in seconds because its countdown ticks once a second.
 */

export interface BackoffOptions {
	/** Delay before the first retry (attempt 0). */
	baseMs: number
	/** Upper bound for the delay, applied before jitter. Default: no bound. */
	capMs?: number
	/**
	 * Share of the delay, from 0 to 1, that may be taken off at random, so clients that
	 * failed together do not all retry at the same moment. Jitter only shortens the wait:
	 * the result stays between (1 - jitter) * delay and delay. Default 0: exact delays.
	 */
	jitter?: number
	/** Random source returning a number in [0, 1). Default `Math.random`. For tests. */
	random?: () => number
}

/**
 * Delay before retry number `attempt` (0-based): `min(baseMs * 2^attempt, capMs)`,
 * minus up to `jitter` of it. Without jitter the value is returned unrounded, so callers
 * that relied on exact delays keep them.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
	const { baseMs, capMs = Number.POSITIVE_INFINITY, jitter = 0, random = Math.random } = options
	const capped = Math.min(baseMs * 2 ** Math.max(0, attempt), capMs)
	const share = Math.min(1, Math.max(0, jitter))

	if (share === 0) {
		return capped
	}

	return Math.round(capped - capped * share * random())
}

/** Thrown by {@link countdown} when `isAborted` returns true before a tick. */
export class CountdownAbortedError extends Error {
	constructor() {
		super("Countdown aborted")
		this.name = "CountdownAbortedError"
	}
}

export interface CountdownOptions {
	/** Checked before every tick; when it returns true the countdown throws {@link CountdownAbortedError}. */
	isAborted?: () => boolean
	/** Waits between ticks. Default: a `setTimeout` promise. Callers whose tests mock a sleep helper pass it here. */
	sleep?: (ms: number) => Promise<unknown>
	/** Length of one tick in milliseconds. Default 1000. */
	tickMs?: number
}

/**
 * Calls `onTick(remaining)` for remaining = seconds, seconds - 1, ... while it is above 0,
 * waiting one tick after each call. Stops with {@link CountdownAbortedError} as soon as
 * `isAborted` returns true. Sends no final message: the caller does that.
 */
export async function countdown(
	seconds: number,
	onTick: (remaining: number) => unknown,
	options: CountdownOptions = {},
): Promise<void> {
	const { isAborted, sleep = defaultSleep, tickMs = 1000 } = options

	for (let remaining = seconds; remaining > 0; remaining--) {
		if (isAborted?.()) {
			throw new CountdownAbortedError()
		}

		await onTick(remaining)
		await sleep(tickMs)
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
```

### Step 2. Export it: `packages/core/src/utils/index.ts`

Find (the whole file today):

```ts
export { findLast, findLastIndex } from "./array.js"
```

Replace with:

```ts
export { findLast, findLastIndex } from "./array.js"
export {
	backoffDelayMs,
	countdown,
	CountdownAbortedError,
	type BackoffOptions,
	type CountdownOptions,
} from "./backoff.js"
```

This makes the helper available from `@roo-code/core` (host, `src/`), `@roo-code/core/browser` (cloud) and
`@roo-code/core/cli`, because all three entries re-export `./utils/index.js`. Do not touch `index.ts`,
`browser.ts` or `cli.ts`.

### Step 3. Create `packages/core/src/utils/__tests__/backoff.spec.ts` (full content in section 7, test T1)

### Step 4. `src/core/task/RetryHandler.ts` (five edits; behavior identical except the abort check)

RetryHandler and `lastGlobalApiRequestTime` are on the do-not-touch list (`docs/architecture.md`). Do not change
the module-level `lastGlobalApiRequestTime` variable, `resetGlobalApiRequestTime`, `getLastGlobalApiRequestTime`,
`setLastGlobalApiRequestTime`, the `requestDelaySeconds || 5` default (that is roadmap item D2, not this one), the
RetryInfo 429 branch, the header text, or any `say` type or argument. Only the math and the loops move.

4a. Find:

```ts
import delay from "delay"
import { type ProviderSettings } from "@roo-code/types"
```

Replace with:

```ts
import delay from "delay"
import { backoffDelayMs, countdown, CountdownAbortedError } from "@roo-code/core"
import { type ProviderSettings } from "@roo-code/types"
```

4b. Find:

```ts
export function setLastGlobalApiRequestTime(time: number): void {
	lastGlobalApiRequestTime = time
}
```

Replace with:

```ts
export function setLastGlobalApiRequestTime(time: number): void {
	lastGlobalApiRequestTime = time
}

/**
 * Whole seconds left in the provider rate limit window that started at
 * `lastRequestTime` (a `performance.now()` value), never more than the window.
 */
function rateLimitWaitSeconds(rateLimitSeconds: number, lastRequestTime: number): number {
	const elapsedMs = performance.now() - lastRequestTime
	return Math.ceil(Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - elapsedMs) / 1000))
}

/** The countdown's sleep. A wrapper, so specs that mock the "delay" module still see every tick. */
const sleep = (ms: number) => delay(ms)
```

4c. In `calculateBackoffDelay`, find:

```ts
		let exponentialDelay = Math.min(
			Math.ceil(baseDelay * Math.pow(2, retryAttempt)),
			MAX_EXPONENTIAL_BACKOFF_SECONDS,
		)

		// Respect provider rate limit window
		let rateLimitDelay = 0
		const rateLimit = (state?.apiConfiguration ?? this.access.apiConfiguration)?.rateLimitSeconds || 0
		if (getLastGlobalApiRequestTime() && rateLimit > 0) {
			const elapsed = performance.now() - getLastGlobalApiRequestTime()!
			rateLimitDelay = Math.ceil(Math.min(rateLimit, Math.max(0, rateLimit * 1000 - elapsed) / 1000))
		}
```

Replace with:

```ts
		// In seconds (the countdown ticks once a second). Rounding up after the cap gives the
		// same result as the former min(ceil(base * 2^n), 600) because the cap is whole.
		let exponentialDelay = Math.ceil(
			backoffDelayMs(retryAttempt, { baseMs: baseDelay, capMs: MAX_EXPONENTIAL_BACKOFF_SECONDS }),
		)

		// Respect provider rate limit window
		let rateLimitDelay = 0
		const rateLimit = (state?.apiConfiguration ?? this.access.apiConfiguration)?.rateLimitSeconds || 0
		const lastRequestTime = getLastGlobalApiRequestTime()
		if (lastRequestTime && rateLimit > 0) {
			rateLimitDelay = rateLimitWaitSeconds(rateLimit, lastRequestTime)
		}
```

Keep the line `const rateLimit = (state?.apiConfiguration ?? this.access.apiConfiguration)?.rateLimitSeconds || 0`
as it is: it differs on purpose from the `??` chain in `maybeWaitForProviderRateLimit`; unifying them would change
behavior.

4d. Replace the body of `showCountdownUX`. Find:

```ts
	async showCountdownUX(seconds: number, headerText: string): Promise<void> {
		for (let i = seconds; i > 0; i--) {
			if (this.access.abort) {
				throw new Error(`[Task#${this.access.taskId}] Aborted during retry countdown`)
			}

			await this.access.askSay.say(
				"api_req_retry_delayed",
				`${headerText}<retry_timer>${i}</retry_timer>`,
				undefined,
				true,
			)
			await delay(1000)
		}

		await this.access.askSay.say("api_req_retry_delayed", headerText, undefined, false)
	}
```

Replace with:

```ts
	async showCountdownUX(seconds: number, headerText: string): Promise<void> {
		try {
			await countdown(
				seconds,
				(i) =>
					this.access.askSay.say(
						"api_req_retry_delayed",
						`${headerText}<retry_timer>${i}</retry_timer>`,
						undefined,
						true,
					),
				{ isAborted: () => this.access.abort, sleep },
			)
		} catch (error) {
			if (error instanceof CountdownAbortedError) {
				throw new Error(`[Task#${this.access.taskId}] Aborted during retry countdown`)
			}
			throw error
		}

		await this.access.askSay.say("api_req_retry_delayed", headerText, undefined, false)
	}
```

The rethrown message must stay exactly `Aborted during retry countdown`: `backoffAndAnnounce` matches that text to
return quietly. Do not edit `backoffAndAnnounce`.

4e. In `maybeWaitForProviderRateLimit`, find:

```ts
		if (rateLimitSeconds <= 0 || !getLastGlobalApiRequestTime()) {
			return
		}

		const now = performance.now()
		const timeSinceLastRequest = now - getLastGlobalApiRequestTime()!
		const rateLimitDelay = Math.ceil(
			Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - timeSinceLastRequest) / 1000),
		)

		// Only show countdown UX on first attempt
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			for (let i = rateLimitDelay; i > 0; i--) {
				const delayMessage = JSON.stringify({ seconds: i })
				await this.access.askSay.say("api_req_rate_limit_wait", delayMessage, undefined, true)
				await delay(1000)
			}
			await this.access.askSay.say("api_req_rate_limit_wait", undefined, undefined, false)
		}
```

Replace with:

```ts
		const lastRequestTime = getLastGlobalApiRequestTime()
		if (rateLimitSeconds <= 0 || !lastRequestTime) {
			return
		}

		const rateLimitDelay = rateLimitWaitSeconds(rateLimitSeconds, lastRequestTime)

		// Only show countdown UX on first attempt
		if (rateLimitDelay > 0 && retryAttempt === 0) {
			try {
				await countdown(
					rateLimitDelay,
					(i) =>
						this.access.askSay.say(
							"api_req_rate_limit_wait",
							JSON.stringify({ seconds: i }),
							undefined,
							true,
						),
					{ isAborted: () => this.access.abort, sleep },
				)
			} catch (error) {
				if (error instanceof CountdownAbortedError) {
					throw new Error(`[Task#${this.access.taskId}] Aborted during rate limit wait`)
				}
				throw error
			}
			await this.access.askSay.say("api_req_rate_limit_wait", undefined, undefined, false)
		}
```

After step 4 the file no longer calls `Math.pow` and still imports `delay` (used by `sleep`).

### Step 5. Create `src/core/task/__tests__/RetryHandler.spec.ts` (full content in section 7, test T2)

### Step 6. `src/services/marketplace/RemoteConfigLoader.ts`

6a. Find `import { getRooCodeApiUrl } from "@roo-code/cloud"` and replace with:

```ts
import { getRooCodeApiUrl } from "@roo-code/cloud"
import { backoffDelayMs } from "@roo-code/core"
```

6b. Find `					const delay = Math.pow(2, i) * 1000` and replace with:

```ts
					const delay = backoffDelayMs(i, { baseMs: 1000 })
```

Keep the comment line `// Exponential backoff: 1s, 2s, 4s` above it.

### Step 7. `src/services/code-index/embedders/rate-limit-gate.ts`

7a. Find the first line of the file `/** Backoff after the first 429 from an endpoint; it doubles with every further 429. */` and
replace with:

```ts
import { backoffDelayMs } from "@roo-code/core"

/** Backoff after the first 429 from an endpoint; it doubles with every further 429. */
```

7b. Find:

```ts
		this.resetAt = now + Math.min(BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1), MAX_BACKOFF_MS)
```

Replace with (prettier wraps it like this):

```ts
		this.resetAt =
			now + backoffDelayMs(this.consecutiveErrors - 1, { baseMs: BASE_BACKOFF_MS, capMs: MAX_BACKOFF_MS })
```

### Step 8. `src/services/code-index/embedders/base-http-embedder.ts`

8a. Find `import { TelemetryService } from "@roo-code/telemetry"` (line 3) and replace with:

```ts
import { TelemetryService } from "@roo-code/telemetry"
import { backoffDelayMs } from "@roo-code/core"
```

8b. Find:

```ts
						const delayMs = Math.max(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt), gate.remainingDelay())
```

Replace with:

```ts
						const delayMs = Math.max(
							backoffDelayMs(attempt, { baseMs: INITIAL_RETRY_DELAY_MS }),
							gate.remainingDelay(),
						)
```

### Step 9. `src/services/code-index/processors/scanner.ts`

9a. Find `import { TelemetryEventName } from "@roo-code/types"` (unique, near line 30) and replace with:

```ts
import { TelemetryEventName } from "@roo-code/types"
import { backoffDelayMs } from "@roo-code/core"
```

9b. Find `					const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)` and replace with:

```ts
					const delay = backoffDelayMs(attempts - 1, { baseMs: INITIAL_RETRY_DELAY_MS })
```

### Step 10. `src/services/code-index/processors/file-watcher.ts`

10a. Find `import { TelemetryEventName } from "@roo-code/types"` (unique, near line 27) and replace with:

```ts
import { TelemetryEventName } from "@roo-code/types"
import { backoffDelayMs } from "@roo-code/core"
```

10b. Find:

```ts
								setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)),
```

Replace with:

```ts
								setTimeout(resolve, backoffDelayMs(retryCount - 1, { baseMs: INITIAL_RETRY_DELAY_MS })),
```

### Step 11. `src/services/code-index/manager.ts`

11a. Find `import { TelemetryEventName } from "@roo-code/types"` (unique, near line 17) and replace with:

```ts
import { TelemetryEventName } from "@roo-code/types"
import { backoffDelayMs } from "@roo-code/core"
```

11b. Find:

```ts
		const delay = Math.min(
			CodeIndexManager.AUTO_RETRY_MAX_DELAY_MS,
			CodeIndexManager.AUTO_RETRY_INITIAL_DELAY_MS * 2 ** this._retryAttempt,
		)
```

Replace with:

```ts
		const delay = backoffDelayMs(this._retryAttempt, {
			baseMs: CodeIndexManager.AUTO_RETRY_INITIAL_DELAY_MS,
			capMs: CodeIndexManager.AUTO_RETRY_MAX_DELAY_MS,
		})
```

### Step 12. Add the workspace dependency to `packages/cloud/package.json`

Find:

```json
	"dependencies": {
		"@roo-code/types": "workspace:^",
```

Replace with:

```json
	"dependencies": {
		"@roo-code/core": "workspace:^",
		"@roo-code/types": "workspace:^",
```

Then from the repository root run `pnpm install --offline` (if it reports a network fetch error, run
`pnpm install`). Expected: `pnpm-lock.yaml` changes only in the `packages/cloud:` importer, gaining

```yaml
      '@roo-code/core':
        specifier: workspace:^
        version: link:../core
```

and `packages/cloud/node_modules/@roo-code/core` becomes a link to `packages/core`. Commit the lockfile change.

### Step 13. `packages/cloud/src/bridge/BridgeOrchestrator.ts`

13a. Find the first line `import { io, type Socket } from "socket.io-client"` and replace with:

```ts
import { io, type Socket } from "socket.io-client"

import { backoffDelayMs } from "@roo-code/core/browser"
```

13b. Find:

```ts
	return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
```

Replace with:

```ts
	return backoffDelayMs(attempt, { baseMs: RETRY_BASE_MS, capMs: RETRY_MAX_MS })
```

Do not change the signature `bridgeRetryDelayMs(attempt: number): number`, its doc comment, or the constants (it is
exported from `packages/cloud/src/index.ts` and used by `src/extension/bridge.ts`).

### Step 14. `src/extension/bridge.ts`: no edit

It already calls `bridgeRetryDelayMs(startRetry++)`; after step 13 that uses the shared helper.

### Step 15. `docs/architecture.md`: record the new edge

Find (inside the mermaid block of "Allowed dependency directions"):

```
  cloud --> types
```

Replace with:

```
  cloud --> coreBrowser
  cloud --> types
```

No other doc change is needed (`docs/08-cloud.md` does not describe the formulas).

## 7. Tests to add or change

### T1 (new): `packages/core/src/utils/__tests__/backoff.spec.ts`

Proves the formula, the cap, jitter bounds (only shortens), rounding rules, and the countdown's order, abort and
default timer. Fails without the fix because `../backoff.js` does not exist.

```ts
// npx vitest run src/utils/__tests__/backoff.spec.ts

import { backoffDelayMs, countdown, CountdownAbortedError } from "../backoff.js"

describe("backoffDelayMs", () => {
	it("doubles from the base delay with every attempt", () => {
		expect([0, 1, 2, 3].map((attempt) => backoffDelayMs(attempt, { baseMs: 500 }))).toEqual([500, 1000, 2000, 4000])
	})

	it("never goes above the cap", () => {
		expect(backoffDelayMs(5, { baseMs: 1_000, capMs: 60_000 })).toBe(32_000)
		expect(backoffDelayMs(6, { baseMs: 1_000, capMs: 60_000 })).toBe(60_000)
		expect(backoffDelayMs(100, { baseMs: 1_000, capMs: 60_000 })).toBe(60_000)
	})

	it("treats a negative attempt as the first one", () => {
		expect(backoffDelayMs(-1, { baseMs: 5_000 })).toBe(5_000)
	})

	it("returns unrounded values without jitter, so a caller can round in its own unit", () => {
		expect(backoffDelayMs(0, { baseMs: 2.5, capMs: 600 })).toBe(2.5)
		expect(backoffDelayMs(10, { baseMs: 2.5, capMs: 600 })).toBe(600)
	})

	it("takes up to the jitter share off the delay and never adds to it", () => {
		expect(backoffDelayMs(2, { baseMs: 1_000, jitter: 0.2, random: () => 0 })).toBe(4_000)
		expect(backoffDelayMs(2, { baseMs: 1_000, jitter: 0.2, random: () => 0.5 })).toBe(3_600)
		expect(backoffDelayMs(2, { baseMs: 1_000, jitter: 0.2, random: () => 0.999999 })).toBe(3_200)
	})

	it("applies jitter after the cap", () => {
		expect(backoffDelayMs(20, { baseMs: 1_000, capMs: 60_000, jitter: 0.5, random: () => 0.5 })).toBe(45_000)
	})

	it("clamps the jitter share to the range 0 to 1", () => {
		expect(backoffDelayMs(0, { baseMs: 1_000, jitter: 5, random: () => 0.5 })).toBe(500)
		expect(backoffDelayMs(0, { baseMs: 1_000, jitter: -1, random: () => 0.5 })).toBe(1_000)
	})

	it("stays inside the jitter band with the real random source", () => {
		for (let i = 0; i < 200; i++) {
			const delay = backoffDelayMs(3, { baseMs: 1_000, jitter: 0.25 })
			expect(delay).toBeGreaterThanOrEqual(6_000)
			expect(delay).toBeLessThanOrEqual(8_000)
		}
	})
})

describe("countdown", () => {
	it("ticks from the given number of seconds down to 1, sleeping one tick after each", async () => {
		const ticks: number[] = []
		const sleep = vi.fn().mockResolvedValue(undefined)

		await countdown(3, (remaining) => void ticks.push(remaining), { sleep })

		expect(ticks).toEqual([3, 2, 1])
		expect(sleep).toHaveBeenCalledTimes(3)
		expect(sleep).toHaveBeenCalledWith(1000)
	})

	it("does nothing for zero or negative seconds", async () => {
		const onTick = vi.fn()
		const sleep = vi.fn().mockResolvedValue(undefined)

		await countdown(0, onTick, { sleep })
		await countdown(-2, onTick, { sleep })

		expect(onTick).not.toHaveBeenCalled()
		expect(sleep).not.toHaveBeenCalled()
	})

	it("waits for an async onTick before sleeping", async () => {
		const order: string[] = []
		const sleep = vi.fn(async () => void order.push("sleep"))

		await countdown(
			2,
			async (remaining) => {
				await Promise.resolve()
				order.push(`tick ${remaining}`)
			},
			{ sleep },
		)

		expect(order).toEqual(["tick 2", "sleep", "tick 1", "sleep"])
	})

	it("stops before the next tick once isAborted returns true", async () => {
		const ticks: number[] = []
		let aborted = false
		const sleep = vi.fn(async () => {
			aborted = true
		})

		await expect(
			countdown(5, (remaining) => void ticks.push(remaining), { sleep, isAborted: () => aborted }),
		).rejects.toBeInstanceOf(CountdownAbortedError)

		expect(ticks).toEqual([5])
		expect(sleep).toHaveBeenCalledTimes(1)
	})

	it("does not tick at all when already aborted", async () => {
		const onTick = vi.fn()

		await expect(countdown(3, onTick, { isAborted: () => true })).rejects.toThrow("Countdown aborted")
		expect(onTick).not.toHaveBeenCalled()
	})

	it("uses a real one-second timer by default", async () => {
		vi.useFakeTimers()
		try {
			const ticks: number[] = []
			const done = countdown(2, (remaining) => void ticks.push(remaining))

			await vi.advanceTimersByTimeAsync(0)
			expect(ticks).toEqual([2])
			await vi.advanceTimersByTimeAsync(999)
			expect(ticks).toEqual([2])
			await vi.advanceTimersByTimeAsync(1)
			expect(ticks).toEqual([2, 1])
			await vi.advanceTimersByTimeAsync(1000)
			await expect(done).resolves.toBeUndefined()
		} finally {
			vi.useRealTimers()
		}
	})
})
```

### T2 (new): `src/core/task/__tests__/RetryHandler.spec.ts`

Pins today's RetryHandler delays and `say` sequences (so the refactor provably keeps them) and adds the abort case
for the rate-limit wait. On the old code 9 of 10 cases pass and "stops the countdown when the task is aborted (D1)"
fails (the old loop keeps calling `say` 5 times). On the new code all 10 pass. It is a unit test of the class with
a fake access object, the lowest layer that shows the bug (AGENTS.md).

```ts
// npx vitest run core/task/__tests__/RetryHandler.spec.ts

import delay from "delay"

import {
	RetryHandler,
	resetGlobalApiRequestTime,
	setLastGlobalApiRequestTime,
	type RetryHandlerAccess,
} from "../RetryHandler"

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

const mockDelay = delay as unknown as ReturnType<typeof vi.fn>

function createHandler(state: Record<string, unknown> | undefined, apiConfiguration: Record<string, unknown> = {}) {
	const say = vi.fn().mockResolvedValue(undefined)
	const access = {
		taskId: "task-1",
		instanceId: "inst-1",
		abort: false,
		apiConfiguration,
		providerRef: { deref: () => ({ getState: async () => state }) },
		askSay: { say },
	}
	const handler = new RetryHandler(access as unknown as RetryHandlerAccess)
	return { handler, access, say }
}

describe("RetryHandler", () => {
	let now: number

	beforeEach(() => {
		mockDelay.mockClear()
		resetGlobalApiRequestTime()
		now = 1_000_000
		vi.spyOn(performance, "now").mockImplementation(() => now)
	})

	afterEach(() => {
		resetGlobalApiRequestTime()
		vi.restoreAllMocks()
	})

	describe("calculateBackoffDelay (delays pinned so the D1 refactor keeps them)", () => {
		it("doubles requestDelaySeconds per attempt and caps at 600 seconds", () => {
			const { handler } = createHandler(undefined)
			const state = { requestDelaySeconds: 3 }

			expect([0, 1, 2, 3].map((attempt) => handler.calculateBackoffDelay(attempt, {}, state))).toEqual([
				3, 6, 12, 24,
			])
			expect(handler.calculateBackoffDelay(8, {}, state)).toBe(600)
			expect(handler.calculateBackoffDelay(50, {}, state)).toBe(600)
		})

		it("falls back to 5 seconds when requestDelaySeconds is unset or 0", () => {
			const { handler } = createHandler(undefined)

			expect(handler.calculateBackoffDelay(0, {}, undefined)).toBe(5)
			expect(handler.calculateBackoffDelay(1, {}, { requestDelaySeconds: 0 })).toBe(10)
		})

		it("rounds a fractional delay up to whole seconds", () => {
			const { handler } = createHandler(undefined)

			expect(handler.calculateBackoffDelay(0, {}, { requestDelaySeconds: 2.5 })).toBe(3)
			expect(handler.calculateBackoffDelay(1, {}, { requestDelaySeconds: 0.3 })).toBe(1)
		})

		it("uses the RetryInfo delay of a 429 plus one second", () => {
			const { handler } = createHandler(undefined)
			const error = {
				status: 429,
				errorDetails: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }],
			}

			expect(handler.calculateBackoffDelay(4, error, { requestDelaySeconds: 3 })).toBe(8)
		})

		it("waits for the rest of the provider rate limit window when that is longer", () => {
			const { handler } = createHandler(undefined)
			setLastGlobalApiRequestTime(now)
			now += 1_500

			const state = { requestDelaySeconds: 1, apiConfiguration: { rateLimitSeconds: 30 } }
			// 30 s window, 1.5 s elapsed: 28.5 s left, rounded up.
			expect(handler.calculateBackoffDelay(0, {}, state)).toBe(29)
		})
	})

	describe("backoffAndAnnounce", () => {
		it("counts down once per second and then clears the timer", async () => {
			const { handler, say } = createHandler({ requestDelaySeconds: 3 })

			await handler.backoffAndAnnounce(0, new Error("API Error"))

			expect(say.mock.calls).toEqual([
				["api_req_retry_delayed", "API Error\n<retry_timer>3</retry_timer>", undefined, true],
				["api_req_retry_delayed", "API Error\n<retry_timer>2</retry_timer>", undefined, true],
				["api_req_retry_delayed", "API Error\n<retry_timer>1</retry_timer>", undefined, true],
				["api_req_retry_delayed", "API Error\n", undefined, false],
			])
			expect(mockDelay).toHaveBeenCalledTimes(3)
			expect(mockDelay).toHaveBeenCalledWith(1000)
		})

		it("stops quietly when the task is aborted during the countdown", async () => {
			const { handler, access, say } = createHandler({ requestDelaySeconds: 3 })
			mockDelay.mockImplementationOnce(async () => {
				access.abort = true
			})
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

			await expect(handler.backoffAndAnnounce(0, new Error("API Error"))).resolves.toBeUndefined()

			expect(say).toHaveBeenCalledTimes(1)
			expect(consoleError).not.toHaveBeenCalled()
		})
	})

	describe("maybeWaitForProviderRateLimit", () => {
		it("counts down the rest of the window on the first attempt", async () => {
			const { handler, say } = createHandler({ apiConfiguration: { rateLimitSeconds: 3 } })
			setLastGlobalApiRequestTime(now)
			now += 500

			await handler.maybeWaitForProviderRateLimit(0)

			expect(say.mock.calls).toEqual([
				["api_req_rate_limit_wait", JSON.stringify({ seconds: 3 }), undefined, true],
				["api_req_rate_limit_wait", JSON.stringify({ seconds: 2 }), undefined, true],
				["api_req_rate_limit_wait", JSON.stringify({ seconds: 1 }), undefined, true],
				["api_req_rate_limit_wait", undefined, undefined, false],
			])
			expect(mockDelay).toHaveBeenCalledTimes(3)
			expect(mockDelay).toHaveBeenCalledWith(1000)
		})

		it("does not wait on a retry attempt", async () => {
			const { handler, say } = createHandler({ apiConfiguration: { rateLimitSeconds: 3 } })
			setLastGlobalApiRequestTime(now)

			await handler.maybeWaitForProviderRateLimit(1)

			expect(say).not.toHaveBeenCalled()
			expect(mockDelay).not.toHaveBeenCalled()
		})

		it("stops the countdown when the task is aborted (D1)", async () => {
			const { handler, access, say } = createHandler({ apiConfiguration: { rateLimitSeconds: 5 } })
			setLastGlobalApiRequestTime(now)
			mockDelay.mockImplementationOnce(async () => {
				access.abort = true
			})

			await expect(handler.maybeWaitForProviderRateLimit(0)).rejects.toThrow(
				"[Task#task-1] Aborted during rate limit wait",
			)

			expect(say).toHaveBeenCalledTimes(1)
			expect(mockDelay).toHaveBeenCalledTimes(1)
		})
	})
})
```

### Existing tests that pin exact delays (must pass unchanged; do not edit them)

- `src/core/task/__tests__/Task.spec.ts`: "should handle API retry with countdown", "should not apply retry delay
  twice" (3 ticks, `delay(1000)` x3, exact `say` arguments), describe "Subtask Rate Limiting" (`delay` called
  `rateLimitSeconds` times, `api_req_rate_limit_wait` JSON messages).
- `src/services/code-index/embedders/__tests__/rate-limit-gate.spec.ts` (5_000, 10_000, 20_000, 300_000 ms).
- `src/services/code-index/__tests__/manager.auto-retry.spec.ts` (5000, 9999/1, 19999/1, cap 299999/1).
- `src/services/code-index/embedders/__tests__/openai-compatible.spec.ts` (advances 5000 and 10000 ms).
- `src/extension/__tests__/bridge.spec.ts` (999/1, 1999/1 ms; it imports the real `bridgeRetryDelayMs`).
- `packages/cloud/src/bridge/__tests__/BridgeOrchestrator.test.ts` (999/1, 1999/1, cap 60_000).
- Scanner, file-watcher and RemoteConfigLoader specs use real timers and do not pin delays.

## 8. Commands to run (exact, from which directory) and the expected result

1. Prove T1 fails first: create the spec (step 3) before `backoff.ts`, then
   `cd packages/core && npx vitest run src/utils/__tests__/backoff.spec.ts` -> fails ("Failed to load" /
   cannot find `../backoff.js`). After steps 1-2: 14 tests pass.
2. Prove T2 fails first: create `RetryHandler.spec.ts` (step 5) before step 4, then
   `cd src && npx vitest run core/task/__tests__/RetryHandler.spec.ts` -> exactly 1 failed ("stops the countdown when
   the task is aborted (D1)"), 9 passed. After step 4: 10 passed.
3. `cd packages/core && npx vitest run` -> all pass (488 + 14 = 502), including
   `src/__tests__/browser-entry.spec.ts`.
4. `cd packages/cloud && npx vitest run` -> 319 passed.
5. `cd src && npx vitest run core/task services/code-index services/marketplace extension` -> no new failures
   compared with the same command on `origin/main` (run it there first if unsure; known unrelated failures in
   `src` need a built `dist` or tree-sitter wasm assets).
6. H1 check: `cd src && npx vitest run core/task/__tests__/build-tools-slim-toolset.spec.ts
   core/task/__tests__/grace-retry-errors.spec.ts
   core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts
   core/tools/__tests__/RunParallelTasksTool.spec.ts` -> all pass. If one fails with `No "backoffDelayMs" export is
   defined on the "@roo-code/core" mock` (or `countdown` / `CountdownAbortedError`), apply the H1 fix in section 5
   to that spec only.
7. Type checks: `pnpm --filter @roo-code/core check-types`, `pnpm --filter @roo-code/cloud check-types`,
   `pnpm --filter tumble-code check-types` -> no errors.
8. ESLint on changed files, per workspace (ESLint 10 uses the config of the directory it runs in):
   `cd packages/core && npx eslint src/utils --max-warnings=0`;
   `cd packages/cloud && npx eslint src/bridge/BridgeOrchestrator.ts --max-warnings=0`;
   `cd src && npx eslint core/task/RetryHandler.ts core/task/__tests__/RetryHandler.spec.ts services/marketplace/RemoteConfigLoader.ts services/code-index/embedders/rate-limit-gate.ts services/code-index/embedders/base-http-embedder.ts services/code-index/processors/scanner.ts services/code-index/processors/file-watcher.ts services/code-index/manager.ts --max-warnings=0`
   -> no output, exit code 0.
9. Prettier (root): `npx prettier --check` on every changed file above plus `packages/cloud/package.json` and
   `docs/architecture.md` -> "All matched files use Prettier code style!".
10. `pnpm knip` (root) -> no new findings for `packages/core` or `packages/cloud`.
11. Grep check: `grep -rn --include=*.ts -E "Math\.pow\(2|2 \*\* " src/core/task src/services/marketplace src/services/code-index packages/cloud/src/bridge`
    -> no output (only comments may mention the formula).

## 9. Do not touch / pitfalls

- Do-not-touch (docs/architecture.md): "Task control: cancelTask and the abort ordering, the global
  lastGlobalApiRequestTime rate limit". Keep RetryHandler behavior identical; only dedupe the math and the loops.
  The single intended change is the abort check in the rate-limit countdown (section 5).
- Do not "fix" `state?.requestDelaySeconds || 5` (the settings default is 10): that is roadmap item D2.
- Do not change `MAX_EXPONENTIAL_BACKOFF_SECONDS`, `INITIAL_RETRY_DELAY_MS`, `BASE_BACKOFF_MS`, the
  `AUTO_RETRY_*` constants or `RETRY_*` in BridgeOrchestrator.
- Jitter stays 0 at every call site in this item. Adding jitter is WP-R11 and it must update the tests that pin
  exact delays (they are listed there).
- Keep `import delay from "delay"` in RetryHandler and pass `sleep` as a wrapper `(ms) => delay(ms)`: `Task.spec.ts`
  replaces the module's default export with a spy and asserts `toHaveBeenCalledWith(1000)`.
- Cloud must import `@roo-code/core/browser`, not `@roo-code/core` (keeps cloud free of Node-only core modules).
  Host files in `src/` import `@roo-code/core` like the other host modules.
- Do not add `packages/build` or `RefreshTimer` to this item (section 4.12).
- Known flaky tests unrelated to this item: F1 (`apps/cli` cli-integration case
  `create-with-session-id-resume-loads-correct-session`) and F2 (Windows `TaskHistoryStore` spec "releases per-ID lock
  tails for many unique IDs"). If they fail, re-run; do not change them here.
- `rate-limit-gate.ts` had no imports; the new import goes at the very top with one blank line after it.

## 10. Acceptance checklist (checkboxes)

- [ ] `packages/core/src/utils/backoff.ts` exists with `backoffDelayMs`, `countdown`, `CountdownAbortedError` and
      is exported from `packages/core/src/utils/index.ts`.
- [ ] T1 (14 cases) passes; `browser-entry.spec.ts` passes.
- [ ] T2 (10 cases) passes; it failed 1 case before step 4.
- [ ] No `Math.pow(2` or `2 **` backoff formula left in the eight sites.
- [ ] RetryHandler: `lastGlobalApiRequestTime` code, `|| 5`, messages and `say` arguments unchanged.
- [ ] `packages/cloud/package.json` depends on `@roo-code/core`; `pnpm-lock.yaml` updated; cloud imports only
      `@roo-code/core/browser`.
- [ ] `docs/architecture.md` mermaid has `cloud --> coreBrowser`.
- [ ] All existing tests listed in section 7 pass unchanged.
- [ ] check-types, eslint, prettier, knip clean.
- [ ] `ai_plans/2026-09-27_d1-shared-backoff.md` added.

## 11. Commit, changeset and PR text

Commit title: `refactor(core): one shared exponential backoff and countdown helper (D1)`

Commit body:

```
Eight retry loops computed exponential backoff by hand. backoffDelayMs and an
abortable countdown now live in packages/core (utils/backoff.ts) and every
site calls them: RetryHandler, RemoteConfigLoader, the embedder retry and
rate-limit gate, the code-index scanner, file watcher and manager, and the
bridge retry delay in @roo-code/cloud. Jitter is off, so every delay is the
same as before; specs pin them.

Inside RetryHandler the rate-limit window math and the countdown loop were
each written twice; they are one function each now. The provider rate-limit
countdown checks the abort flag before each tick, like the retry countdown.

@roo-code/cloud now depends on @roo-code/core (browser entry only);
docs/architecture.md shows the edge.

<the commit attribution trailers your harness requires>
```

Changeset: none (no user-visible change: delays are identical, and the abort case already ended one tick later).

`ai_plans/2026-09-27_d1-shared-backoff.md`:

```md
# D1: one shared exponential backoff

Item D1 of `2026-09-27_simplification-roadmap.md`.

## Problem

Eight places computed exponential backoff with their own formula (RetryHandler, RemoteConfigLoader,
base-http-embedder, rate-limit-gate, code-index scanner, file-watcher, CodeIndexManager, the bridge retry used by
`src/extension/bridge.ts`). RetryHandler also had the rate-limit window math and the countdown loop twice, and the
rate-limit countdown did not check for an abort.

## Change

- `packages/core/src/utils/backoff.ts`: `backoffDelayMs(attempt, { baseMs, capMs, jitter })` and
  `countdown(seconds, onTick, { isAborted, sleep })`, exported from every core entry.
- All eight sites call `backoffDelayMs` with jitter 0, so every delay is unchanged.
- RetryHandler: `rateLimitWaitSeconds` and `countdown` replace the copies; the rate-limit wait stops before the
  next tick once the task is aborted. `lastGlobalApiRequestTime` handling is unchanged.
- `@roo-code/cloud` depends on `@roo-code/core` (browser entry) for `bridgeRetryDelayMs`.

## Not done, on purpose

`RefreshTimer` moves to the helper in R11 together with jitter. `packages/build/src/esbuild.ts` keeps its own
formula: build tooling does not depend on core.

## Tests

- `packages/core/src/utils/__tests__/backoff.spec.ts` (14 cases).
- `src/core/task/__tests__/RetryHandler.spec.ts` pins the old delays and `say` sequences; its abort case fails
  without the fix.
- Existing specs that pin delays pass unchanged (Task.spec retry and rate-limit cases, rate-limit-gate,
  manager.auto-retry, openai-compatible, bridge.spec, BridgeOrchestrator.test).
```

PR body outline:

- Title = commit title.
- Summary: one helper in `packages/core`, eight call sites, identical delays, the one abort fix.
- Table of old -> new formulas (copy from section 5).
- Dependency note: new `cloud --> core/browser` edge, lockfile change, architecture.md updated.
- Tests: new specs, list of unchanged pinning specs, commands run with results.
- End with the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If any test in section 7 "existing tests that pin exact delays" fails after the change, stop: a formula was not
  translated exactly. Report the test name, the expected and actual delay, and the site; do not edit the test.
- If `pnpm install` cannot link `@roo-code/core` into `packages/cloud` (no network, lockfile conflict), stop after
  steps 1-11 (they do not need the new dependency), skip steps 12-13 and 15, and report; WP-R11 then cannot start.
- If `tsc` in `packages/cloud` reports TS6059 (file not under rootDir) for a core file, report it with the full
  message; do not add `rootDir` or path mappings on your own.
- If Task.spec rate-limit tests fail with a different number of `delay` calls, check that `sleep` is the wrapper
  `(ms) => delay(ms)` and that `countdown` is called with `rateLimitDelay`; if still failing, stop and report.
