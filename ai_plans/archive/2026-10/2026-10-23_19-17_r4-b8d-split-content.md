# R4-B8d: one content split for the message converters

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B8d).

## Touched files

- `src/api/transform/split-content.ts` (new)
- `src/api/transform/mistral-format.ts`, `src/api/transform/openai-format.ts`, `src/api/transform/vscode-lm-format.ts`
- `src/api/providers/native-ollama.ts`

## Problem

The Mistral, OpenAI, VS Code LM and native Ollama converters each split a user message into tool results and
text/image blocks, and an assistant message into tool uses and text/image blocks, with the same `reduce` (eight
copies; jscpd reported six clones across the four files).

## Change

`splitUserContent(content)` and `splitAssistantContent(content)` in `src/api/transform/split-content.ts` return
`{ nonToolMessages, toolMessages }` in block order and drop other block types, exactly like the `reduce` they replace.
The converters themselves (in the "do not touch" list of `docs/architecture.md`) keep their own per-protocol logic;
only the split moved. No behaviour change.

## Tests

- `mistral-format.spec.ts`, `openai-format.spec.ts`, `vscode-lm-format.spec.ts`, `native-ollama.spec.ts`,
  `ollama-wire-characterization.spec.ts`, `mistral.spec.ts`, `mistral-wire-characterization.spec.ts`,
  `vscode-lm.spec.ts`, `openai-compatible-request-bodies.characterization.spec.ts` green, unchanged (182 cases).
- Mutation checks: dropping images from the user split fails 8 cases across all four converters and both wire
  characterizations; dropping tool uses from the assistant split fails 9 cases. Reversing the order of tool uses
  survives, because no converter spec sends two tool uses in one assistant message.
- jscpd over production TypeScript no longer reports a converter clone.
