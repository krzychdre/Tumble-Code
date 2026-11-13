# Completed chat tasks never reached "Task Completed" telemetry

Branch: `fix/completion-telemetry-accepted-abandon` (off main).
Follow-up to `ai_plans/2026-09-25_memory-writers-after-completion.md` (PR #339),
whose "Not covered" section recorded this defect.

## Symptom

`TelemetryService.captureTaskCompleted` (event "Task Completed") is never sent for a
top-level task that finishes normally in the VS Code chat or in the CLI.

## Evidence from real data (read-only)

Self-hosted cloud API database (`self-hosted-cloudapi-postgres-1`, table
`telemetry_events`, 2026-09-11 to 2026-09-25):

- 63 "Task Created" events, 0 "Task Completed" events (the event type does not
  occur at all).
- Last "Task Message" per task: 37 top-level tasks end at an open
  `completion_result` ask (finished, never answered), 5 at `resume_completed_task`.

Note: the self-hosted metrics page (`self-hosted-cloudapi/src/services/metrics_service.py`)
does not read "Task Completed" today (it aggregates "LLM Completion", and session
quality derives completion from the messages), so no number on that page changes.
The defect is in the raw event stream that any consumer of "Task Completed" sees.

## Root cause (verified in code)

- `captureTaskCompleted` has exactly one caller: `AttemptCompletionTool.emitTaskCompleted`,
  reached on a `yesButtonClicked` answer to the `completion_result` ask or on
  delegation back to a parent.
- The VS Code chat never answers "yes": `ChatView` answers `completion_result` with
  `startNewTask()` = `clearTask`.
- The CLI never answers "yes" either: `AskDispatcher.handleIdleAsk` leaves
  `completion_result` open, and `/new` and `/clear`
  (`apps/cli/src/ui/hooks/useTaskSubmit.ts`, `resetConversation`) send the same
  `clearTask` webview message. Both land in `ClineProvider.clearTask` ->
  `removeClineFromStack` -> `abortTask(true)`, an abandoned abort.
- PR #339 already recognises that abort as the accepted end of the task
  (`Task.awaitingCompletionAcceptance`, consumed in `TaskLifecycle.prepareAbort`) but
  only runs the memory writers there, on purpose without emitting `TaskCompleted`.

## Fix

- `TaskLifecycle.prepareAbort`: when the abort is abandoned, the task was waiting at
  its completion ask, it is not a user cancel (Stop) and not a background task,
  call `TelemetryService.instance.captureTaskCompleted`. The public
  `TaskCompleted` event is still NOT emitted (API consumers,
  `taskEventForwarding` and `BackgroundTaskRunner.awaitTaskCompletion` keep seeing
  only `TaskAborted`, as before).
- Exactly once: a "yes" answer clears `awaitingCompletionAcceptance` (in the
  `finally` around the ask) before its own capture, and `prepareAbort` consumes the
  flag, so "yes then clear" and a second abort of the same instance count nothing
  extra.
- Payload: the "yes" path sends `{ taskId }` plus the provider's ambient properties,
  which describe the current task. On this path the provider has already popped the
  task, so the ambient `modelId`, `parentTaskId`, `isSubtask` and `diffStrategy`
  would describe no task (or the parent under a subtask). `captureTaskCompleted`
  gained an optional `properties` argument and the lifecycle passes those four
  task-scoped values from the task itself. The ambient `todos` summary is not
  overridden (not on the lifecycle's access surface).

## Tests

`src/core/task/__tests__/Task.completion-memory-writers.spec.ts`, new describe block
(real `Task`, `AttemptCompletionTool`, `ClineProvider.clearTask`/`removeClineFromStack`):
clear after completion counts once with the task's own properties and emits no
`TaskCompleted` (one `TaskAborted`); history switch counts once; a subtask left at
its own completion ask is attributed to itself; "yes" then clear counts once;
feedback, Stop, background task and a task reopened from history count nothing.

## Out of scope

- Closing VS Code or exiting the CLI while a task sits at its completion ask runs no
  abort at all, so it is not counted (owner decision 15).
- Typing a new message in the CLI after a completion sends it as feedback on the
  same task (the loop continues); that is not a completion and is not counted.
