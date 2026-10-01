# Zoo PR #317 — Gemini: honor custom model ids instead of falling back to default

- **Upstream:** Zoo-Code #317 (refs #227), commit `cef0cc342`, merged 2026-05-26 19:46:17Z, author Armando Vaquera.
- **Branch:** `feature/zoo-317-gemini-custom-model-id` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`.

## Problem

`GeminiHandler.getModel()` resolved the model id with
`modelId && modelId in geminiModels ? modelId : geminiDefaultModelId`. Two bugs:

1. **Custom ids silently swapped.** Selecting a custom Gemini model id not present
   in `geminiModels` (e.g. `gemini-3.5-flash`) silently invoked
   `geminiDefaultModelId`. The settings ModelPicker exposes a "use custom model"
   option and `useSelectedModel` keeps the configured id — so the UI and the actual
   request disagreed.
2. **Prototype-key false positive.** `modelId in geminiModels` is true for inherited
   `Object.prototype` keys (e.g. `"toString"`), which would resolve `info` to a
   function rather than a `ModelInfo`.

## Fix (`src/api/providers/gemini.ts`, `getModel()`)

Replace the single ternary with a three-branch resolution:

1. **Known id** — `Object.hasOwn(geminiModels, modelId)`: use it as-is. The own-property
   check fixes bug #2 (prototype keys like `toString` fall through).
2. **Custom Gemini id** — `modelId.toLowerCase().startsWith("gemini-")`: honor the
   configured id (fixes bug #1). Baseline `info` off the default model's structural
   info, but drop `inputPrice`/`outputPrice`/`cacheReadsPrice`/`cacheWritesPrice`/`tiers`
   so cost reports "unknown" (calculateCost → undefined) rather than charging the
   default model's rates against a different model.
3. **Otherwise** — fall back to `geminiDefaultModelId`.

`id` becomes `let id: string` (a custom id is not a `GeminiModelId`). The existing
fork-specific post-processing (apply_diff/edit tool preferences, `:thinking` suffix
stripping) is unchanged and runs after the new block.

## Tests (`src/api/providers/__tests__/gemini.spec.ts`, `describe("getModel")`)

Insert after "should return default model if invalid model specified":

- "should honor a custom gemini model id not present in geminiModels (#227)" — asserts
  `id === "gemini-3.5-flash"`, `info` defined, and all pricing/tiers fields undefined.
- "should not treat Object prototype keys as known models" — `apiModelId: "toString"`
  resolves to the default model with `info` defined.

## Scope / skip

No changeset (fork port workflow omits them). Product + tests only; reuses existing
`geminiModels`/`geminiDefaultModelId`. No dependency changes.

## Verification

- `npx vitest run api/providers/__tests__/gemini.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
