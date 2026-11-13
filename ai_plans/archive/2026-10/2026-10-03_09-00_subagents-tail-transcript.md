# Expanded subagent row: no scrollbar, and nothing to read after the child finished

Status: done on `fix/subagents-tail-transcript` (stacked on `fix/subagents-panel-task-scope`)
Overview: [2026-10-03_08-40_subagents-panel-and-telemetry-overview.md](2026-10-03_08-40_subagents-panel-and-telemetry-overview.md)
Touched: `webview-ui/src/components/chat/SubagentsPanel.tsx`, `src/core/task-persistence/subagentSummariesStore.ts`,
`src/core/tools/RunParallelTasksTool.ts`, `src/core/webview/messageHandlers/subagents.ts`, specs of all four

## Symptom

The owner expanded a finished subagent ("R3-4a completed and merged", status Completed). The row showed a long
markdown text that ran past the bottom of the panel with no scrollbar, and nothing else of what the subagent did.
The question was whether only old fan-outs are affected or current ones too.

## What was happening

Both old and current fan-outs are affected, because the cause is the moment a child finishes, not its age:

- `BackgroundTaskRunner.awaitTaskCompletion` removes a finished child from `backgroundTasks`, disposes it and,
  when it completed, deletes its task directory (`cleanupBackgroundTaskFiles`). Checked on the owner's machine:
  `tasks/01a0fe98-ad5e-.../` of the R3-4a child holds only `api_conversation_history.json` (rewritten by the
  abort after the delete), no `ui_messages.json`.
- `subscribeSubagentMessages` (`src/core/webview/messageHandlers/subagents.ts`) answers from
  `getBackgroundTask(id)`, which is `undefined` for a finished child, so the snapshot is empty.
- With no entries, `SubagentTail` rendered `summary.finalMessage` in a plain `div`. Only the entries list had
  `max-h-64 overflow-y-auto`, so the final message had no height cap and no scrollbar.
- A running child was fine: its entries render in the capped box and scroll.

## Fix

1. `run_parallel_tasks` copies each finished child's `clineMessages` to
   `tasks/<parentTaskId>/subagents/<childTaskId>.json` right after `awaitTaskCompletion`, for completed, failed
   and cancelled children alike (`saveSubagentTranscript`). It lives under the parent, so deleting the parent
   task deletes it. Best-effort: a failed write is logged.
2. `subscribeSubagentMessages` reads that transcript (`loadSubagentTranscript`) when the child is no longer
   live. The parent id comes from the registry row; the live path makes the same calls as before (the routing
   characterization snapshot is unchanged).
3. `SubagentTail` renders every kind of content (entries, final message, "no output") inside one box capped at
   `max-h-64` that scrolls. The list of rows is capped at half the view height, so several expanded rows cannot
   push the chat and the composer out of view.

The child id in the transcript path comes from the webview; `getSubagentTranscriptPath` rejects an id that is not
a single plain file name (`..`, separators, leading dot).

## Tests

- `subagentSummariesStore.spec.ts`: round-trip, missing and corrupt transcript give `[]`, ids that leave the
  directory are rejected.
- `RunParallelTasksTool.spec.ts`: a completed and a failed child both get a transcript under the parent.
- `messageHandlers/__tests__/subagents.spec.ts` (new): live child, finished child with a transcript, neither.
- `SubagentsPanel.spec.tsx`: the final message renders inside the capped scrolling box; a transcript pushed by
  the host replaces the final message. Both fail against the previous `SubagentsPanel.tsx`.

## Notes

- Fan-outs from before this change have no transcript; their rows show the final message, now scrollable.
- The leftover `api_conversation_history.json` in a deleted child's directory (the abort writes after the
  delete) is a separate, older defect and is not touched here.
