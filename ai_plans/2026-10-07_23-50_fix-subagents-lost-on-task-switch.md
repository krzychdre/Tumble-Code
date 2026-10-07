# Subagents panel: live subagents lost after leaving and reopening a task, header counts

**Status:** done (branch `fix/subagents-panel-scroll-collapsed`, second commit)
**Related plans:** `2026-10-07_23-20_fix-subagents-panel-squashed-rows.md`, keep tasks running off screen (#816-#820)
**Touched:**

- `src/core/webview/SubagentRegistry.ts`
- `src/core/webview/ClineProvider.ts`
- `src/core/tools/RunParallelTasksTool.ts`
- `webview-ui/src/components/chat/SubagentsPanel.tsx`
- `webview-ui/src/i18n/locales/*/chat.json`
- tests: `SubagentRegistry.spec.ts`, `RunParallelTasksTool.spec.ts`, `SubagentsPanel.spec.tsx`

## Symptom

A task fanned out 20 parallel subagents (4 running, 16 queued). The owner left
the task and opened it again: the panel was gone. A row appeared only when the
next queued subagent started. The subagents that were running or waiting
before the switch never came back.

The header read "Subagents: 20/20 active" while only 4 were running.

## What was happening

- Every foreground task change (`createTask`, `clearTask`,
  `createTaskWithHistoryItem`, `reattachTask`) calls
  `ClineProvider.resetSubagentPanel`, which called
  `SubagentRegistry.clearAll()` and broadcast an empty list.
- Since #816-#820 a parent left mid fan-out keeps running off screen, and the
  fan-out detaches instead of cancelling (`RunParallelTasksTool`, the
  `onParentAborted` comment even says the children "stay visible in the
  panel"). `clearAll` dropped their rows anyway.
- On reopen, `rehydrateSubagents` loads the `subagents.json` sidecar, which is
  written only after the whole fan-out settles, so there was nothing to load.
- `registerQueued` / `register` of a child started after the reopen added a new
  row, hence "only the next one appears". `update` / `markTerminal` for the
  dropped ids are ignored (unknown id), so the final sidecar snapshot lacked
  those children too.
- The header counted `queued`, `running` and `awaiting_input` together as
  "active".

## Failure surface (before/after)

| Scenario                                          | Before                             | After                            |
| ------------------------------------------------- | ---------------------------------- | -------------------------------- |
| Reopen a task whose fan-out still runs            | empty panel, later only new rows   | all rows, live status            |
| Sidecar written after such a fan-out settles      | only children started after reopen | every child                      |
| Open a task whose fan-out finished                | rows from sidecar                  | rows from sidecar (unchanged)    |
| Another task open while a fan-out runs off screen | panel empty                        | panel empty (filtered by parent) |
| Header, 4 running + 16 queued                     | "20/20 active"                     | "4/20 running · 16 queued"       |

## Fix

- `SubagentRegistry` tracks parents whose fan-out is in progress
  (`beginFanOut` adds, new `endFanOut` removes). `clearAll` is replaced by
  `clearSettled`, which drops only rows of parents without a fan-out in
  progress. `restore` skips a parent whose fan-out is in progress (its live
  rows are newer than any sidecar).
- `RunParallelTasksTool` calls `endFanOut` in the `finally` after the sidecar
  is written.
- `resetSubagentPanel` broadcasts the remaining list instead of `[]`. Rows of
  other parents are harmless: the webview panel filters by `parentTaskId`.
- Header: `headerRunning` ("{{running}}/{{total}} running") plus
  `headerQueued` and `headerAwaitingInput` only when non-zero, joined with
  " · ". `headerActive` removed from all 18 locales.

## Tests

- `SubagentRegistry.spec.ts`: `clearSettled` keeps the rows of a fan-out in
  progress and they keep updating; drops them after `endFanOut`; `restore`
  leaves live rows untouched. Verified by forcing `clearSettled` to drop
  everything (the old behaviour): the regression test fails.
- `RunParallelTasksTool.spec.ts`: `endFanOut` is called after the sidecar
  snapshot.
- `SubagentsPanel.spec.tsx`: header counts running, queued and awaiting input
  separately and names only non-zero states.

## Notes

- A finished fan-out's rows still stay in memory until the next task switch
  (same as before).
- `clearForParent` (unused) keeps its old meaning via `dropParent`.
