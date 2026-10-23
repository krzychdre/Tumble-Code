# R4-B8b: one non-streamed response reader in the OpenAI handler

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B8b).

## Touched files

- `src/api/providers/openai.ts`

## Problem

`createMessage` and `handleO3FamilyMessage` each turned a non-streamed Chat Completions response into stream chunks
with the same 20 lines (tool calls, text, usage); jscpd reported them as a clone.

## Change

One private generator `yieldNonStreamingResponse(response, modelInfo)` yields the function tool calls, the text (an
empty string when the message has none) and the usage chunk. Both non-streaming branches call
`sendChatCompletion` and then `yield*` it. No behaviour change.

## Tests

- `openai.spec.ts`, `openai.compact.spec.ts`, `openai-compatible-request-bodies.characterization.spec.ts`,
  `openai-usage-tracking.spec.ts`, `openai-cache-usage*.spec.ts`, `openai-timeout.spec.ts`,
  `openai-native-tools.spec.ts` green, unchanged.
- Mutation checks: dropping the usage chunk fails the two non-streaming cases of `openai.spec.ts` (plain and Azure AI
  Inference); dropping the tool calls fails the non-streaming tool-call cases for the default and the O3 path.
