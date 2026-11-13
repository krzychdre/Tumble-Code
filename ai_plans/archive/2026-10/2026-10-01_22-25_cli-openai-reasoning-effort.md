# CLI: reasoning effort never reaches the openai provider

Status: done (branch `fix/cli-openai-reasoning-effort`), item A4 of `ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

- `apps/cli/src/lib/utils/provider-config.ts`
- `apps/cli/src/lib/utils/__tests__/provider-config.test.ts`
- `apps/cli/src/commands/cli/__tests__/run.test.ts`
- `apps/cli/src/__tests__/__snapshots__/argument-parser.test.ts.snap`
- `apps/cli/src/main.ts` (help text)
- `apps/cli/README.md`
- `.changeset/cli-openai-reasoning-effort.md`

## Problem

`toProviderSettings` (`apps/cli/src/lib/utils/provider-config.ts`, before the fix lines 165-181) set
`enableReasoningEffort: true` and `reasoningEffort`, but for the `openai` provider it wrote
`openAiCustomModelInfo` as `openAiModelInfoSaneDefaults` plus a context window, or `null`. Neither carries
`supportsReasoningEffort` nor `reasoningEffort`. The openai handler (`src/api/providers/openai.ts`, `getModel` via
`resolveOpenAiModel` and `getModelParams`) asks `shouldUseReasoningEffort`
(`packages/core/src/api/model-options.ts:47-82`), which returns false when the model info has neither the
capability nor a default effort ("Ignore settings-only selections when capability is absent/false"). So every effort
the CLI configured was dropped, and for GLM models served through the openai provider `addGLMThinkingIfNeeded`
even turned thinking off. The README admitted it ("the CLI cannot set it yet").

## Fix

- `toProviderSettings`: when an effort other than `disabled`/`unspecified` is configured and the provider is `openai`,
  `openAiCustomModelInfo` becomes `openAiModelInfoSaneDefaults` (+ the configured context window) with
  `supportsReasoningEffort: true` and `reasoningEffort: <effort>`. The second field also feeds the o-series path of
  the handler, which reads `modelInfo.reasoningEffort` directly, and matches where the settings UI stores the effort.
  `disabled` keeps `enableReasoningEffort: false` and `unspecified` sends nothing; both leave the model info `null`
  (or sized only), so nothing is sent.
- `resolveProviderConfig`: the built-in default effort is `unspecified` for the `openai` provider instead of
  `medium`. Without this the fix would start sending `reasoning_effort: medium` to every OpenAI-compatible server on
  every run, and many servers and non-reasoning models reject the field. Before the fix the default had no effect
  there, so the default behaviour is unchanged; only an explicitly configured effort (flag, settings file or a
  `modes` entry) now reaches the model. Other providers keep `medium`.
- Help text and README note updated.

## Tests

- `provider-config.test.ts`: the openai model info carries the effort and `shouldUseReasoningEffort` returns true for
  it (fails before the fix); `disabled`/`unspecified` give `null` model info and false; the openai default is
  `unspecified`, other providers keep `medium` (fails before the fix).
- `run.test.ts`: per-mode and context-window expectations now include the effort fields.
- Help snapshot updated for the new help text.

## Notes / caveats

- A user who configured an effort for a model that rejects `reasoning_effort` will now get an API error where the
  value used to be silently ignored. That is the intended "explicit means sent" behaviour; the README says so.
