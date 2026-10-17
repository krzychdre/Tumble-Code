# Claude Haiku 5.5 and Anthropic price refresh

**Date:** 2026-10-17
**Branch:** `feat/anthropic-models-2026-10` (off main at 46a9f8b20)
**Status:** done, not merged.

## What

Anthropic released Claude Haiku 5.5 (`claude-haiku-5-5`, 2026-10-07). The Claude model tables did not offer it,
and one existing price no longer matched Anthropic's pricing page. This branch adds the model to the Anthropic,
Vertex and Bedrock tables, fixes the price, and marks the one model the Claude API has deprecated.

## Evidence

Read live on 2026-10-17 with the crawler:

- Pricing page (https://platform.claude.com/docs/en/about-claude/pricing): Haiku 5.5 costs $0.10 input,
  $0.50 output, $0.125 5-minute cache writes and $0.01 cache reads per million tokens for prompts up to 100,000
  tokens, and $0.50, $2.50, $0.625 and $0.05 above. "A request's prompt length counts all of its input tokens,
  including cache reads and cache writes", and a request over the threshold pays the higher prices for the whole
  request. Sonnet 5.5 cache reads are $0.10 ("0.05x on Claude Opus 5.5 and Claude Sonnet 5.5 ... $0.10 USD on
  Claude Sonnet 5.5"); the table had $0.20.
- Models overview and the Haiku 5.5 model page: 1M context, 128K max output, text and image input, adaptive
  thinking on by default, ids `claude-haiku-5-5` (Claude API, Google Cloud) and `anthropic.claude-haiku-5-5`
  (Bedrock).
- Haiku 5.5 migration guide: `budget_tokens` thinking, non-default `temperature` / `top_p`, any `top_k` and an
  assistant prefill all return 400. Forced `tool_choice` is accepted (we only send `auto`).
- Model deprecations page: `claude-sonnet-4-5-20250929` deprecated on 2026-09-30, retired on 2026-11-30. Every
  other model of the Anthropic table is Active. Sonnet 4 and Opus 4 are retired on the Claude API (already not in
  the Anthropic table).
- Anthropic's Bedrock page: Haiku 5.5 has a 1M window on Bedrock and is served on the same endpoint as the other
  Claude 5 models.

Every other record (Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, 4.7, 4.6, 4.5, Opus 4, Sonnet 5, Sonnet 4.6,
4.5, 4, Haiku 4.5) matches the pricing page: input, output, 5-minute cache write and cache read prices. The current
models' limits (128K / 1M) match the overview; the older models' limits were checked on 2026-10-02 and are pinned
by `claude-model-tables.spec.ts`.

## Fix

- `packages/types/src/providers/claude.ts`: new `haiku-5-5` record with the base prices and
  `longContextPricing: { thresholdTokens: 100_000, all four multipliers 5 }`. The reasoning flags copy
  `sonnet-5-5` (`supportsReasoningBudget`, `supportsReasoningBinary`, `supportsTemperature: false`).
  `sonnet-5-5.cacheReadsPrice` 0.2 -> 0.1.
- `longContextPricing` is honoured: `calculateApiCost` (`packages/core/src/api/cost.ts`) applies it when the
  total input (Anthropic protocol: uncached input plus cache writes plus cache reads) is over the threshold, which
  is exactly Anthropic's rule. Every Claude provider path (`anthropic-stream.ts`, `TaskStreamProcessor.costOf`)
  goes through it.
- `anthropic.ts`, `vertex.ts`, `bedrock.ts`: one entry each (`claude-haiku-5-5`, `claude-haiku-5-5`,
  `anthropic.claude-haiku-5-5` with the Bedrock cache points), and `anthropic.claude-haiku-5-5` in
  `BEDROCK_GLOBAL_INFERENCE_MODEL_IDS` like the other Claude 5 models.
- `src/api/providers/bedrock.ts`: `isAdaptiveThinkingModel` matches `haiku-5`. Bedrock picks the adaptive thinking
  request and drops `temperature` by model id, so without this Haiku 5.5 on Bedrock would get `budget_tokens` and
  a temperature, both 400.
- `anthropic.ts`: `claude-sonnet-4-5` gets `deprecated: true`, in the Anthropic table only. The model picker then
  stops offering it but keeps it for a user who has it selected (with the "no longer available" warning). Vertex
  and Bedrock set their own schedules and both default to Sonnet 4.5, so their entries are unchanged.

## Defaults

No default changed. `anthropicDefaultModelId` is Opus 5 (not a Haiku), and no code in `src/`, `packages/`,
`webview-ui/` or `apps/` picks Haiku 4.5 as a "cheap model" default; the only `haiku-4-5` references are the table
entries, the OpenRouter capability sets and tests.

## Tests

- `packages/types/src/__tests__/claude-model-tables.spec.ts`: Haiku 5.5 limits on all three platforms, its prices
  and long prompt tier on all three, same reasoning flags on all three, only `claude-sonnet-4-5` deprecated and only
  in the Anthropic table. Fixture `claude-model-tables.json` regenerated; its diff is exactly the values listed
  above.
- `packages/core/src/api/__tests__/cost.spec.ts`: a 100,000-token prompt pays the base prices, 100,001 pays five
  times every price.
- `src/api/providers/__tests__/anthropic.spec.ts`: Haiku 5.5 gets cache breakpoints, adaptive thinking and no
  temperature; no thinking parameter with reasoning off; `getModel` info; a 121,000-token prompt is billed at the
  long prompt prices in the stream's cost chunk.
- `src/api/providers/__tests__/bedrock.spec.ts`: `isAdaptiveThinkingModel` true for Haiku 5.5 (with and without
  `global.`), false for Haiku 4.5.

## Left out

- OpenRouter: `anthropic/claude-haiku-5.5` is not added to the OpenRouter capability sets or the Claude 5 id map in
  `src/api/providers/fetchers/openrouter.ts`; its OpenRouter id was not verified.
- `effort` levels: the parallel branch `feat/anthropic-reasoning-effort` adds `output_config.effort` flags to the
  same records; the Haiku 5.5 record will need them there (default effort `medium`).
- The Vertex and Bedrock defaults (Sonnet 4.5, deprecated on the Claude API and labelled deprecated on Anthropic's
  Bedrock page) are not moved.
- 1-hour cache write prices are not modelled (no field for them, unchanged from before).
