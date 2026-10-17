# Choose the reasoning effort for Claude models

**Status:** implemented on `feat/anthropic-reasoning-effort`, not pushed, not merged
**Related plans:** none (the parallel branch `feat/anthropic-models-2026-10` adds `claude-haiku-5-5`; its effort
fields are listed at the end of this file)
**Touched:**

- `packages/types/src/providers/claude.ts` (`supportsReasoningEffort` and `reasoningEffort` on eleven records, no
  other field changed) and the frozen fixture `packages/types/src/__tests__/__fixtures__/claude-model-tables.json`
- `src/api/transform/reasoning.ts` (`getAnthropicEffort`)
- `src/api/providers/anthropic.ts`, `src/api/providers/anthropic-vertex.ts`, `src/api/providers/bedrock/request.ts`
- `webview-ui/src/components/settings/ThinkingBudget.tsx`
- `webview-ui/src/i18n/locales/*/settings.json` (`providers.reasoningEffort.modelDefault` and
  `providers.reasoningEffort.anthropicHint`, all 18 locales)
- tests: `reasoning.spec.ts`, `model-params.spec.ts`, `anthropic.spec.ts`, `anthropic-vertex.spec.ts`,
  `bedrock/__tests__/request.spec.ts`, `ThinkingBudget.spec.tsx`

## Symptom

For Claude models the settings showed only the thinking on/off toggle (and the budget sliders on the older
models). No effort level was ever sent: `AnthropicHandler.createMessage` passed `reasoningEffort: undefined` into
`getAnthropicProviderReasoning`, which only builds the `thinking` field. On Opus 5.5, Sonnet 5.5 and Fable 5.x
thinking cannot be disabled, so the toggle did nothing there and the user had no depth control at all.

## API facts used (Anthropic docs, 2026-10)

- Effort is GA without a beta header: `output_config: { effort: "low" | "medium" | "high" | "xhigh" | "max" }`.
  Omitting it runs the model default.
- Levels: Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5.5, Sonnet 5 (and Haiku 5.5): all five.
  Opus 4.6 and Sonnet 4.6: low, medium, high, max. Opus 4.5: low, medium, high. Sonnet 4.5, Sonnet 4, Opus 4,
  Haiku 4.5: not supported, a request with the field fails with 400.
- Default: `high`, except Opus 5.5 and Haiku 5.5 (`medium`).
- Opus 5 rejects `thinking: {type: "disabled"}` at xhigh and max. We never send `disabled`: the toggle off omits
  `thinking`, which Opus 5 runs as adaptive, so every level is safe.
- Changing the effort in the middle of a task invalidates the prompt cache for the next request (the request
  prefix changes). Accepted; the hint under the select says so.

## What was happening

- `ModelInfo` already had `supportsReasoningEffort: boolean | string[]` and a default `reasoningEffort`, but no
  Claude record set them, and no model had both a thinking toggle (`supportsReasoningBinary` or
  `supportsReasoningBudget`) and effort levels.
- `getModelParams` (`src/api/transform/model-params.ts`) prefers the budget path when
  `shouldUseReasoningBudget` holds (toggle on), and `shouldUseReasoningEffort` returns false when the toggle is
  off. So routing Claude effort through `getModelParams` would tie it to the toggle, which is wrong for Opus 5.5.
- The generic effort select in `ThinkingBudget.tsx` writes the shown value back on render and forces
  `enableReasoningEffort = true` for every level except "disable". Applied to Claude it would have switched
  thinking on by itself.

## Fix

- Data: the Claude records get the level list and the default. Eleven records: `opus-5-5` (five levels, default
  medium), `opus-5`, `sonnet-5-5`, `sonnet-5`, `opus-4-8`, `opus-4-7`, `fable-5-1`, `fable-5` (five levels,
  high), `opus-4-6`, `sonnet-4-6` (low, medium, high, max; high), `opus-4-5` (low, medium, high; high).
  `sonnet-4-5`, `sonnet-4`, `opus-4`, `haiku-4-5` get nothing. The Anthropic, Vertex and Bedrock tables spread
  the records, so all three pick the fields up.
- Request: `getAnthropicEffort({ model, settings })` returns the stored `reasoningEffort` only when the model's
  `supportsReasoningEffort` array contains it and it is one of the five API levels; otherwise undefined. It does
  not read the thinking toggle. Unset means omit, so the API runs the model default; the model's
  `reasoningEffort` field is only what the UI shows as preselected.
- Invalid carried values: a level stored for another model ("minimal", "none", "disable", "xhigh" on Opus 4.6,
  "max" on Opus 4.5) is dropped by `getAnthropicEffort` (same idea as the level check in `getGeminiReasoning`,
  but falling back to omitting the field rather than to the model default, which gives the same result on the
  wire). The UI shows the model default for it and writes nothing back.
- Anthropic handler: `output_config` is spread into both the cached and the uncached request and into
  `completePromptWithUsage`. The installed `@anthropic-ai/sdk` 0.128 types `OutputConfig.effort`, so no cast.
- Vertex handler: `getModel()` returns `effort`; `createMessage` and `completePromptWithUsage` spread
  `output_config` the same way.
- Bedrock (`buildThinkingFields`): the Converse request already carried `additionalModelRequestFields.output_config`
  with a hardcoded `xhigh` for adaptive models. Now a chosen valid level replaces that `xhigh`; with no choice the
  `xhigh` stays (no change for existing Bedrock users). A chosen level is also sent next to budget thinking
  (Opus 4.6, Sonnet 4.6, Opus 4.5) and alone when thinking is off. `anthropic_version` is still only added when
  `thinking` is present (`thinkingEnabled` now checks `fields.thinking`, not the whole object).
- UI (`ThinkingBudget.tsx`): a model with a thinking toggle and an effort array (`hasAnthropicEffort`) renders a
  "Model Reasoning Effort" select under the toggle (binary branch) or under the budget sliders (budget branch). It
  is visible with thinking on and off. Options are exactly the model's levels; the model default is labelled
  "High (model default)". Choosing a level writes only `reasoningEffort`; nothing is written on render. A hint
  explains that the level applies with reasoning off as well and that a change mid-task rebuilds the prompt cache.
  The two write-back effects of the generic select now run only when `usesEffortSelect` (effort support and not
  the Claude case). The component keeps its existing props (`apiConfiguration` / `setApiConfigurationField`, the
  `cachedState` buffer of `SettingsView`).

## Unchanged on purpose

- `getModelParams`, `shouldUseReasoningEffort` and `shouldUseReasoningBudget`. With the toggle on, budget models
  still get `budget_tokens` (pinned by a new `model-params.spec.ts` case), the binary models still get
  `{type: "adaptive"}`, and the max-token caps do not change. When the toggle is unset `getModelParams` now fills
  `params.reasoningEffort` from the model default for Claude records; no Anthropic, Vertex or Bedrock request
  reads that field, the effort is taken from `getAnthropicEffort` only.
- `TaskApiLoop` request capture reports `apiConfiguration.reasoningEffort` as before.

## CLI

- The CLI writes `reasoningEffort` from `--reasoning-effort`, else `models.<id>.reasoningEffort` in
  cli-settings.json, else the CLI default "medium" (all providers except `openai`), together with
  `enableReasoningEffort = true`. Its level list is `reasoningEffortsExtended`, which includes xhigh and max, so
  every Claude level can be chosen and `/model` keeps the per-model value. An invalid level for the model is
  dropped by the handler.
- Behaviour change to note: the CLI default "medium" now reaches Claude. Before, the anthropic, vertex and
  bedrock providers ignored it; now Claude models that default to high run at medium in the CLI unless the user
  sets a level (`--reasoning-effort high` or `models.<id>.reasoningEffort`). If that is not wanted, the fix is to
  make `resolveReasoningEffort` (`apps/cli/src/lib/utils/provider-config.ts`) keep thinking on but leave the level
  unset for those three providers. Not done here; left for the owner to decide.

## Bedrock and Vertex caveats

- Not verified against the live services. Vertex documents `output_config.effort` for Claude. On Bedrock the
  adaptive models already received `output_config` before this change; sending it to Opus 4.6, Sonnet 4.6 and
  Opus 4.5 happens only when the user picks a level explicitly.
- Bedrock with no choice keeps sending `xhigh` when thinking is on, while the select shows the model default
  (high). The difference predates this change; aligning it would change the depth for existing Bedrock users.

## Tests

- `reasoning.spec.ts`: valid level per model family, independent of the toggle, unset omitted, five carried
  invalid values dropped, Sonnet 4.5 and Haiku 4.5 never get the field.
- `model-params.spec.ts`: Opus 4.6 keeps `budget_tokens`, the 1.0 temperature and the hybrid max tokens with the
  toggle on and a level stored; toggle off sends no budget.
- `anthropic.spec.ts`: effort with the toggle off (Opus 5.5), next to adaptive (Opus 4.7), next to budget
  (Opus 4.6), absent when unset, absent for four carried invalid values, absent for Sonnet 4.5 and Haiku 4.5,
  present in `completePrompt`.
- `anthropic-vertex.spec.ts`: adaptive plus level, toggle off plus level, unset, invalid and unsupported omitted,
  `completePrompt`.
- `bedrock/__tests__/request.spec.ts`: chosen level replaces xhigh, invalid keeps xhigh, effort alone when thinking
  is off, effort next to budget thinking, nothing for a model without levels, and the payload without thinking
  has no `anthropic_version`.
- `ThinkingBudget.spec.tsx`: select next to the binary and the budget toggle with thinking off, exact level list,
  stored level shown, carried invalid level shows the default without writes, no automatic toggle change, a
  choice writes only `reasoningEffort`, the default label, no select for Sonnet 4.5.

## For the lead after rebasing on `feat/anthropic-models-2026-10`

Add to the `haiku-5-5` record in `claude.ts`, right after its `supportsReasoningBudget: true,` line:

```ts
supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
reasoningEffort: "medium",
```

and the same two keys to every `claude-haiku-5-5` entry of the frozen fixture (anthropic, vertex and bedrock
tables, whichever carry it). If the Haiku 5.5 record has no `supportsReasoningBinary` and no
`supportsReasoningBudget`, the settings UI falls back to the generic effort select instead of the Claude one; give it
the same thinking flags as Sonnet 5.5 in that case.
