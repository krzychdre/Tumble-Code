# Port Zoo PR #225 — configure knip + remove dead dependencies

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #225, commit `8ea077942`, merged 2026-06-08.
- Original author: Elliott de Launay (roomote[bot] / renovate[bot] dropped as bots).
- Commit trailer:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## §1 What & why

Upgrade the knip config (schema v5, per-workspace `ignoreDependencies`, rules,
`ignoreExportsUsedInFile`) and remove dependencies knip flagged as dead.

**Divergence guard (critical):** "dead in Zoo" ≠ "dead in our fork." Every removed
dependency was independently verified UNUSED in _our_ code before removal (grep
for imports + a scripts/config audit). The knip `ignoreDependencies` lists were
checked against our actual dep set (src 16/16, webview 10/11 — we lack `vscode`,
so it was dropped from our webview list).

## §2 Edits (exact, verified)

### Dead deps removed from `src/package.json` (all verified zero-usage here)

- `@openrouter/ai-sdk-provider` — zero refs repo-wide; our `openrouter.ts` uses
  `@anthropic-ai/sdk`, not this package.
- `@vscode/test-electron` — `apps/vscode-e2e` declares its own; src's is unused.
- `npm-run-all2` — no script uses `run-p`/`run-s`/`npm-run-all`.
- `tsup` — src builds via esbuild; only `apps/cli` uses tsup (has its own).
- `tsx` — only `apps/cli` scripts use it (was hoisted from src) → moved to cli.
- `zod-to-ts` — zero imports.

### `apps/cli/package.json`

- Add `"tsx": "^4.19.3"` (cli scripts `dev`/`test:integration` use it; previously
  resolved via hoist from src).

### `webview-ui/package.json` + delete `webview-ui/src/types.d.ts`

- Remove `knuth-shuffle-seeded` (only referenced by the now-deleted `types.d.ts`
  module declaration; no real import) and `identity-obj-proxy` (no config uses it).
- Delete `webview-ui/src/types.d.ts` (contained only the knuth-shuffle declaration).

### `package.json`

- `"knip": "knip --include files"` → `"knip": "knip"`.

### `knip.json` (adapted to our fork)

- Port Zoo's new structure verbatim where deps match; **dropped** `vscode` from the
  webview `ignoreDependencies` (we don't declare it); **added** `self-hosted-cloudapi/**`
  to top-level `ignore` (our fork has that extra Docker/Python sub-project Zoo lacks).

## §3 Scope cuts (YAGNI / divergence)

- Did NOT add `@vitest/coverage-v8` to src or cli (neither runs coverage here; Zoo
  already had it — we don't, and don't need it).
- Did NOT re-order posthog-js/lucide-react in webview (cosmetic).
- Did NOT add `packages/evals` to knip workspaces (faithful to upstream's new config).
- Did NOT re-add Roo branding / TTS / router / cloud.

## §4 Verify (binary acceptance)

- `pnpm install` succeeds after removals. ✓
- `pnpm --filter tumble-code check-types` / `@roo-code/vscode-webview` /
  `@roo-code/cli` → all pass (tsc resolves every import; a removed-but-used dep
  would error "cannot find module"). ✓
- `tsx` bin resolves for `apps/cli`. ✓
- Note: `pnpm knip` cannot complete on this machine — it crashes traversing the
  root-owned (uid 70, mode 700) `self-hosted-cloudapi/.vol/postgres` Docker volume
  with EACCES. Confirmed this happens with the OLD config too → pre-existing local
  environment issue, independent of this change. The knip config itself parses
  (knip reaches file traversal past config validation).

## §5 Co-author — see §0.
