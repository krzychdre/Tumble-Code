# Background tasks fail fast on 401, 403 and 404

Branch: `fix/background-tasks-fail-fast-auth-errors`

Follow-up to PR #343 (`ai_plans/2026-09-25_no-auto-retry-auth-errors.md`),
which left background tasks out of scope.

## Problem (verified on origin/main 847787e92)

A background task with a bad key (401), forbidden access (403) or an unknown
model or endpoint (404) retried forever:

- First chunk: `TaskApiLoop.handleApiRequestError` kept `mayAutoRetry` true
  for every background task, so with auto-approval on it backed off and
  recursed into `attemptApiRequest`. That recursion never passes through
  `recursivelyMakeClineRequests`, so `maxAgentTurns` never stops it. With
  auto-approval off it asked `api_req_failed`, and both background approval
  policies (`buildSubagentApprovalPolicy`, `memoryWriteSandbox`) answer that
  ask with an instant approve: a retry with no backoff at all.
- Mid-stream: `handleStreamError` backed off and requeued (bounded only by
  `maxAgentTurns`).

## Who runs background tasks, and who waits

Every background task is created by `BackgroundTaskRunner.createBackgroundTask`
(`isBackground: true`); there are exactly two callers:

- Memory writers (extraction and dream): `memorySubTaskRunner` ->
  `runMemorySubTask` -> `awaitTaskCompletion`. The writer run is awaited by
  `TaskLifecycle` (writer trigger and its drain with timeout). The runner
  retries once on the foreground profile when a `memoryWriterApiConfigId`
  profile ended as `streaming_failed`.
- Parallel subagents: `RunParallelTasksTool.runOneSubtask` ->
  `awaitTaskCompletion`; the parent's tool result is `formatParallelResults`.

`new_task` children are foreground delegation (not background), covered by
#343. `BackgroundModelHandler` / `isFallbackTriggerError` is only the condense
handler, not in the task request path: unchanged.

## Change

- `apiErrors.describeNonRetryableApiError(error, { provider, model })`: one
  line, e.g. `API error 401 (invalid or missing API key) from provider
"openai", model "gpt-x". Provider message: ...` (message capped at 300
  characters).
- `TaskApiLoop.mustFailFast(error)`: background task and not
  `isAutoRetryableApiError`. `handleApiRequestError` rethrows such an error
  before any backoff or ask; `handleStreamError` (reached for both the
  rethrown first-chunk error and a mid-stream error) calls
  `endBackgroundTaskOnApiError`: sets `Task.apiFailureMessage`, logs once to
  the console, `abortReason = "streaming_failed"`, `abortTask()`, and ends the
  loop. `mayAutoRetry` is gone (foreground behavior of #343 unchanged).
- `awaitTaskCompletion` returns `failureMessage` from `task.apiFailureMessage`
  on abort. The abort emits `TaskAborted`, so the awaiter settles at once.
- Memory writers: `runMemorySubTask` logs the failure once per run to the
  output channel. `streaming_failed` keeps the existing single foreground
  fallback for a writer profile (so a bad writer key still gets its memory
  written on the foreground model); the foreground run fails fast too, so at
  most two requests. No toast.
- Parallel subagents: the parent's report says `Failed: <failure line>
Retrying will not help until the API key, model or profile is fixed: do
this work yourself in this task, or tell the user.` (instead of "subtask
  aborted before completion"); the panel row gets the same text.

400, 429, 5xx and errors without a status keep the backoff retry in
background tasks.

## Tests

- `TaskApiLoop.no-auto-retry-auth-errors.spec.ts`, "background task": 401,
  403, 404 on the first chunk (auto-approve on and off) and mid-stream: one
  request, no backoff, no ask, `return_true`, `streaming_failed`, one
  `abortTask`, failure message; 400/429/500/no status still back off.
- `BackgroundTaskRunner.spec.ts`: outcome carries `failureMessage`; the
  memory runner falls back once (writer profile) or not at all, logs each
  failure once, no toast.
- `RunParallelTasksTool.spec.ts`: the parent report shows the child's API
  error and the hint.

The TaskApiLoop tests drive the loop through its access object (as the #343
spec does), not a full `Task`; the `Task` wiring is the plain
`apiFailureMessage` field that `TaskApiLoop` receives as its access.
