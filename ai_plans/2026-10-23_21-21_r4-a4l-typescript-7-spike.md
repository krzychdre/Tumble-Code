# r4 A4l: TypeScript 7.0.2 spike (not adopted)

**Status:** spike done, TypeScript stays on 6.0.3. No code change.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item A4l).

## Touched files

- This document only.

## What was measured

Each workspace's type check, run one after the other on the same tree (main at the ink 8 merge, #993), with
the root `typescript` 6.0.3 and with `typescript` 7.0.2 installed in a scratch directory. Same command for both:
`tsc -p <tsconfig> --noEmit --pretty false` (plus `--noUnusedLocals` for `src`, as
`scripts/check-unused-locals.mjs` does). TypeScript 7 ran with its default of 4 type-checker workers.

| Workspace                    | 6.0.3 (s) | 7.0.2 (s) | Diagnostics                 |
| ---------------------------- | --------: | --------: | --------------------------- |
| `apps/cli`                   |       5.7 |      0.97 | 0 / 0                       |
| `apps/vscode-e2e`            |       2.4 |      0.57 | 0 / 0                       |
| `packages/agent-interchange` |       1.6 |      0.22 | 0 / 0                       |
| `packages/build`             |       1.0 |      0.13 | 0 / 0                       |
| `packages/cloud`             |       3.2 |      0.68 | 0 / 0                       |
| `packages/core`              |       3.5 |      0.68 | 0 / 0                       |
| `packages/telemetry`         |       2.4 |      0.53 | 0 / 0                       |
| `packages/types`             |       3.7 |      0.86 | 0 / 0                       |
| `packages/vscode-shim`       |       1.5 |      0.17 | 0 / 0                       |
| `src` (with unused locals)   |      20.6 |      3.83 | 256 / 256, all unused-local |
| `webview-ui`                 |      14.2 |      1.90 | 0 / 0                       |
| **Total**                    |  **59.8** |  **10.5** | about 5.7x faster           |

The `src` diagnostics are the same 256 unused-local findings (the folders outside the opt-in list); 7.0.2 reports
some of them at the identifier's column instead of the statement's, which `check-unused-locals.mjs` does not
read. No tsconfig needed a change: the repository already builds on 6.0's defaults.

## Blockers

- **typescript-eslint 8.72.0 refuses TypeScript 7.0.** Its peer range is `typescript >=4.8.4 <6.1.0`, and with
  7.0.2 installed it throws at load time: "typescript-eslint does not support TS 7.0", pointing at
  typescript-eslint#10940, which tracks support for TS 7.1 and newer. Checked in a scratch project with
  eslint 10.13.0: both the plain `recommended` config (what this repository uses; it has no type-aware rules)
  and `recommendedTypeChecked` fail the same way. So every `pnpm lint` and the pre-commit hook would break.
- **TypeScript 7.0 ships no compiler API** (its package exports only `unstable/*` entry points). Other tools that
  import `typescript` as a library would need the 6.0 API too: tsup's declaration build in `apps/cli` and
  `packages/types`.

## Way forward

- The TypeScript team's interim answer is to run both side by side: `typescript` aliased to
  `@typescript/typescript6` for the tools that need the API, and `typescript@7` under another name
  (`@typescript/native`) for `tsc`. That is a dependency alias plus a second compiler for every developer, for a
  saving of about 50 s of CPU per full type check, which turbo's cache already hides most of the time. Not worth it
  while the gate is "typescript-eslint supports TS 7".
- Re-run this spike when typescript-eslint releases support for TypeScript 7.1 (typescript-eslint#10940) and 7.1
  is stable (7.1.0-beta came out on 2026-10-20). The measuring loop is small: for each workspace above, the same
  `tsc` command with each compiler, timed, diagnostics counted.
