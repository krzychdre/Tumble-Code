# TE-5: processRawChunk drops first chunk when id is absent

## Root cause

`NativeToolCallParser.processRawChunk` initialized tracking for an index ONLY
when a chunk carried a non-empty `id` (`if (id && !tracked) {…}`). A chunk
arriving before any id fell through to `if (!tracked) return events` — the
chunk, including its `arguments` delta, was silently dropped.

Weak local models (GLM/Qwen/Llama) frequently emit the first chunk with
`name` + `arguments` but no `id`, or an empty `id` throughout. Result: the
tool call never assembles, the turn ends with no tool use,
`consecutiveNoToolUseCount` climbs, the loop degrades.

## Fix

Initialize tracking when ANY of `id`/`name`/`arguments` is present in the
chunk. If `id` is absent at init time, use a synthetic id:
`synthetic-tool-call-{index}` (deterministic, collision-free per stream since
the tracker is per-parser-instance and keyed by index).

### Id adoption rule

If a real `id` arrives in a LATER chunk for the same index:

- Adopt the real id ONLY IF `hasStarted` is false (tool_call_start not yet
  emitted).
- Once started with the synthetic id, KEEP the synthetic id for the rest of
  that call's lifecycle.

Rationale: downstream state (`streamingToolCallIndices` in
`TaskStreamProcessor`, the `ToolUse.id` on `assistantMessageContent`) is keyed
by the id from `tool_call_start`. Switching ids mid-flight would orphan that
state.

### Downstream id flow (verified)

The id from `tool_call_start` propagates through:

1. `TaskStreamProcessor.handleToolCallEvents` — stores `event.id` in
   `streamingToolCallIndices` (id -> contentIndex), sets `ToolUse.id`.
2. `assembleAndSaveAssistantMessage` — sanitizes `toolUse.id` via
   `sanitizeToolUseId()`, builds `tool_use` block for `apiConversationHistory`.
3. `presentAssistantMessage` — reads `toolCallId` from `block.id`, builds
   `tool_result` block with `tool_use_id: sanitizeToolUseId(toolCallId)`.
4. `validateAndFixToolResultIds` — ensures `tool_use_id` matches `tool_use.id`.
5. `ApiRequestBuilder.prepareConversationHistory` — sends both blocks to the
   LLM provider.

The id DOES reach the API request payload. For OpenAI-compatible providers,
the id is typically not validated server-side (it's a client correlation
token). For Anthropic, `sanitizeToolUseId` ensures the synthetic id
(`synthetic-tool-call-0` — all alphanumeric+hyphens) passes the
`^[a-zA-Z0-9_-]+$` validation pattern. A synthetic id is safe in the payload.

## Tests

- `core/assistant-message/__tests__/NativeToolCallParser.spec.ts` — 4 new
  tests in the "TE-5" describe block:
    1. First chunk with name+args, no id; second chunk brings id — synthetic id
       kept (start already emitted with name).
    2. First chunk with only args (no id, no name); second chunk brings id+name
       — real id adopted (start not yet emitted).
    3. Id never arrives — tool call assembles under synthetic id, finish emits
       end.
    4. Regression: existing id-first behavior unchanged.

## Pre-fix failure confirmation

Tests 1 and 3 FAILED before the fix (events array empty — chunks dropped).
All 51 tests green after fix.
