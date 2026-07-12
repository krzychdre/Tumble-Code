# AP-8: O3 stream path drops `reasoning_content`

## Finding

`src/api/providers/openai.ts` — `handleStreamResponse` (the O3-family
streaming handler, ~line 534) never calls `extractReasoningFromDelta`, so
`reasoning_content` deltas from reasoning-capable servers routed through
the O3 branch are silently dropped. The user sees no reasoning output.

This matters beyond OpenAI-native O3: many OpenAI-compatible
local/proxy servers (DeepSeek-R1 distills, QwQ behind adapters) emit
`reasoning_content` and can be routed through the O3 branch depending on
model-id matching (`modelId.includes("o1") || "o3" || "o4"`).

## Root cause

The main streaming path (lines 283-285) calls
`extractReasoningFromDelta(delta)` and yields `{ type: "reasoning", text }`
chunks. The O3 path's `handleStreamResponse` was a simpler loop that only
handled `delta.content`, tool calls, and usage — it never invoked the
reasoning extractor.

## Fix

Mirror the main path in `handleStreamResponse`: after the `delta.content`
yield and before `processToolCalls`, call `extractReasoningFromDelta(delta)`
and yield `{ type: "reasoning", text: reasoningText }` when non-empty.

### Helper reused

`extractReasoningFromDelta` from `./utils/extract-reasoning` — already
imported at line 26, already used by the main path. Prefers
`reasoning_content`, falls back to `reasoning`, skips empty strings.

## Tests

Two new tests in `O3 Family Models` describe block:

1. `O3 stream path yields reasoning chunk from delta.reasoning_content` —
   streams `{ reasoning_content: "thinking..." }` through the O3 path,
   asserts `{ type: "reasoning", text: "thinking..." }` is yielded.
2. `O3 stream path falls back to delta.reasoning when reasoning_content is
absent` — streams `{ reasoning: "router-style thought" }`, asserts the
   fallback path works identically to the main path.

Pre-fix: both tests fail (no reasoning chunk yielded). Post-fix: both
pass. Existing 72 tests (main-path reasoning, O3 content/tool/usage) stay
green.
