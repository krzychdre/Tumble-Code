# Fix Windows-only flaky/timing-out Subtask Rate Limiting tests

Date: 2026-06-02
Branch: `fix/windows-rate-limit-test-flakiness`
File under test: `src/core/task/__tests__/Task.spec.ts` → `describe("Subtask Rate Limiting")`
Code under test: `src/core/task/RetryHandler.ts` → `maybeWaitForProviderRateLimit()`

## Symptom

GitHub Actions Windows unit-test job fails 5 tests (Linux/macOS pass):

1. `should enforce rate limiting across parent and subtask` — `mockDelay` called **0** times, expected 5.
2. `should not apply rate limiting if enough time has passed` — **timeout** at 20000ms.
3. `should share rate limiting across multiple subtasks` — `firstDelayCount` was **0**, expected 5.
4. `should handle rate limiting with zero rate limit` — **timeout** at 20000ms.
5. `should update global timestamp even when no rate limiting is needed` — **timeout** at 20000ms.

## Root cause (proven, not assumed)

These tests assert the _number_ of `delay(1000)` countdown calls, which is derived from **real wall-clock elapsed time**:

```ts
// RetryHandler.maybeWaitForProviderRateLimit
const now = performance.now()
const timeSinceLastRequest = now - getLastGlobalApiRequestTime()!
const rateLimitDelay = Math.ceil(
	Math.min(rateLimitSeconds, Math.max(0, rateLimitSeconds * 1000 - timeSinceLastRequest) / 1000),
)
```

The test makes a parent request (which records `lastGlobalApiRequestTime = performance.now()`),
then a child request, and asserts the child saw exactly `rateLimitSeconds` (= 5) countdown ticks.
That only holds if **less than ~1 second of real time** elapses between the two calls.

Evidence (reproduced locally via the delay math):

- elapsed ≈ 5 ms → 5 delays (fast Linux multi-fork → tests pass)
- elapsed ≈ 1200 ms → 4 delays
- elapsed ≥ 5000 ms → **0 delays** (exactly the Windows "called 0 times" failures)

Why Windows specifically (`src/vitest.config.ts`):

```ts
const isWindowsCI = process.platform === "win32" && process.env.CI === "true"
poolOptions: isWindowsCI ? { forks: { singleFork: true } } : undefined
testTimeout: 20_000
```

On Windows CI every test file shares **one** heavily-loaded process (`singleFork: true`), running
all ~5705 tests serially. Under that memory/GC/scheduler pressure the wall-clock gap between the
parent and child request grows unpredictably — past the 5 s rate-limit window (→ 0 delays) or past
the 20 s test timeout (→ the three timeouts). On Linux/macOS the suite fans out across parallel
forks, so the gap is sub-millisecond and the assertions happen to hold. The failure is a test
harness artifact, not a product bug — `maybeWaitForProviderRateLimit` itself is correct.

A secondary hazard: test 2 does `performance.now = vi.fn(() => mockTime)` and only restores it at
the end of the test body. If the test times out before the restore, a frozen clock can leak to
later tests in the same single-fork process.

## Fix

Make the 5 tests **deterministic** by controlling the clock instead of measuring real time:

- In the `Subtask Rate Limiting` `beforeEach`, install `vi.spyOn(performance, "now")` backed by a
  mutable `mockNow` counter; restore it in `afterEach` (so nothing leaks under single-fork).
- Each test sets/advances `mockNow` explicitly so the elapsed time — and therefore the expected
  delay count — is exact and machine-independent:
    - enforce / share: do **not** advance `mockNow` between parent and child → elapsed 0 → 5 ticks.
    - enough-time-passed: advance `mockNow` by `(rateLimitSeconds + 1) * 1000` → elapsed > window → 0.
    - zero rate limit: `rateLimitSeconds = 0` → early return → 0 (no reliance on timing).
    - timestamp: `mockNow` is a positive constant → `lastGlobalApiRequestTime > 0`.
- Remove the manual `performance.now = vi.fn(...)` reassignment / restore in test 2.

This removes all wall-clock dependence and the global-reassignment leak, so the tests pass
identically under Linux multi-fork and Windows single-fork.

## Verification

- `npx vitest run core/task/__tests__/Task.spec.ts -t "Subtask Rate Limiting"` passes locally.
- Simulate the Windows path by also running with the clock spy in place and confirming counts are
  exact regardless of inserted real delays.
- Full `Task.spec.ts` file still green.
