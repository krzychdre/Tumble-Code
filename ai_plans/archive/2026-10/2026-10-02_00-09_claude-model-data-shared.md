# Claude model data shared by Anthropic, Vertex and Bedrock (simplification round 2, C5)

Status: done on branch `refactor/claude-model-data-shared`, PR open, not merged.

## Touched files

- `packages/types/src/providers/claude.ts` (new): `claudeModels` (one record per Claude model as the Anthropic API
  serves it), the two 1M-context price tiers, `OPUS_4_200K_WITH_1M_BETA`, `withoutFields`, `oneMillionContextIds`.
- `packages/types/src/providers/anthropic.ts`, `vertex.ts`, `bedrock.ts`: the Claude entries spread the shared record
  and add or replace platform fields. `ANTHROPIC_1M_CONTEXT_MODEL_IDS` moved here from
  `provider-model-selection.ts` (which now imports it, as does `provider-descriptors.ts`).
- `packages/types/src/__tests__/claude-model-tables.spec.ts` + `__fixtures__/claude-model-tables.json`.

## Problem

Fourteen Claude models were written out three times (`providers/anthropic.ts`, the Claude half of `vertex.ts`,
the Claude half of `bedrock.ts`), about 750 lines with the same prices, limits, comments and descriptions. PR #674
had to align the output limits by hand in all three.

## Fix

- The Anthropic table is `{ ...claudeModels[key] }` per id.
- Vertex differences, all kept as they were: `maxTokens: 8192` for Sonnet 4, 4.5, 4.6, Haiku 4.5, Opus 4.5 and
  Opus 4; Opus 4.7 and 4.8 at 200K with the 1M beta tier (`OPUS_4_200K_WITH_1M_BETA`); no `description` on Haiku
  4.5; no `supportsReasoningBudget` on Opus 4.
- Bedrock differences, all kept: the cache-point fields (`BEDROCK_CLAUDE_CACHE_POINTS`, Haiku with 2048 tokens);
  `maxTokens: 8192` for Sonnet 4, 4.5, 4.6, Haiku 4.5, Opus 4.5 and Opus 4; no 1M tier on Sonnet 4 and 4.5; Opus 4.7
  and 4.8 at 200K with the 1M tier and without `supportsReasoningBinary` / `supportsTemperature`; no `description`
  on Haiku 4.5.
- 1M lists: `ANTHROPIC_1M_CONTEXT_MODEL_IDS` and `VERTEX_1M_CONTEXT_MODEL_IDS` are the entries that price the 1M
  tier (`oneMillionContextIds`). The Anthropic list has the same members in table order (was: Sonnet 4, 4.5, 4.6,
  Opus 4.6; now: Sonnet 4.6, 4.5, 4, Opus 4.6); every user only calls `includes`. The Vertex list is identical.
  `BEDROCK_1M_CONTEXT_MODEL_IDS` stays hand-written: its Sonnet 4 and 4.5 entries carry no 1M tier, so the table
  cannot say they take the beta (comment added).

## Tests

- New in `claude-model-tables.spec.ts`: the Claude entries of each table are `toStrictEqual` to a JSON copy taken
  from origin/main before the change (`__fixtures__/claude-model-tables.json`), the full key order of each table is
  unchanged, the 1M lists have the same members (Vertex and Bedrock in the same order), and each table gets its own
  entry objects. A mutation check (Vertex Sonnet 4.6 `maxTokens` 8193) fails the spec.
- packages/types full suite: 46 files, 785 tests pass. src provider specs for anthropic, vertex, bedrock: 17 files,
  319 pass. webview `components/ui/hooks` and `settings/providers` specs: 7 files, 182 pass.
- `tsc --noEmit` in types, src, webview-ui, apps/cli clean; eslint clean; prettier; `pnpm knip` exit 0.

## Notes / caveats

Kept on purpose because the item asks for deep equality; each looks like stale data and could be its own item:

- Vertex and Bedrock list `maxTokens: 8192` for Sonnet 4.x, Haiku 4.5 and Opus 4.5 / 4, where the Anthropic table
  has 64K or 32K (#674 aligned only the newest models).
- Bedrock Opus 4.7 and 4.8 lack `supportsReasoningBinary` and `supportsTemperature: false`, which the Anthropic and
  Vertex entries have (the Anthropic comment says these models reject budget-token thinking).
- Bedrock Sonnet 4 and 4.5 are in `BEDROCK_1M_CONTEXT_MODEL_IDS` but carry no 1M price tier, so with the beta on
  `bedrock.ts` keeps the 200K prices for them.
