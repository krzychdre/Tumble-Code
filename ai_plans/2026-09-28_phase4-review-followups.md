# Phase ④ review follow-ups: TaskSlot.seedForTests, typed StreamToolCallHandler seam

Two tiny cleanups from the phase-④ review of the simplification roadmap
(one branch, one commit). Main baseline: 186dbf345 (D3/D7/D8/D10, S1/S2/S3 merged).

## Follow-up 1 — TaskSlot seedForTests (closes the S1 review finding)

**Finding:** the public `current` setter on
[`TaskSlot.ts`](../src/core/webview/TaskSlot.ts) lets any caller bypass
`set()`'s invariants (TaskFocused emit, `performPreparationTasks`). Eight
specs seeded the slot via `(provider as any).taskSlot.current = task`.

**Fix:**

- Delete the public setter; keep the read-only `get current()`. The
  underlying `currentTask` field was already private.
- Add `seedForTests(task?: Task)` — direct assignment, no side effects,
  documented "For tests only." This follows the repo's established
  test-only convention (`resetOsInfoCacheForTests`,
  `TaskHistoryStore.resetSharedStoresForTests`): the `ForTests` name suffix
  plus a "For tests only." doc comment. `scripts/find-test-only-exports.mjs`
  only scans top-level `export` declarations, not class members, so a method
  on an exported class is never flagged by it; knip has `classMembers: "off"`
  and `ignoreExportsUsedInFile: true`, so neither gate reports it.
- Retarget all 17 pokes across 8 spec files:
    - `src/__tests__/task-resume-ui.spec.ts`
    - `src/core/task/__tests__/Task.completion-memory-writers.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.historyReopenAllowList.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.cancelTask-abort-race.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`
    - `src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts`

## Follow-up 2 — typed seam in StreamToolCallHandler (closes the S2 review finding)

**Finding:** the extracted handler took an untyped `_task: any` and
duck-typed `checkpointSave`/`pendingCheckpointSave` via
`typeof x === "function"`.

**Fix:** verify what the handler actually touches on `_task`:

- `checkpointSave` (guarded call, eager pre-edit checkpoint)
- `pendingCheckpointSave` (read + write)
- passes `_task` to `presentAssistantMessage(this._task)`, whose signature
  is `(cline: Task)`

So it needs a type that satisfies `presentAssistantMessage` too — the
parameter is typed as `Task` (type-only import; the same file already
imports from `../assistant-message`, and `Task.ts` does not import this
module, so no runtime cycle). The duck-typing guard
`typeof this._task?.checkpointSave === "function"` is kept: specs pass
partial fixtures (`{}`, `{ checkpointSave, pendingCheckpointSave }`) via
`as any` through `TaskStreamProcessor`, and `presentAssistantMessage` is
mocked in those suites — the guard is load-bearing runtime safety. Typing
alone cannot remove it without breaking those fixtures.

S2's residual note ("typing `_task: any` is S6 territory") refers to the
`TaskStreamProcessor`-wide seam; this change types only the
`StreamToolCallHandler` parameter, as directed.

## Verification

- `cd src && npx vitest run` the 8 retargeted specs + the
  TaskStreamProcessor/StreamToolCallHandler suites, then the `core/task` and
  `core/webview` directories.
- Typecheck + eslint on touched files.
- `node scripts/find-test-only-exports.mjs` — no new entry for
  `seedForTests` (methods are out of its scan scope).
- `pnpm knip` — baseline exit 1 pre-existing; diff shows no new findings.

## Residuals

- None from this change. `TaskStreamProcessor._task` (and the
  `presentAssistantMessage` full-task seam) remain `any` — deliberately
  left for roadmap S6.
