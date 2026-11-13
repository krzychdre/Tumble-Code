# D1: One backoff + countdown helper (roadmap 2026-09-27, Priority 2)

Roadmap item D1 (`ai_plans/2026-09-27_simplification-roadmap.md:82`): eight exponential-backoff
implementations, plus inside `RetryHandler` the rate-limit delay and the countdown loop are each
written twice and the rate-limit countdown ignores abort. R11's residual: the equal-jitter helper
lives in `packages/cloud` although cloud→core is the allowed direction only the other way round —
D1 moves it to `packages/core`.

## Inventory (found by reading main @ 24b3e15b)

| #   | Site                                                          | Shape                                                                                                                      | Notes                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/task/RetryHandler.ts`                               | `base * 2^attempt`, cap 600 s, seconds-based, **no jitter**                                                                | Countdown loop written twice (`showCountdownUX`, `maybeWaitForProviderRateLimit`); the rate-limit countdown ignores `abort` (roadmap finding). Also: rate-limit delay computed twice (`calculateBackoffDelay` + `maybeWaitForProviderRateLimit`). |
| 2   | `src/services/marketplace/RemoteConfigLoader.ts:103`          | `2^i * 1000` ms, 3 attempts, no cap check needed, no jitter                                                                | Plain `Math.pow`.                                                                                                                                                                                                                                 |
| 3   | `src/services/code-index/embedders/base-http-embedder.ts:250` | `max(500 * 2^attempt, gate.remainingDelay())`                                                                              | Floor vs shared gate — keep the `max` semantics.                                                                                                                                                                                                  |
| 4   | `src/services/code-index/embedders/rate-limit-gate.ts:37`     | `min(5_000 * 2^(n-1), 300_000)`                                                                                            | Escalation via consecutive-429 counter, deterministic (no jitter by design — tests assert exact 5/10/20 s).                                                                                                                                       |
| 5   | `src/services/code-index/processors/scanner.ts:498`           | `500 * 2^(attempts-1)`, no cap                                                                                             |                                                                                                                                                                                                                                                   |
| 6   | `src/services/code-index/processors/file-watcher.ts:449`      | `500 * 2^(retryCount-1)`, no cap                                                                                           |                                                                                                                                                                                                                                                   |
| 7   | `src/services/code-index/manager.ts:399`                      | `min(5_000 * 2^attempt, 300_000)`                                                                                          |                                                                                                                                                                                                                                                   |
| 8   | `src/extension/bridge.ts:128`                                 | `bridgeRetryDelayMs` → already the R11 helper; **plus its own start-retry ladder** (`startRetry++` + `bridgeRetryDelayMs`) | Migrate the ladder to the shared helper via `@roo-code/cloud` re-export (the function body stays in core).                                                                                                                                        |

`packages/cloud/src/backoff.ts` (`backoffDelayMs`, equal jitter, R11) is the ninth implementation
and the one that already has the right shape + tests. It moves to core; cloud re-exports it so
`RefreshTimer`, `RetryQueue`, `BridgeOrchestrator` and `extension/bridge.ts` keep compiling.

Out of scope: `packages/build/src/esbuild.ts` (sync `sleepSync`, build tooling, not runtime code),
`TaskHistory.saveHistoryWithRetry` (fixed delay ladder `[100, 500, 1500]`, not exponential),
`openai-codex.ts` auth retry (fixed 2 attempts, no backoff).

## Design

New `packages/core/src/fs/../` — no: it is not fs. New module `packages/core/src/backoff.ts`,
exported through `packages/core/src/index.ts` **and** a new `./backoff` entry point
(`@roo-code/core/backoff`) so `packages/cloud` and `src` can import it narrowly.

```ts
export interface BackoffOptions {
	/** First-step delay in milliseconds. */
	baseMs: number
	/** Upper bound for the returned delay. */
	capMs: number
	/**
	 * Source of randomness in `[0, 1)`. Injectable so tests are deterministic;
	 * defaults to `Math.random`. Pass a constant for a jitter-free ladder.
	 */
	random?: () => number
}

/** Equal-jitter exponential backoff: `raw = min(base * 2^attempt, cap); raw/2 + random() * raw/2`. */
export function backoffDelayMs(attempt: number, { baseMs, capMs, random = Math.random }: BackoffOptions): number

/** Delay without jitter: `min(base * 2^attempt, cap)` — for sites whose tests assert exact ladders. */
export function backoffDelayMsNoJitter(attempt: number, { baseMs, capMs }: { baseMs: number; capMs: number }): number

export interface CountdownOptions {
	/** Called once per second with the seconds remaining (counting down). */
	onTick: (secondsRemaining: number) => Promise<void> | void
	/** 1-second step; injectable for tests. */
	stepMs?: number
	/** Checked before every tick; when it returns true the countdown rejects with `AbortError`. */
	isAborted?: () => boolean
	/** Custom abort error; defaults to `new Error("Countdown aborted")`. */
	abortError?: Error
}

/**
 * Counts `seconds` down to 0, calling `onTick(i)` for each `i` in `[seconds .. 1]`.
 * Rejects with the abort error when `isAborted()` becomes true. Resolves after the last step.
 */
export function countdown(seconds: number, options: CountdownOptions): Promise<void>
```

`backoffDelayMs` is byte-for-byte the R11 helper (tests move with it); `backoffDelayMsNoJitter` is
the same formula with the jitter term dropped — that is the exact ladder every non-cloud site uses
today, and sites with deterministic tests (rate-limit-gate: 5/10/20 s) keep passing unchanged.

## Migration per site

1. **`RetryHandler`** (`src/core/task/RetryHandler.ts`):
    - `calculateBackoffDelay` uses `backoffDelayMsNoJitter(attempt, { baseMs: baseDelay * 1000, capMs: 600_000 }) / 1000`
      → identical numbers (ceil semantics preserved: the old code `Math.ceil`ed the seconds;
      `Math.ceil` the result).
    - The duplicated rate-limit-delay computation: one private `providerRateLimitDelaySeconds(state)`
      used by both `calculateBackoffDelay` and `maybeWaitForProviderRateLimit` (this is the "written
      twice" fix).
    - Both countdown loops → `countdown(seconds, { onTick, isAborted: () => this.access.abort, abortError })`.
      The rate-limit loop gains the abort check (roadmap: "the rate-limit countdown ignores abort");
      `showCountdownUX` keeps its exact error message `[Task#<id>] Aborted during retry countdown`
      because `TaskApiLoop` (and specs) match on `"aborted during retry"` — the abortError carries it.
    - Final `say(..., false)` after each countdown stays at the call site (it differs: headerText vs
      undefined payload).
2. **`RemoteConfigLoader.fetchWithRetry`**: `backoffDelayMsNoJitter(i, { baseMs: 1000, capMs: 4000 })`.
3. **`base-http-embedder`**: `Math.max(backoffDelayMsNoJitter(attempt, { baseMs: INITIAL_RETRY_DELAY_MS, capMs: Number.MAX_SAFE_INTEGER }), gate.remainingDelay())`.
   The `capMs` there only guards overflow; keep the value shape identical (500/1000/2000).
4. **`rate-limit-gate`**: `backoffDelayMsNoJitter(consecutiveErrors - 1, { baseMs: BASE_BACKOFF_MS, capMs: MAX_BACKOFF_MS })`.
5. **`scanner`**: `backoffDelayMsNoJitter(attempts - 1, { baseMs: INITIAL_RETRY_DELAY_MS, capMs: Number.MAX_SAFE_INTEGER })`.
6. **`file-watcher`**: same as scanner.
7. **`manager._scheduleAutoRetry`**: `backoffDelayMsNoJitter(this._retryAttempt, { baseMs: AUTO_RETRY_INITIAL_DELAY_MS, capMs: AUTO_RETRY_MAX_DELAY_MS })`.
8. **`extension/bridge.ts`**: unchanged call (`bridgeRetryDelayMs` re-exported from cloud); the
   ladder itself is the shared helper already. Only the import path stays. **No change needed** —
   verified: the site uses `bridgeRetryDelayMs(startRetry++)`, which is the shared formula.
9. **`packages/cloud/src/backoff.ts`**: deleted; `packages/cloud/src/index.ts` re-exports from
   `@roo-code/core/backoff`; `RefreshTimer.ts`, `RetryQueue.ts`, `BridgeOrchestrator.ts` import
   from the new path (cloud package gains `@roo-code/core` dep — direction core←cloud is the
   allowed one).

No behavior change anywhere except the two documented ones: (a) the rate-limit countdown in
`RetryHandler` now stops on abort, (b) nothing else. All existing fake-timer specs
(`TaskApiLoop.no-auto-retry-auth-errors.spec.ts` asserts exact 5+10+20+40+80+160+320+600 ladders,
`manager.auto-retry.spec.ts`, `rate-limit-gate.spec.ts`, `embedder-contract.spec.ts`,
`RefreshTimer.backoff.spec.ts`, `RetryQueue.per-item-backoff.spec.ts`,
`BridgeOrchestrator.rearm.spec.ts`) must pass without modification — they are the regression net.

## New tests

- `packages/core/src/__tests__/backoff.spec.ts`: the moved cloud spec (equal-jitter bands, growth,
  cap, sequence spread) + `backoffDelayMsNoJitter` ladder (0 → base, 1 → 2·base, cap, no random).
- `packages/core/src/__tests__/countdown.spec.ts`: ticks seconds..1, awaits onTick, rejects on
  `isAborted` before each tick, custom abortError, resolves after the final step (fake timers).
- `src/core/task/__tests__/RetryHandler.rate-limit-abort.spec.ts`: the D1 regression — with
  `rateLimitSeconds` set and `abort` flipping mid-countdown, `maybeWaitForProviderRateLimit`
  rejects instead of counting to the end (the bug the roadmap names).

## Acceptance criteria

- One helper pair in `packages/core`; `packages/cloud/src/backoff.ts` gone; cloud re-exports.
- `grep -rn "Math.pow(2" src packages/cloud` returns only test files (formulas asserted in specs).
- All touched spec files pass unmodified (numbers preserved); new regression tests pass.
- `pnpm knip` exit code unchanged vs main (baseline is 1 pre-existing).
- Changeset added.
