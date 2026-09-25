# DeepSeek catalog refresh (owner decision 16, 2026-09-25)

Branch `chore/deepseek-catalog-refresh`. Refresh the DeepSeek model list in
`packages/types/src/providers/deepseek.ts` to DeepSeek's current official
catalog, keep the legacy names DeepSeek still serves resolvable, and make the
retired names honest.

## Sources (all read on 2026-09-25, 13:38-13:40 UTC)

- Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing
  (and the Chinese page https://api-docs.deepseek.com/zh-cn/quick_start/pricing,
  used to read the feature rows whose labels the English crawl lost).
- List models reference: https://api-docs.deepseek.com/api/list-models
  (example response with `context_window`, `max_output_tokens`,
  `input_modalities` and `effort` per model).
- Change log: https://api-docs.deepseek.com/updates
- Thinking mode guide: https://api-docs.deepseek.com/guides/thinking_mode
- Vision guide: https://api-docs.deepseek.com/guides/vision

No `DEEPSEEK_API_KEY` was present in the environment, so the live
`GET https://api.deepseek.com/models` call was skipped.

## What the docs say

- Two documented models: `deepseek-flash` (DeepSeek-V4.1-Flash, released
  2026-09-10, native image input) and `deepseek-v4-pro` (DeepSeek-V4-Pro-0813,
  text only; DeepSeek keeps serving it after 2026-09-14, billing unchanged).
- Both: context 1M (`context_window` 1048576), max output 384K
  (`max_output_tokens` 393216), thinking and non-thinking modes (thinking is
  the default, effort default `high`, levels `low` / `high` / `max`), JSON
  output, tool calls, chat prefix completion (beta), FIM (beta, non-thinking
  only). Tool calls in thinking mode need `reasoning_content` passed back
  (our `preserveReasoning`).
- Legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are
  "still accepted, but the corresponding models have been retired, their
  requests are served by the DeepSeek-V4.1-Flash model and billed at the Flash
  price".
- `deepseek-chat` / `deepseek-reasoner`: the 2026-04-24 change log announced
  their discontinuation on 2026-07-24; no current page lists them.
- Prices per 1M tokens, peak (off-peak is exactly half; peak is 01:00-04:00
  and 06:00-10:00 UTC Monday to Friday, excluding Chinese public holidays):

| Model | cache hit | cache miss | output |
| --- | --- | --- | --- |
| deepseek-flash | $0.006 | $0.30 | $1.20 |
| deepseek-v4-pro | $0.044 | $1.32 | $3.96 |

## Changes

| Id | Before | After |
| --- | --- | --- |
| `deepseek-flash` | absent (unknown id, default info, warning) | new default; 1_048_576 ctx, 393_216 out, images, peak prices above |
| `deepseek-v4-flash` | default; 1_000_000 / 384_000, no images, $0.44 / $1.32 / $0.014 | alias of `deepseek-flash` (sent as configured, hidden from the picker) |
| `deepseek-v4-flash-vision-exp` | catalog entry, images, V4 Flash prices, no thinking toggle | alias of `deepseek-flash`, gets the thinking toggle |
| `deepseek-v4-pro` | 1_000_000 / 384_000 | 1_048_576 / 393_216, prices unchanged, description names 0813 |
| `deepseek-chat` | alias of `deepseek-v4-flash` | catalog entry with `deprecated: true` |
| `deepseek-reasoner` | alias of `deepseek-v4-flash` | catalog entry with `deprecated: true` |

Why `deprecated: true` and not "unknown": the ModelPicker hides a deprecated
model from the list (unless it is the selected one) and shows "This model is
no longer available. Please select a different model.", which is exactly the
documented state. The id is still sent as configured (owner decision 5), so a
compatible endpoint that still serves it keeps working; the handler keeps its
old behavior for these ids (thinking on for `deepseek-reasoner`, no thinking
fields for `deepseek-chat`). Dropping them would have shown the generic
"not in this provider's model list" warning, which says less.

Handler (`src/api/providers/deepseek.ts`): the thinking toggle was keyed on
`deepseek-v4-flash` / `deepseek-v4-pro`; it is now keyed on `deepseek-flash` /
`deepseek-v4-pro`, with an alias counted as the model it names. The effort
mapping sent `low` as `high` (true before 2026-08-13); it now sends `low` as
`low`, `medium` / `high` as `high`, `xhigh` / `max` as `max`.
`supportsReasoningEffort` keeps its existing list so stored settings stay
valid.

Fetcher (`src/api/providers/fetchers/deepseek.ts`): a `/models` id that is an
alias is described by the model it names instead of the generic 128K
fallback.

## Peak / off-peak pricing

`ModelInfo` has `tiers` (OpenAI service tiers, context-size limits), `longContextPricing` and service-tier pricing but no
time-of-day pricing. No mechanism was invented: the catalog carries the peak
rates (cost estimates never come in low) and the model descriptions state that
off-peak is half.

## Checked, unchanged

- CLI `providerEnvMap.deepseek.modelField` is `apiModelId`, no hard-coded id;
  the CLI context-window table imports `deepSeekModels`.
- `activeProviderIdsForPublicApi` duplicate `deepseek` entry untouched.
- No DeepSeek model ids in i18n or docs. `src/api/providers/openai.ts`
  `deepseek-reasoner` handling is for OpenAI Compatible profiles, left alone.
- e2e `providers/deepseek-v4.test.ts` probes `deepseek-flash` instead of
  `deepseek-v4-flash`.

## Open (out of scope)

- `/models` now returns `context_window`, `max_output_tokens`,
  `input_modalities` and `effort`; the fetcher still ignores them and gives
  unknown ids a stale V3-era fallback (128K, $0.28 / $0.42).
- `supportsReasoningEffort` could become `disable / low / high / max` to match
  DeepSeek's levels, but that needs a migration for stored `medium` / `xhigh`.
