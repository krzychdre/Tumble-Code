# Zoo PR #90 — Update Z.AI default model to GLM-4.7

- **Upstream:** Zoo-Code #90, commit `ea09844ae`, merged 2026-05-18 12:32, author Bryce Hoehn.
- **Branch:** `feature/zoo-90-zai-default-glm-4-7` (off `main`).
- **Credit:** `Co-authored-by: Bryce Hoehn <bryce.hoehn@icloud.com>`.

## Change

Pure default-model bump. Both Z.AI lines default to `glm-4.6`; upstream switches them to
`glm-4.7`. Two one-line edits in `packages/types/src/providers/zai.ts`:

- `internationalZAiDefaultModelId`: `"glm-4.6"` → `"glm-4.7"`
- `mainlandZAiDefaultModelId`: `"glm-4.6"` → `"glm-4.7"`

## Why it ports cleanly

The `*DefaultModelId` consts are typed `keyof typeof *ZAiModels`, so the new value must be
a defined model key. Our fork **already** ships `"glm-4.7"` entries in both
`internationalZAiModels` (line 108) and `mainlandZAiModels` (line 284) — and even has a
`"glm-5"` entry upstream lacked at this commit — so the flip type-checks with no model-table
edit. No other file hardcodes the old `glm-4.6` default; the provider/UI all read the
symbolic `*DefaultModelId`, so they follow automatically.

## Approach (TDD-first)

1. Add focused assertions in `src/api/providers/__tests__/zai.spec.ts` ("Default model ids"
   describe) pinning both `internationalZAiDefaultModelId` and `mainlandZAiDefaultModelId`
   to `"glm-4.7"` and asserting the keyed model entry is defined. (Existing default-model
   tests reference the ids symbolically, so they don't pin the value — this captures #90's
   intent.) — RED: both assert `glm-4.6`.
2. Flip the two consts in `packages/types/src/providers/zai.ts`. — GREEN.

## Verification

- `npx vitest run api/providers/__tests__/zai.spec.ts` → 35/35 (2 new + 33 existing).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
