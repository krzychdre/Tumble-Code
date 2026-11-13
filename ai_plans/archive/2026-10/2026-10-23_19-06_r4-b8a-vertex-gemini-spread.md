# R4-B8a: Vertex takes its shared Gemini entries from the Gemini table

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B8a).

## Touched files

- `packages/types/src/providers/vertex.ts`

## Problem

`vertexModels` spelled out Gemini entries that are copies of `geminiModels` entries (jscpd: two clones,
`vertex.ts` 19-90 and 91-131 against `gemini.ts` 57-130 and 132-172), while its Claude entries were already derived
by spread.

## Change

Comparing every Gemini id of `vertexModels` with `geminiModels` (deep equality per entry) gives:

- Identical, now `{ ...geminiModels[id] }`: `gemini-3.5-flash`, `gemini-3.1-pro-preview`,
  `gemini-3.1-pro-preview-customtools`, `gemini-3-flash-preview`, `gemini-2.5-flash`.
- Identical except that Gemini flags it `deprecated`, now `{ ...withoutFields(geminiModels[id], "deprecated") }`:
  `gemini-3-pro-preview`.
- Different data, kept literal: `gemini-2.5-pro` and the three `gemini-2.5-pro-preview-*` ids (Vertex lists no cache
  prices, the previews also no tiers or thinking budget).
- Only on Vertex, kept literal: 12 ids (the 2.5 Flash previews with and without `:thinking`, the 2.0 and 1.5 lines,
  `gemini-2.5-pro-exp-03-25`, `gemini-2.5-flash-lite-preview-06-17`).

The audit counted 17 shared entries; the per-entry comparison finds 6 that can be derived.

## Tests

- A one-off script confirmed the new `vertexModels` deep-equals the previous one with the same key order.
- `vertex-model-family.spec.ts`, `provider-model-resolution.spec.ts`, `claude-model-tables.spec.ts`,
  `provider-schema-derivation.spec.ts` (types) and `vertex-model-family-characterization.spec.ts`, `vertex.spec.ts`,
  `gemini.spec.ts` (src) green.
- jscpd over `packages/types/src/providers` reports only the B8f data clone inside `gemini.ts`.

## Notes

- `gemini-3-pro-preview` is flagged `deprecated` in the Gemini table but not in the Vertex table. The derivation keeps
  that difference; whether Vertex should flag it too is an open data question.
