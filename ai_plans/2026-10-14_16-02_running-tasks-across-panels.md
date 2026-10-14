# Running tasks of every panel shown in every panel of the window

**Status:** implemented on `feat/running-tasks-across-panels`, pull request open, not merged
**Related plans:** `2026-10-07_12-31_keep-tasks-running-in-background.md` (the running status and the detached
tasks), `2026-10-14_14-45_multiple-editor-tabs.md` (several editor tabs, `findTaskHost`),
`2026-10-14_15-36_history-running-first.md` (running tasks listed first), `2026-10-14_15-41_history-pin-task.md`
(pin)
**Touched:**

- `src/core/webview/ClineProvider.ts` (`getOwnRunningTasks`, static `getRunningTasksOfAllPanels` and
  `postRunningTasksToAllPanels`, the task-event listener, `dispose`)
- `src/core/webview/ProviderStateBuilder.ts`, `packages/types/src/vscode-extension-host.ts`,
  `packages/types/src/vscode-extension-host/state.ts` (doc comments only)
- `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts` (4 new tests),
  `src/core/webview/__tests__/TaskHistoryGateway.sharedStore.spec.ts` (new, 3 tests)
- `docs/02-extension-host.md`, `.changeset/history-running-across-panels.md`

## Symptom

Owner request: "Chcę aby inne instancje widziały aktualnie uruchomione taski i subtaski i tak samo sortowały."
Scope confirmed by the owner: one VS Code window, that is all Tumble panels of one extension host (the sidebar
view and every Tumble editor tab, each its own `ClineProvider`).

With a task working in editor tab 1, the sidebar and editor tab 2 showed it at rest: no spinner, no attention
icon, and since #890 sorts working tasks (and the root of a working subtask) first, the panels listed the same
history in different orders.

## What was happening

- `src/core/webview/ClineProvider.ts:704` (before): `getRunningTasks()` returned
  `this.taskSlot.getRunningTasks(this.backgroundTaskRunner.liveSubagents())`, the tasks of THIS provider only
  (`TaskSlot.getRunningTasks`, `src/core/webview/TaskSlot.ts:259`: the slot occupant, the detached tasks and the
  given subagents).
- That map fed the state push (`ProviderStateBuilder.ts:400`, `runningTasks`) and `postRunningTasksIfChanged`
  (`ClineProvider.ts:709`), which compared it with the panel's own `runningTasksInView`.
- `postRunningTasksIfChanged` was triggered only by this provider's own task events (`ClineProvider.ts:491`,
  `RUNNING_TASK_EVENTS`), so a status change in tab 1 never reached tab 2 either.
- The webview (`webview-ui/src/components/history/useTaskSearch.ts`, `withAncestors` and the sections) sorts
  by `runningTasks`, so different maps meant different orders.

The task history itself was already shared: `TaskHistoryStore.acquire` (`TaskHistoryStore.ts:363`) returns one
ref-counted store per storage path, every `TaskHistoryGateway` subscribes to its `onChange`
(`TaskHistoryGateway.ts:330`) and skips only its own `origin`, so an upsert from another panel (a new task,
`setTaskPinned` through `atomicReadAndUpdate`) is pushed as `taskHistoryItemUpdated`, a delete as
`taskHistoryItemDeleted`. Verified with a real store (see Tests); nothing to fix there.

## Failure surface

| Situation (two panels, task works in panel 1)              | Before                     | After                                        |
| ---------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| Panel 2 history row of the task                            | at rest, no spinner        | spinner / attention icon, same as panel 1    |
| Panel 2 order of the lists                                 | task not in "Active"       | same "Active" section and order as panel 1   |
| Task in panel 1 starts waiting for the user, then finishes | panel 2 never told         | panel 2 gets `runningTasksUpdated` each time |
| Detached task or parallel subagent of panel 1              | invisible in panel 2       | shown in panel 2                             |
| Panel 1 closes while its task works                        | (never shown in panel 2)   | panel 2 drops the task at once               |
| Same id reported by two panels (should not happen)         | n/a                        | "awaiting_input" wins                        |
| Pin / new task / delete made in panel 1                    | already reached panel 2    | unchanged, now covered by a test             |
| Click on the row of a task that panel 1 runs, in panel 2   | shows it in panel 1 (#888) | unchanged                                    |
| CLI (one provider)                                         | own tasks                  | same: the merge over one panel is its map    |

## Fix

- `getRunningTasks()` became `getOwnRunningTasks()` (still the panel's own slot tasks plus its live subagents).
- New static `ClineProvider.getRunningTasksOfAllPanels()`: merges `getOwnRunningTasks()` of every instance in
  `activeInstances` that is not disposed; when an id repeats, "awaiting_input" wins (the rule of
  `withAncestors` in the webview).
- New static `ClineProvider.postRunningTasksToAllPanels()`: computes the merged map once and calls
  `postRunningTasksIfChanged(map)` on every live instance; each panel still compares against its own
  `runningTasksInView`, so it posts only when its view holds a different map.
- The `RUNNING_TASK_EVENTS` listener (still deferred to a microtask, for the reason in its comment) calls
  `postRunningTasksToAllPanels()` instead of the panel's own post.
- The state builder's `getRunningTasks` source returns the merged map (and still records it as the view's map).
- `dispose()` calls `postRunningTasksToAllPanels()` right after `_disposed = true`, so the other panels drop the
  closing panel's tasks at once (the disposed panel is skipped both as a source and as a target).
- Ownership is untouched: `TaskSlot`, `findLiveTask`, `findTaskHost`, `stopTask` and every "does this panel own
  the task" check stay per panel. Only what the history rows display is shared.

Cost: one map per panel per task event, a handful of panels at most.

## Tests

- `ClineProvider.stateBuilder.spec.ts`, describe "several panels in one window":
    - a panel shows a task working in another panel, and gets `runningTasksUpdated` for running, awaiting input
      and rest;
    - both panels show a detached task of panel 1, a parallel subagent of panel 2 and the open task of panel 2;
    - a task reported by two panels shows as "awaiting_input" in both;
    - disposing panel 1 posts `{}` to panel 2 and nothing to panel 1.
- `TaskHistoryGateway.sharedStore.spec.ts` (new): two gateways on one real `TaskHistoryStore` in a temporary
  directory; a new task, a pin and an unpin, and a delete made through gateway 1 reach gateway 2's webview,
  each exactly once, and gateway 1 never gets its own echo.
- Re-run unchanged: `ClineProvider.spec.ts`, `ClineProvider.task-slot.spec.ts`, `ClineProvider.multipleTabs.spec.ts`
  (includes "opening a task that another panel runs shows it in that panel"), `TaskHistoryGateway.spec.ts`,
  `ClineProvider.taskHistory.spec.ts`.

## Notes

- Other VS Code windows are out of scope (owner): each window is its own extension host with its own
  `activeInstances`. Their history changes still arrive through the store's file watcher, their running status
  does not.
- A provider that exists but has no webview yet (the sidebar before it is ever shown, running a task from the
  API) counts as a source; posting to it is a no-op until its view launches and gets the merged map in its state.
- The CLI has one provider, so the merged map equals its own map.
