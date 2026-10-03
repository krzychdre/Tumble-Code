# Cloud metrics count parallel subagents as standalone tasks

Status: done on `fix/subagent-telemetry-lineage` (stacked on `fix/subagents-tail-transcript`)
Overview: [2026-10-03_08-40_subagents-panel-and-telemetry-overview.md](2026-10-03_08-40_subagents-panel-and-telemetry-overview.md)
Touched: `packages/types/src/telemetry.ts`, `packages/types/src/task.ts`, `packages/telemetry/src/BaseTelemetryClient.ts`,
`packages/cloud/src/TelemetryClient.ts`, `src/core/webview/BackgroundTaskRunner.ts`, `src/core/webview/ClineProvider.ts`,
specs of the cloud client, the runner and the provider

## Symptom

On `/app/metrics` (the quality panel and its "Roughest runs" list) and in the task list the subagents of a
`run_parallel_tasks` fan-out appear as tasks of their own, not under the parent that ran them.

## Evidence

Live cloud database, child `01a0fe98-ad5e-7551-918b-ef6492864dd8` of parent `01a0fe37-d4d9-70d0-8779-e813c7352912`
(the R3-4a fan-out):

| event          | `parentTaskId` | `isSubtask` | count |
| -------------- | -------------- | ----------- | ----- |
| LLM Completion | (none)         | false       | 23    |
| Task Message   | (none)         | false       | 132   |
| Tool Used      | (none)         | false       | 32    |
| Task Completed | (none)         | false       | 1     |

`tasks.parent_task_id` of both children is NULL and `task_relations` has no row for them.

## What was happening

- The server links a child to its parent from any event whose properties carry `taskId` and `parentTaskId`
  (`self-hosted-cloudapi/src/services/task_tree.py`, `record_relation`); the quality panel and the task list
  then select `parent_task_id IS NULL` for top-level runs. The server side is correct.
- An event's properties are the provider's properties overlaid with the event's own
  (`CloudTelemetryClient.getEventProperties`). The event names its task (`taskId: access.taskId`), but
  `parentTaskId` and `isSubtask` come from `ClineProvider.getTaskProperties`, which reads `getCurrentTask()`.
- A subagent is never the current task (it runs headless, `BackgroundTaskRunner`), and it is created without a
  `parentTask`, so it has no `parentTaskId` of its own. Its events got the foreground parent's lineage: no
  parent for a top-level parent, or the grandparent when the parent is itself a subtask.

## Fix

- `TelemetryPropertiesProvider.getTelemetryProperties(taskId?)`: both telemetry clients pass the event's
  `taskId`.
- `ClineProvider.getTaskProperties`: for an event of another task than the current one, report that task's
  lineage only (`getOtherTaskLineage`): the fan-out parent from `BackgroundTaskRunner.subagentParentOf`, else
  the history item's `parentTaskId` (a backfill upload of an older task). The current task's model, diff
  strategy and todos are left out, since they describe another task.
- `BackgroundTaskRunner` remembers subagent id to parent id for the session. A map, not the live task: the
  last events of a child are sent after it left `backgroundTasks`.

Giving the child Task a real `parentTask` was rejected: `parentTaskId` drives `new_task` delegation
(`AttemptCompletionTool` returns to the parent through it) and workspace inheritance.

## Tests

- `TelemetryClient.test.ts`: the provider is asked with the event's `taskId`, or `undefined` without one.
- `BackgroundTaskRunner.spec.ts`: a finished subagent's parent is still known; a memory writer has none.
- `ClineProvider.spec.ts`: a subagent's event carries the fan-out parent and `isSubtask: true` and no foreign
  `modelId`; a task from history keeps its own parent; the current task's own event is unchanged. The first two
  fail against the previous `ClineProvider.ts`.

## Notes

- Data already in the cloud stays as it is: earlier subagents remain top-level rows. A one-off backfill would set
  `task_relations` and `tasks.parent_task_id` from the parents' `parallelChildIds` in local history; not done.
- `mode` in a subagent's provider properties is still the global UI mode. The LLM Completion event sets its own
  `mode`, which is what the metrics read.
- `task_count` on the metrics page counts every task that called the model, subtasks included, as before; only
  the quality panel and the task list group subtasks under their parent.
