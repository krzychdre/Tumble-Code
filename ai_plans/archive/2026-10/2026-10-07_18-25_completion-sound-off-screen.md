# Completion sound for a task that finishes off screen

**Status:** done on `feat/completion-sound-off-screen` (stacked on `feat/history-running-on-ancestors`).
**Related plans:** `2026-10-07_12-31_keep-tasks-running-in-background.md`, `2026-10-07_18-20_running-indicator-on-ancestors.md`.
**Touched:** `src/core/webview/TaskSlot.ts`, `src/core/webview/ClineProvider.ts`,
`packages/types/src/vscode-extension-host/taskLifecycle.ts`,
`webview-ui/src/components/chat/hooks/useChatHostMessages.ts`, specs.

## Symptom

Owner request: "jeśli całe zadanie się zakończy, nadal chcę słyszeć dźwięk zakończenia zadania". Since
tasks keep running when the user leaves them, a task that finishes while the user looks at another task
(its subtask, a different task, the home screen) ends silently.

## What was happening

The celebration sound is played by ChatView (`useAskButtons`) when the `completion_result` ask of the
task on screen arrives. A detached task posts nothing to the view (`postMessageForTask` drops messages
of a task that is not the current one), and `TaskSlot.detach` destroys it on `TaskIdle`, the event the
completion ask raises after two seconds. So the ask never reaches the view and nothing else announces it.
The notification sound for a pending approval did not have this problem: `interactionRequired` is posted
with `postMessageToWebview`, regardless of which task is on screen.

## Fix

- `TaskSlot.detach` registers one listener per end event, so it knows which one fired. On `TaskIdle`
  with a last message `ask: "completion_result"` it calls the new host seam
  `TaskSlotHost.onDetachedTaskCompleted(task)` before destroying the task.
- `ClineProvider` answers with the host message `taskCompletedOffScreen` (task lifecycle domain).
- `useChatHostMessages` lists the type in `CHAT_VIEW_MESSAGE_TYPES` (the bus delivers only listed
  types) and plays `celebration`; `useChatSounds` keeps applying the sound setting and volume.

A child that delegates back to its parent never asks `completion_result`, so the sound marks the end of
the whole tree: the root (or an orphaned child that falls back to the normal completion ask).

## Failure surface (before/after)

| Situation                                                | Before           | After                              |
| -------------------------------------------------------- | ---------------- | ---------------------------------- |
| Root task on screen finishes                             | sound (ChatView) | unchanged                          |
| Root task off screen finishes                            | silent           | sound                              |
| Detached task rests on `api_req_failed` / resume / abort | silent           | silent                             |
| Delegated child finishes, parent resumes                 | silent           | silent (parent's own end plays it) |

## Tests

- `ClineProvider.task-slot.spec.ts` describe "a detached task that finishes is announced": announced on
  completion idle; silent on another idle ask, on resumable, on abort; silent for the foreground task.
- `ChatView.ask-state-machine.spec.tsx`: `taskCompletedOffScreen` plays `/celebration.wav`. Its first run
  failed because the type was missing from `CHAT_VIEW_MESSAGE_TYPES`.

## Caveats

If the user opens the task within the two seconds between the ask and `TaskIdle`, it is re-attached and
not announced; the reopened view suppresses the sound for a loaded completion (`taskJustSwitched`).
