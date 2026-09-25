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

## Follow-up on the same branch (coordinator review of PR #343)

Every 401/403/404 now reaches the `api_req_failed` ask, which made two old
gaps reachable.

### A declined ask ends the loop

Declining the first-chunk ask threw `Error("API request failed")` without a
status. `processStream` handed it to `handleStreamError`, which treated it as
a normal mid-stream failure: back off (auto-approve on) or retry at once
(auto-approve off), then send the request again and ask again. Now the ask
throws `ApiRetryDeclinedError`, and `handleStreamError` ends the loop
(`return_true`) for it: no further request, no further ask. The row is still
closed by `abortStream`. The abort check runs first, so the webview decline
(Start New Task sends `clearTask`, which aborts the task) keeps the
`user_cancelled` path exactly as before. The mid-stream ask added above
already ended the loop on decline.

### CLI

- Non-interactive always means auto-approval on: `run.ts` sets
  `nonInteractive: !requireApproval`, and `ExtensionHost` maps it through
  `getPermissionMode(nonInteractive)` to the "allow" settings
  (`autoApprovalEnabled: true`, bypass tier), which bypass never uses for
  `api_req_failed`. So there the ask now only means 401/403/404. The runtime
  `/permissions` switch exists only in the TUI.
- Print mode (`AskDispatcher`, the only non-TUI, non-JSON ask handler):
  non-interactive used to print "[retrying api request]" and send nothing,
  so the task waited forever. It now prints why it does not retry and
  declines (`noButtonClicked`), which ends the core loop.
- Print and JSON mode (`AskDispatcher` is disabled in JSON mode, so the
  exit cannot live there): new host option `exitOnApiRequestFailed`, set by
  `run.ts` for non-interactive non-TUI runs. `waitForTaskCompletion` rejects
  on a `waitingForInput` event for `api_req_failed`, so `run.ts` takes its
  normal failure path: the error is printed (or emitted as a JSON error
  event), the host is disposed, `--signal-only-exit` is respected, exit code
  1. `--exit-on-error` gets the same listener (before, it only reacted to
  `api_req_retry_delayed`, which these errors no longer produce). In
  stdin-stream mode the same rejection becomes a `task_error` control event;
  before, that mode could not answer this ask at all
  (`api_req_failed` is not in `MESSAGE_AS_ASK_RESPONSE_ASKS`).
- TUI: in "allow" mode the ask was printed as prose and never answered.
  It now gets the Yes/No approval dialog (as in "ask" mode), which shows
  "API request failed", the provider's error and "Retry the request?".

## Tests

- `src/core/task/__tests__/TaskApiLoop.no-auto-retry-auth-errors.spec.ts`:
  table over 400, 401, 403, 404, 429, 500 and no status, on both paths, plus
  the other SDK status names, the manual Retry, the background-task
  exception, a declined ask ending the loop (auto-approve on and off) and
  the webview abort path.
- CLI: `ask-dispatcher.test.ts`, `extension-host.test.ts`,
  `useMessageHandlers.test.tsx`, `ApprovalDialog.test.tsx`.

## Out of scope

- Background tasks with a bad key still retry with backoff forever. Failing
  them fast would need its own decision (what the memory writer and the
  subagent panel should show).
