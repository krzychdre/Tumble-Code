# R5: network timeouts

Item R5 of `2026-09-27_simplification-roadmap.md`.

## Problem

- Several requests had no timeout: the Qwen token refresh, the OpenAI Codex usage lookup, the OpenAI-compatible
  model list, the OpenRouter key exchange, image generation, and the OpenAI-compatible embedder's direct request.
  A dropped connection left the caller waiting forever.
- Nothing ended a stream that stopped sending data. The provider SDKs time out only the wait for the response
  headers, so a connection that died mid-answer waited until the user pressed Stop.

## Change

- `CONTROL_REQUEST_TIMEOUT_MS` (30 s) in `api/providers/utils/timeout-config.ts` for short control requests,
  passed as `AbortSignal.timeout(...)` to `fetch` or `timeout` to axios. The Codex OAuth calls already used a
  30 s literal and now use the constant.
- Long operations (image generation, embeddings) use `getApiRequestTimeout()`, the user's `apiRequestTimeout`.
- `raceNextChunkWithAbort` takes an optional idle timeout and rejects with `StreamIdleTimeoutError`.
  `processStream` passes `getApiRequestTimeout()`; on the error it aborts the request controller (closing the HTTP
  request) and rethrows, so `handleStreamError` retries as for any other mid-stream failure.

## Not done, on purpose

Passing `apiRequestTimeout` to the Gemini, Vertex and Mistral SDKs was part of the roadmap item. `@google/genai`
keeps its `httpOptions.timeout` armed while the response body is read (see `apiCall` in its dist), so it would
cap the whole answer at 10 minutes and cut long generations. The idle watchdog covers a stalled stream for these
providers without that risk.

The first chunk (`attemptApiRequest`) is still bounded only by the provider SDK's own timeout. Once R3 is merged
the first chunk uses `raceNextChunkWithAbort` too, and the idle timeout can be passed there in a follow-up.

## Tests

- `TaskApiLoop.stream-idle-timeout.spec.ts`: the race rejects with `StreamIdleTimeoutError` after the idle time,
  clears its timer when a chunk arrives, and waits without limit when no timeout is given; `processStream`
  aborts the request controller and hands the error to `handleStreamError`.
- `openai.spec.ts`: the model list request carries `timeout: 30_000`.
- `rate-limits.spec.ts`: the usage lookup passes `AbortSignal.timeout(30_000)`.
- The new cases fail without the fix. `vitest run api integrations services/code-index core/webview core/task`
  passes (5176 tests).
