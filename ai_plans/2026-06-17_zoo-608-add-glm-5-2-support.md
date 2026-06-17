# Port plan — Zoo PR #608 → `feature/zoo-608-add-glm-5-2-support`

> **For the executor (read first).** Do the steps in order. Do not improvise or
> refactor beyond what is written (YAGNI). Every code block is already adapted to
> this repo. This repo is **Tumble Code**: never introduce the strings "Roo" or
> "Zoo" in user-facing text or test names.

---

## 0. Context

- **Upstream:** Zoo PR #608 — "feat: add glm-5.2 support" (commit `085bc7f57`,
  merged 2026-06-15).
- **What it does:** Adds the `glm-5.2` model (Zhipu's flagship, 1M context) to
  both Z.ai model maps with a new **"max"** reasoning-effort tier on top of the
  existing ladder. `high` is the model default and `max` is opt-in. Also hardens
  the Z.ai handler so a persisted reasoning-effort value the _current_ model
  doesn't support falls back to that model's default instead of silently
  disabling reasoning, and wraps the streaming `create()` in `handleOpenAIError`
  for parity with the base class.
- **Why we want it:** new model support is high-value/low-risk; the "max" tier and
  the unsupported-effort fallback are general correctness improvements that help
  every GLM thinking model, not just 5.2.

- **Adaptations vs. the raw upstream diff (IMPORTANT):**

    1. **No changeset.** Zoo's diff includes `.changeset/add-glm-5-2-support.md`.
       That is a Zoo release-prep mechanic (triage rubric → SKIP). **Do not** port
       it.
    2. **Our fork has no `glm-5-turbo`.** Zoo anchored some edits/tests around
       `glm-5-turbo`, which doesn't exist here. Anchor the new model entries after
       **`glm-5.1`** and the new streaming tests near the existing **GLM-4.7**
       thinking tests instead.
    3. **Handler shape already diverged.** Our `src/api/providers/zai.ts` already
       carries the custom `ZAiChatCompletionParams` type and `createStreamWithThinking`
       from earlier ports. The port only _adds_ the unsupported-effort fallback
       block + `reasoning_effort` param + the `try/catch` around `create()`. Our
       params comment stays `// For GLM-4.7: thinking is ON by default, so we
explicitly disable when needed` (do not adopt Zoo's wording).
    4. **`max` already half-present.** `packages/types/src/model.ts` already had
       the `xhigh`/`max` machinery in some unions; the port ensures `"max"` is in
       all three places: `reasoningEffortsExtended`, `reasoningEffortSettingValues`,
       and the `modelInfoSchema.supportsReasoningEffort` enum.

- **Original author — credit:**

    ```text
    Co-authored-by: Mob Code 100 <66469454+MobCode100@users.noreply.github.com>
    ```

## 1. Preconditions

- [x] Branch `feature/zoo-608-add-glm-5-2-support` created off
      `feature/zoo-588-extract-reasoning-from-delta-helper` (stacked — overlaps
      nothing with #588 except sharing the provider dir, so stacking keeps the
      chain clean).
- [x] `glm-5.1` exists in both Z.ai maps (anchor for the new entry).
- [x] `glm-5-turbo` confirmed absent (re-anchored, see §0 adaptation 2).

## 2. Types edits

### Edit A — `packages/types/src/model.ts`

Ensure `"max"` is present in all three reasoning-effort surfaces:

1. `reasoningEffortsExtended` → `["none", "minimal", "low", "medium", "high", "xhigh", "max"]`.
2. `reasoningEffortSettingValues` → includes `"xhigh"` and `"max"` (reformatted multiline).
3. `modelInfoSchema.supportsReasoningEffort` array enum union → ends `…, "high", "xhigh", "max"`.

### Edit B — `packages/types/src/providers/zai.ts`

Insert a `"glm-5.2"` entry **after `glm-5.1`** in BOTH `internationalZAiModels`
and `mainlandZAiModels`. Shared fields: `maxTokens: 131_072`,
`contextWindow: 1_000_000`, `supportsImages: false`, `supportsPromptCache: true`,
`supportsMaxTokens: true`, `supportsReasoningEffort: ["disable", "high", "max"]`,
`reasoningEffort: "high"`, `preserveReasoning: true`, `cacheWritesPrice: 0`, the
`// TODO: Pricing is from GLM-5.1, should update later.` comment, and the flagship
description. Pricing differs by line:

- international: `inputPrice: 1.4`, `outputPrice: 4.4`, `cacheReadsPrice: 0.26`.
- mainland: `inputPrice: 0.68`, `outputPrice: 2.28`, `cacheReadsPrice: 0.13`.

## 3. Handler edit — `src/api/providers/zai.ts`

In `createStreamWithThinking`, replace the prior effort computation with the
unsupported-effort fallback:

```ts
const supported = info.supportsReasoningEffort
const raw =
	this.options.enableReasoningEffort === false ? undefined : (this.options.reasoningEffort ?? info.reasoningEffort)
const effort =
	raw && raw !== "disable" && Array.isArray(supported) && !supported.includes(raw) ? info.reasoningEffort : raw
const reasoningEffort = effort && effort !== "disable" ? effort : undefined
const useReasoning = reasoningEffort !== undefined
```

Add `reasoning_effort: reasoningEffort,` to the params (after the `thinking` line),
widen the params type to allow `"max"` (the `ZAiChatCompletionParams` `Omit`/union),
and wrap the `create()` return in `try { … } catch (error) { throw
handleOpenAIError(error, this.providerName) }`. Add the
`import { handleOpenAIError } from "./utils/openai-error-handler"` import.

## 4. i18n — `webview-ui/src/i18n/locales/<lang>/settings.json`

Add a `"max"` key to the `reasoningEffort` block in all 18 locales, after
`"xhigh"`. Translations: ca=Màxim, de=Maximum, en=Max, es=Máximo, fr=Maximum,
hi=अधिकतम, id=Maksimum, it=Massimo, ja=最高, ko=최대, nl=Maximum, pl=Maksymalny,
pt-BR=Máximo, ru=Максимальные, tr=Maksimum, vi=Tối đa, zh-CN=最高, zh-TW=最高.

## 5. Tests — `src/api/providers/__tests__/zai.spec.ts`

- 2 model-info tests: GLM-5.2 international (ctx 1M, max 131_072, effort
  `["disable","high","max"]`, default `high`, prices 1.4/4.4/0.26) and GLM-5.2
  China (prices 0.68/2.28/0.13), anchored after the matching GLM-5.1 tests.
- 4 streaming tests near the GLM-4.7 thinking tests: (1) default → `reasoning_effort:"high"`
    - thinking enabled; (2) `reasoningEffort:"max"` → `reasoning_effort:"max"`; (3)
      `reasoningEffort:"disable"` → thinking disabled + `reasoning_effort` undefined;
      (4) unsupported `reasoningEffort:"medium"` → falls back to model default `"high"`.

## 6. Out of scope

- No `.changeset/`. No `glm-5-turbo`. No "Zoo"/"Roo" strings. No handler comment
  rewording.

## 7. Verify

- `pnpm --filter @roo-code/types check-types` clean.
- `pnpm --filter tumble-code check-types` clean.
- `cd src && npx vitest run api/providers/__tests__/zai.spec.ts` all green (46 tests).
- `cd src && npx eslint api/providers/zai.ts api/providers/__tests__/zai.spec.ts` clean.

## 8. Acceptance

- [x] `glm-5.2` present in both Z.ai maps with the "max" tier.
- [x] Handler falls back to model default when persisted effort is unsupported.
- [x] `"max"` in all 18 locales and all 3 model.ts surfaces.
- [x] No "Roo"/"Zoo" user-facing strings introduced.

## 9. Record

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record --pr 608 --status ported \
  --branch feature/zoo-608-add-glm-5-2-support \
  --plan ai_plans/2026-06-17_zoo-608-add-glm-5-2-support.md
```
