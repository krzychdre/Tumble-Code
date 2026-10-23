# R4 E5: `openai-native.spec.ts` tests the handler, not the model table

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item E5)

## Touched files

- `src/api/providers/__tests__/openai-native.spec.ts`

## Problem

`describe("getModel")` restated `maxTokens`, `contextWindow`, prices and effort lists from `packages/types` for a
dozen model ids, so every model-table refresh broke it, and listed 25 removed ids that all ran one branch of
`resolveCatalogModel`. Five "handle <model> with Responses API" tests (gpt-5.4, gpt-5.5, gpt-4.1-mini, gpt-5-mini,
gpt-5-nano) went through one request path, and the two verbosity-gating tests differed only by model id.

## Change

- `getModel`: three tests, one per branch: a known id resolves to its catalog entry (compared with
  `openAiNativeModels`, not with copied numbers); an unknown id is kept with the default model's info (owner
  decision 5); no id selects `openAiNativeDefaultModelId`.
- Responses API: one `it.each` over model ids with the two branches `buildRequestBody` has: a reasoning model
  (effort and encrypted reasoning sent, no temperature, verbosity sent) and a chat model (temperature sent, no
  reasoning, no verbosity). Expected `max_output_tokens` and effort come from `getModel()`.
- The gpt-4o-mini verbosity-gating duplicate is deleted; the gpt-4.1 case stays.
- 1919 lines before, 1532 after; 46 tests, all green.

## Tests

- `./node_modules/.bin/vitest run api/providers/__tests__/openai-native.spec.ts --maxWorkers=2`: 46 passed.
- Mutation checks in `openai-native.ts` (each restored afterwards):
    - `getModel` ignores `apiModelId`: "resolves the selected id" red (and 18 others).
    - temperature gate inverted: both `it.each` rows red.
    - `text.verbosity` sent for every model: chat row and gpt-4.1 gating test red.
    - `max_output_tokens` dropped: both rows red.
    - model-default effort fallback dropped in `getReasoningEffort`: reasoning row red.
- In `packages/types/src/provider-models.ts`, an unknown id replaced by the default id: "keeps an id the catalog
  does not have" red.
