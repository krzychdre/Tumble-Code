# Tool errors reach the model without the stack trace (SVC-12 leftover)

## Problem

`handleError` in `src/core/assistant-message/toolCallbacks.ts` (`createToolCallbacks`) is the
single implementation every tool failure goes through: tools call it from their own
`try/catch`, and the safety net in `BaseTool.handle` forwards anything that escapes
`execute` to it. It built the model-facing text as

    `Error ${action}: ${JSON.stringify(serializeError(error))}`

`serializeError` keeps `stack` for the error and for every nested `cause`. Measured with a
real `BaseTool` whose `execute` throws (spec in `toolCallbacks.spec.ts`), the model received
`{"name":"Error","message":"...","stack":"Error: ...\n    at ...` with about ten frames of
absolute local paths, plus the cause's stack when there was one.

Why it matters: the stack costs context on every failure, leaks the user's directory layout
to the provider, and weak models (GLM, Qwen, local Llamas) tend to reason about the frames
instead of the message.

## What stays as it was

- The UI say: already `Error <action>:\n<error.message>`.
- The WS-D teaching envelope: `formatResponse.toolError(errorString, failedToolName)` still
  wraps the text and still attaches `failed_tool` and `minimal_valid_example`.
- Mistake accounting (`recordToolFailureAsMistake`) and the AskIgnoredError / abort guards.
- The other `handleError` (text-completion fallback in `TaskApiLoop`) already used
  `error.message` only.

## Change

- New private `describeToolErrorForModel(error)`: the message, plus the messages of the
  `cause` chain (`fetch failed (cause: connect ECONNREFUSED ...)`, bounded to 5 to survive a
  cycle). A thrown value without a message falls back to its serialized form with every
  `stack` key dropped.
- `handleError` logs the full error (with its stack) through `console.error` before sending
  the message-only text, so the stack is not lost for debugging. Previously the stack reached
  a log only on the `BaseTool` safety-net path.

## Tests

`src/core/assistant-message/__tests__/toolCallbacks.spec.ts`, new describe block: throw inside
a real `BaseTool`, direct `handleError` with a stack, an error with a cause, a thrown object
without a message. No existing spec pinned the serialized JSON format (the runtime-errors
spec only checks `toContain("Error listing files")`), so none needed updating.
