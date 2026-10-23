# R4-B1: subagent panel bookkeeping in one place

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B1).

## Touched files

- `src/core/webview/SubagentRegistry.ts`
- `src/core/webview/subagentBackfill.ts`
- `src/core/webview/ClineProvider.ts`, `src/core/webview/TaskSlot.ts` (comment)
- Specs: `rehydrateSubagents.spec.ts`, `SubagentRegistry.spec.ts`, `ClineProvider.task-slot.spec.ts`,
  `Task.completion-memory-writers.spec.ts`, `src/__tests__/single-open-invariant.spec.ts`,
  `src/__tests__/task-resume-ui.spec.ts`

## Problem

`ClineProvider` built the `subagentsUpdated` message by hand twice, although `SubagentRegistry` already posts it.
At a task boundary the panel got two identical messages whenever finished rows were dropped. Three of the four
reset call sites wrapped a reset that cannot throw in an empty `try/catch`. `SubagentRegistry.clearForParent` and
the `dropParent` behind it had no caller. The restore of a reopened task's subagent rows lived as two private
provider methods although it only works on the registry and the history.

## Change

- `SubagentRegistry.broadcast()` (formerly the private `postUpdate`) is public. `clearSettled()` broadcasts the
  rows that are left at every call, so a task boundary sends exactly one message with the current rows.
- The provider's four task boundaries call `subagentRegistry.clearSettled()` directly; `resetSubagentPanel` and
  its `try/catch` wrappers are gone.
- `rehydrateSubagents(host, historyItem)` and its `readParentMessages` helper live in `subagentBackfill.ts`. The
  provider passes itself as the host (`subagentRegistry`, `globalStoragePath`, `getHistoryItem`,
  `getCurrentTask`). Imports are static.
- `clearForParent` and `dropParent` are deleted.

## Tests

- `rehydrateSubagents.spec.ts` runs the module function against a real `SubagentRegistry` and asserts the rows and
  the one broadcast; a new case covers reading the parent's messages from disk when it is not on screen (that
  branch was stubbed before).
- `SubagentRegistry.spec.ts`: "posts the remaining rows also when nothing is dropped" replaces the no-post case.
- `ClineProvider.task-slot.spec.ts` uses a real registry and asserts the post; the navigation case asserts
  `rehydrateSubagents` is called with the provider and the history item.
- Provider stand-ins in three other specs get a real registry (they used to pass only because the `try/catch`
  swallowed "resetSubagentPanel is not a function").
- Mutation checks: dropping `registry.broadcast()` in `rehydrateSubagents`, returning `[]` instead of the live
  messages, and dropping the broadcast in `clearSettled` each turned a spec red.
