# Nested subtasks record the root of the delegation chain

## Touched files

- `src/core/task/Task.ts` (option `rootTask?: Task` replaced by `rootTaskId?: string`; the never-assigned `rootTask` field removed)
- `src/core/webview/ClineProvider.ts` (`createTask` derives the root id; dead `rootTask` plumbing removed from the rehydration paths)
- Tests: `src/core/webview/__tests__/ClineProvider.spec.ts`, `src/core/task/__tests__/Task.spec.ts`, plus specs that only carried the removed field (`ClineProvider.task-slot.spec.ts`, `ClineProvider.delegation-cancel-races.spec.ts`, `ClineProvider.cancelTask-abort-race.spec.ts`, `ClineProvider.historyReopenAllowList.spec.ts`, `src/__tests__/task-resume-ui.spec.ts`, `src/__tests__/single-open-invariant.spec.ts`)

## Symptom

In a chain of nested subtasks only the first child stores the real root in `history_item.json`. From the
second level down, every child's `rootTaskId` equals its parent's id. Measured on the chain rooted at
`01a11598-6328-743d-87f3-24f02ad97650` (about 100 levels, 2026-10-07):

| task                   | parentTaskId    | rootTaskId                |
| ---------------------- | --------------- | ------------------------- |
| `01a11598-6328` (root) | -               | -                         |
| `01a1159a-bc02`        | `01a11598-6328` | `01a11598-6328` (correct) |
| `01a1159a-eabf`        | `01a1159a-bc02` | `01a1159a-bc02` (wrong)   |
| `01a1159b-077b`        | `01a1159a-eabf` | `01a1159a-eabf` (wrong)   |

Every deeper level repeats the pattern.

## What was happening

The proven path (extension log `1-Tumble-Code.log` of 2026-10-07, lines 289-309):

1. `09:03:44.645 [createTask] child task 01a1159a-bc02...8548d09f instantiated`
2. `09:03:56.445 [Task#01a1159a-bc02...8548d09f] Aborting current HTTP request` (the same instance calls `new_task`)
3. `09:03:56.611 [createTask] child task 01a1159a-eabf... instantiated`

So the parent of the wrong child was the live instance built by `createTask` 12 seconds earlier, not a task
rehydrated from history (`createTaskWithHistoryItem` only appears 40 minutes later). The rehydration
hypothesis does not explain the data; the live delegation path does:

- `DelegationService.delegateParentAndOpenChild` (`src/core/webview/DelegationService.ts:187`) calls
  `createTask(message, undefined, parent)` with the current live Task.
- `ClineProvider.createTask` (`src/core/webview/ClineProvider.ts:1740` before the fix) passed
  `rootTask: parentTask ? (parentTask.rootTask ?? parentTask) : undefined`.
- `Task` declared `readonly rootTask: Task | undefined = undefined` (`src/core/task/Task.ts:240`) but never
  assigned it. Upstream commit `43ff486d4` ("Publish subtask events #7626") replaced
  `this.rootTask = rootTask` with `this.rootTaskId = ... rootTask?.taskId` and left the field behind.
- So `parentTask.rootTask` was `undefined` for every Task, live or rehydrated, and the fallback
  `?? parentTask` always picked the parent. For a first-level child the parent is the root, so it looked
  right; one level deeper it is wrong.

The `rootTask` object passed by the rehydration paths (`rehydrateAfterStreamingFailure`, `showTaskWithId`,
`cancelTask`) was dead too: with a `historyItem` the constructor takes `historyItem.rootTaskId` and ignores
`rootTask` (`Task.ts:930`). The test `ClineProvider.task-slot.spec.ts` "delegated child: rootTask derived
from the parent chain" copied the formula into the test and fed it hand-made objects that had `rootTask`
set, so it passed while the real Task never had that field.

## Failure surface before/after

| situation                                   | before                                       | after                                                           |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| top-level task                              | `rootTaskId` undefined                       | undefined (unchanged)                                           |
| first-level child                           | root id (by accident: parent is the root)    | root id                                                         |
| grandchild and deeper (live delegation)     | parent's id                                  | root id                                                         |
| child reopened from history                 | value stored in `history_item.json`          | same (unchanged)                                                |
| new child of a parent reopened from history | parent's id when the parent is not top-level | root id (the parent's `rootTaskId` comes from its history item) |
| already stored wrong values                 | wrong                                        | still wrong (no migration, see Notes)                           |

## Fix

- `Task` takes `rootTaskId?: string` instead of `rootTask?: Task`; the constructor keeps
  `historyItem ? historyItem.rootTaskId : rootTaskId`. The unused `rootTask` field is gone, so nobody can
  read an always-undefined field again.
- `createTask` passes `rootTaskId: parentTask ? (parentTask.rootTaskId ?? parentTask.taskId) : undefined`.
- `createTaskWithHistoryItem` no longer accepts or forwards `rootTask`; `rehydrateAfterStreamingFailure`,
  `showTaskWithId` and `cancelTask` stop passing it. Behaviour there is unchanged because the history item
  already supplied the root id.

## Tests

- `ClineProvider.spec.ts`, "createTask delegation lineage": top-level task has no root; a first-level child
  records its parent; a grandchild of a parent shaped like a live Task (`taskId`, `rootTaskId`, no root
  object) records the chain's root. The grandchild test is the regression test.
- `Task.spec.ts`, constructor: a new subtask keeps the given `rootTaskId`; a reopened subtask takes it from
  the history item.
- Verified by swapping in the pre-fix `Task.ts` and `ClineProvider.ts`: three new tests fail there (the
  constructor test, the first-level child and the grandchild) and pass with the fix. The first-level case
  fails before only because the old code passed a Task object instead of an id; the grandchild case is
  the real bug.
- Touched specs pass. `ClineProvider.cancelTask-abort-race.spec.ts` fails on this machine on `main` too,
  because the provider loads skills from the real `~/.roo/skills` (one has a broken YAML header) and the
  spec asserts that `console.error` is never called; with `HOME` pointed at an empty directory it passes.

## Notes

- Consumers checked: `TaskMessageLog` writes `rootTaskId` into `history_item.json`; `ExchangeRecorder`
  copies it into the LLM exchange dataset (`root_task_id` in the cloud schema, stored only). The history tree
  (`useGroupedTasks`), telemetry lineage (`TelemetryPropertiesSource`) and the subagents panel use
  `parentTaskId` or their own parent map, not `rootTaskId`, so they are unaffected. Parallel subagents
  (`BackgroundTaskRunner`) never had a root id and still do not.
- No migration: already stored wrong values stay in old `history_item.json` files and dataset rows. A
  repair would walk `parentTaskId` up to the top and rewrite `rootTaskId`; nothing reads it for display,
  so it is not worth the risk now.
