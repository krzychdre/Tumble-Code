# Parallel subagents as history subtasks (cost and tokens counted)

**Status:** done (branch `feat/subagents-as-history-subtasks`)
**Related plans:** `2026-10-07_23-50_fix-subagents-lost-on-task-switch.md`, history whole-tree cost (#824), keep tasks running off screen (#816-#820)
**Touched:** `packages/types/src/history.ts`, `src/core/task/{Task,TaskMessageLog,TaskResumption,TaskLifecycle}.ts`, `src/core/task-persistence/{taskMetadata,subagentSummariesStore}.ts`, `src/core/tools/{AttemptCompletionTool,RunParallelTasksTool}.ts`, `src/core/webview/{BackgroundTaskRunner,ClineProvider,TaskHistoryGateway,TaskSlot,aggregateTaskCosts}.ts`, `src/core/webview/messageHandlers/subagents.ts`, `webview-ui/src/components/history/useTaskSearch.ts`, `webview-ui/src/components/chat/hooks/useChatHostMessages.ts`, `ChatView.tsx`, `src/i18n/locales/*/common.json`, tests.

## Symptom

The owner asked whether the cost and tokens of parallel subagents are counted
into the task. They were not, outside the cloud:

| Place                                  | Before                     |
| -------------------------------------- | -------------------------- |
| Parent's own cost                      | not counted                |
| History list whole-tree cost, header Σ | not counted, not listed    |
| Cloud tree                             | counted (live bridge only) |

## What was happening

- A subagent is a headless background Task. `TaskMessageLog.writeClineMessages`
  skipped `updateProviderTaskHistory` for every background task, so no
  HistoryItem existed.
- `BackgroundTaskRunner` deleted a completed subagent's task directory; the
  messages survived only as a copy under the parent for the panel.
- The history list nests and sums by `parentTaskId`; the header aggregate and
  the delete cascade walk `childIds`. A subagent had neither; the parent lists
  them in `parallelChildIds` only.
- `subagents.json` (panel sidecar, the only local cost record) is overwritten
  by every fan-out of the same parent.

## Fix

Contract: a subagent's HistoryItem has `parentTaskId` = fan-out parent,
`rootTaskId` = parent's root, `workspace` = parent's workspace (the worktree
path would hide it behind the workspace filter), `isSubagent: true`.

1. **Persist (WP1).** New Task option `historyLineage` used only when building
   the HistoryItem; the live Task keeps no runtime parent (a runtime
   `parentTaskId` would start the `new_task` delegation in
   `attempt_completion`, a `parentTask` would replace the worktree cwd).
   Background tasks with a lineage write their item; `taskNumber: 1`; the
   subagent's API profile is recorded. The task directory is no longer
   deleted (the history store drops items whose directory is gone).
   `AttemptCompletionTool` skips delegation for background tasks and
   `isSubagent` items.
2. **Tree (WP2).** Delete cascade follows `childIds` and `parallelChildIds`
   (cycle safe) and aborts live subagents in the deleted set before removing
   files. Header aggregate follows both lists; the webview re-requests it when
   the open task has `parallelChildIds` and whenever its subagents' status or
   cost changes. The history workspace filter keeps an item whose ancestor is
   in the current workspace. Live subagents get the history spinner
   (`TaskSlot.getRunningTasks(others)`). Auto-dream does not count subagent
   items as sessions.
3. **Open (WP3).** The panel reads a finished subagent's messages from its own
   directory, falling back to the legacy copy under the parent (no directory
   is created by the read; the webview-supplied id is validated). The legacy
   copy is no longer written. Opening a live subagent from history opens its
   parent instead of starting a second Task with the same id. A finished
   subagent opens read-only: always `resume_completed_task`, no checkpoints, a
   typed message gets `common:errors.subagent_read_only`.

`isSubagent` survives a re-save after reopening: `taskMetadata` adds it only
when true and `TaskHistoryStore.upsert` merges onto the stored item.

Implemented as three parallel work packages in `/tmp` worktrees on top of the
types commit, merged into the feature branch.

## Tests

New or updated specs: `TaskMessageLog.background-guard`, `taskMetadata`,
`BackgroundTaskRunner`, `backgroundTask`, `ClineProvider.backgroundTaskOptions`,
`RunParallelTasksTool`, `attemptCompletionTool`, `TaskHistoryGateway`,
`aggregateTaskCosts`, `ClineProvider.task-slot`,
`TaskLifecycle.abort-memory-writers`, `subagents` (message handler),
`subagentSummariesStore`, `TaskResumption.readonly-subagent`, webview
`useTaskSearch`, `ChatView.ask-state-machine`. Full `src` and `webview-ui`
suites, both `tsc`, knip run after the merge.

## Notes

- Old runs keep what they had: their subagents have no items (directories
  deleted), and only the latest fan-out per parent has panel rows.
- Deleting a parent mid fan-out: the fan-out may still write `subagents.json`
  after the parent directory is removed (orphan directory without a history
  item, invisible). Pre-existing, not addressed.
- The cloud needs no change: it links children by `parentTaskId` and dedupes
  tasks by id; the HistoryItem lineage also lets the telemetry lineage lookup
  work after a reload.
