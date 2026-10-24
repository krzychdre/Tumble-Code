# R4 day wave: Gemini 2.5 Pro and 2.5 Flash cache-read prices from the pricing page

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`,
`ai_plans/2026-10-24_16-02_r4-day-gemini-new-models.md` (found the stale prices).

## Touched files

- `packages/types/src/providers/gemini.ts`

## Problem

The Gemini table priced cached input of `gemini-2.5-pro` at $0.31 (prompts up to 200k tokens) and $0.625 (above),
and of `gemini-2.5-flash` at $0.075. The Gemini API pricing page (https://ai.google.dev/gemini-api/docs/pricing,
Standard paid tier, read 2026-10-24) lists $0.125 and $0.25 for 2.5 Pro and $0.03 (text, image, video) for
2.5 Flash, so the cost shown for cache hits was 2.5 times too high.

## Change

`cacheReadsPrice` of `gemini-2.5-pro` (top level and both prompt-size tiers) and of `gemini-2.5-flash` now match
the pricing page. The `gemini-flash-latest` and `gemini-flash-lite-latest` aliases keep their prices: Google does not
say which model they point to today.

## Tests

`packages/types` suite, `packages/core` suite (cost), `src` `gemini.spec.ts` and
`gemini-wire-characterization.spec.ts`: green. A price is data, not logic, so no new test.
