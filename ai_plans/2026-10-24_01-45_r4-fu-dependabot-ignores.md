# r4 follow-up: Dependabot #1023 to #1026

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")
- `ai_plans/2026-10-23_20-39_r4-a4g-small-majors.md` (dotenvx deferral)

## Touched files

- `.github/dependabot.yml`

## Problem and findings

- #1023, `@dotenvx/dotenvx` 1.66.0 to 1.75.1: `pnpm turbo run bundle` on the PR branch (one commit behind
  `main`, no source difference) grows `src/dist/extension.js` from 24,465,022 to 25,617,470 bytes (+1.1 MB)
  and bundles `systeminformation`, which `main` does not contain. The only user is `src/extension.ts`, which
  loads an optional development `.env`.
- #1024, `web-tree-sitter` 0.25.6 to 0.27.1: the bundle fails, because the runtime is now
  `web-tree-sitter.wasm` instead of `tree-sitter.wasm` (`packages/build/src/esbuild.ts`). With the copy
  pointed at the new name for a trial run, 59 of the 69 tree-sitter and code-index parser spec files fail in
  `getDylinkMetadata` (101 tests), with the `tree-sitter-wasms` 0.1.12 grammars of that branch as well.
- #1026, `tree-sitter-wasms` 0.1.13 with `web-tree-sitter` 0.25.6: `services/tree-sitter`,
  `services/code-index/processors` and `__tests__/dist_assets.spec.ts` against a fresh bundle pass (391
  passed, the 12 skipped are the static Swift skips). Merged.
- #1025, `undici` 7.30.1: `networkProxy` specs, the Qdrant wire spec and provider wire specs (75 passed),
  `tsc` for `src`, `pnpm knip`. Merged.

## Change

`.github/dependabot.yml` ignores `@dotenvx/dotenvx` `>=1.75.0` and `web-tree-sitter` `>=0.26.0`. #1023 and
#1024 are closed with a comment.

## Tests

`pnpm install --frozen-lockfile` on `main` after both merges; no code changed.
