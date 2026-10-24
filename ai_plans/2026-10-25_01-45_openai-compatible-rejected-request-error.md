# Z.ai and Moonshot: a rejected streaming request skipped the provider error handler

**Status:** fixed on branch `fix/openai-compatible-rejected-request-error`
**Related plans:** `2026-10-25_00-26_test-refactor-round-5.md` (lane L3 found it while pruning provider specs)
**Touched:** `src/api/providers/base-openai-compatible-provider.ts`,
`src/api/providers/__tests__/base-openai-compatible-provider.spec.ts`, `.changeset/openai-compatible-rejected-request-error.md`

## Symptom

A Z.ai or Moonshot task whose request is refused (server unreachable, 401, 429) showed the SDK's bare message, for
example "Connection error.", without the provider name and without the root cause that `handleProviderError` appends
(`connect ECONNREFUSED 127.0.0.1:8080`), and the error was not logged to the Tumble Code output channel.

## What was happening

`BaseOpenAiCompatibleProvider.createStream` returned `chat.completions.create(...)` from inside `try` without
`await`. The SDK's call returns a promise that rejects later, so the `catch` that runs `handleProviderError` never saw
the rejection; `createMessage` awaited the raw rejection. The HTTP status survived (the SDK error carries it), so
retries worked; only the message and the log were lost. `OpenAiHandler` uses `return await` at the same spot.
Z.ai and Moonshot are the two subclasses.

## Fix

`createStream` is `async` and awaits the request inside `try`.

## Tests

`streamed request > reports a rejected request as a provider error with its root cause and status`: the client
rejects with "Connection error." caused by `connect ECONNREFUSED 127.0.0.1:8080` and status 503; the error must read
`TestProvider completion error: Connection error. (connect ECONNREFUSED 127.0.0.1:8080)` and keep status 503. Red
before the fix (bare "Connection error."), green after; zai, moonshot and base specs pass (86 tests).
