# Port Zoo PR #599 — add Fireworks kimi-k2p7-code model

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #599, commit `74583b55e`, merged 2026-06-20.
- Author: Povilas Kanapickas.

## §1 What & why

New model support: Fireworks `kimi-k2p7-code` (Moonshot AI coding model). Pure
additive change — no divergence concerns; our `fireworks.ts` matches the pre-PR
structure (type union, model map, neighboring deepseek-v4-pro / glm-5p1 anchors).

## §2 Edits

- `packages/types/src/providers/fireworks.ts`:
    - add `"accounts/fireworks/models/kimi-k2p7-code"` to the `FireworksModelId` union
      (after `kimi-k2p6`).
    - add its entry to `fireworksModels` (maxTokens 16384, ctx 262144, images+cache+
      reasoning+temperature, in 0.95 / out 4.0 / cacheReads 0.19), inserted after
      `deepseek-v4-pro`, before `glm-5p1` — matching upstream placement.
- `src/api/providers/__tests__/fireworks.spec.ts`: add the model-config test.

## §3 Verify (binary acceptance) — all ✓

- `pnpm --filter @roo-code/types check-types` passes.
- `npx vitest run api/providers/__tests__/fireworks` → 32 pass.
