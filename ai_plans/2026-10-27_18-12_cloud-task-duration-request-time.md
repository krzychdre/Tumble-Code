# Cloud task duration is the time of the model requests (2026-10-27)

**Status:** implemented on `fix/cloud-task-duration-request-time` (base `feat/cloud-web-org-metrics`).
**Related plans:** `2026-10-27_10-45_cloud-unique-project-names.md` (the branch below in the stack).
**Touched:** `packages/types/src/{telemetry,message}.ts`, `packages/types/src/vscode-extension-host/chat-rows.ts`,
`src/core/task/{TaskApiLoop,TaskStreamProcessor,StreamProcessorTypes,TaskContextManager}.ts`,
`src/core/condense/summarize.ts`; `self-hosted-cloudapi/src/models/task.py`, `src/services/{task_summary,task_tree,metrics_service}.py`,
`src/web/presenters/{task_rows,task_detail,task_list}.py`, `src/web/templates/{_spend,tasks_list,task_detail,metrics}.html`,
migration `alembic/versions/d4e5f6a7b8c1_task_duration_ms.py`, tests.

## Symptom

The task list showed a parent task at 1h 32m and its subtasks at 15m 24s, 32m 21s and 5m 4s, while the work the
model did was a fraction of that. The owner asked for the duration to be the sum of the actual request-response
times, without the breaks: as it was, adding a message to an old task days later made its duration days long.

## What was happening

- The task list took `tasks.last_ts - tasks.first_ts`: the span from the first to the last stored message
  (`task_summary.duration_ms`). Every wait inside that span counted: the user answering, an approval, a command
  running, a task reopened days later and continued. Only a trailing `resume_task` ask was excluded.
- The metrics page summed, per task, the span from its first to its last `LLM Completion` event, with the same
  flaw. The characterization fixture showed it plainly: its "Session duration" was 17595h 33m.
- The client never measured a request. It reported `ttftMs` (time to the first chunk), and that clock started in
  `TaskStreamProcessor.resetStreamingState`, before context management, the auto-approval limit ask and retry
  waits, which all run inside `TaskApiLoop.attemptApiRequest` before the provider is called.

The end of a request is not in the stored data (a message `ts` is when it was created, never updated), so the old
tasks cannot be measured after the fact.

## Fix

**Client (extension and CLI share `src/core`).** `TaskApiLoop.attemptApiRequest` stores `requestSentAt =
performance.now()` right before `api.createMessage`, so each retry restarts it and nothing before the provider
call counts. `handleBackgroundUsageDrain` passes it to `createBackgroundUsageDrain`, whose `captureUsageData`
runs when the drain has read the stream to its end and computes `durationMs`. It goes to:

- the request row: `updateApiReqMsg(undefined, undefined, durationMs)` writes `durationMs` into the
  `api_req_started` JSON (`ClineApiReqInfo.durationMs`). Passed as an argument, not shared processor state,
  because the drain can outlive `resetStreamingState` of the next request;
- the `LLM Completion` event (`durationMs`).

`ttftMs` now uses the same start. Condensing is a request the task waits for: `summarizeConversation` times
`streamSummary` and reports `durationMs` on its `LLM Completion` event and in `SummarizeResponse`, which
`TaskContextManager` copies into `contextCondense.durationMs` on both the manual and the automatic path.
Memory ranking (runs in parallel with the turn) and prompt enhancement (before the task) are not timed.

**Cloud.** `message_metrics` reads `durationMs` from `api_req_started` and `contextCondense`; the new
`task_messages.duration_ms` column stores it and `refresh_task_summary` sums it into `tasks.duration_ms`, the same
idempotent SUM as tokens and cost. `Spend` carries `duration_ms`, so a task that delegated shows the duration of
its whole run marked Σ with the split in the cell's hover, like tokens and cost (the owner's choice). Group
headers of the task list sum it too (`_run_totals`). The metrics page sums `durationMs` over the completions of
the period and still counts the distinct tasks. The column header and the metrics tile explain the figure on
hover; the tile is now "Duration" instead of "Session duration".

`first_ts`/`last_ts` and the resume-marker rule stay: recall uses `last_ts` as the session's last activity.

## Failure surface

| Scenario                                                            | Before                     | After                                                   |
| ------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------- |
| Task resumed and continued days later                               | days                       | sum of its requests                                     |
| User took 20 minutes to approve a tool                              | counted                    | not counted                                             |
| Request waited for a retry countdown or the auto-approval limit ask | counted (also in `ttftMs`) | not counted                                             |
| Parent waiting for its subtasks                                     | its own span covered them  | own requests; Σ adds the subtasks' requests             |
| Task stored before this change                                      | span                       | blank (owner's choice: nothing measured, nothing shown) |

## Tests

- Client: the drain writes `durationMs` (request sent at 1000, drain ends at 4500 -> 3500) into the request row
  and the event; the clock starts after the approval ask (`TaskApiLoop.request-signal.spec.ts`); condensing
  reports its duration on the event and in the result; the automatic condense row carries it.
- Cloud: the list hover sums an `api_req_started` (4s) and a `condense_context` (1.5s) 65s apart as 5s; the
  presenter tests pin Σ duration and its hover split for a run with nested subtasks; the grouped list sums run
  durations under "Runs" and own ones under "All"; metrics sum `durationMs` (6.5s, not the 5 minutes between the
  events) and ignore a string or a bool; the characterization fixture's duration is regenerated.
- Mutations, each turned a test red and was reverted: the clock set before the approval ask removed; `durationMs`
  dropped from the request row, from `SummarizeResponse` and from the automatic condense row; the
  `api_req_started` and `condense_context` readers; the run rollup in grouped "Runs"; `Spend.__add__`; the metrics
  sum.
- The two span tests that relied on `duration_ms` now assert `first_ts`/`last_ts` only; the test that idle time
  stays in the span was removed, since the span is no longer the duration.

## Deploy

Migration `d4e5f6a7b8c1` (after `c3d4e5f6a7b9`) adds `task_messages.duration_ms` and `tasks.duration_ms`,
default 0, no backfill. Durations appear once the VSIX and the CLI from this branch send them.
