# Subagent transcript view (Claude Code style)

**Status:** implemented on `feat/subagent-transcript-view` (3 of 3 stacked branches, on
`fix/subagents-panel-all-runs`)
**Related plans:** `2026-10-18_20-45_subagent-no-turn-limit.md`, `2026-10-18_21-20_subagents-panel-all-runs.md`
**Touched:** `packages/types/src/subagent.ts`, `src/core/webview/subagentActivity.ts` (new),
`src/core/webview/BackgroundTaskRunner.ts`, `webview-ui/src/App.tsx`,
`webview-ui/src/components/chat/SubagentTranscriptView.tsx` (new), `SubagentTranscriptContext.ts` (new),
`subagentStatus.tsx` (new), `rows/ReadOnlyRowsContext.ts` (new), `SubagentsPanel.tsx`, `CommandExecution.tsx`,
`rows/renderers/say/UserFeedbackRow.tsx`, `components/history/TaskItem.tsx`, `components/history/SubtaskRow.tsx`,
18 `chat.json` locales, tests next to each.

## Symptom

"Nie mogę uzyskać pełnej historii subagenta." The owner wants subagents "jak w claude code - mogę wszystkie
wyświetlić, a nawet zobaczyć pełen transkrypt".

## What was happening

The only view of a subagent was the panel row's expandable tail (`SubagentTail`): a `max-h-64` box where a tool
call was one label line ("• appliedDiff src/game/glass.js"), command output was dropped, reasoning was clamped to
3 lines, and the subtask message was not shown. Opening a finished subagent read-only existed only from the history
list (it replaced the open task), and a live one there opened its parent.

## Change

- **Transcript view** (`SubagentTranscriptView`, App tab `"subagent"`): the subtask message, then every row as the
  chat renders it (same pipeline: `consolidateCommands` / `consolidateApiRequests` / `filterVisible` /
  `groupToolAsks` / `computeRowMeta`, rows through `ChatRow`, Virtuoso list following the output). It subscribes
  with the existing `subscribeSubagentMessages` (snapshot from the live task or the task directory, then
  `messageUpdated` while it runs), so it works for running and finished subagents alike. Header: description,
  status, mode, profile, tokens, cost, the stop reason of a failed one; Stop for a running one. Footer (running
  only): Approve / Deny, question suggestions, answer or guidance box, moved from the tail.
- It never changes the open task: the parent keeps running, Back returns to the chat (or the history when opened
  there).
- **Read-only rows** (`ReadOnlyRowsContext`): in a transcript, `UserFeedbackRow` has no edit or delete and
  `CommandExecution` no abort. Both act on the open task (`deleteMessage` by ts, `terminalOperation: abort`), so in
  a subagent's transcript they would reach the parent.
- **Panel rows** open the transcript on click (a queued placeholder has no task yet and is disabled); the inline
  tail is gone. A running row shows its current activity (new `SubagentSummary.activity`, set by
  `BackgroundTaskRunner` from the subagent's `Message` events through `subagentActivity`: `$ command`,
  `tool path`, `MCP server/tool`); a failed or cancelled row shows why it stopped (`finalMessage`).
- **History**: a subagent's `TaskItem` / `SubtaskRow` opens its transcript instead of `showTaskWithId`.

## Tests

- `SubagentTranscriptView.spec.tsx` (new): subscribe/unsubscribe, subtask message + rows read-only, live
  updates scoped by `sourceTaskId`, stop and guidance, answering a question, failed header without controls,
  header from the history item.
- `SubagentsPanel.spec.tsx`: the tail tests replaced by row click, disabled placeholder, activity and stop-reason
  detail lines.
- `CommandExecution.spec.tsx`: no abort in a read-only transcript; `ChatRow.edit-images.spec.tsx`: no edit or
  delete.
- `SubtaskRow.spec.tsx`, `TaskItem.spec.tsx`: a subagent opens its transcript.
- `subagentActivity.spec.ts` (new), `BackgroundTaskRunner.spec.ts`: activity from messages.

## Notes

- The host still opens a subagent read-only through `showTaskWithId` (CLI, cloud links); the webview no longer
  uses that path for subagents.
- File links in a transcript open paths relative to the workspace, not to the subagent's worktree.
