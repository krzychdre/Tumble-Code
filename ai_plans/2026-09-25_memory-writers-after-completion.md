# Memory writers never ran after a completed VS Code task

Branch: `fix/memory-writers-after-completion` (off main 6f7030210).

## Symptom

The memory background writers (extraction and dream, started by
`TaskLifecycle.triggerMemoryBackgroundWriters`) never ran after a normally
completed top-level task in the VS Code chat.

## Evidence from real data (read-only)

Owner's VS Code storage: `~/.config/Code/User/globalStorage/qub-it.tumble-code`.
Memory settings in `state.vscdb` (`QUB-IT.tumble-code` key): `autoMemoryEnabled: true`,
`autoDreamEnabled: true`, `autoMemoryShareWithClaudeCode: true`, `memoryWriterApiConfigId` set.

1. Every memory writer run is a background task created by
   `BackgroundTaskRunner.createBackgroundTask`, which logs
   `[createBackgroundTask] started background task <id>` to the Tumble-Code output channel.
   The only full session log available,
   `~/.config/Code/logs/20260924T222026/window1/exthost/output_logging_20260924T222030/1-Tumble-Code.log`
   (2026-09-24 22:20 to 2026-09-25 08:49), shows 7 tasks instantiated, of which 5 are
   top-level and every one of them ends at an open `completion_result` ask:

    | task                                 | first message  | last message   | last message          |
    | ------------------------------------ | -------------- | -------------- | --------------------- |
    | 01a0d514-0944-7639-a53a-619af75d4239 | 09-24 22:20:55 | 09-24 22:23:55 | ask completion_result |
    | 01a0d517-4142-751e-a420-f93d1b6ff232 | 09-24 22:24:26 | 09-24 22:28:40 | ask completion_result |
    | 01a0d51c-b03b-718e-a639-1bf9207dc673 | 09-24 22:30:22 | 09-24 22:42:43 | ask completion_result |
    | 01a0d73a-d1cf-7433-ad24-418499886c56 | 09-25 08:22:31 | 09-25 08:25:20 | ask completion_result |
    | 01a0d74a-b9d3-7038-8af1-0784a5b7fbd0 | 09-25 08:39:54 | 09-25 08:42:14 | ask completion_result |

    The log contains 0 `createBackgroundTask` lines and 0 `[memory]` lines. The
    extraction's only other gate that could skip the spawn, the "main agent already
    wrote a memory" check (`hasMemoryWritesSince`), reads `message.toolUses`, a field
    `ClineMessage` never carries, so it is always false: a triggered extraction would
    always have spawned (and logged) a background task.

2. Across the whole VS Code task store, 693 tasks have run since the memory system
   landed on main (2026-07-14); 251 of them are top-level tasks whose last message is
   an unanswered `completion_result` ask. No memory writer task directory exists on
   disk (completed writer runs delete theirs, aborted ones would keep theirs).

## Root cause (verified in code)

- `Task` hooks the writers on `RooCodeEventName.TaskCompleted`, with a comment that
  assumed "a normal attempt_completion only emits TaskCompleted".
- Since upstream e6ad7949d (#11817, 2026-03-01, in this fork long before the memory
  hook of 2026-07-13), `AttemptCompletionTool` emits `TaskCompleted` only when the
  `completion_result` ask is answered with `yesButtonClicked` (or on delegation).
- The webview never sends that answer. `ChatView` answers `completion_result` (and
  `resume_completed_task`) with `startNewTask()` = `clearTask`; typing sends
  `messageResponse` (feedback, the loop continues).
- `clearTask`, `createTask`, `createTaskWithHistoryItem` and delegation all leave a
  task through `removeClineFromStack` -> `abortTask(true)`, an abandoned abort, and
  `TaskLifecycle.prepareAbort` skips the writers for abandoned aborts.
- The brief assumed the CLI sends "yes". It does not: `AskDispatcher.handleIdleAsk`
  returns without a response for `completion_result`, and the TUI sends
  `messageResponse` when the user types after a completion. 56 CLI tasks in
  `~/.vscode-mock/global-storage/tasks` also end at an open `completion_result` ask.

## Fix

- `Task.awaitingCompletionAcceptance`: set by `AttemptCompletionTool` right before the
  `completion_result` ask, cleared in a `finally` once it is answered.
- `TaskLifecycle.prepareAbort` reads and consumes the flag. An abandoned abort of a
  task that is still waiting at its completion ask is the accepted end of the task,
  so it runs the writers; the user-cancel and background guards are unchanged.
  Consuming the flag keeps a second abort of the same instance from firing again.
- Chosen over emitting `TaskCompleted` on clear: `TaskCompleted` also feeds
  telemetry (`captureTaskCompleted`), the provider's public event forwarding and
  `BackgroundTaskRunner.awaitTaskCompletion`, and the abort already emits
  `TaskAborted`; emitting both for one task would change what API consumers see.
- `TaskLifecycle.drainAbort` no longer drains on an abandoned abort while the
  provider is alive (new `ClineProvider.isDisposed` getter). The callers await the
  abort before the chat moves on, so draining a writer in flight (often the one this
  abort just started) would freeze "Start New Task" or a history switch for up to
  60 s. Abandoned aborts during provider dispose still drain.

Cases covered by tests (`src/core/task/__tests__/Task.completion-memory-writers.spec.ts`,
real `Task` + `AttemptCompletionTool` + `ClineProvider.clearTask`/`removeClineFromStack`):
clear after completion runs the writers once; history switch runs them once; the clear
does not wait on the drain; "yes" then clear runs them exactly once; feedback, Stop,
background task and a task reopened from history run none.

## Not covered (out of scope, recorded)

- Closing VS Code (sidebar) or exiting the CLI while a task sits at its completion
  ask: no abort runs at all (as far as the code shows, the sidebar provider is only
  disposed in tab mode, the
  CLI's `deactivate` does not dispose the provider), so the writers do not run.
- Reopening a completed task from history and clearing it runs no writers, on
  purpose: the extraction cursor is in memory only, so it would re-extract the whole
  old conversation on every history browse.
- `hasMemoryWritesSince` reads `toolUses`, which `ClineMessage` never has, so the
  "main agent already saved a memory" mutual exclusion never triggers.
- Top-level VS Code chat completions never reach `TelemetryService.captureTaskCompleted`
  for the same reason (no "yes" answer); only delegated subtasks and API clients do.
