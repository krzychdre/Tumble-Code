# Claude model tables: platform limits, native 1M context and long-context prices

Status: done on branch `fix/claude-platform-tables-data` (PR open, not merged).

## Touched files

- `packages/types/src/providers/claude.ts`, `anthropic.ts`, `vertex.ts`, `bedrock.ts`
- `packages/types/src/__tests__/claude-model-tables.spec.ts` and `__fixtures__/claude-model-tables.json`
- `webview-ui/src/hooks/models/useSelectedModel.ts`, `webview-ui/src/components/settings/providers/Bedrock.tsx`
- `webview-ui/src/i18n/locales/*/settings.json` (the three 1M beta descriptions)
- Specs: `src/api/providers/__tests__/{anthropic,anthropic-vertex,bedrock,bedrock-characterization}.spec.ts`,
  `src/api/providers/bedrock/__tests__/request.spec.ts`, `webview-ui/.../provider-forms.model-rules.spec.tsx`,
  `webview-ui/.../useSelectedModel.spec.ts`, `apps/cli/src/lib/utils/__tests__/context-window.test.ts`

## Sources

Crawled 2026-10-02 (the brief's facts came from a cache dated 2026-09-25; where they differ, the live pages win,
confirmed by the coordinator):

- https://platform.claude.com/docs/en/about-claude/pricing: "Claude 4.6 and later models ... include the full 1M
  token context window at standard pricing."
- https://platform.claude.com/docs/en/build-with-claude/context-windows: Fable 5/5.1, Opus 4.6 to 5.5, Sonnet 4.6
  to 5.5 have a 1M window and 128K max output; "For every model with a 1M-token context window, 1M is the default:
  you don't need a beta header"; other models (Sonnet 4.5) 200K.
- https://platform.claude.com/docs/en/about-claude/models/overview: Haiku 4.5 200K / 64K output.
- https://platform.claude.com/docs/en/about-claude/model-deprecations: `claude-sonnet-4-20250514` and
  `claude-opus-4-20250514` retired on the Claude API on 2026-06-15; Sonnet 4.5 deprecated, retires 2026-11-30;
  Bedrock and Google Cloud set their own schedules.
- Output limits of the legacy models (Opus 4.5 64K, Sonnet 4.5 64K, Sonnet 4 64K, Opus 4 32K) from the brief.

## Problem

After #674 and #714 the shared records still carried stale data, and the platform tables overrode it:

- `claude.ts` (origin/main): `sonnet-4-6` 64K output, 200K window with the priced 1M beta tier; `opus-4-6` 200K with
  the priced Opus 1M tier; `opus-4-5` 32K output.
- `vertex.ts` and `bedrock.ts`: `maxTokens: 8192` overrides on Sonnet 4, Sonnet 4.5, Sonnet 4.6, Haiku 4.5,
  Opus 4.5 and Opus 4, which capped the max output slider.
- `OPUS_4_200K_WITH_1M_BETA` gave Opus 4.7 and 4.8 on Vertex and Bedrock a 200K window and a priced 1M beta,
  although they serve 1M natively at standard prices.
- `bedrock.ts`: Sonnet 4 and 4.5 had their tier removed (`withoutFields(..., "tiers")`) but stayed in the hand-written
  `BEDROCK_1M_CONTEXT_MODEL_IDS`, so with the beta on the handler (`src/api/providers/bedrock.ts:645`) set a 1M window
  and kept the 200K prices.
- `bedrock.ts`: Opus 4.7 and 4.8 dropped `supportsReasoningBinary` and `supportsTemperature`.
- `anthropic.ts`: still offered Sonnet 4 and Opus 4 (May 2025), retired on the Claude API.

## Fix

Every changed value (the frozen fixture was updated with exactly these changes):

| Platform  | Id                                        | Field                                         | Before                  | After                                             |
| --------- | ----------------------------------------- | --------------------------------------------- | ----------------------- | ------------------------------------------------- |
| Anthropic | claude-sonnet-4-6                         | maxTokens                                     | 64000                   | 128000                                            |
| Anthropic | claude-sonnet-4-6                         | contextWindow / tiers                         | 200000 + Sonnet 1M tier | 1000000, no tier                                  |
| Anthropic | claude-opus-4-6                           | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Anthropic | claude-opus-4-5-20251101                  | maxTokens                                     | 32000                   | 64000                                             |
| Anthropic | claude-sonnet-4-20250514                  | entry                                         | present                 | removed (retired)                                 |
| Anthropic | claude-opus-4-20250514                    | entry                                         | present                 | removed (retired)                                 |
| Vertex    | claude-sonnet-4@20250514                  | maxTokens                                     | 8192                    | 64000                                             |
| Vertex    | claude-sonnet-4-5@20250929                | maxTokens                                     | 8192                    | 64000                                             |
| Vertex    | claude-sonnet-4-6                         | maxTokens                                     | 8192                    | 128000                                            |
| Vertex    | claude-sonnet-4-6                         | contextWindow / tiers                         | 200000 + Sonnet 1M tier | 1000000, no tier                                  |
| Vertex    | claude-haiku-4-5@20251001                 | maxTokens                                     | 8192                    | 64000                                             |
| Vertex    | claude-opus-4-6                           | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Vertex    | claude-opus-4-7                           | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Vertex    | claude-opus-4-8                           | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Vertex    | claude-opus-4-5@20251101                  | maxTokens                                     | 8192                    | 64000                                             |
| Vertex    | claude-opus-4@20250514                    | maxTokens                                     | 8192                    | 32000                                             |
| Bedrock   | anthropic.claude-sonnet-4-5-20250929-v1:0 | maxTokens                                     | 8192                    | 64000                                             |
| Bedrock   | anthropic.claude-sonnet-4-5-20250929-v1:0 | tiers                                         | none                    | Sonnet 1M tier ($6 / $22.50, cache $7.50 / $0.60) |
| Bedrock   | anthropic.claude-sonnet-4-20250514-v1:0   | maxTokens                                     | 8192                    | 64000                                             |
| Bedrock   | anthropic.claude-sonnet-4-20250514-v1:0   | tiers                                         | none                    | Sonnet 1M tier                                    |
| Bedrock   | anthropic.claude-sonnet-4-6               | maxTokens                                     | 8192                    | 128000                                            |
| Bedrock   | anthropic.claude-sonnet-4-6               | contextWindow / tiers                         | 200000 + Sonnet 1M tier | 1000000, no tier                                  |
| Bedrock   | anthropic.claude-opus-4-6-v1              | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Bedrock   | anthropic.claude-opus-4-7                 | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Bedrock   | anthropic.claude-opus-4-7                 | supportsReasoningBinary / supportsTemperature | absent                  | true / false                                      |
| Bedrock   | anthropic.claude-opus-4-8                 | contextWindow / tiers                         | 200000 + Opus 1M tier   | 1000000, no tier                                  |
| Bedrock   | anthropic.claude-opus-4-8                 | supportsReasoningBinary / supportsTemperature | absent                  | true / false                                      |
| Bedrock   | anthropic.claude-opus-4-5-20251101-v1:0   | maxTokens                                     | 8192                    | 64000                                             |
| Bedrock   | anthropic.claude-opus-4-20250514-v1:0     | maxTokens                                     | 8192                    | 32000                                             |
| Bedrock   | anthropic.claude-haiku-4-5-20251001-v1:0  | maxTokens                                     | 8192                    | 64000                                             |

1M beta lists (checkbox and `context-1m-2025-08-07` header):

- Anthropic: `[sonnet-4-20250514, sonnet-4-5, sonnet-4-6, opus-4-6]` to `[claude-sonnet-4-5]`.
- Vertex: `[sonnet-4@, sonnet-4-5@, sonnet-4-6, opus-4-6, opus-4-7, opus-4-8]` to `[claude-sonnet-4@20250514,
claude-sonnet-4-5@20250929]`.
- Bedrock: hand-written 6 ids to `oneMillionContextIds(bedrockModels)` =
  `[anthropic.claude-sonnet-4-5-20250929-v1:0, anthropic.claude-sonnet-4-20250514-v1:0]`, now derived like the others.

`OPUS_4_200K_WITH_1M_BETA` and the Opus 1M tier are deleted (no model uses them). Prices on Vertex and Bedrock stay
the Anthropic prices, as the tables already used them (the tables have no platform-specific Claude prices).

Webview: the Bedrock branch of `useSelectedModel` now applies the tier prices with the 1M window, as the Bedrock
handler does (it applied only the window). The three 1M beta descriptions in all 18 locales now name "Claude Sonnet
4 / Claude Sonnet 4.5" instead of "Claude Sonnet 4.x / Claude Opus 4.6" (model names only, nothing to translate).

### Bedrock Opus 4.7 / 4.8 reasoning flags

`supportsReasoningBinary` only switches the settings UI from a budget slider to an on/off toggle
(`ThinkingBudget.tsx:74`) and, on the Anthropic and Vertex handlers, sends `thinking: {type: "adaptive"}`
(`src/api/transform/reasoning.ts:70`). Bedrock does not read it: `buildThinkingFields` (`bedrock/request.ts:203`)
chooses adaptive thinking by model id (`isAdaptiveThinkingModel`, `bedrock.ts:168`, matches opus-4-7 and opus-4-8)
and sends `thinking: {type: "adaptive"}` plus `output_config.effort`, the same request it sends for Opus 5 / Fable,
whose Bedrock entries already carry the flag. `supportsTemperature: false` only drops the temperature
(`model-params.ts:148`), which the Bedrock handler already omits for these ids. So the request stays valid and the
UI now shows the same toggle as on Anthropic and Vertex instead of a budget slider that Bedrock ignored.

### Saved profiles with a removed id

As described for #674: `resolveCatalogModel` keeps the unknown id; `guessAnthropicModelInfo` finds no known id
inside `claude-sonnet-4-20250514` / `claude-opus-4-20250514` and returns the default model's limits without
prices; the settings view shows the unknown-model warning; the request goes out with the saved id and the API
rejects it, as it already did since 2026-06-15. A spec pins this (`anthropic.spec.ts`, "keeps a saved id of a model
retired on the Claude API").

## Tests

- `claude-model-tables.spec.ts`: new invariants (fail on origin/main, 19 of 28 cases): the documented maxTokens and
  contextWindow per model on every platform that offers it; every Claude entry is covered by that list; every id in
  a 1M list has a 200K window and a 1M tier priced above the base prices, and no native 1M entry has a tier; the
  Sonnet 4/4.5 tier is the same on all platforms; Opus 4.7/4.8 have the same reasoning flags on all platforms; the
  Anthropic table drops the ids retired on the Claude API while Vertex/Bedrock keep theirs. Frozen fixture updated.
- Updated deliberately: Anthropic handler (Sonnet 4.6 limits, 1M header now on Sonnet 4.5, native 1M at standard
  prices, retired id), Vertex handler (4.6/4.7/4.8 native 1M without the beta, Sonnet 4.5 64K), Bedrock handler
  (1M tier prices for Sonnet 4/4.5, Sonnet 4.6 native, 64K limits), Bedrock request builder (no 1M header for
  Sonnet 4.6), Bedrock characterization inline snapshot (only change: Opus 4.7 with the setting on no longer sends
  `context-1m-2025-08-07`), webview provider form (checkbox visibility), `useSelectedModel` (Sonnet 4.6 standard
  prices, Bedrock tier prices), CLI context window (Vertex 1M case on Sonnet 4.5). No webview snapshot changed.
- Run: packages/types (all 46 files), 29 src specs that mention the touched ids or 1M settings, packages/core
  `model-options` and `cost`, 6 webview specs, 3 CLI specs; tsc (types, src, webview-ui, cli), eslint, prettier,
  knip exit 0.

## Notes / caveats

- Not verified against live Bedrock / Vertex: that Opus 4.6+ and Sonnet 4.6 serve 1M there without the beta header
  (Anthropic's docs say so for the model; partner platforms are assumed to match). A user who had the 1M checkbox on
  for one of those models no longer sends the header.
- Sonnet 4 / 4.5 1M beta: the live context-windows page lists Sonnet 4.5 as 200K and no longer mentions the beta;
  the tier was kept (and added on Bedrock) because the brief and the coordinator kept it. If the beta is gone, the
  checkbox and the tier for those two models can be removed in a follow-up.
- Sonnet 4 and Opus 4 stay on Vertex and Bedrock (own retirement schedules, not checked). Vertex Opus 4 still drops
  `supportsReasoningBudget` (kept from #714, not in scope).
- No `claude-sonnet-5-5` entry exists in any table yet.
