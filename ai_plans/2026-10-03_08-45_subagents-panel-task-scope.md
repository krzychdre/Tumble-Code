# Subagents panel shown in a subtask that did not fan out

Status: done on `fix/subagents-panel-task-scope`
Overview: [2026-10-03_08-40_subagents-panel-and-telemetry-overview.md](2026-10-03_08-40_subagents-panel-and-telemetry-overview.md)
Touched: `webview-ui/src/components/chat/SubagentsPanel.tsx`, `webview-ui/src/components/chat/ChatView.tsx`,
`webview-ui/src/components/chat/__tests__/SubagentsPanel.spec.tsx` (new)

## Symptom

A parent runs `run_parallel_tasks`, then delegates with `new_task`. The child's chat shows the parent's
"Subagents: 2 finished" panel, although the child never ran a subagent. The edited-files bar, by contrast,
belongs to its task and disappears with it.

## What was happening

- `SubagentRegistry` (`src/core/webview/SubagentRegistry.ts`) keeps the rows of every fan-out until a reset.
- `ClineProvider.resetSubagentPanel` runs only for a top-level task (`createTask` with no `parentTask`), for
  `clearTask` and for a rehydrated task that is not the current one. `createTask` for a `new_task` child skips
  it on purpose: the parent is only paused and comes back.
- The state push (`ProviderStateBuilder`, `subagents: this.sources.listSubagents()`) and every registry push
  (`sourceTaskId` = the current task, now the child) therefore carry the parent's rows to the child's chat. The
  reducer's scope guard compares `sourceTaskId` with `currentTaskId`, which match, so the rows are accepted.
- `ChatView` rendered `subagents` as they came.

## Fix

`SubagentsPanel` takes the open task's id (`currentTaskId`) and lists only rows whose `parentTaskId` equals it.
Every `SubagentSummary` already carries `parentTaskId`. The registry stays as it is, so the parent's rows are
still there when the child returns and the parent is the open task again.

## Tests

`SubagentsPanel.spec.tsx` (the panel had no spec before): rows of the open task are listed; a task that did not
fan out renders nothing; with two parents in the list only the open task's rows count in the header; no open
task renders nothing. With the filter replaced by `() => true` the second and third tests fail.

## Notes

The host still pushes rows that the open task does not own. Filtering at the host as well would need the same
rule in two places (state push and registry push); the panel is the one consumer, so the rule lives there.
