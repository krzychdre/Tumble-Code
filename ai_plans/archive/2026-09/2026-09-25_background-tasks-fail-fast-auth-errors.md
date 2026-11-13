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

- `apiErrors.describeBackgroundApiFailure(error, { provider, model, attempts })`: one
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

## Follow-up (coordinator review of PR #353): backoff always, retry cap

The same defect in its common form: with auto-approval off, a retryable
error (400, 429, 5xx, no status) in a background task reached the
`api_req_failed` ask, the background policy approved it at once, and the
task re-requested in a tight loop with no delay. The empty model response
path (`handleEmptyAssistantResponse`) had the same ask.

- Background tasks never reach `api_req_failed`: `handleApiRequestError`,
  `handleStreamError` and `handleEmptyAssistantResponse` back off
  (`backoffAndAnnounce`, the delay the auto-approve path uses) whenever the
  task is a background task, whatever `autoApprovalEnabled` says. Other asks
  on the request path (`mistake_limit_reached`,
  `auto_approval_max_req_reached`) are not error retries; they stay as they
  were.
- Retry cap: no cap existed (only `MAX_CONTEXT_WINDOW_RETRIES` for the
  context-window branch and `MAX_EXPONENTIAL_BACKOFF_SECONDS` for one delay;
  `maxAgentTurns` does not see the first-chunk recursion). New
  `BACKGROUND_MAX_API_RETRIES = 6` in `TaskApiLoop.ts`: backoffs of 5, 10,
  20, 40, 80 and 160 s at the default 5 s base (315 s), so 7 requests. Past
  it, first chunk: `BackgroundRetriesExhaustedError` (carries the original
  error and the attempt count); mid-stream: `currentItem.retryAttempt` at
  the cap. Both end the task through `endBackgroundTaskOnApiError`
  (`streaming_failed` + `apiFailureMessage`), e.g. `API error 500 from
provider "openai", model "gpt-x" after 7 attempts. Provider message: ...`;
  without a status the line starts `API request failed`.
- The empty-response retry is a new loop turn, so `maxAgentTurns` already
  bounds it; it only gained the backoff.
- The parent hint became `Retrying will not help now (the API key, model or
profile needs fixing, or the provider is down): do this work yourself in
this task, or tell the user.`
- Foreground tasks: unchanged (no cap, ask without auto-approval).

Tests added: 400/429/500/no status with auto-approve on and off on both
paths (backoff, no ask); empty response backs off; 500 on every request: 7
requests, 6 backoffs, then the task ends with "after 7 attempts"; the cap
mid-stream; the no-status line; fake timers with the real `RetryHandler`
(requests 5, 10, 20 s apart); `awaitTaskCompletion` passes the line on.

## Owner decision: 429 excluded from the cap

Branch: `fix/background-429-no-retry-cap` (after PR #353, merge 47e9fa63d).

The owner decided (2026-09-25) that HTTP 429 (too many requests) is not
subject to `BACKGROUND_MAX_API_RETRIES`. A 429 means the provider is up and
asks the caller to slow down; ending a memory writer or a parallel subagent
after 7 attempts throws away work that succeeds a few minutes later.

- Backoff stays bounded per wait (verified in `RetryHandler.calculateBackoffDelay`):
  `min(base * 2^attempt, MAX_EXPONENTIAL_BACKOFF_SECONDS = 600)`, so after the
  7th request a background task retrying 429 waits 600 s between requests. A
  Google `RetryInfo` detail on the 429 replaces that delay (delay + 1 s, not
  capped at 600 s). A plain `Retry-After` header is not read anywhere
  (unchanged, out of scope).
- Rule for mixed sequences: a 429 retry does not count toward the cap, every
  other retryable failure (400, 5xx, no status) does. The task ends at the 7th
  counted failure; a 429 itself never ends it. Examples: 500 and 429
  alternating ends at the 13th request (the 7th 500); ten 429s followed by
  six 500s still recover; six 500s followed by 429s still recover. The failure
  line reports every request made ("after 13 attempts"). The backoff exponent
  still uses the total retry count, so a 500 after a long 429 streak waits the
  capped 600 s, not 5 s.
- Implementation (`TaskApiLoop.ts`): `isCappedRetry(error, retryAttempt,
rateLimitRetries)` replaces the two `retryAttempt >= BACKGROUND_MAX_API_RETRIES`
  checks. First chunk: `attemptApiRequest` options gain `rateLimitRetries`,
  passed through `handleApiRequestError` (incremented on a 429 retry, kept on
  the context-window retry). Mid-stream: `StackItem.rateLimitRetries`,
  incremented on a 429 requeue and kept on the empty-response requeue.
  401/403/404 still fail fast; foreground tasks are unchanged (no cap).
- Abort during an uncapped 429 backoff: `TaskApiLoop` handed `RetryHandler` a
  copy of `access.abort` taken at construction (always false), so the
  countdown's own abort check never fired; the countdown ended only because
  `TaskAskSay.say` throws on an aborted task (logged as "Exponential backoff
  failed"). `abort` is now a live getter, so the countdown stops within a
  second and the loop ends as `user_cancelled` on both paths.
- Known cost: the first-chunk retry recurses (`yield*`) once per attempt, so a
  429 that lasts for hours builds a deeper generator chain (one level per
  request, at most one per 600 s without RetryInfo). Not changed here.

Tests (`TaskApiLoop.no-auto-retry-auth-errors.spec.ts`, "429 is not subject to
the retry cap"): 429 on 20 requests (auto-approve on and off) recovers on the
21st; the mixed sequences above; mid-stream 429 at retry 6 and 40 requeues with
`rateLimitRetries + 1`; mid-stream 500 counts only non-429 retries; abort
during a 429 backoff past the cap on both paths; fake timers with the real
`RetryHandler`: 5..320 s then 600 s, abort stops further requests, RetryInfo
"30s" spaces requests 31 s apart past the old cap.
