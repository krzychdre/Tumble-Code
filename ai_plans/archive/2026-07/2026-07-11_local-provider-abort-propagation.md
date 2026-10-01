# Fix: Propagate Abort to Local/OpenAI-Compatible Providers

**Date:** 2026-07-11
**Branch:** `fix/local-provider-abort-propagation`
**Parent:** `fix/local-provider-stream-crash`

## Problem

When the user cancels a task, `TaskLifecycle.cancelCurrentRequest()` calls
`this.access.currentRequestAbortController.abort()` (which stops the chunk-read
loop via a Promise.race) and then `this.access.api.cancelRequest?.(destroyClient)`.

But the OpenAI-compatible / local-model providers never threaded an AbortSignal
into the actual HTTP call and didn't implement `cancelRequest`, so the underlying
generation on the local inference server (LM Studio / llama.cpp / Ollama / vLLM)
kept running -- burning GPU and blocking the next request.

## Root Cause

- `BaseOpenAiCompatibleProvider` (shared base for DeepSeek, Fireworks, SambaNova,
  ZAi, Baseten) called `this.client.chat.completions.create(params)` without
  passing `{ signal }` as the second argument, and had no `cancelRequest` method.
- `LmStudioHandler` had the same issue -- no AbortSignal, no `cancelRequest`.
- `NativeOllamaHandler` had no `cancelRequest` and didn't abort the Ollama SDK's
  stream iterator.

## Fix

### `base-openai-compatible-provider.ts`

- Added `protected abortController?: AbortController` field.
- Changed `client` to `OpenAI | null` and added `getClient()` lazy initializer
  (mirrors `openai.ts` pattern) so `cancelRequest(true)` can null the client and
  it will be recreated on the next request.
- `createStream()`: creates a fresh `AbortController`, merges `{ signal }` into
  the `requestOptions` passed to `chat.completions.create`, clears on error.
- `createMessage()`: wraps the `for await` loop in `try/finally` to clear
  `abortController` on completion or abort.
- `completePrompt()`: creates a fresh `AbortController`, passes `{ signal }`,
  clears in `finally`.
- `cancelRequest(destroyClient?)`: aborts the controller, optionally nulls client.

### `lm-studio.ts`

- Added `private abortController?: AbortController`, changed `client` to
  `OpenAI | null`, added `getClient()` lazy initializer.
- `createMessage()`: creates fresh `AbortController`, passes `{ signal }` to
  `chat.completions.create`, wraps stream loop in `try/finally` to clear.
- `completePrompt()`: same pattern -- fresh controller, signal, finally clear.
- `cancelRequest(destroyClient?)`: same as base provider.

### `native-ollama.ts`

- Added `private currentStream` to hold a reference to the `AbortableAsyncIterator`
  returned by `client.chat()`.
- `createMessage()`: stores the stream reference, clears it in `finally`.
- `cancelRequest(destroyClient?)`: calls `abort()` on the stored stream iterator
  and `this.client.abort()` (Ollama SDK global abort), optionally nulls client.
  The Ollama SDK's `AbortableAsyncIterator.abort()` method sends an abort signal
  to the server-side generation.

## Signal Composition

The providers create a fresh `AbortController` per request (not reused across
requests, matching `openai.ts`). The `TaskLifecycle.cancelCurrentRequest()`
calls `this.access.api.cancelRequest(destroyClient)` which aborts the provider's
controller, causing the in-flight `for await` to throw promptly.

No caller-provided signal is currently passed via `metadata` to these providers'
`createMessage` -- the `ApiHandlerCreateMessageMetadata` interface doesn't
include an AbortSignal field. The `TaskLifecycle` separately aborts its own
`currentRequestAbortController` which races the chunk-read loop. The provider's
own `cancelRequest` is the mechanism that stops the HTTP request server-side.

## Tests

### New tests (failing first, then green)

**`base-openai-compatible-provider.spec.ts`** (7 new tests):

- `should pass an AbortSignal as the second argument to chat.completions.create`
- `should abort the signal when cancelRequest() is called`
- `should create a fresh AbortController per request`
- `should not destroy the client when cancelRequest(false)`
- `should destroy the client when cancelRequest(true)`
- `should pass signal in completePrompt too`

**`lmstudio.spec.ts`** (7 new tests):

- Same set of abort/cancel tests for LM Studio handler.

### Updated existing tests

Tests that asserted `mockCreate` was called with `(params, undefined)` or
`(params)` as the second argument were updated to expect
`expect.objectContaining({ signal: expect.any(AbortSignal) })`:

- `base-openai-compatible-provider.spec.ts`: 1 test ("should create stream with
  correct parameters")
- `lmstudio.spec.ts`: 1 test ("should complete prompt successfully")
- `lmstudio-native-tools.spec.ts`: 3 tests (tool inclusion assertions)
- `fireworks.spec.ts`: 4 tests (parameter passing assertions)
- `sambanova.spec.ts`: 1 test (parameter passing assertion)
- `zai.spec.ts`: 1 test (parameter passing assertion)

## Verification

All 227 tests across 10 spec files pass:

- `base-openai-compatible-provider.spec.ts` (21 tests)
- `base-openai-compatible-provider-timeout.spec.ts`
- `lmstudio.spec.ts` (16 tests)
- `lmstudio-native-tools.spec.ts`
- `lm-studio-timeout.spec.ts`
- `native-ollama.spec.ts` (15 tests)
- `fireworks.spec.ts`
- `sambanova.spec.ts`
- `zai.spec.ts`
- `openai.spec.ts` (existing cancel tests still green)
