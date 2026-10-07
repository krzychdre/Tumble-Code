# Live status on history rows (`runningTasks`)

**Status:** done on `feat/history-running-indicator`: types, webview and the host push (see "Host
side"). Keeping a task running when the user navigates away is the earlier commit on the same branch
(plan `2026-10-07_12-31_keep-tasks-running-in-background.md`).

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

## Host side

### What is in the map

`TaskSlot.getRunningTasks()` (`src/core/webview/TaskSlot.ts`): the slot occupant plus the detached
tasks, each kept only when the slot's own `isWorking` rule says it works (loop started, not aborted,
last message not an ask that ends the work). The same rule decides keep-alive versus abort, so a task
is listed exactly while leaving it would keep it running. Status `"awaiting_input"` when
`task.taskStatus === TaskStatus.Interactive` (an approval or a question pending for 2 s, the same
moment `TaskInteractive` fires), otherwise `"running"`.

### How it reaches the webview

- Full state: `ProviderStateBuilder` gets the map through the new source `getRunningTasks` (next to
  `getMemoryActivity`) and puts it in `runningTasks`, so every state push and every `messageAdded`
  carries the current map.
- Changes: the provider subscribes once, in its constructor, to its own re-emitted task events
  (`RUNNING_TASK_EVENTS` in `ClineProvider.ts`: TaskStarted, TaskActive, TaskInteractive, TaskIdle,
  TaskResumable, TaskCompleted, TaskAborted, TaskFocused, TaskUnfocused). The forwarding table
  (`taskEventForwarding.ts`) re-emits them for every task with listeners, and a detached task keeps
  its listeners, so one subscription covers the foreground and the background tasks without a row
  change in the table. `postRunningTasksIfChanged` posts `runningTasksUpdated` only when the map
  differs from `runningTasksInView`, the map the view was last sent. The state source records the
  map too (every built state is posted), so an event right after a state push does not repeat it.
  Headless subagents also forward their events; they never change the map, so the comparison drops
  those posts.

### Event order (why the push is deferred to a microtask)

- `TaskSlot.clear` sets `currentTask = undefined`, emits `TaskUnfocused`, and only then moves a
  working task into `detached` (synchronously, before its first `await`). A map read inside the
  `TaskUnfocused` listener would leave the task out, and no later event would put it back. The
  provider's listener therefore reads the map in a `queueMicrotask`, after the synchronous
  transition. The test "a task the user leaves while it works stays listed" fails when the deferral is
  removed.
- `TaskSlot.set` takes a task out of `detached` and installs it before `TaskFocused`; `replaceInPlace`
  installs before `TaskFocused` too.
- A detached task leaves `detached` in the slot's own `TaskIdle` / `TaskResumable` / `TaskAborted`
  listener, registered after the provider's forwarding listener; the predicate already excludes it at
  that point (its last message ends the work, or `abort` is set before `TaskAborted` in
  `TaskLifecycle.prepareAbort`), and the microtask sees it gone from the set anyway.
- A fresh task: `ClineProvider.createTask` installs it with `setCurrentTask` before `task.start()`;
  `TaskLifecycle.startTask` sets `isInitialized = true` and then calls `initiateTaskLoop`, which emits
  `TaskStarted` (`TaskApiLoop.initiateTaskLoop`), so the task is listed at `TaskStarted`. A resumed
  task (`TaskResumption.resumeTaskFromHistory`) and a resumed delegated parent
  (`TaskSubtasks`, which also emits `TaskActive`) reach the same `initiateTaskLoop`.
- A completion: the `completion_result` ask makes the task at rest at once (the next state push
  drops it); `TaskIdle` follows 2 s later (`TaskAskSay.ask` status timer) and posts the map without it
  if no state push did. `TaskCompleted` (the "yes" answer) fires with the completion ask still last.
- Known gap, covered by state pushes: answering a completion ask with feedback within the 2 s emits no
  event, and an answer after the 2 s emits `TaskActive` before the `user_feedback` message is added,
  so the event reads the task as at rest. The `user_feedback` message itself is a state push of the
  foreground task, which carries the corrected map.

### CLI

The CLI receives `ExtensionMessage`s and ignores unknown types (`apps/cli/src/agent/message-processor.ts`,
`default` branch); it keeps the abort-on-switch behaviour, so its map only ever holds its one task.

### Host tests

- `src/core/webview/__tests__/ClineProvider.task-slot.spec.ts`, "getRunningTasks": empty slot; the
  foreground task plus two detached ones, one awaiting input; a foreground task at rest (completion,
  resume, loop not started, aborted) is left out; a detached task drops out once it comes to rest.
- `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts`, "runningTasks" (real provider,
  task stand-in with a real emitter attached through `taskCreationCallback`): the posted state carries
  the map; an event posts only a changed map; a state push counts as sent; leaving a working task keeps
  it listed until it comes to rest (mutation-checked against a synchronous push). The three golden
  snapshots of the posted state gain `runningTasks: {}`.

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
