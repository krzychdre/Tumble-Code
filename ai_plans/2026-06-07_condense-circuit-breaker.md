# Auto-condense circuit breaker (stacked follow-up #2)

Date: 2026-06-07
Branch: `feat/condense-circuit-breaker` (stacked on `feat/condense-keep-recent-tail`, off `main`)

## Motivation / evidence

Recommendation from the compaction gap analysis (see
`ai_plans/2026-06-07_context-microcompaction-layer.md`). Claude Code guards its
expensive summarization with a **consecutive-failure circuit breaker**:

- `autoCompact.ts:70` — `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`.
- `autoCompact.ts:241-351` — a counter is incremented when an autocompact
  attempt does not actually reduce the context (or throws); once it reaches the
  cap, autocompact is **skipped entirely** for the rest of the session and the
  request falls through to cheaper, reliable reduction. The counter resets to 0
  the moment an attempt genuinely reduces context.

Tumble-code today has **no such guard** (verified): `manageContext`
(`context-management/index.ts:368-392`) calls `summarizeConversation()` on every
overflow whenever `autoCondenseContext` is on and we are over threshold. If
summarization is futile — the model errors every time (common on weak local
models: GLM/Qwen/Llama returning malformed or empty summaries), or the context
is so irrecoverably large that even a fresh summary + kept tail does not drop
below the limit — tumble **retries the full, expensive, lossy summary on every
single API request**, burning tokens and latency with nothing to show, while the
user watches a stream of `condense_context_error` says.

## Decision

Port the circuit breaker, scoped narrowly: track consecutive **condense**
failures on the `Task`; once the cap is hit, **skip only the condense step**
inside `manageContext` and let the call fall through to the cheap microcompaction
pre-pass (branch 1) and the reliable sliding-window truncation fallback. The
breaker never disables microcompaction or truncation — those always reduce
context and cannot "fail" the way an LLM summary can.

### Failure / success definition (verified against the result shape)

`manageContext`'s `error`/`errorDetails`/`summary` fields are set **exclusively**
by the condense branch (`index.ts:384-390`), so the caller can detect, without
any new signal, whether a condense was attempted this pass and how it went:

- **condense attempted** ⇔ `summary` non-empty (success) **or** `error` set
  (threw / invalid summary).
- **failure** = attempted AND (`error` set, OR no genuine reduction:
  `newContextTokens >= prevContextTokens`). A summary that does not shrink the
  context is as futile as one that throws — both increment.
- **success** = attempted AND reduced (`newContextTokens < prevContextTokens`) →
  reset counter to 0.
- **not attempted** (microcompaction-only quiet path, plain truncation, no-op,
  or a pass where the breaker already skipped condense) → leave the counter
  unchanged, so a tripped breaker stays **latched**.

Latching matches Claude Code: once condense has proven futile, stop paying for it
for the rest of the task; truncation handles overflow from there. A genuine
reduction (which can only happen while the breaker is still closed) is the only
thing that clears it. This is per-task state — a fresh task starts with a closed
breaker.

## Design

### `src/core/context-management/index.ts`

- New optional input on `ContextManagementOptions`: `condenseCircuitOpen?: boolean`.
- Gate the condense branch with it: `if (autoCondenseContext && !condenseCircuitOpen) { ... }`
  (line ~368). Everything else — microcompaction pre-pass (~317-360), the
  truncation fallback (~395+), the no-op return — is untouched, so when the
  breaker is open the call still microcompacts and (if over the hard limit)
  truncates.

### `src/core/task/Task.ts`

- New public field in the consecutive-\* cluster (`Task.ts:335-342`):
  `consecutiveAutoCompactFailures: number = 0`. Lives on the Task so it survives
  across API requests within a task and is naturally reset per task. Already wired
  to `TaskContextManager` because the manager receives `this` cast to
  `TaskContextManagerAccess` (`Task.ts:623-624`).

### `src/core/task/TaskContextManager.ts`

- New const beside the existing ones (line ~32):
  `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`.
- Expose the counter on `TaskContextManagerAccess` (a mutable `number` the
  manager reads and writes).
- In `manageContextIfNeeded`:
    - Compute `condenseCircuitOpen = this.access.consecutiveAutoCompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES`
      up front and pass it into `manageContext`.
    - Gate the wasted condense-prep work and the "condensing" spinner
      (`condenseTaskContextStarted` / its `finally` response) on
      `!condenseCircuitOpen` too — when condense is guaranteed skipped there is no
      point folding files / building environment details / showing a condense
      spinner. (`environmentDetails` and `filesReadByRoo` are condense-only inputs.)
    - After `manageContext` returns, update the counter per the success/failure
      rules above.

## Tests: `src/core/context-management/__tests__/circuit-breaker.spec.ts`

`manageContext`-level (the gate):

- breaker open ⇒ condense is NOT attempted even when over threshold
  (`summarizeConversation` not called), yet microcompaction still runs and
  truncation still fires when over the hard limit.
- breaker closed ⇒ condense runs as before.

Counter-update logic (a small harness over the documented rules, or via
`TaskContextManager` with a stubbed `manageContext` result):

- errored condense increments; third consecutive error trips the breaker.
- a condense that reduces resets the counter to 0.
- a condense that produces a summary but does NOT reduce
  (`newContextTokens >= prevContextTokens`) increments.
- microcompaction-only / truncation-only / no-op passes leave the counter
  unchanged (latch preserved).

## Known limitations / tradeoffs

- **Latched for the task**: once tripped, no further summaries for that task even
  if the underlying cause was transient (e.g. a brief provider hiccup). This is
  intentional and matches Claude Code; the cost is falling back to truncation,
  which is safe and always reduces. A future refinement could re-arm the breaker
  after context drops well below threshold, but that adds state for little gain.
- The breaker keys off `newContextTokens` vs `prevContextTokens`. With branch 1
  (microcompaction) and branch 2 (kept tail), a successful condense practically
  always reduces, so false "no reduction" increments are not expected outside the
  genuinely irrecoverable case the breaker exists to catch.
