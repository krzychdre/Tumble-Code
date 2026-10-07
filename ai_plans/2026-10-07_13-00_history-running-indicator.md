# Live status on history rows (`runningTasks`)

**Status:** webview + types half done on `wip/history-running-indicator-ui`. The host half (keeping a
task running when the user navigates away, and pushing the map) lives on a separate branch and is
coded against the contract below.

## Problem

A task in the chat panel is about to keep running when the user leaves it (for its subtask, its parent
or the home screen). The history rows on the home screen and in the full History view show nothing
about that: a task that is still calling the model, or one that is blocked on an approval or a
question, looks exactly like a finished one. The user has no way to see which tasks need attention
without opening each of them.

## Contract (`packages/types`)

- `RunningTaskStatus = "running" | "awaiting_input"` in
  `packages/types/src/vscode-extension-host/state.ts` (next to `RemoteControlStatus`), exported from the
  package index through the `vscode-extension-host` barrel.
- `ExtensionState.runningTasks?: Record<string, RunningTaskStatus>` next to `memoryActivity`, keyed by
  task id: the tasks of this panel that are working right now, the open one included. A task at rest is
  absent.
- Host to view message `"runningTasksUpdated"` (task lifecycle domain, next to `"memoryActivity"` in
  `vscode-extension-host/taskLifecycle.ts`) with the field `ExtensionMessage.runningTasks`: the full
  map, replace semantics. The two surface specs that pin the message names and the message fields list
  the new names. All changes are additive.

## Webview

- `context/extensionStateReducer.ts`: initial state `runningTasks: {}`; case `runningTasksUpdated`
  replaces the map (a message without one clears it). Full `state` pushes already copy every key via
  `mergeExtensionState`, so a pushed `runningTasks` replaces the previous map with no extra code.
- `components/history/types.ts`: `DisplayHistoryItem.runningStatus?: RunningTaskStatus`.
- `components/history/useTaskSearch.ts`: selects `runningTasks` and sets `runningStatus` on the rows
  of working tasks in a memo of its own after the search and sort, so a status change does not search
  or sort again and rows at rest keep their object identity (their memoized rows do not re-render).
  `useGroupedTasks` passes the items through by reference (groups) or by spread (search mode), so
  `TaskItem` (compact and full), `SubtaskRow` and the search rows all receive the field.
- `components/history/RunningStatusIndicator.tsx` (new): the chat's `ProgressIndicator` spinner for
  `running`, the subagents panel's `MessageCircleQuestion` icon (same yellow) for `awaiting_input`,
  nothing for a task at rest. It is a `role="img"` with a translated `aria-label` and a
  `StandardTooltip`. Because the row is a `<button aria-label={task}>` (its children do not reach the
  accessible name), the row also points `aria-describedby` at the indicator so a screen reader reads
  the status with the row.
- `TaskItem.tsx`: indicator in the title row, before the hover arrow. `SubtaskRow.tsx`: indicator
  before the title.
- i18n: `history:runningIndicator.running` ("Working") and `history:runningIndicator.awaitingInput`
  ("Waiting for your input") in all 18 webview locales.

## Tests

- Reducer and provider: rows in the shared table `context/__tests__/extensionMessageCases.ts` (sets the
  map, replaces it so a task at rest drops out, a message without a map clears it, a `state` push
  replaces it), plus the message type in the "covers every message type" list.
- `useTaskSearch.spec.tsx`: statuses land on the right rows, resting rows keep identity, search
  results keep the status.
- `useGroupedTasks.spec.ts`: the status survives grouping and search mode.
- `TaskItem.spec.tsx` (both variants) and `SubtaskRow.spec.tsx` (including a nested child): spinner,
  attention icon, nothing at rest, `aria-describedby` wiring.
- Types: the two compile-time surface specs list the new message name and field.
