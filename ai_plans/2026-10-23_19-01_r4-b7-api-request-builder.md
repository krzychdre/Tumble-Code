# R4-B7: request history and metadata built by ApiRequestBuilder

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B7),
`2026-10-23_18-57_r4-b7-builder-live-handler.md` (the prerequisite fix that made the builder read the current handler).

## Touched files

- `src/core/task/ApiRequestBuilder.ts`
- `src/core/task/TaskApiLoop.ts`

## Problem

`TaskApiLoop.attemptApiRequest` (256 lines) mixed context-token estimation, request assembly and streaming. The
history cleanup (effective history, since the last summary, user messages merged, images removed, reasoning cleaned),
the provider metadata and the request-parameter description for error reports and the exchange recorder were all
spelled inline, next to `ApiRequestBuilder`, which already owns the system prompt, the tools array and the clean
history.

## Change

- `ApiRequestBuilder.buildRequestMessages()` returns the conversation the request sends (the five cleanup steps).
- `ApiRequestBuilder.buildRequestMetadata({ mode, signal, suppressPreviousResponseId, allTools, allowedFunctionNames })`
  returns the handler metadata; `describeRequestParams(mode, hasTools)` returns the parameter description. Both read
  `resolveParallelToolCalls` themselves. `TaskApiLoop` still owns the abort controller and resets
  `skipPrevResponseIdOnce`, and still builds the parameter description lazily (only when error reporting or the
  exchange recorder asks for it).
- The builder's access object passes `apiConversationHistory` as a getter, because the task replaces its history
  array (resume, overwrite) and the builder now reads it.
- No behaviour change. `attemptApiRequest` is 217 lines.

## Tests

- Unchanged and green: the request-shape characterization specs (`ApiRequestBuilder.*.spec.ts`,
  `TaskApiLoop.*.spec.ts`, `Task.spec.ts`, `TaskContextManager.*.spec.ts`, `RetryHandler.*.spec.ts`), 273 cases.
- Mutation check: passing the history as a construction-time copy instead of a getter fails five `Task.spec.ts`
  cases (the history the request sends).

## Notes

- `describeRequestParams` has no direct spec: the request-level specs do not turn on error reporting or the exchange
  recorder. A small spec of its two rules (retired provider means no tool protocol; `enableReasoningEffort: false`
  means no effort) would close that gap.
