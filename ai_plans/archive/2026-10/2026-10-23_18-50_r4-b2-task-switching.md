# R4-B2: one way to leave the current task

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B2).

## Touched files

- `src/core/webview/ClineProvider.ts`
- `src/core/webview/PendingEditOperations.ts`
- Specs: `PendingEditOperations.spec.ts`, `ClineProvider.task-slot.spec.ts`, `Task.completion-memory-writers.spec.ts`,
  `src/__tests__/single-open-invariant.spec.ts`, `src/__tests__/task-resume-ui.spec.ts`

## Problem

The four task boundaries of `ClineProvider` (`createTask` for a top-level task, `clearTask`,
`createTaskWithHistoryItem` for another task, `reattachTask`) each spelled "reset the subagent panel, then leave
the current task", with different error handling (`createTask` wrapped the leave in a silent catch, `clearTask`
skipped it on an empty slot). The replay of a pending message edit was 42 lines inline in
`createTaskWithHistoryItem`, with an immediately invoked function. `cloudUserInfo` and `taskSyncEnabled` were
destructured and never read, and `if (configuration)` in `createTask` was always true (the parameter defaults to
`{}`).

## Change

- `private switchAwayFromCurrentTask()`: `subagentRegistry.clearSettled()`, then `leaveCurrentTask()`. All four
  boundaries call it. `clearTask` calls it also on an empty slot, where `leaveCurrentTask` does nothing.
- `PendingEditOperations.replayInto(task, operationId)` takes the pending edit, clears it and, after 100 ms, cuts
  the task's messages and API history at the edited message and sends the edited text. The provider's private
  `getPendingEditOperation` and `clearPendingEditOperation` delegators are gone.
- The dead destructures and the always-true branch are gone.
- `cancelTask` is untouched.

## Tests

- `PendingEditOperations.spec.ts`: two new cases for `replayInto` (the replay had no test).
- Provider stand-ins in four specs get the real `switchAwayFromCurrentTask` and a real `PendingEditOperations`.
- Mutation checks: cutting at `messageIndex + 1` in `replayInto` and dropping `clearSettled()` from
  `switchAwayFromCurrentTask` each turned a spec red.
- Ran: all `ClineProvider*.spec.ts`, `PendingEditOperations`, `checkpointRestoreHandler`,
  `webviewMessageHandler.checkpoint`, `rehydrateSubagents` and the four stand-in specs.
