# Zoo #1243 port: OpenAI Codex single completions use the streaming request

**Status:** ported, one commit.
**Upstream:** Zoo-Code PR #1243, commit `bd399fa77`, merged 2026-08-22, author Rafael Oliveira.
**Touched:** `src/api/providers/openai-codex.ts`, `src/api/providers/__tests__/openai-codex.spec.ts`.

## Symptom

With the OpenAI Codex (ChatGPT subscription) provider, every one-shot completion failed: prompt
enhancement, commit-message generation, condensing and the other `completePrompt` callers got
`HTTP 400 Stream must be set to true` from the Codex endpoint.

## Root cause in our code

`src/api/providers/openai-codex.ts:1187` (before the fix): `completePromptWithUsage` built its own
request with `stream: false` and POSTed it to `https://chatgpt.com/backend-api/codex/responses`.
The chat path (`buildRequestBody`, `stream: true`) was never affected.

Verification: the code path is proven by the new test (the pre-fix code ignored the injected SDK
client, called `fetch` with `stream: false` and failed on the mocked 400). The endpoint's refusal of
`stream: false` is taken from the upstream report; it was not re-probed live (that would need the
user's ChatGPT OAuth token).

A second defect sat on the path the fix now uses: in `executeRequest` the SDK stream and its
consumption loop share one `try`, so an error in the middle of a stream fell through to the SSE
fallback and replayed the whole request, appending a second generation to the text already
yielded. A mid-stream error that looks like an auth failure could likewise trigger the token
refresh retry in `handleResponsesApiMessage` and replay the request. This affects the chat too.

## Fix

- `completePromptWithUsage` now runs `handleResponsesApiMessage` with an empty system prompt and
  one user message, joins the text chunks and keeps the last usage chunk. Reasoning is dropped,
  and so are refusal chunks (streamed as text with the `[Refusal] ` prefix, now the shared
  constant `REFUSAL_TEXT_PREFIX`), because the old non-streaming code read only `output_text`.
  It inherits the OAuth refresh-and-retry and the SDK-then-SSE fallback.
- New flag `sawSdkEventInCurrentResponse`, reset per request and set before the first SDK event is
  processed. After it is set, the SSE fallback rethrows instead of replaying and the auth retry is
  skipped.
- Usage keeps the old shape (input, output, cache reads), now read from the stream's usage chunk.

## Tests

New `describe("OpenAiCodexHandler.completePrompt")` in `openai-codex.spec.ts`, 8 cases. All 8 failed
before the fix: the 6 completion cases rejected with the completion error caused by the mocked 400
for `stream: false`, the mid-stream completion case never reached the SDK stream (it called the
non-streaming `fetch`), and the chat stream finished normally after the SSE replay instead of
rejecting. Now all pass: streaming
request with joined text, reasoning omitted, usage reported, refusals omitted (SDK and SSE), auth
retry before any event still works, no replay over SSE or auth retry after the SDK emitted (for
both completion and chat).

`openai-codex.spec.ts` + `openai-codex-native-tool-calls.spec.ts`: 26 passed;
`runtime-provider-registry.spec.ts` + `completion-usage.spec.ts`: 39 passed. `tsc --noEmit`,
eslint and prettier are clean.

## Not ported

- Caller abort-signal linking and the `AbortError` rejection: our `completePrompt` takes no
  options and `ApiHandlerCreateMessageMetadata` has no `abortSignal`, so there is no caller signal
  to link. The "aborted SDK call must not fall back to SSE" guard depends on it and is left out too.
- Luna Responses Lite body and service tier assertions: those code paths do not exist in our tree.
- Zoo's `eslint-suppressions.json` count change (we have no such file).
