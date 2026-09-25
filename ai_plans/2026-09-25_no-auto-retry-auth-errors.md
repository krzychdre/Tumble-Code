# No automatic retry for 401, 403 and 404 (owner decision 14, 2026-09-25)

Branch: `fix/no-auto-retry-auth-errors`

## Problem

With auto-approve on, the task loop retried every failed API request with
exponential backoff. A 401 (invalid or missing key), 403 (forbidden) or 404
(unknown model or endpoint) never fixes itself, so the task looped forever,
showing a countdown after each attempt.

## Where the retry decisions live (verified on origin/main 99d28803c)

- First-chunk failure: `TaskApiLoop.attemptApiRequest` awaits the first chunk
  and hands any error to `TaskApiLoop.handleApiRequestError`. After the
  context-window branch, `autoApprovalEnabled` meant `backoffAndAnnounce` plus
  a recursive `attemptApiRequest(retryAttempt + 1)`; otherwise the
  `api_req_failed` ask (Retry or Start New Task in the webview, y/n in the CLI).
- Mid-stream failure: `TaskApiLoop.handleStreamError` (errors after the first
  chunk). With auto-approve on it backs off, and in both modes it pushes the
  request back on the stack.
- `BackgroundModelHandler` (background model with foreground fallback, via
  `isFallbackTriggerError`) catches its own errors before they reach the task
  loop; 401/403/400 still fall back to the foreground handler. Unchanged.
- The CLI (apps/cli) has no retry loop of its own: it runs the core task loop
  and only answers the `api_req_failed` ask (`ask-dispatcher.ts`).

## Change

- `src/api/apiErrors.ts`: new `isAutoRetryableApiError(error)`, false only
  for 401, 403 and 404, read through the existing `getApiErrorStatus`
  (`status`, `statusCode`, `status_code`, `$metadata.httpStatusCode`). 400
  stays retryable on purpose (Z.ai and some proxies return it for transient
  trouble), as do errors without a status.
- `handleApiRequestError`: auto-retry only when `mayAutoRetry(error)`;
  otherwise the existing `api_req_failed` ask. The context-window branch runs
  first and is unchanged.
- `handleStreamError`: for 401/403/404 no backoff; the same `api_req_failed`
  ask; Retry requeues the request, declining ends the loop.
- `mayAutoRetry` applies the rule only to foreground tasks. Background tasks
  (memory writers, parallel subagents) keep the backoff retry, because a
  parallel subagent's approval policy answers `api_req_failed` with an instant
  "approve": asking there would turn the backoff loop into a tight one.

## Tests

`src/core/task/__tests__/TaskApiLoop.no-auto-retry-auth-errors.spec.ts`:
table over 400, 401, 403, 404, 429, 500 and no status, on both paths, plus the
other SDK status names, the manual Retry, and the background-task exception.

## Open (not in this branch)

- Background tasks with a bad key still retry with backoff forever. Failing
  them fast would need its own decision (what the memory writer and the
  subagent panel should show).
- In the first-chunk path, declining the ask throws "API request failed",
  which `handleStreamError` then treats as a generic mid-stream failure and
  retries (pre-existing, same as with auto-approve off). In the webview the
  decline button starts a new task, which aborts the old one, so it is not
  visible there; in the CLI answering "n" leads to another request and ask.
