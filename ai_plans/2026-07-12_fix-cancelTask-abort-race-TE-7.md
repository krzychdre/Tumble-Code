# TE-7: cancelTask fire-and-forget abort races the 3s pWaitFor

## Root cause

`ClineProvider.cancelTask()` called `task.abortTask()` fire-and-forget, then
immediately set `task.abandoned = true` before the abort had any chance to
progress. The subsequent `pWaitFor(() => !isStreaming, { timeout: 3000 })`
would time out if the abort was still running (e.g. slow stream cleanup,
memory-writer drain on a non-user-cancel path), logging a spurious
"Failed to abort task" error. The `abandoned` flag was set while the abort
was still mid-flight, potentially clobbering a to-be-successful cleanup.

## Fix

1. **Move `abandoned = true` AFTER the bounded wait** — the flag is now set
   after the `pWaitFor` concludes (whether the abort finished or timed out),
   never before the abort has had a chance to run.

2. **Replace the error log with a warning** — the `.catch()` on `pWaitFor`
   now logs "abort still in progress after 3s bound — continuing" via
   `this.log()` instead of `console.error("Failed to abort task")`. A
   timeout here means the abort is progressing but hasn't finished within
   the 3s bound; that's success-in-progress, not failure.

3. **`abortTask()` remains fire-and-forget** — the abort is initiated
   immediately, and the bounded `pWaitFor` gives it up to 3s to clear
   `isStreaming`. If the abort needs longer (e.g. 60s memory-writer drain
   on a non-user-cancel path), it continues in the background without
   blocking `cancelTask` or producing a spurious failure.

## Invariants

- (a) User-cancel path behavior unchanged — `abortReason` is always
  `user_cancelled` in `cancelTask`, so the 60s drain is skipped; the
  `pWaitFor` bound stays at 3s.
- (b) No spurious "Failed to abort task" when a non-user-cancel abort is
  legitimately draining — the timeout is now a warning, not an error.
- (c) `cancelTask` returns within ~3s — the `pWaitFor` bound is unchanged.
- (d) `abandoned` is never set while it can clobber a to-be-successful
  abort — it's set after the bounded wait, not before.

## How `abandoned` is consumed

- `Task.resumeTaskFromHistory` (Task.ts:789): early-returns if
  `abandoned || abort` — prevents a resumed task from continuing after
  being abandoned.
- `ClineProvider` constructor (line 972): removes cline from stack if
  `abandoned || abort` — clears stale task state on extension start.
- `logWebviewHiddenDiagnostics` (line 2908): skips diagnostics if
  `abandoned || abort` — no diagnostics for dead tasks.

Setting `abandoned` after the bounded wait is safe for all consumers:
they check the flag to skip work on dead tasks, and the 3s delay doesn't
change the outcome (the task is being aborted regardless).

## Test

`src/core/webview/__tests__/ClineProvider.cancelTask-abort-race.spec.ts`

- **fast abort (control)**: abort resolves quickly → no error, `abandoned`
  set, rehydrate proceeds.
- **slow abort**: abort takes 5s (past the 3s pWaitFor bound) → no spurious
  "Failed to abort task" error, `cancelTask` returns bounded, `abandoned`
  set after the wait, abort continues in the background.
- **abandoned ordering**: `abandoned` is `false` when `abortTask` starts,
  `true` after `cancelTask` completes.
