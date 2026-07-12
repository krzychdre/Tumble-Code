# Fix: Stop button regression — memory writers fired on user cancel

**Date:** 2026-07-11
**Branch:** `fix/memory-writers-skip-user-cancel` (stacked on `feature/memory-subtask-runner-wiring`)
**Status:** DONE.

## Problem (proven)

After the memory-hook + headless-subagent work
([2026-07-01 plan](2026-07-01_memory-hook-and-headless-subagent.md)), pressing **Stop**
during an active request no longer stopped the inference engine, and the UI felt
unresponsive (worst during thinking blocks on slow models). Evidence:

- `ClineProvider.cancelTask()` sets `task.abortReason = "user_cancelled"`, aborts the
  HTTP request, then calls `task.abortTask()` **without** `isAbandoned`
  ([ClineProvider.ts](../src/core/webview/ClineProvider.ts), cancelTask).
- `TaskLifecycle.abortTask()` guarded the memory writers only on the `isAbandoned`
  **parameter**, so a user cancel passed the guard and fired
  `triggerMemoryBackgroundWriters()` → `executeExtractMemories` + `executeAutoDream`,
  which spawn a headless sub-task that sends a **fresh LLM request**. Net effect: the
  engine went right back to work the moment the user pressed Stop — indistinguishable
  from "the request was never cancelled".
- `abortTask()` also awaited `drainPendingExtraction(60_000)`. The stream loop awaits
  `abortTask()` in `TaskApiLoop.handleStreamError`, and `isStreaming` only flips false
  after that returns — so the drain held `isStreaming === true` past `cancelTask`'s 3s
  `pWaitFor`, delaying rehydration and freezing the UI.
- The provider-level abort itself was never the defect: the active provider
  (`openai.ts`) has its own `AbortController` + `cancelRequest`, pre-existing on main.

## Fix

In [`TaskLifecycle.abortTask()`](../src/core/task/TaskLifecycle.ts):

1. Skip `triggerMemoryBackgroundWriters()` when `abortReason === "user_cancelled"`
   (in addition to the existing abandoned skip). Completion remains the durable
   extraction signal; a cancelled run has none, and firing writers on Stop defeats Stop.
2. Skip `drainPendingExtraction(60_000)` on user cancel. In-flight extraction runs as a
   provider-level background task and survives without the drain; the drain only
   matters for extension shutdown (abandoned/dispose paths keep it).

No changes to the writers themselves, the headless runner, or `run_parallel_tasks`.

## Tests

`src/core/task/__tests__/TaskLifecycle.abort-memory-writers.spec.ts` (new, stub-based
like `TaskLifecycle.lazy-access.spec.ts`):

- `user_cancelled` abort → no `executeExtractMemories`/`executeAutoDream`, no drain.
- non-cancelled abort → writers fire, drain runs (previous behavior preserved).
- abandoned abort → writers skipped, drain still runs (shutdown orphaning guard).

Plus green runs of the neighboring suites: `TaskLifecycle.lazy-access`,
`Task.dispose`, `core/webview/__tests__/backgroundTask.spec.ts`, `core/memory/__tests__/`.

## Verification

Manual, against a live engine: start a long generation, press Stop mid-stream
(including during a thinking block) → chat stops promptly and the engine shows no
follow-up request; a normally _completed_ task still triggers memory extraction.
