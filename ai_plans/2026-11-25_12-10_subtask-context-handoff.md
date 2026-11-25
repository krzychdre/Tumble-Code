# A delegated task hands its work over at its context limit

Status: in progress.

## Problem

A subagent cannot start its own subagents, and a `new_task` child that could never did: the esp32-modulator child
`01a211af` made 307 requests (87 diffs, 57 reads, 3 failed condensations) without one `new_task` call. A large
assignment grows a long TODO list and the child works for hundreds of requests next to the window ceiling.
Measured over the last 45 days of task history: 1127 children (940 subagents); median 9 requests, but 119 children
(11%) passed 128k tokens of context and sent 2990 requests above it (17% of all child requests). Their context grows
about 1k tokens per request up to about 220k and then saws there: microcompaction strips old tool results, the model
loses what it read and reads it again.

Letting subagents nest was rejected: weak models do not delegate even when they can (above), waiting parents holding
the shared subagent slots could starve their children, and worktrees would nest.

## Fix

The parent keeps the plan; a child continues on a fresh context instead of a condensed one.

- `TaskApiLoop.handleSubtaskContextLimit`, run after the mode request budget in each request cycle, for tasks whose
  `taskOrigin` is not `user`. The size is the last request's `contextTokens` plus `microcompactStrippedTokens` (what
  the condense gate reads), against the model's `contextWindow`.
    - At `SUBTASK_CONTEXT_REMINDER` (65%) one reminder joins the user content: finish the step, then
      `attempt_completion` with a handoff report (done, state, every open item written for a new subtask).
      `Task.contextHandoff` records it.
    - At `SUBTASK_CONTEXT_STOP` (85%) `Task.handOverAtContextLimit`: a subagent stops with `abortReason` "context"
      (`run_parallel_tasks` reports it COMPLETED with its last message); a `new_task` child returns its last chat text
      to its parent through `reopenParentFromDelegation`, or is aborted with the reason shown when the parent no
      longer waits.
- `childReportNotes` adds, for a child with `contextHandoff`, that the context filled up and this is planned, the
  TODO items left open, and "start a new subtask for the work that is left and give it this report".
- A task the user started keeps the whole window, as before.

## Tests

`TaskApiLoop.subtask-context-limit.spec.ts` (thresholds, once-only reminder, stripped tokens, user tasks untouched),
`TaskApiLoop.cycle-state-snapshot.spec.ts` (the cycle hands over before the request goes out),
`Task.handOverAtContextLimit.spec.ts`, `childReport.spec.ts`, `RunParallelTasksTool.spec.ts`; mutation-checked.
