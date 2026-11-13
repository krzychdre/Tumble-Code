# R4 follow-up: Gemini and Vertex tables without the models Google has shut down

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution"), `ai_plans/archive/2026-08/2026-08-26_provider-cleanup-and-model-refresh.md` (the previous Gemini
refresh), `ai_plans/2026-10-17_14-30_moonshot-kimi-k3-refresh.md` (the pattern for removed ids).

## Touched files

- `packages/types/src/providers/gemini.ts`, `packages/types/src/providers/vertex.ts`
- `packages/types/src/__tests__/vertex-model-family.spec.ts`, fixture `claude-model-tables.json` (Vertex key order)
- `src/api/providers/__tests__/vertex.spec.ts`, `src/api/providers/__tests__/gemini-wire-characterization.spec.ts`
  (+ snapshot)
- Comments naming `gemini-3-pro-preview` as an example: `src/api/providers/gemini.ts`, `src/api/transform/reasoning.ts`

## Sources (read 2026-10-24)

- Gemini API deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Vertex (Gemini Enterprise Agent Platform) model versions and lifecycle:
  https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions, and the model pages
  `.../models/gemini/2-5-pro`, `2-5-flash`, `3-1-pro`, `3-flash`, `3-pro` (the last redirects to the model index).
  The 2.5 model pages note that the dates are the end of Vertex support; the Gemini API keeps its own schedule.

## Removed from the Gemini table

| Id                                                 | Shutdown (Gemini API page) |
| -------------------------------------------------- | -------------------------- |
| `gemini-3-pro-preview`                             | 2026-03-09                 |
| `gemini-2.5-pro-preview-06-05`, `-05-06`, `-03-25` | 2025-12-02                 |
| `gemini-2.5-flash-preview-09-2025`                 | 2026-02-17                 |
| `gemini-2.5-flash-lite-preview-09-2025`            | 2026-03-31                 |

Kept: the 3.x models (no shutdown announced; 3.5 Flash and 3.7 Flash route to newer models instead of shutting
down), `gemini-2.5-pro` and `gemini-2.5-flash` (no shutdown announced on the Gemini API), and the
`gemini-flash-latest` / `gemini-flash-lite-latest` aliases. None has an announced future shutdown date, so none is
newly marked `deprecated`.

## Removed from the Vertex table

| Id                                                                | Source                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `gemini-2.5-pro`, `gemini-2.5-flash`                              | Vertex retirement 2026-10-20 (model pages and lifecycle table)                 |
| `gemini-2.5-flash-lite-preview-06-17`                             | preview of 2.5 Flash-Lite, which Vertex retired on 2026-10-20                  |
| `gemini-2.5-pro-preview-03-25`, `-05-06`, `-06-05`                | shut down 2025-12-02 (Gemini API page); 2.5 Pro retired on Vertex 2026-10-20   |
| `gemini-2.5-pro-exp-03-25`                                        | experimental 2.5 Pro; 2.5 Pro retired on Vertex 2026-10-20                     |
| `gemini-2.5-flash-preview-05-20` and `:thinking`                  | shut down 2025-11-18 (Gemini API page); 2.5 Flash retired on Vertex 2026-10-20 |
| `gemini-2.5-flash-preview-04-17` and `:thinking`                  | earlier preview of 2.5 Flash, retired on Vertex 2026-10-20                     |
| `gemini-3-pro-preview`                                            | shut down 2026-03-09 (Gemini API page); its Vertex model page is gone          |
| `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-001`               | Vertex retired table: 2.0 Flash and Flash-Lite, 2026-06-01                     |
| `gemini-2.0-pro-exp-02-05`, `gemini-2.0-flash-thinking-exp-01-21` | experimental 2.0 models; Gemini 2.0 retired on Vertex 2026-06-01               |
| `gemini-1.5-pro-002`, `gemini-1.5-flash-002`                      | Vertex retired table: 2025-09-24                                               |

For the five experimental and preview ids that Google no longer lists, the date given is the retirement of the GA
model of the same line; a preview does not outlive its GA model. Left on Vertex: 3.5 Flash (GA, available until
2027-05-19 or later), 3.1 Pro preview (+ customtools) and 3 Flash preview (public preview pages, no retirement).

## Profiles that still select a removed id

As in the Moonshot refresh: no migration. The id is kept as an unknown model (owner decision 5), the settings
show the unknown-model warning and the handler sizes it with the provider's unknown-id info: on Gemini the default
model's limits without prices, on Vertex the Gemini stand-in. No default id pointed at a removed model
(Gemini: `gemini-3.1-pro-preview`, Vertex: `claude-opus-5`); the Vertex Gemini stand-in did
(`gemini-2.0-flash-001`) and is now `gemini-3.1-pro-preview`: Vertex serves no Gemini before 3, so an unknown
Gemini id is a newer one, and the stand-in's default thinking level `low` is one every Gemini 3 model accepts. It
lists no thinking budget, which Gemini 3 rejects.

## Tests

- `vertex-model-family.spec.ts`: neither table lists a shut-down id (and Vertex no Gemini 2.5); a removed id on
  Gemini and on Vertex resolves as an unknown model with its own id; the Gemini stand-in has no thinking budget and
  its default level is in the effort list of every listed Vertex Gemini. The test that the Gemini-to-Vertex
  `deprecated` flags agree stays (it no longer names `gemini-3-pro-preview`).
- `vertex.spec.ts`: a listed Vertex Gemini and the stand-in sizing for an unknown id (65,536 output tokens,
  thinking level `low`, no budget).
- `gemini-wire-characterization.spec.ts`: both handlers now run against `gemini-3.1-pro-preview`; the three Vertex
  body snapshots move from a thinking budget to the thinking level.
- Mutation: adding `gemini-2.5-pro-preview-06-05` back to the Gemini table turns two cases red.

## Notes

- The Vertex Claude entries are not part of this sweep: Google's two pages cover Gemini only, and Anthropic's models
  on Vertex follow their own retirement schedule.
- Not added: newer models the pages list (Gemini 3.8 Flash, 4 Argon, 3.6 and 3.7 Flash on Vertex); that is a model
  refresh with prices and limits, not a cleanup.
