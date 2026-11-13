# R11 — Cloud client backoff: jitter, per-item RetryQueue backoff, bridge re-arm (2026-09-27)

Roadmap item: [`ai_plans/2026-09-27_simplification-roadmap.md`](2026-09-27_simplification-roadmap.md) §2 R11.
Branch: `fix/r11-cloud-client-backoff-jitter`.

## Problem (all three verified in the code before the fix)

1. **No jitter.** `RefreshTimer` (`packages/cloud/src/RefreshTimer.ts`) and `RetryQueue`
   (`packages/cloud/src/retry-queue/RetryQueue.ts`) computed deterministic delays
   (`initialBackoff * 2^(n-1)`, fixed `retryDelay`). Every window of the extension runs
   its own RefreshTimer (auth session, org settings, user settings); after a VS Code
   reload or a backend restart they all fail on the same tick and then all retry on the
   same tick — a thundering herd against the cloud.
2. **Whole-queue retry every 60 s.** `RetryQueue.retryAll()` iterated the entire queue on
   every `networkCheckInterval` tick; a request that had been waiting 5 s got the same
   full penalty (it was retried at the same moment and burned a `retryCount` attempt) as
   one that had just failed. One failing request also held up the whole cycle
   (`await this.delay(100)` between attempts).
3. **Bridge gives up after `reconnect_failed`.** `BridgeOrchestrator` logged
   "reconnect failed — giving up; remote control is offline" and never tried again: once
   the socket.io manager exhausts its reconnection attempts the socket is dead until the
   next VS Code reload.

## Fix

### 1. One equal-jitter backoff helper — `packages/cloud/src/backoff.ts`

```ts
export function backoffDelayMs(attempt: number, { baseMs, capMs, random = Math.random }: BackoffOptions): number {
	const raw = Math.min(baseMs * 2 ** attempt, capMs)
	return Math.floor(raw / 2 + random() * (raw / 2))
}
```

**Pattern choice: equal jitter** (`delay = raw/2 + random*raw/2`, i.e. uniform in
`[raw/2, raw]`). Rationale over the alternatives:

- _Full jitter_ (`uniform[0, raw]`) can schedule a retry almost immediately after a
  failure (a 5-minute cap can become a 1 ms delay) — bad for a server that is down and
  for the queue's per-item windows.
- _No jitter / decorrelated jitter_ need more state or lose the exponential shape.
- Equal jitter keeps the exponential ladder and the cap as _guarantees_ while spreading
  synchronized clients across half the interval — the standard AWS recommendation for
  thundering herds.

The random source is injectable (`random` option) so tests are deterministic. D1 (the
separate roadmap item) will move this helper to `packages/core` and replace the other
eight implementations; that refactor is explicitly out of scope here — this file lives
in `packages/cloud` next to its first three users.

### 2. RefreshTimer — jittered backoff (public API unchanged)

Before:

```ts
this.currentBackoffMs = Math.min(this.initialBackoffMs * Math.pow(2, this.attemptCount - 1), this.maxBackoffMs)
```

After:

```ts
this.currentBackoffMs = backoffDelayMs(this.attemptCount, {
	baseMs: this.initialBackoffMs,
	capMs: this.maxBackoffMs,
	random: this.random,
})
this.attemptCount++
```

New optional `random?: () => number` constructor option; `callback`, `successInterval`,
`initialBackoffMs`, `maxBackoffMs`, `start/stop/reset` unchanged, so `WebAuthService` and
`CloudSettingsService` (the only constructors) need no changes. Success still resets to
the fixed `successInterval`.

### 3. RetryQueue — per-item backoff

Each `QueuedRequest` gains `nextAttemptAt?: number` (persisted through the existing
`RetryQueueStorage`). `retryAll()` now:

```ts
const due = requests.filter((request) => (request.nextAttemptAt ?? 0) <= now)
```

and only processes `due` items. On a failure the item's own window moves:

```ts
request.nextAttemptAt =
	Date.now() +
	backoffDelayMs(request.retryCount - 1, {
		baseMs: this.config.retryDelay,
		capMs: this.config.retryDelayMaxMs,
		random: this.config.random,
	})
```

Before, the catch block was:

```ts
} else {
	this.queue.set(request.id, request)
	this.emit("request-retry-failed", request, error as Error)
}

// Add a small delay between retry attempts
await this.delay(100)
```

i.e. every failure left the item immediately retryable by the _global_ 60 s cycle, and
the `delay(100)` stalled the whole cycle (also removed now — the per-item windows
replace it).

Config additions (both optional, defaults preserve old pacing semantics):
`retryDelayMaxMs` (cap, default 600 000) and `random`. `maxRetries`, `retryDelay`,
`networkCheckInterval`, `requestTimeout`, the 429 `Retry-After` whole-queue pause, the
events, and the public API are unchanged. Consumers (`CloudService` constructs it with
no config overrides) are unaffected.

### 4. Bridge re-arm after `reconnect_failed`

`BridgeOrchestrator` gains `reconnectRearmDelayMs?: number` and `random?: () => number`
options. Before:

```ts
manager.on("reconnect_failed", () => {
	this.log("reconnect failed — giving up; remote control is offline")
})
```

After:

```ts
manager.on("reconnect_failed", () => {
	const rearm = this.options.reconnectRearmDelayMs ?? 0
	if (rearm > 0) {
		this.log("reconnect failed — re-arming the connector")
		this.scheduleRearm(socket, rearm)
	} else {
		this.log("reconnect failed — giving up; remote control is offline")
	}
})
```

`scheduleRearm` calls `socket.connect()` after the configured delay (which restarts the
manager's reconnect cycle — the `auth` callback re-mints the short-lived bridge token),
then backs off exponentially (`bridgeRetryDelayMs` with jitter, i.e. 1 min … 60 min cap)
if the next cycle also fails. A successful `connect` resets the ladder. `stop()` cancels
a pending re-arm. **Semantics preserved:** with the default `0` the old
give-up-after-`reconnect_failed` behaviour is kept; the re-arm is opt-in.

`bridgeRetryDelayMs(attempt, random?)` now carries the equal jitter too (it feeds the
DEF-C50 refused-handshake ladder and the extension-host start retry).

### 5. Setting: `tumble-code.bridgeRetryDelayMs`

Wired the same way as the other cloud settings (`cloudApiUrl`/`cloudProviderUrl`/
`clerkBaseUrl` family):

- `src/package.json` — `"tumble-code.bridgeRetryDelayMs"`, type number, default `0`,
  minimum 0, scope machine, `%settings.bridgeRetryDelayMs.description%`.
- `src/package.nls.json` — the description.
- `src/activate/cloud-urls.ts` — `getBridgeRetryDelayMs()` (read live at every bridge
  start, so a change applies on the next reconnect; guards `NaN`/negative), and the
  config-change listener also reacts to the key.
- `src/extension/bridge.ts` — passes `reconnectRearmDelayMs: getBridgeRetryDelayMs()`
  to the orchestrator.

The roadmap suggested "re-arm the bridge with `bridgeRetryDelayMs`"; the natural VS Code
convention here is a contributes-configuration entry (no `SETTINGS_DEFAULTS` table entry
is needed: the default `0` lives in package.json with the other cloud settings, matching
`cloudApiUrl` et al.).

## Tests (all deterministic; fake timers + injected random)

- `packages/cloud/src/__tests__/backoff.spec.ts` — band `[raw/2, raw]`, exponential
  shape, cap, decorrelation across items.
- `packages/cloud/src/__tests__/RefreshTimer.backoff.spec.ts` — first-failure delay at
  the bottom (500 ms) vs the top (999 ms) of the band for `initialBackoffMs: 1000`;
  exponential ladder; two timers with different random sources do not fire on the same
  tick.
- `packages/cloud/src/retry-queue/__tests__/RetryQueue.per-item-backoff.spec.ts` —
  (a) item B is delivered while item A backs off, and A is retried only after **its own**
  window elapses; (b) A's second failure moves only A's window (exponential, 2 × 60 s);
  (c) jitter: seeded `random()=0` halves the 60 s delay to 30 s; (d) `nextAttemptAt`
  persists across restarts and a fresh queue honours it.
- `packages/cloud/src/bridge/__tests__/BridgeOrchestrator.rearm.spec.ts` — old
  give-up behaviour when the option is unset; re-arm fires after the configured delay;
  exponential backoff across repeated failed re-arms and reset on connect; seeded
  jitter; `stop()` cancels a pending re-arm; `bridgeRetryDelayMs` band/cap.
- Updated existing specs (behaviour intentionally changed, assertions pinned to
  `random()=0.999`): DEF-C50 handshake ladder in `BridgeOrchestrator.test.ts` (999 ms /
  1999 ms steps), `bridge.spec.ts` start-retry ladder, and `RetryQueue.test.ts` cases
  that count consecutive immediate retries now pass `retryDelay: 0`.

Results: `packages/cloud` 339/339 passed; `src` `bridge.spec.ts` + `extension.spec.ts`
10/10 passed; `tsc --noEmit` clean in both workspaces; eslint clean.

## Residuals / notes

- `networkCheckInterval` (60 s) still drives when _due_ items are attempted; the
  per-item window only adds a lower bound. Worst case an item waits
  window + up to 60 s. Acceptable for a background queue; shrinking the interval would
  burn wake-ups.
- The 429 `Retry-After` whole-queue pause is unchanged (it is a server-issued global
  signal, distinct from per-item failure backoff).
- D1 remains: move `backoffDelayMs` to `packages/core` and replace the other eight
  backoff implementations (`RetryHandler`, `RemoteConfigLoader`, embedder, rate-limit
  gate, code-index scanner/file-watcher/manager, and the start-retry ladder in
  `extension/bridge.ts` which now uses the jittered `bridgeRetryDelayMs` but still
  computes its own ladder).
- The setting is documented in `package.nls.json` only (consistent with the other cloud
  settings); `docs/09-environment-variables.md` covers env vars, not VS Code settings.
