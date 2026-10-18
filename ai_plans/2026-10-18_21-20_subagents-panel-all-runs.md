# Subagents panel lists every fan-out of a task

**Status:** implemented on `fix/subagents-panel-all-runs` (2 of 3 stacked branches, on
`fix/subagent-no-turn-limit`; next: `feat/subagent-transcript-view`)
**Related plans:** `2026-10-18_20-45_subagent-no-turn-limit.md`
**Touched:** `packages/types/src/subagent.ts`, `src/core/webview/SubagentRegistry.ts`,
`src/core/webview/BackgroundTaskRunner.ts`, `src/core/tools/RunParallelTasksTool.ts`,
`src/core/task-persistence/subagentSummariesStore.ts`, `src/core/webview/subagentBackfill.ts` (new),
`src/core/webview/ClineProvider.ts`, `webview-ui/src/components/chat/SubagentsPanel.tsx`, 18 `chat.json` locales,
tests next to each.

## Symptom

"widzę tylko te, które aktualnie działają, jeśli są takie, które skończyły pracę, a dokładają się nowe - nie
widzę starych." The 2026-10-18 Game task ran three fan-outs (4 + 3 + 3 subagents). Its history item lists all 10
in `parallelChildIds`; its `subagents.json` held only the 3 of the second run, and during the third run the panel
showed only the third.

## What was happening

- `SubagentRegistry.beginFanOut` called `dropParent`: by design ("the panel only ever shows the live
  generation") a new fan-out removed every row of the parent's earlier ones.
- `persistSubagentSummariesSidecar` overwrote the sidecar with `saveSubagentSummaries` ("only the latest fan-out
  is relevant").
- `SubagentRegistry.snapshot()` returned the rows of every parent, so a sidecar could also carry other tasks'
  rows (filtered out again on restore).
- `restore` replaced a parent's rows, and skipped a parent whose fan-out was in progress.
- Placeholder ids were `queued:<parent>:<index>`, so two runs of one parent would collide once rows were kept.

## Fix

- `SubagentSummary.runId` (optional): the `run_parallel_tasks` call's `newFanOutRunId()` (start time in base 36,
  sorts in start order). Passed through `registerQueued`, `SubagentInfo` and `register`; placeholder ids are
  `queued:<parent>:<runId>:<index>`.
- Registry: `beginFanOut` keeps the earlier rows; `snapshot(parentTaskId)`; `restore` merges (a row already in
  the registry wins, it is at least as new); `list` orders by parent, run, index.
- Sidecar: `mergeSubagentSummaries` replaces `saveSubagentSummaries` (merge by task id, never saves queued
  placeholders), so it keeps every run even when the registry no longer holds the earlier ones.
- Rehydration (`ClineProvider.rehydrateSubagents`, used by open-from-history and reattach): for every child in
  `parallelChildIds` that is neither in the sidecar nor live in the registry, a row is rebuilt from the child's
  history item (`subagentBackfill.completeSubagentRows`: status from `outcome`, cost, tokens, profile, mode,
  description, start time from the UUIDv7 task id). Rows without a run id get the run they were created in: the
  latest `runParallelTasks` approval ask of the parent before the child's creation time (`fanOutStartTimes`),
  encoded like a real run id. The parent's messages are read only when a row needs it.
- Panel: one run looks as before; several runs get a header per run ("Run N · HH:MM · x/y finished"; unknown
  runs first as "Earlier subagents"). The latest run and any run with live rows start open. Row keys are
  `runId:index`.

## Failure surface (before/after)

| Scenario                                | Before                  | After                                     |
| --------------------------------------- | ----------------------- | ----------------------------------------- |
| Second fan-out starts                   | first run's rows vanish | both runs listed                          |
| Task reopened after 3 fan-outs          | last run only           | all runs (sidecar merged)                 |
| Old task (overwritten sidecar) reopened | last run only           | missing runs rebuilt from history items   |
| Reattach while a fan-out runs           | earlier runs missing    | restore merges them next to the live rows |

## Tests

- `SubagentRegistry.spec.ts`: earlier rows survive `beginFanOut` (regression), placeholders of two runs do not
  collide, run order, `snapshot(parent)`, merging `restore`.
- `subagentSummariesStore.spec.ts`: merge keeps earlier runs and replaces by id; placeholders not saved.
- `subagentBackfill.spec.ts` (new): UUIDv7 time, approval-ask starts, rebuilt rows of the real Game task ids
  land in the right run with the right index.
- `rehydrateSubagents.spec.ts`: a child missing from the sidecar is rebuilt; a live one is not touched.
- `RunParallelTasksTool.spec.ts`: sidecar keeps an earlier run; one run id per call.
- `SubagentsPanel.spec.tsx`: run headers, earlier runs closed, unknown run first, no header for one run.

## Notes

- A rebuilt row says only completed / failed (the history item keeps whether a task finished, not whether it
  was cancelled) and has no final message; the transcript is read from the child's own task directory.
