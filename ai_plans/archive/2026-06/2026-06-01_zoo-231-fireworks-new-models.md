# Zoo PR #231 — Fireworks: add glm-5.1, kimi-k2.6, deepseek-v4-pro models

- **Upstream:** Zoo-Code #231 (refs #198), commit `78d3dac9b`, merged 2026-05-27 (commit 14:15:33Z — last of the 05-27 group by `%cI`, after #213/#239/#212), authors Armando Vaquera + edelauna.
- **Branch:** `feature/zoo-231-fireworks-new-models` (off `main`).
- **Credit:**
    - `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`
    - `Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>`

## What this PR is

Adds three models to the Fireworks provider (issue #198):

- `accounts/fireworks/models/kimi-k2p6` — ctx 262144, in 0.95 / out 4.0 / cacheReads 0.16, images+cache
- `accounts/fireworks/models/deepseek-v4-pro` — ctx 1048576, in 1.74 / out 3.48 / cacheReads 0.14, no images, cache
- `accounts/fireworks/models/glm-5p1` — ctx 202752, in 1.4 / out 4.4 / cacheReads 0.26, no images, cache

Each is added both to the `FireworksModelId` union (after its closest sibling: kimi-k2p5,
deepseek-v3p2, glm-4p7) and to the `fireworksModels` record. Metadata mirrors the closest
existing family sibling with corrected context windows / pricing per the follow-up commit.

## Changes

- `packages/types/src/providers/fireworks.ts`: +3 union members, +3 model entries (+36 lines).
- `src/api/providers/__tests__/fireworks.spec.ts`: +1 parameterized `it.each` (3 cases)
  asserting each new model is defined, has the expected ctx/pricing, and is selectable via
  `new FireworksHandler({ apiModelId }).getModel().id`.

## Fork compatibility (verified)

Both files were byte-identical to the upstream parent (anchor models kimi-k2p5 /
deepseek-v3p2 / glm-4p7 all present), so the upstream patch applies cleanly via
`git apply` with zero fuzz. No Tumble rename (provider model IDs are vendor strings).

## Scope / skip

No changeset (fork port workflow omits them). Types + test only.

## Verification

- `npx vitest run api/providers/__tests__/fireworks.spec.ts` (from `src/`) — 31 pass.
- Build gate: `pnpm install:vsix -y --editor=code` (rebuilds `@roo-code/types`) must be green.
