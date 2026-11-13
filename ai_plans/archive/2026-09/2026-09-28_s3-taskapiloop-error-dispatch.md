# S3 — TaskApiLoop error dispatch moved next to RetryHandler

Roadmap item (ai_plans/2026-09-27_simplification-roadmap.md): `TaskApiLoop` (1,644 lines):
move error dispatch (`handleApiRequestError`, fail-fast, capped retry) next to `RetryHandler`.

Pure refactor — observable behavior identical. Base: main @ 4c733e0eb.

## 1. Dispatch-region map (before, file:line)

`src/core/task/TaskApiLoop.ts` (1,647 lines total):

| Region                                                   | Lines     | Content                                                                                                                                                                                            |
| -------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiRetryDeclinedError` (module-private class)           | 61–71     | Thrown when the user declines the first-chunk `api_req_failed` ask; `handleStreamError` recognises it and ends the loop                                                                            |
| `BACKGROUND_MAX_API_RETRIES` + `isRateLimitError`        | 73–93     | Background retry cap (6) and 429 detection (reads status via `getApiErrorStatus`)                                                                                                                  |
| `BackgroundRetriesExhaustedError` (module-private class) | 95–110    | Thrown when a background task used up the cap; carries the original error + attempt count                                                                                                          |
| `handleStreamError` — terminal-error branch              | 1177–1202 | The 4 end-of-task checks: declined-retry (`ApiRetryDeclinedError`), fail-fast (401/403/404 on background), retries-exhausted, capped mid-stream retry — each calling `endBackgroundTaskOnApiError` |
| `handleStreamError` — backoff/ask/requeue branch         | 1204–1253 | Loop mechanics: non-auto-retryable ask, `backoffAndAnnounce`, abort handling, stack requeue with `rateLimitRetries` accounting (STAYS in TaskApiLoop)                                              |
| `handleApiRequestError`                                  | 1529–1594 | First-chunk dispatch: context-window truncation retry, fail-fast rethrow, capped-retry throw, backoff+auto-retry recursion, `api_req_failed` ask + declined throw                                  |
| `mustFailFast`                                           | 1596–1604 | `isBackground && !isAutoRetryableApiError(error)`                                                                                                                                                  |
| `isCappedRetry`                                          | 1606–1618 | `retryAttempt - rateLimitRetries >= BACKGROUND_MAX_API_RETRIES`, 429 never counts                                                                                                                  |
| `endBackgroundTaskOnApiError`                            | 1620–1646 | Records `apiFailureMessage` (via `describeBackgroundApiFailure`), sets `abortReason = "streaming_failed"`, `abortTask()`                                                                           |

`src/core/task/RetryHandler.ts` already owns (untouched): backoff calculation
(`calculateBackoffDelay`), countdown UX (`showCountdownUX`), `backoffAndAnnounce`,
`maybeWaitForProviderRateLimit`, the global rate-limit timestamp.

## 2. Boundary against S2's territory

S2 (#558) left `TaskStreamProcessor` with "chunk dispatch, reasoning throttle,
usage-drain/abort factories". Nothing in the S3 region lives in
TaskStreamProcessor and nothing in TaskStreamProcessor is touched. The other
boundary: `handleStreamError` itself stays in TaskApiLoop — it owns the loop's
presentation (abortStream, ask, stack requeue), which is loop mechanics, not
error→retry decision. Only the decision helpers + their task-ending side
effects move; TaskApiLoop calls a single new RetryHandler method for the
terminal-error checks and keeps its own presentation/requeue code.

## 3. Seam design

RetryHandler grows into the owner of error→retry decisions. It needs more from
the task than the current `RetryHandlerAccess` (taskId, instanceId, abort,
apiConfiguration, providerRef, askSay). New members, following the existing
Access-interface pattern (plain members wired by TaskApiLoop's constructor,
same as D3/S1/S2 seams; no reverse dependency, RetryHandler never imports
Task/TaskApiLoop):

```ts
export interface RetryHandlerAccess {
	// existing members unchanged (abort already a getter for live reads)
	isBackground: boolean // fail-fast + capped-retry decisions
	abortReason?: ClineApiReqCancelReason // written by endBackgroundTaskOnApiError
	apiFailureMessage?: string // written by endBackgroundTaskOnApiError
	api: ApiHandler // model id for the failure line
	abortTask(): Promise<void> // end the task
	contextManager: { handleContextWindowExceededError(): Promise<void> } // narrowed structural type, avoids importing TaskContextManager
}
```

No circular import risk: `context-error-handling` imports only `openai`;
`MAX_CONTEXT_WINDOW_RETRIES` is re-exported by `TaskContextManager` but imported
from there already by TaskApiLoop — RetryHandler imports it from
`TaskContextManager` too (TaskContextManager does not import RetryHandler, verified).
`TaskContextManager`'s access type imports `ClineProvider` only by type; runtime import chain TaskContextManager → McpServerManager/McpHub does not reach RetryHandler/TaskApiLoop.

New RetryHandler public surface:

- `handleApiRequestError(error, retryAttempt, autoApprovalEnabled, iterator, rateLimitRetries)` — moved verbatim from TaskApiLoop; recursion via a `retryRequest` callback passed at call time by TaskApiLoop (the generator recursion re-enters `TaskApiLoop.attemptApiRequest`, which RetryHandler must not know about).
- `endTaskOnTerminalStreamError(error, retryAttempt, rateLimitRetries)` — the 4 terminal checks from `handleStreamError`, returning `"ended" | undefined`; TaskApiLoop maps `"ended"` → `return "return_true"` with its existing logging. Absorbs `endBackgroundTaskOnApiError`.
- `isRateLimitError` (exported), `BACKGROUND_MAX_API_RETRIES` (exported), `ApiRetryDeclinedError`/`BackgroundRetriesExhaustedError` stay module-private with `instanceof` checks inside RetryHandler.

TaskApiLoop shrink: the three private decision helpers, `handleApiRequestError`,
and the error classes move out; the first-chunk catch calls
`this.retryHandler.handleApiRequestError(error, ..., (attempt, opts) => this.attemptApiRequest(attempt, opts))`.

## 4. Spec-impact inventory (mock seams only; assertions unchanged)

| Spec                                                                 | Change                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskApiLoop.no-auto-retry-auth-errors.spec.ts`                      | None expected — mocks `access` + `(loop as any).retryHandler.backoffAndAnnounce`; the retryHandler seam keeps working. Verify, don't edit.                                |
| `TaskApiLoop.stream-idle-timeout.spec.ts` L126                       | `vi.spyOn(loop as any, "handleApiRequestError")` → spy moves to `(loop as any).retryHandler.handleApiRequestError` (loop keeps a thin private call site). Same assertion. |
| `TaskApiLoop.request-signal.spec.ts` L133                            | Same seam move as above.                                                                                                                                                  |
| `RetryHandler.rate-limit-abort.spec.ts`                              | None — constructs `RetryHandlerAccess` literal; new members required for typecheck → add to the literal (behavior-neutral).                                               |
| `grace-retry-errors.spec.ts` (full Task)                             | None expected; runs to prove end-to-end dispatch unchanged.                                                                                                               |
| D1 backoff specs (`packages/core` backoff tests, delay-module spies) | None — `backoffAndAnnounce` untouched.                                                                                                                                    |

## 5. Docs

- `docs/03-task-agent-loop.md`: module table — error dispatch moves from TaskApiLoop's row to RetryHandler's; §"What a failed request becomes" now names `RetryHandler.handleApiRequestError`.
- `docs/architecture.md`: no structural claim changes (RetryHandler not enumerated there); check line 114 context.
- `src/api/apiErrors.ts` header comment: update the "task retry loop" paragraph to name RetryHandler as the dispatch owner.

## 6. Verification

- `cd src && npx vitest run core/task` (all TaskApiLoop + RetryHandler + grace specs) + backoff/countdown specs in packages/core.
- Typecheck + eslint on touched files.
- `pnpm knip` — baseline exit 1 pre-existing; no new findings.
- Changeset `.changeset/s3-error-dispatch.md` (patch, mimic d3-remove-forwarders.md).
