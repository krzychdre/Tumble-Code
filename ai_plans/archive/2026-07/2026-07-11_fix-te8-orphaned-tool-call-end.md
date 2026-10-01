# TE-8: Orphaned `tool_call_end` silently drops the tool call

## Finding

`TaskStreamProcessor.handleToolCallEvents` — the `tool_call_end` branch had three
paths but missed the case where `finalToolUse === null` AND `toolUseIndex === undefined`.
Neither existing branch ran, silently swallowing the event.

## Root cause

When a duplicate `tool_call_start` arrives for an id that is already tracked, the
dedup guard (line 301) logs a warning and skips. However, the parser's
`rawChunkTracker` still creates a **second** entry for the duplicate index with
the same id. On `finish_reason` / `finalizeRawChunks`, the parser iterates ALL
tracker entries and emits a `tool_call_end` for each — so **two** end events are
emitted for the same id.

- **First end**: `finalizeStreamingToolCall` returns a ToolUse (or null if args
  malformed). `streamingToolCallIndices.get(id)` returns the index. One of the
  two existing branches runs, finalizes the block, and deletes the tracking entry.
- **Second end**: `finalizeStreamingToolCall` returns null (parser entry already
  consumed). `streamingToolCallIndices.get(id)` returns undefined (already deleted).
  Pre-fix: **silent swallow**.

## Reachability of a true orphan (end with no content block)

Through normal parser event flow, a `tool_call_end` is only emitted for a tool
call that was started (`hasStarted=true` in `rawChunkTracker`), and a
`tool_call_start` always creates a content block in `assistantMessageContent`.
Therefore, the `toolUseIndex === undefined` case is ONLY reachable as a
**duplicate** end for an id whose content block was already handled by the first
end. A true orphan (end for an id with no content block at all) is not reachable
through the parser, but the fix includes a safety-net `console.error` for that
case in case of future state inconsistencies.

## Fix shape

Added an `else` branch to the `tool_call_end` handler:

1. **`handleOrphanedToolCallEnd(toolCallId)`** — scans
   `assistantMessageContent` for a block with the matching id:

    - If found and still `partial`: mark it non-partial, set
      `userMessageContentReady = false`, call `presentAssistantMessage` (same
      behavior as the existing null-finalize-with-index branch).
    - If found and already non-partial: the first end already handled it —
      nothing to do.
    - If not found at all: log `console.error` with taskId and toolCallId.
    - Defensively delete `streamingToolCallIndices` entry (already clean, but
      guards against future inconsistencies).

2. **`markToolUseNonPartial(toolCallId, toolUseIndex)`** — extracted helper
   used by the existing null-finalize-with-index branch to avoid duplication.

## Tests

`src/core/task/__tests__/TaskStreamProcessor.orphaned-end.spec.ts` — 3 tests:

1. Duplicate start deduped, finish_reason emits two ends — second end must not
   be silently swallowed; block must be finalized.
2. Orphaned end with malformed args — block must be marked non-partial, not
   left partial forever.
3. Orphaned end with no content block at all — must log explicit error, not
   silently swallow. (Pre-fix failure confirmed: `console.error` never called.)
