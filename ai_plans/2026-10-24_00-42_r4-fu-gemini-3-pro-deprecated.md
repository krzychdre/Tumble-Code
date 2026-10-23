# R4 follow-up: gemini-3-pro-preview deprecated on Vertex too

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution"), `ai_plans/2026-10-23_19-06_r4-b8a-vertex-gemini-spread.md` (the spread that kept the difference).

## Touched files

- `packages/types/src/providers/vertex.ts`
- `packages/types/src/__tests__/vertex-model-family.spec.ts`

## Problem

`gemini-3-pro-preview` was flagged `deprecated` in the Gemini table (so the picker hides it and warns a profile
that still selects it) and not in the Vertex table, which spread the Gemini record without that field.

## Evidence

- The flag came from an upstream announcement: #154 (2026-08-26) flagged the models "Google has shut down".
- Gemini API deprecations page (https://ai.google.dev/gemini-api/docs/deprecations, read 2026-10-24):
  `gemini-3-pro-preview`, released 2025-11-18, shutdown date 2026-03-09, replacement `gemini-3.1-pro-preview`.
- Vertex (now Gemini Enterprise Agent Platform): the Google models page lists two Gemini text previews, 3.1 Pro and
  3 Flash; the Gemini 3 Pro model page (`.../models/gemini/3-pro`) redirects to that index, while the 3.1 Pro and
  3 Flash pages still exist. The model versions and lifecycle page lists no preview models, so it gives no date.

The model is gone on both platforms, so Vertex takes the Gemini record as it is.

## Change

`"gemini-3-pro-preview": { ...geminiModels["gemini-3-pro-preview"] }`, keeping `deprecated: true`.

## Tests

- `vertex-model-family.spec.ts`: every id that both the Gemini and the Vertex table list has the same `deprecated`
  flag on Vertex as in the Gemini table, and the list includes `gemini-3-pro-preview`.
- Mutation: the previous `withoutFields(..., "deprecated")` turns the case red.

## Notes

- The Gemini table does not flag the `gemini-2.5-pro-preview-*` ids, which the Gemini API page lists as shut down on
  2025-12-02; Vertex lists them too. That is a separate model refresh, not part of this consistency fix.
