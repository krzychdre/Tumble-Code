# F2 — Windows flake: TaskHistoryStore "releases per-ID lock tails for many unique IDs"

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md` §F2.
Branch: `fix/f2-taskhistorystore-lock-count-flake` (off `main`, F1 already merged as #530).

## Problem

`src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts` →
"releases per-ID lock tails for many unique IDs" fires 100 concurrent `upsert()`
calls and immediately asserts `TaskHistoryStore.getPendingRecordLockCountForTests(store) === 0`.
On Windows CI this fails intermittently (flake also visible on `main`).

## Root cause (proven from code, no behavior change needed)

The production code is correct — the assertion races a _second_, watcher-driven
user of the same locks:

1. Every `upsert()` runs through `withRecordTransaction()`
   (`src/core/task-persistence/TaskHistoryStore.ts:1450`), which takes a
   per-ID lock (`perIdLocks.set(taskId, tail)`, line 1467) and deletes the
   entry in `finally` when no one else waits (lines 1504-1506).
2. Each upsert **creates a task subdirectory**. The non-recursive `fs.watch`
   on the tasks dir fires for every new subdir and calls
   `scheduleTargetedRefresh(taskId)` (line 1173). Per-task watchers armed by
   `ensureTaskDirWatcher` re-schedule on `history_item.json` writes (line 1304).
3. `scheduleTargetedRefresh` (line 1197) coalesces IDs into
   `pendingWatcherIds` behind a **500 ms debounce** (`WATCHER_DEBOUNCE_MS`),
   then runs `refreshTask(id, { external: true })` per ID inside a fire-and-
   forget `Promise.all` — the promise was not tracked anywhere.
4. `refreshTask` (line 739) enters the **same** `withRecordTransaction` →
   the same per-ID locks.

So: on a slow filesystem (Windows), the debounce can fire after the test's
`Promise.all` of upserts resolves but before/during the assertion, and the
in-flight `refreshTask` calls make `perIdLocks.size > 0`. On Linux the
watcher events usually coalesce into one pass that finishes before the
assertion, which is why the flake is Windows-dominated and not reliably
reproducible locally.

Production behavior is fine: the lock map is a transient serialization
primitive, and the watcher pass is by design asynchronous.

## Fix (test-side determinism; no production behavior change)

`src/core/task-persistence/TaskHistoryStore.ts`:

- Extracted the debounce callback body into a private
  `runTargetedRefreshPass()` and track its promise on a new
  `watcherRefreshTail` field (initialized to a resolved promise). The timer
  path and the test path now share one code path.
- Added a test-only static helper next to the existing
  `getPendingRecordLockCountForTests`:
  `TaskHistoryStore.waitForWatcherRefreshesForTests(store)` — it fires the
  armed debounce immediately (instead of waiting up to 500 ms), then awaits
  `watcherRefreshTail` so the pass and its per-ID locks have settled.
- `dispose()` resets `watcherRefreshTail` to a resolved promise after
  clearing the debounce, so a late pass cannot keep a test waiting after
  teardown.

`src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`:

- The "releases per-ID lock tails" test now calls
  `await TaskHistoryStore.waitForWatcherRefreshesForTests(store)` before
  counting, with a comment explaining the fs.watch → refreshTask → per-ID
  lock path (F2).

The helper is `ForTests`-suffixed like its sibling; production behavior is
byte-for-byte equivalent (same statements, just factored into a method and
tracked).

## Verification

- `cd src && npx vitest run core/task-persistence` — 7 files, 95 tests green.
- The flaky spec in a 10x loop: 10/10 green (twice — also after the typing
  fix).
- `cd src && npx tsc --noEmit -p .` — clean (one iteration error fixed by
  flattening the tail promise to `Promise<void>`).
- `pnpm knip` — no new findings vs. the main baseline (exit 1 pre-existing,
  unchanged set).
- Windows CI: the mechanism is proven from code; local Linux cannot
  reproduce the exact Windows timing, but with the drain the assertion is
  ordered after the watcher pass rather than racing it, which removes the
  only non-deterministic path.

## Residuals

- The watcher pass still takes per-ID locks in production — by design
  (serialization with in-process upserts). No action needed.
- `WATCHER_DEBOUNCE_MS = 500` is untunable from tests; if more specs need
  to await watcher behavior, consider a constructor option later (YAGNI now).
- Other specs that rely on watcher timing (`migrationAndInit`,
  `realLock`) still use real debounces where they only assert on watcher
  _registration_, which does not take locks — not affected by this race.
