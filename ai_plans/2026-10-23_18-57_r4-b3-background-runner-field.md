# R4-B3: the background task runner as a public provider field

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B3).

## Touched files

- `src/core/webview/ClineProvider.ts`
- `src/core/tools/RunParallelTasksTool.ts` (the `SubtaskProvider` surface and three call sites only)
- `src/core/task/TaskLifecycle.ts`, `src/core/task/Task.ts` (call sites)
- Specs: `RunParallelTasksTool.spec.ts`, `subagents-compact-profile.spec.ts`, `TaskLifecycle.abort-memory-writers.spec.ts`,
  `Task.completion-memory-writers.spec.ts`, `ClineProvider.cancelTask-abort-race.spec.ts` (fakes and call sites)

## Problem

`ClineProvider` forwarded six methods one-to-one to its private `backgroundTaskRunner`: `createBackgroundTask`,
`resolveSubagentProfile`, `awaitTaskCompletion` (used only by `RunParallelTasksTool`), `memoryWriterQuery`,
`notifyBackgroundOutcome` (only `TaskLifecycle`) and `setMemoryActivity` (only `Task`). About 60 lines, mostly doc
comments that pointed at the runner. `subagentRegistry` and `backgroundSubagents` are already public readonly
fields, so the pattern for direct access exists.

## Change

- `backgroundTaskRunner` is `public readonly`; the six delegators are deleted.
- `RunParallelTasksTool`'s `SubtaskProvider` declares `backgroundTaskRunner: Pick<BackgroundTaskRunner, ...>`
  instead of three hand-written method signatures; `placeSubtasks` takes the same shape.
- `getBackgroundTask` stays on the provider (many callers, also the bridge and message handlers), and so do the
  `modeProfiles` and `taskHistory` forwards that implement `*Host` interfaces.

## Tests

- A rename of call sites: `tsc` proves every consumer moved, and the fakes in the touched specs no longer carry
  the old top-level methods, so a missed call site fails at run time.
- Ran: all `ClineProvider*.spec.ts`, `RunParallelTasksTool.spec.ts`, `subagents-compact-profile.spec.ts`,
  `TaskLifecycle.abort-memory-writers.spec.ts`, `Task.completion-memory-writers.spec.ts`, `Task.spec.ts`,
  `BackgroundTaskRunner.spec.ts`.
