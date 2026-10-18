# Parallel subagents: no turn limit, stopped only when stuck

**Status:** implemented on `fix/subagent-no-turn-limit` (1 of 3 stacked branches; next:
`fix/subagents-panel-all-runs`, `feat/subagent-transcript-view`)
**Touched:** `src/core/task/Task.ts`, `src/core/task/TaskApiLoop.ts`, `src/core/task/RetryHandler.ts` (comment),
`src/core/task/subagentApproval.ts` (comment), `src/core/tools/ToolRepetitionDetector.ts`,
`src/core/assistant-message/steps/toolUseGuards.ts`, `src/core/webview/BackgroundTaskRunner.ts`,
`src/core/tools/RunParallelTasksTool.ts`, `packages/types/src/vscode-extension-host/chat-rows.ts`,
`docs/03-task-agent-loop.md`, tests next to each.

## Symptom

Task "uruchom grę" (Game repo, 2026-10-18, DeepSeek-v4.1-Flash, architect parent) ran three fan-outs.
Four of ten subagents ended `FAILED` with only "subtask aborted before completion". The owner could not
tell why. The parent model guessed wrong and wrote a memory note that subtasks "abort mid-run when one
prompt packs many deliverables".

## What was happening

Every failed subagent made exactly **50** API requests (`api_req_started` count in its `ui_messages.json`);
the ones that completed used 20, 25 and 43. None had an API error or a pending ask: they were mid-work
(tuning a shader, debugging a solver, waiting for screenshots).

- `RunParallelTasksTool` passed `maxAgentTurns: SUBAGENT_MAX_TURNS` (50) to every subagent.
- `TaskApiLoop` aborted the task at the cap with `abortReason = "max_turns_reached"`, with no warning
  to the model.
- `runOneSubtask` ignored `abortReason`; with no `failureMessage` `describeSubtaskFailure` returned the
  bare "subtask aborted before completion".

The cap stood in for "the subagent is stuck", but it cut subagents that were making progress. The owner
called it an artificial limit. It also covered two real holes, which had to be closed before removing it:

1. **Mistake limit.** At `consecutiveMistakeLimit` a task asks `mistake_limit_reached`; a subagent's approval
   policy answers every non-actionable ask with "approve", so the loop went on, and a profile limit of 0
   means no limit at all. The repetition detector, which uses the same limit, only blocked every 4th
   identical call.
2. **Empty answers.** `handleEmptyAssistantResponse` retried an empty answer of a background task with
   backoff and no cap ("each retry is a new loop turn, so maxAgentTurns bounds it").

## Fix

- `maxAgentTurns` / `agentTurnCount` / `SUBAGENT_MAX_TURNS` / `"max_turns_reached"` are gone. A subagent
  runs until it completes, is cancelled, fails on the API, or is stopped as stuck.
- `Task.stopStuckBackgroundTask(message)`: sets `stuckMessage`, `abortReason = "stuck"`, aborts.
- `TaskApiLoop.handleBackgroundMistakeLimit` (background only, foreground keeps the user ask): at the limit
  one hint (`tooManyMistakes` guidance: change approach, or attempt_completion with what is done and left;
  more mistakes stop the task); at twice the limit with the hint sent and no success in between (a
  successful tool call resets the count), stop as stuck. A limit of 0 falls back to the default 3.
- Repetition: `ToolRepetitionDetector.check` returns `repeatedTrip` when the same call trips again with no
  other call in between. A background task never asks: the first trip is an error result that warns of
  the stop, the repeated trip stops the task. A background task with limit 0 uses the default for the
  detector too.
- Empty answers: a background task calls `RetryHandler.endTaskOnTerminalStreamError` before backing off,
  so it ends after `BACKGROUND_MAX_API_RETRIES` like a failed request (`apiFailureMessage` "after 7 attempts").
- `awaitTaskCompletion` reports `failureMessage = stuckMessage ?? apiFailureMessage` and, for an aborted task,
  `lastMessage` = its last finished `text` say.
- `describeSubtaskFailure(outcome)`: stuck -> "Stopped as stuck: ... partial work is in its worktree: check
  it, then finish the rest yourself or start a subtask with narrower, clearer instructions"; API failure as
  before; no reason -> "Stopped before finishing (its task was torn down, ...)". `formatParallelResults`
  adds "Its last message before it stopped:" to a failed subtask.

## Failure surface (before/after)

| Scenario                   | Before                                                  | After                              |
| -------------------------- | ------------------------------------------------------- | ---------------------------------- |
| Subagent needs 51+ turns   | killed at 50, "aborted before completion"               | runs to completion                 |
| 3 tool errors in a row     | auto-approved ask, loop continues forever under the cap | hint; stopped as stuck at 6        |
| Profile mistake limit 0    | no stop except the cap                                  | default 3 applies to subagents     |
| Same call repeated forever | every 4th blocked, the cap ended it                     | hint, then stopped as stuck        |
| Empty answers forever      | backoff until the cap                                   | ends after 7 attempts              |
| Parent report on failure   | bare text                                               | reason + what to do + last message |

## Tests

- `TaskApiLoop.background-mistake-limit.spec.ts` (new): below limit, hint once, stop at 2x, success resets,
  limit 0.
- `TaskApiLoop.empty-response-retry-hint.spec.ts`: background retry 5 continues, retry 6 ends.
- `ToolRepetitionDetector.spec.ts`: `repeatedTrip` false/true, a different call starts over.
- `presentAssistantMessage-steps.spec.ts`: background repetition without ask; repeated trip stops.
- `BackgroundTaskRunner.spec.ts`: stuck abort reports `failureMessage` and the last finished text.
- `RunParallelTasksTool.spec.ts`: `describeSubtaskFailure` for stuck / API / no reason; last message in report.

## Notes

- Foreground tasks are unchanged (they still ask the user at the mistake limit).
- The cost of a long subagent is now bounded by the user (Stop on the panel row, or cancelling the parent),
  not by a turn count.
