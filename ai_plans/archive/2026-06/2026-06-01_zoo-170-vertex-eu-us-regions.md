# Zoo PR #170 — Add Vertex AI eu and us multi-region endpoints

- **Upstream:** Zoo-Code #170, commit `2e8e72ebc`, merged 2026-05-18 16:37, authors Roomote, Naved Merchant.
- **Branch:** `feature/zoo-170-vertex-eu-us-regions` (off `main`).
- **Credit:** `Co-authored-by: Roomote <roomote@roocode.com>`, `Co-authored-by: Naved Merchant <naved.merchant@gmail.com>`.

## Change

Vertex AI supports multi-region endpoints `us` and `eu` (broad regional routing) in
addition to `global` and the specific zones. Add both to the `VERTEX_REGIONS` selector
list, immediately after `global`.

Two files (pre-image matches our fork exactly):

- `packages/types/src/providers/vertex.ts` — insert `{ value: "us", label: "us" }` and
  `{ value: "eu", label: "eu" }` after the `global` entry in `VERTEX_REGIONS`.
- `webview-ui/src/components/settings/providers/__tests__/Vertex.spec.tsx` — the
  "should contain all expected regions" test asserts the literal `VERTEX_REGIONS` array;
  mirror the same two entries into the expected list.

## Approach (TDD-first)

1. Add `us`/`eu` to the expected array in `Vertex.spec.tsx`. — RED (source lacks them).
2. Add the two entries to `VERTEX_REGIONS` in `vertex.ts`. — GREEN.

## Verification

- `npx vitest run src/components/settings/providers/__tests__/Vertex.spec.tsx` → 5/5.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
