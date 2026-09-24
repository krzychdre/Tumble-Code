# Zoo #1349 port: reasoning effort select honours the model's declared default

**Status:** ported (one commit on wip/zoo-agent-c, on top of the #774 port)
**Upstream:** Zoo-Code PR #1349, commit 4c7474d42, merged 2026-09-06 (authors Roomote, Elliott de Launay)
**Touched:** webview-ui/src/components/settings/ThinkingBudget.tsx, webview-ui/src/components/settings/__tests__/ThinkingBudget.spec.tsx

## Symptom

Pick a model whose reasoning is optional but which declares a default effort, for example
DeepSeek V4 Flash/Pro (`reasoningEffort: "high"`, options include "disable"). The settings
dropdown shows "None". If the profile still carries `enableReasoningEffort: false` from an
earlier model (for example a binary "Use reasoning" toggle left off), DeepSeek really stops
thinking (`src/api/providers/deepseek.ts:35` checks that flag) and the UI gives no hint that the
model's default is "high".

## Root cause in our code

- `ThinkingBudget.tsx` computed the UI default as
  `requiredReasoningEffort ? (modelDefault || "medium") : "disable"`, so a declared default was
  ignored for optional reasoning. The backend does the opposite: `getModelParams`
  (`src/api/transform/model-params.ts:134-139`) and `shouldUseReasoningEffort`
  (`src/shared/api.ts:51`) fall back to `model.reasoningEffort` when the setting is unset. The UI
  and the request disagreed.
- The write-back effect only ran for required models with nothing stored, so a stale stored value
  (one the model does not offer, which `shouldUseReasoningEffort` then rejects, dropping
  reasoning) stayed stored while the #774 clamp showed something else.

## Fix

- Default = `modelInfo.reasoningEffort ?? (required ? "medium" : "disable")`, matching the backend.
- The effect writes the shown value back whenever it differs from the stored one and is not
  "disable". The existing sync effect then sets `enableReasoningEffort = true`.
- Kept the `isUserAction = false` flag on that write (Zoo dropped it): Save still sends the
  cached value, and just opening settings on an unset profile does not raise an
  "unsaved changes" prompt. A stale stored value still marks settings dirty because it really changes.

## Tests

5 new cases in `ThinkingBudget.spec.tsx` ("model default and normalization"). Before the fix 3
failed: a DeepSeek-like model showed "disable" instead of "high"; a stale "max" on a required
model was never replaced by "medium"; an explicit `["low","high"]` model with nothing stored
never stored "low". Two guard cases passed before and after (explicit "disable" is preserved, a
model with no declared default stays off without writes). After: 31/31; all settings specs
357/357 (incl. SettingsView change detection and ApiOptions); webview tsc clean; eslint clean.

## Not ported

- NanoGPT provider changes and its spec: we have no NanoGPT provider.
- Zoo's SettingsView change-detection test for a user-action write: our write keeps the
  non-user flag on purpose (see Fix).
