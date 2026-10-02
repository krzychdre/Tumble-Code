# R3-1: Kill the stale `@roo/*` webview path alias

Audit item: R3-1 of `ai_plans/simplification_round3_audit_2026-10-02.md` (simplification round 3).
Branch: `refactor/r3-1-webview-alias-rename`.

## What / why

The webview imported `src/shared` through the `@roo/*` path alias — a rebrand leftover
(the repo rule is: no "RooCode"/"@roo" name anywhere). The alias was renamed to
`@shared/*`, matching the existing webview alias style (`@/*`, `@src/*` — short,
scope-named, no brand). The deeper "promote `src/shared` to a real workspace package"
variant was explicitly rejected as too large and was NOT done.

## How

- `webview-ui/tsconfig.json`: `"@roo/*": ["../src/shared/*"]` → `"@shared/*"`.
  `webview-ui/vite.config.ts` resolves through `tsconfigPaths: true`, so the build
  follows automatically.
- `webview-ui/vitest.config.ts`: `"@roo"` alias entry → `"@shared"`.
- Mechanical find-replace `@roo` → `@shared` in all import paths, `vi.mock` call
  paths, and test files under `webview-ui/src` (36 files).
- Comments referencing the alias updated: `src/eslint.config.mjs`,
  `src/__tests__/layering.spec.ts`, `packages/config-eslint/__tests__/boundaries.test.mjs`,
  `webview-ui/turbo.json`, plus `docs/architecture.md` (lines 22 and 50 — the audit
  didn't list them, but they describe the alias and would have gone stale).

## Test evidence

- `cd webview-ui && npx vitest run <touched specs> --maxWorkers=2`:
  60 test files, **807 tests, all green** (all `src/components/chat/__tests__`,
  `ModesView.import-switch`, `About`, `SkillsSettings`, `useModeSelection`).
- `cd src && npx vitest run __tests__/layering.spec.ts`: 9 tests green.
- `node --test packages/config-eslint/__tests__/boundaries.test.mjs`: 13 tests green.
- DONE criteria: `grep -rn "@roo" webview-ui/src webview-ui/tsconfig.json
webview-ui/vitest.config.ts` is empty.
- `pnpm knip`: exits 1, but **pre-existing on main** — the two "unused files" are
  untracked, gitignored local zoo-port skill scripts and the `.css` hint is a
  long-standing `knip.jsonc` note; no finding touches this diff.

## Known traps honored

- vitest mocking of i18next `t` requires TooltipProvider wrapping — no test needed
  changes, all passed as-is.
- Both alias definitions (tsconfig + vitest.config) were updated together, so build
  and tests resolve identically.
