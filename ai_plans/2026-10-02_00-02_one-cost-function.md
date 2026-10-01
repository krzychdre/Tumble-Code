# One cost function (simplification round 2, C4)

Status: done on branch `refactor/one-cost-function`, PR open, not merged.

## Touched files

- `packages/core/src/api/cost.ts`, `packages/core/src/api/index.ts`: `calculateApiCost(protocol, modelInfo, usage,
options)` and `selectTierPrices` replace `calculateApiCostAnthropic` / `calculateApiCostOpenAI`.
- `src/core/task/TaskStreamProcessor.ts`: one private `costOf` for the api_req_started message and the LLM
  Completion telemetry (two copies before). `src/core/task/Task.ts`: unused import removed.
- `src/api/transform/anthropic-stream.ts`, `src/api/providers/utils/completion-usage.ts`: call the new function.
- `src/api/providers/openai-native.ts`: `applyServiceTierPricing` deleted; the service tier goes to the cost function.
- `src/api/providers/gemini.ts`: `calculateCost` is a thin wrapper (prompt-size tiers, thinking tokens billed as
  output); the unused `trace` object is gone.
- Specs: `src/api/__tests__/cost-call-sites.characterization.spec.ts` + `__fixtures__/cost-call-sites.ts` (new),
  `packages/core/src/api/__tests__/cost.spec.ts` (tier selection tests added, calls migrated), and the call
  migrations in `anthropic-stream.spec.ts`, `anthropic-vertex.spec.ts`, `anthropic-sdk-wire.spec.ts`,
  `anthropic-protocol-characterization.spec.ts`, `deepseek.spec.ts`, `openai-native-usage.spec.ts` (wording).

## Problem

The formulas lived in `packages/core/src/api/cost.ts`, but the choice between them and the price adjustments were
spread out:

- `TaskStreamProcessor.ts` picked the protocol and called one of two functions twice (message update ~497-512,
  telemetry in the background drain ~664-680), identical code.
- `openai-native.ts:~246-260` applied the named service tier to the prices itself, then called the OpenAI formula.
- `gemini.ts:~596-657` had its own formula with prompt-size tiers and an unused `trace` object.
- `cost.ts` knew `longContextPricing` but not `tiers`.

## Fix

- `calculateApiCost(protocol, modelInfo, usage, { serviceTier, promptSizeTiers })`:
    - "anthropic": `inputTokens` is the uncached input; total input = input + cache writes + cache reads.
    - "openai": `inputTokens` is the whole prompt; the uncached part is `max(0, input - writes - reads)`.
    - Prices: `selectTierPrices` first (a named service tier when one other than "default" is given; with
      `promptSizeTiers`, the first unnamed tier whose `contextWindow` holds the total input), then
      `longContextPricing` with the service tier, then the DEF-C39 write-price fallback, unchanged.
- Prompt-size tiers are opt-in because the Claude tables use `tiers` for the 1M-context variant (a single tier with
  `contextWindow: 1_000_000`); selecting it by size would charge every Claude request the 1M price.

## Tests

- Characterization first: the new spec was written and its fixture generated on the old code
  (`UPDATE_COST_FIXTURE=1`), 180 cases: 5 usages x (task message and task telemetry for 8 provider/model pairs,
  Anthropic stream for 4 models, OpenAI usage chunk for 5 models, OpenAI Native for 2 models x 4 requested/reported
  tier combinations, Gemini for 3 models). Model prices are frozen in the fixture. After the refactor every value is
  equal within 1e-12 relative (float rounding from a different multiplication order), and the five "no price" cases
  are still undefined.
- `packages/core` `src/api` specs: 62 pass. src: 24 spec files around the call sites (providers for openai-native,
  gemini, vertex, anthropic, deepseek, minimax; completion-usage; TaskStreamProcessor; anthropic-stream; the
  characterization spec): 455 pass, 1 skipped (pre-existing skip).
- `tsc --noEmit` in core and src clean; eslint on touched files clean; `pnpm knip` exit 0.

## Notes / caveats

No characterized number changed, so no cost was demonstrably wrong at these call sites. Differences that the table
cannot show, all without effect on today's catalog:

- `longContextPricing` now applies to the Anthropic protocol too. No Anthropic-protocol model has it (only OpenAI
  and xAI tables do).
- Gemini clamps the uncached input at 0 like the OpenAI formula (the old code went negative if a cache read
  exceeded the prompt, which Gemini does not report).
- Prompt-size tier selection ignores named tiers (the Gemini tiers are unnamed).

Left as is: the task's fallback cost (used only when a provider sends no `totalCost`) does not request prompt-size
tiers, exactly as before. Gemini always sends its own cost, so this does not show today.
