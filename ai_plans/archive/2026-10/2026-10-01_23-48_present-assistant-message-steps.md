# presentAssistantMessage split into steps; `cline` renamed `task` (C11)

Status: implemented on branch `refactor/present-assistant-message-steps` (PR open, not merged).
Item C11 of `ai_plans/2026-10-01_simplification-round-2.md`. Branched from fresh origin/main: C1
(`refactor/edit-tools-use-apply-computed-edit`) touches only `src/core/tools/`, so the files do not overlap.

## Touched files

- `src/core/assistant-message/presentAssistantMessage.ts`: `presentAssistantMessage` keeps the lock, the block
  clone, the switch and the advance-to-next-block tail; each case is one function (`presentMcpToolUse`,
  `presentText`, `presentToolUse`). `presentToolUse` is the step sequence.
- `src/core/assistant-message/steps/toolUseGuards.ts` (new): `rejectMissingToolCallId`, `skipToolAfterRejection`,
  `rejectMalformedToolCall`, `rejectInvalidToolUse`, `stopRepeatedToolCall`.
- `src/core/assistant-message/steps/toolUseRun.ts` (new): `recordToolUse`, `checkpointSaveAndMark` (moved),
  `runCustomTool`, `answerDeferredDirectCall`, `rejectUnknownTool`.
- `src/core/assistant-message/toolCallbacks.ts`, `src/core/environment/getEnvironmentDetails.ts`: parameter
  `cline` renamed `task` (pure rename; one comment says "the model" where it said "cline" for the agent).
- Test: `src/core/assistant-message/__tests__/presentAssistantMessage-steps.spec.ts` (new, committed before the
  split and green on the old code).

## Problem

`presentAssistantMessage` (`presentAssistantMessage.ts:92-720` on main) was one 630-line function. Its
`tool_use` case (`:259-664`) ran about ten steps in sequence, each ending the block with a `break` from deep
inside nested `if`s, so the order of the steps and which one answers a block were hard to see.

## Fix

One function per step. Each guard returns `true` when it has answered the block (pushed its tool_result or
error); `presentToolUse` returns on `true`, which is what the `break` did. The order and the
partial/complete gating are unchanged:

1. missing `tool_use.id` (both partial and complete),
2. settings (cached while streaming), task mode, spill policy (complete only),
3. rejected earlier tool (both),
4. malformed arguments, including the deferred-tool guidance (complete only),
5. callbacks, then usage and telemetry (complete only),
6. validation (complete only),
7. repetition (complete only),
8. checkpoint (checkpointed tools, both),
9. built-in handler (both),
10. partial block stops here; then custom tool, deferred direct call, unknown tool.

The body of every step is the old code moved as is (statements, texts, comments). Differences that are not
behaviour: `break` became `return`; the repetition condition is written as its negation for the early return
(`allowExecution || !askUser`); two comments that contained an em dash got a colon instead; the deferred
"now available" text keeps its em dash through a `\u2014` escape, so the string the model reads is
byte-identical. Signature callers use: `presentAssistantMessage(task: Task)` (only the parameter name changed).

## Tests

- New `presentAssistantMessage-steps.spec.ts` (13 tests) pins the paths the other specs did not reach: text
  block (`<thinking>` strip, skip after a tool), rejected MCP call (both texts), deferred guidance and "ready"
  answers, validation failure (usage recorded first, error only for valid names), legacy `read_file` telemetry,
  repetition stop (feedback, telemetry, result, no checkpoint), the step order before a handler, a streaming
  unknown tool. Green before and after the split.
- Green: `src/core/assistant-message` (all `presentAssistantMessage-*`, `toolCallbacks`, parser specs),
  `src/core/environment`, `checkpointed-tools`, `TaskStreamProcessor.{eager-checkpoint,finish-reason,orphaned-end,reasoning-throttle}`,
  `baseTool`, `tool-policy-lists` (25 files, 399 tests).
- `tsc --noEmit -p src`, eslint on touched files, `pnpm knip`.

## Notes

- No changeset: no behaviour change.
- `streamingBlockState` and `getStateForToolBlock` stay in `presentAssistantMessage.ts` (module-level per-task
  cache; moving it would not change semantics but buys nothing).
- The detached file-level doc comment above `prepareToolResultSpill` (describing `presentAssistantMessage`) is
  left where it was.
