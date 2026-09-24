# Zoo #1625 port: every turn reads the task's own mode, not the provider's

**Status:** ported, one commit on the zoo port branch
**Upstream:** Zoo-Code #1625 (commit 8c9662966), by edelauna
**Touched:** `src/core/environment/getEnvironmentDetails.ts`, `src/core/assistant-message/presentAssistantMessage.ts`, `src/core/task/ApiRequestBuilder.ts`, `src/core/task/TaskApiLoop.ts`, `src/core/task/TaskContextManager.ts`, `src/core/task/Task.ts`, their specs

## Symptom

The provider state holds ONE mode: the mode of the focused task (what the mode selector shows).
A task can run in another mode: a parallel subagent (`createBackgroundTask({ taskMode })`), a memory
writer (always `taskMode: "code"`), or any background task while the user switches the focused
task's mode. Such a task was told the wrong `# Current Mode` in its environment details, got the
system prompt and the tool list of the focused task's mode, was validated against that mode, and
condensed with that mode's tools. Example: a memory writer started while the user sits in
Architect mode got Architect's edit restrictions instead of Code's.

## Root cause in our code

Every per-turn reader took `mode` from `provider.getState()`, never from `Task.getTaskMode()`:

- `getEnvironmentDetails.ts:262-271` (the `# Current Mode` block).
- `presentAssistantMessage.ts:444`, used at `:800` (`validateToolUse`) and `:1157` (custom tool
  `execute` context).
- `ApiRequestBuilder.ts:130-161` (`SYSTEM_PROMPT` mode). Not in Zoo's patch.
- `TaskApiLoop.ts:1110-1116` (`attemptApiRequest`: tool list and request metadata `mode`) and
  `TaskApiLoop.ts:552` (skill resolution for slash commands in the user message). Not in Zoo.
- `TaskContextManager.ts:278/403/595` (condensing metadata and tools). Not in Zoo.

`Task.getTaskMode()` already existed and is kept correct across mode switches:
`ClineProvider.handleModeSwitch` updates the focused task's `_taskMode` together with the provider
state, and a delegated child gets its mode set before it is created.

## Fix

All readers above use `await task.getTaskMode()`. `TaskApiLoopAccess`, `ApiRequestBuilderAccess`
and `TaskContextManagerAccess` gained `getTaskMode()`; `buildCondensingMetadata` resolves the mode
itself instead of taking it as a parameter.

One path relied on the old behaviour: `Task.submitUserMessage(text, images, mode)` (used by the
remote-control bridge) only wrote the provider mode with `setMode`, which the task no longer reads.
For the focused task it now calls `provider.handleModeSwitch(mode)`, the same switch the mode
selector performs, so the task, its history item and the provider state move together.

## Tests

Each test failed before the fix with the provider mode (`"code"`) where the task mode
(`"architect"`) was expected, and passes now:

- `getEnvironmentDetails.spec.ts`: "reports the task's own mode" (+ the mode-switch test now drives
  the task mode).
- `presentAssistantMessage-custom-tool.spec.ts`: `validateToolUse` and custom-tool context use the
  task mode.
- `ApiRequestBuilder.task-mode.spec.ts`: `SYSTEM_PROMPT` gets the task mode.
- `Task.spec.ts`: `attemptApiRequest` builds tools and metadata for an explicit `taskMode`;
  `submitUserMessage` with a mode calls `handleModeSwitch` (failed with 0 calls).
- `TaskApiLoop.task-mode.spec.ts`: slash-command skill resolution gets the task mode.
- `TaskContextManager.task-mode.spec.ts`: condensing tools and metadata use the task mode.

Mock tasks in 9 existing specs gained `getTaskMode`. `core/task`, `core/environment`,
`core/assistant-message`, `core/condense`, `core/context-management`, `core/webview`, `core/tools`,
`core/auto-approval`, `core/mentions`: 156 files, 2173 tests pass. tsc and eslint clean.

## Not ported

- Zoo's `scripts/check-delegated-mode-readers.ts` checker and its `package.json` script.
- Left as is, on purpose: `generateSystemPrompt.ts` (the settings preview of the prompt follows the
  selected mode, not a task).
- Left as follow-ups (same bug class, different fix shape):
  - Auto-approval plan gate (`auto-approval/index.ts:284`) reads `state.mode`. For a background
    subagent the decision is made by `buildSubagentApprovalPolicy`, whose `getState` is the
    provider's (`RunParallelTasksTool.ts:331`); fixing it means passing the child's mode there, and
    `TaskAskSay` alone would not change the outcome.
  - `switch_mode`, a slash command's `mode:` and `run_slash_command` switch through
    `provider.handleModeSwitch`, which always switches the FOCUSED task. Run from a background
    task, they switch the user's task instead of the caller.
  - `webviewMessageHandler.ts:1933/2029` (saving or deleting a custom mode) write the provider mode
    without `handleModeSwitch`, so the selector can now show a mode the focused task does not run.
