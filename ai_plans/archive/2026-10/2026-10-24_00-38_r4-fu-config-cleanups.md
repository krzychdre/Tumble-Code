# r4 follow-up: config cleanups and a green dependency audit

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")

## Touched files

- `.prettierrc.json`
- `scripts/audit-allowlist.mjs`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`

## Problem

- `.prettierrc.json` carried an `ignore` key. Prettier has no such option and prints "Ignored unknown option"
  on every run; ignored paths come from `.gitignore` and `.prettierignore`.
- The audit allowlist accepted `GHSA-qjx8-664m-686j` for `js-cookie`, but the lockfile resolves `js-cookie`
  3.0.8 and the advisory is no longer reported.
- `pnpm audit --prod | node scripts/audit-gate.mjs` failed on two new high advisories:
  `GHSA-27r3-jxmh-p828` (`body-parser` 2.3.0, patched in 2.4.0, reached through `@modelcontextprotocol/sdk` and
  `express`) and `GHSA-mrhx-c7xc-m3w5` (`zod` below 4.6.6, reached only through the zod 3 copy that the
  `@lmstudio/sdk>zod` override keeps for `@lmstudio/sdk` 2.1.0).
- The `brace-expansion: ^2.0.2` and `glob: ^13.0.6` overrides forced one major on every consumer, including
  `glob` 7 users such as `rimraf` 2 and `archiver-utils`.

## Change

- Drop the `ignore` key from `.prettierrc.json`.
- Replace the `js-cookie` allowlist entry with one for `GHSA-mrhx-c7xc-m3w5`: no zod 3 release is patched, the
  affected copy only validates replies of the user's own LM Studio server, and the entry expires 2026-12-31.
- `pnpm update -r body-parser` (2.3.0 to 2.4.0, inside `express`'s `^2.3.0`).
- Remove the two overrides. The lockfile then resolves `brace-expansion` 1.1.21, 2.1.7 and 5.0.12 and `glob`
  7.2.3, 10.5.0 and 13.0.6. Every `brace-expansion` advisory up to `GHSA-q2hr-2g5m-vwhr` is patched in 1.1.21,
  2.1.7 and 5.0.12; `GHSA-5j98-mcp5-4vw2` (`glob` CLI) affects only 10.2.0 to 10.4.x and 11.0.x.

## Tests

- `npx prettier --list-different .` lists the same 53 files before and after the `.prettierrc.json` change.
- `pnpm audit --prod --json | node scripts/audit-gate.mjs`: failed before, passes after.
- `pnpm audit --json` (dev included) reports no `brace-expansion` or `glob` advisory.
- `src` specs for xlsx extraction (`exceljs` uses `archiver`) and `services/mcp`: 272 passed.
- `pnpm knip` exits 0.

## Notes

- The dev-only audit findings (`serialize-javascript`, `browserslist`, `launch-editor`) are outside the
  `--prod` gate and unchanged.
