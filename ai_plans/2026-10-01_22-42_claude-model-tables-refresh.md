# Claude model tables: drop retired models, align output limits

Status: done on `chore/claude-model-tables-refresh` (simplification round 2, items A10 and B13).

## Touched files

- `packages/types/src/providers/anthropic.ts`, `vertex.ts`, `bedrock.ts`: retired entries removed; Vertex and Bedrock
  max output raised to 128K for Opus 4.6/4.7/4.8, Opus 5, Opus 5.5, Sonnet 5, Fable 5, Fable 5.1.
- `packages/types/src/providers/bedrock.ts`: `bedrockDefaultPromptRouterModelId` now Claude Sonnet 4.5.
- `packages/types/src/providers/lite-llm.ts`: `litellmDefaultModelId` now `claude-sonnet-5-5`.
- `packages/types/src/providers/openrouter.ts`: retired ids removed from the prompt-caching and reasoning-budget sets;
  the default model info no longer describes Claude 3.7 Sonnet.
- `packages/types/src/provider-model-selection.ts`: the `:thinking` filter in the Anthropic id matcher is gone.
- `src/api/providers/anthropic.ts`: the 3.7 `:thinking` id rewrite and its 128K output beta are gone; the 1M context
  beta check uses `ANTHROPIC_1M_CONTEXT_MODEL_IDS` instead of a hand copy.
- `src/api/providers/anthropic-vertex.ts`: no longer strips a `:thinking` suffix (only Claude 3.7 had one on Vertex).
- `src/api/providers/fetchers/openrouter.ts`: the special cases for `anthropic/claude-3.7-sonnet(:thinking)` and
  `anthropic/claude-opus-4.1` are gone.
- `webview-ui/src/components/settings/providers/BedrockCustomArn.tsx`: the example ARN names Sonnet 4.5.
- New spec `packages/types/src/__tests__/claude-model-tables.spec.ts`; specs updated (see Tests).

## Problem

Anthropic's model list (cached 2026-09-25) marks these as retired: Claude Sonnet 3.7 (2026-02-19), Haiku 3.5
(2026-02-19), Opus 3 (2026-01-05), Sonnet 3.5 both dates (2025-10-28), Haiku 3 (2026-04-19) and Opus 4.1
(2026-08-05); Claude 3 Sonnet went long before. The tables still offered them on Anthropic, Vertex and Bedrock
(23 entries), OpenRouter kept them in its capability sets, and LiteLLM's default model was
`claude-3-7-sonnet-20250219` (`lite-llm.ts:4`). Every request to them fails at the provider.

`claude-opus-5-5` had `maxTokens: 128_000` in `anthropic.ts` but 8192 in `vertex.ts` and `bedrock.ts`, and the same
held for every other 128K model there. For Claude models with a reasoning budget the request size does not come
from this field (`getModelMaxOutputTokens` uses 8192, or `modelMaxTokens`/16384 with the budget on), but the field
is the ceiling of the max output slider (`ThinkingBudget.tsx:211,252`) and the value the model info view shows, so
Vertex and Bedrock users could not pick more than 8192.

`src/api/providers/anthropic.ts:68-72` repeated the list of 1M context models by hand next to the exported
`ANTHROPIC_1M_CONTEXT_MODEL_IDS` that the settings checkbox uses.

## Fix

Remove the retired entries everywhere they are offered; set the Vertex and Bedrock limits to the Anthropic
table's 128K for the models listed above (the skill's model reference states 128K output for Opus 4.6+, Sonnet 5,
Opus 5/5.5 and Fable 5/5.1); import the 1M list.

The `:thinking` suffix handling is kept where other models still use it: `utils/thinking-suffix.ts` serves the
Gemini `:thinking` virtual models (`gemini.ts:668`) and OpenRouter keeps its Gemini `:thinking` ids. Only the Claude
3.7 uses were removed (Anthropic and Vertex handlers).

The Bedrock prompt router stand-in (used to price a router request until the router reports the model it invoked)
was Claude 3 Sonnet ($3/$15, 4096 output, no caching). It is now Claude Sonnet 4.5: same price, but 8192 output and
prompt caching on, so the first request through a router whose model is not yet known now carries cache points.
This was not verified against a live prompt router.

## Saved settings with a removed id

`resolveCatalogModel` (`provider-models.ts:198`) keeps an unknown id (owner decision 5) and gives it a stand-in info
(Anthropic: `guessAnthropicModelInfo`, the default model's limits without prices; Vertex/Bedrock: the default model's
info, Bedrock adds its id heuristics). The settings view shows the unknown-model warning. The request still goes out
with the saved id, and the provider rejects it, exactly as it already did for a retired model before this change.
No migration is added: nothing new breaks, and the user sees a warning that tells them to pick another model.

## Tests

- New `claude-model-tables.spec.ts`: no table (Anthropic, Vertex, Bedrock, OpenRouter sets, LiteLLM default) offers
  a retired id, and the 128K models have the same max output on all three platforms. Fails on the old tables.
- Specs that used retired ids as table models now use current ones: `anthropic.spec.ts`, `anthropic-vertex.spec.ts`
  (the `:thinking` cases became reasoning-budget cases on Sonnet 4.5), every `bedrock*.spec.ts`,
  `bedrock/__tests__/request.spec.ts`, `cache-strategy.spec.ts` (3.x Bedrock ids mapped to Sonnet 4.5, Haiku 4.5 or
  Opus 4), `openrouter.spec.ts` (handler and fetcher; the fetcher's recorded catalog is old, so its assertions now
  pin `anthropic/claude-sonnet-4` instead of the removed 3.x special cases), `ProviderSettingsManager.spec.ts`
  (the "neither reasoning nor configurable max" case needs such a model; no Anthropic model is one now, so it uses
  Bedrock Nova Pro), `useSelectedModel.spec.ts`. One inline snapshot changed: the prompt router characterization's
  second invoked model is Haiku 4.5, so the cost model input price is 1 instead of 0.8.
- Run: packages/types (all, 792), packages/core `model-options.spec.ts`, packages/cloud parsing test, 22 src API specs
  plus the 33 other src specs that mention retired ids, the 12 webview specs that mention them. tsc (types, src,
  webview), eslint, prettier, knip exit 0.

## Notes / caveats

- Specs that use a retired id only as an arbitrary string (Task, ClineProvider, mocks in `ApiOptions.spec.tsx`) were
  left alone; they do not read the tables.
- Not changed: VS Code LM (`vscode-llm.ts`, `vscode-lm.ts` blacklist) lists GitHub Copilot's own model families
  (`claude-3.5-sonnet`), a different catalogue; Bedrock `guessModelInfoFromId` keeps its `claude-3-*` patterns
  (heuristics for custom ARNs, not offered models).
- Not checked: `claude-sonnet-4-6` is 64K in the Anthropic table and 8192 on Vertex/Bedrock although the model
  reference says 128K; left as is. No `claude-sonnet-5-5` entry exists in any table yet (only the LiteLLM default
  names it). The LiteLLM default model info (200K, 8192, $3/$15) was kept as a conservative fallback for proxies
  that do not report model info.
- OpenRouter's capability sets do not list Opus 4.7/4.8; out of scope here.
