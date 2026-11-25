# The parent reads what the user wrote to its subtask

Status: done, merged as #1362.

## Problem

On 2026-11-24 at 23:31 the user wrote to the esp32-modulator child `01a20f96` (a `new_task` child of `01a20f55`):
"we stop for today, save the progress and mark where we continue tomorrow". The child saved its progress and
finished with a report that said the integration was written but not compiled. The parent received only
`Subtask <id> completed. Result: <report>` (`formatSubtaskResult`, `delegationHistory.ts`), reasoned "the subtask
ended mid-work, maybe context limit or the agent chose to wrap up" and delegated the rest at 23:36; the user had to
interrupt it. The user's words stay in the child (`say: "user_feedback"` rows) and never reach the parent.
The same holds for `run_parallel_tasks` subagents (7 of 940 subagents in the last 45 days got a user message).

## Fix

- `childReportNotes(child)` (`src/core/task/childReport.ts`): every `user_feedback` row of the child, quoted as
  `<user_message>`, with "these are the user's own words and they apply to you too" and "when the user asked to stop
  or to pause, do not start new work: tell the user where the work stands". "" when the user wrote nothing.
- `new_task` path: `AttemptCompletionTool.delegateToParent` passes `notes` through `reopenParentFromDelegation` to
  `DelegationService.complete`, which appends them to the tool result (`formatSubtaskResult(id, summary, notes)`).
  The parent's `subtask_result` chat row keeps the child's report only.
- Subagent path: `BackgroundTaskRunner.awaitTaskCompletion` adds `notes` to the outcome, `runOneSubtask` keeps them
  on `ParallelSubtaskResult`, `formatParallelResults` prints them after the subagent's report (completed or failed).

## Tests

`childReport.spec.ts`, `delegationHistory.spec.ts`, `attemptCompletionTool.spec.ts`, `BackgroundTaskRunner.spec.ts`,
`RunParallelTasksTool.spec.ts`, `history-resume-delegation.spec.ts`; each wiring step mutation-checked.
