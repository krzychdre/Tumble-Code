# Zoo #789 port: Vertex Claude single completions find the text block

**Status:** ported, one commit.
**Upstream:** Zoo-Code PR #789, commit `1211eaa49`, merged 2026-07-04, author dw (daewoongoh).
**Touched:** `src/api/providers/anthropic-vertex.ts`, `src/api/providers/__tests__/anthropic-vertex.spec.ts`.

## Symptom

A single completion (commit message, prompt enhancement, condensing) through Claude on Vertex AI
either failed with `Vertex completion error: Cannot read properties of undefined (reading 'type')`
when the response had no content blocks, or returned an empty string when the model answered with
a thinking block before its text block (Claude 5 models think adaptively by default, so this can
happen without any thinking setting).

## Root cause in our code

`src/api/providers/anthropic-vertex.ts:311` (before the fix) read `response.content[0]` and then
`content.type`. An empty array gives `undefined.type` (a TypeError); a leading thinking block is
not `text`, so the method returned `""` and ignored the text block behind it.

## Fix

Look up the first block of type `text` with `response.content.find(...)` and return its text, or
`""` when there is none. This is the same pattern `AnthropicHandler.completePromptWithUsage`
already uses (`src/api/providers/anthropic.ts:389`). The usage object is unchanged.

## Tests

Two new cases in `anthropic-vertex.spec.ts` under `completePrompt`:

- empty content array: failed before with the TypeError above, now returns `""`;
- thinking block followed by a text block: returned `""` before, now returns `"visible response"`.

Whole spec file: 37 passed. `tsc --noEmit`, eslint and prettier are clean.

## Not ported

Zoo's unrelated reformatting of a `createMessage(...).next()` call in the same spec file.
