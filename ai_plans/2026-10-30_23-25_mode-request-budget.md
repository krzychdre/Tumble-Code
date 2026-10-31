# Request budget for a mode (`ModeConfig.maxRequests`)

**Status:** done on `feat/mode-request-budget`
**Related:** `project_subagents_no_cap_transcript_stack` (the global 50-turn subagent cap removed on 2026-10-18);
the council modes in the owner's global `custom_modes.yaml`
**Touched:** `packages/types/src/mode.ts`, `packages/types/src/vscode-extension-host/chat-rows.ts`,
`schemas/roomodes.json`, `src/core/task/TaskApiLoop.ts`, `src/core/task/Task.ts`,
`src/core/assistant-message/steps/toolUseGuards.ts`, `src/core/tools/RunParallelTasksTool.ts`,
`src/core/webview/BackgroundTaskRunner.ts`, their specs, new `TaskApiLoop.mode-request-budget.spec.ts`

## Symptom

A two-model council (a chair mode fanning out to an explorer on DeepSeek-V4.1-Flash-1017 and a verifier on
GLM-5.3-Flash-NVFP4-tp2 with `run_parallel_tasks`) had no bound on how long it works. In the second live run the
explorer's gap search made 27 requests in 8.9 minutes (674k input tokens) running a 500 000-case random simulation,
while every other specialist finished in 3 to 11 requests. The "at most one extra round" rule lived only in the prompt.

## What was happening

Since 2026-10-18 a background task has no turn cap: it is stopped only when stuck (mistake limit hint, then a stop at
twice the limit; or a repeated call after a hint). A task that keeps doing new, valid work never meets either rule. The
global `allowedMaxRequests` counts every task in every mode and asks a human at the limit, which a background subagent
cannot answer.

## Fix

An opt-in budget per mode, so the removed global cap does not come back.

- `modeConfigSchema.maxRequests` (integer, at least 1, optional).
- `TaskApiLoop.handleModeRequestBudget`, called in `executeApiRequestCycle` right after the cycle's state snapshot:
  counts fresh requests (retries of a failed request do not count) since the task entered its current mode. The first
  request past the budget carries one reminder ("finish now with attempt_completion, say what is left unchecked"). A
  task still going `MODE_BUDGET_GRACE_REQUESTS` (2) requests later is stopped: a background task through
  `Task.stopBackgroundTask("budget", message)`, a foreground task by an `error` row and `abortTask` with
  `abortReason = "budget"`.
- `Task.stopStuckBackgroundTask(message)` became `stopBackgroundTask(reason: "stuck" | "budget", message)` and
  `stuckMessage` became `stopMessage`; `ClineApiReqCancelReason` gained `"budget"`.
- `describeSubtaskFailure` tells the fan-out parent that a `budget` stop's last message is a partial report to use as
  it is, never a subtask to start again. `formatSubtaskResults` already appends that last message under "Its last
  message before it stopped".

## Tests

`TaskApiLoop.mode-request-budget.spec.ts`: one reminder past the budget and none after; the background stop with
reason `budget`; the foreground error row and abort; retries not counted; counting restarts after a mode switch; a mode
without a budget is never reminded. `RunParallelTasksTool.spec.ts`: the `budget` failure text. Mutations (retry skip
removed, grace off by one, wrong reason, no reset on mode switch, reminder repeated) each turned a test red.

## Notes

- The budget counts requests, not minutes: a slow model server makes the same run take longer but never changes
  where it stops.
- An older build strips the unknown `maxRequests` key when it parses the modes file (the schema is not strict), so a
  modes file that sets it still loads there.
