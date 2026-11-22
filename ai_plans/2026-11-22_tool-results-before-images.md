# Tool results before images in one user message

## Symptom

Anthropic, claude-opus-5-5, task 01a2051e-910f-7741-b6cc-a6b086831bc5 (2026-11-22):

    400 messages.16: `tool_use` ids were found without `tool_result` blocks immediately after:
    toolu_...J4RqKn, toolu_...od8YJh, toolu_...NYoMZE, toolu_...FAqULw

## Root cause (from the stored api_conversation_history.json)

Message 15 holds five parallel `read_file` calls on PNG files. Message 16 was stored as
`tool_result, image, tool_result, image, ..., tool_result, image, text`. Anthropic requires every
`tool_result` to come before any other block of the message, so only the first result counted and
the four after an image were reported missing (exactly the four ids in the error).

`createToolCallbacks().pushToolResult` (src/core/assistant-message/toolCallbacks.ts) pushes the
result through `Task.pushToolResultToUserContent` and then appends the tool's image blocks right
after it. `pushToolResultToUserContent` itself only appended, so the next result landed behind the
previous image. The same applies to any text pushed between results (repetition feedback, the
missing-id error text). `validateAndFixToolResultIds` checks ids, not order.

## Fix

`Task.pushToolResultToUserContent` is the single place every tool_result enters
`userMessageContent`; it now inserts the block before the first non-tool_result block
(`insertToolResult`). Images stay outside the tool_result on purpose: `convertToOpenAiMessages`
drops images nested in a tool_result, so nesting them would blind OpenAI-compatible vision models.
The spill policy finds its block by identity, so the insert position does not affect it.

## Test

`Task.spec.ts > pushToolResultToUserContent` pushes result, image, result, text and expects both
results first. Mutation (plain push restored) turns it red.

## Not done

The stored history of the failing task stays broken (message 16 is persisted in the old order), so
that task cannot be resumed without a one-off edit of its file.
