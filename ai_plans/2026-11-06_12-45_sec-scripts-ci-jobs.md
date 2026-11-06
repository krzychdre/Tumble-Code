# Bootstrap pins pnpm; CodeQL covers Python; the translations job installs nothing

**Status:** done on `fix/sec-scripts`
**Related:** `private_docs/security-audit-2026-11-06/report.md` section 6 (P-7, P-12, PO-2)
**Touched:** `scripts/bootstrap.mjs`, `package.json`, `.github/workflows/codeql.yml`, `.github/workflows/code-qa.yml`

## Problems and causes

- **P-12.** `scripts/bootstrap.mjs` (the `preinstall` hook, for people who run `npm install`) installed `pnpm` at
  whatever version npm resolved, although the root manifest pins `packageManager: pnpm@12.15.0`. Its
  `ensurePackageJson` was dead: lifecycle scripts and `install:all` run in the repository root, which always has a
  `package.json`. The root manifest also ran the script a second time as the `install` hook.
- **P-7.** `codeql.yml` analyzed only `javascript-typescript`; the 249 Python files of `self-hosted-cloudapi/` had no
  static analysis.
- **PO-2.** `check-translations` ran a full `pnpm install` for `scripts/find-missing-translations.js`, which requires
  only `fs` and `path`.

## Fix

- Bootstrap installs `packageManager` from the root manifest (`npm install --no-save pnpm@12.15.0`);
  `ensurePackageJson` and the duplicate `install` script are gone.
- CodeQL matrix gains `python` with `build-mode: none`.
- `check-translations` has no setup step; the runner's preinstalled Node.js runs the script.

## Tests

`actionlint` 1.7.12 on all workflows. `npm install --no-save pnpm@12.15.0 --dry-run` resolves the pinned spec;
`node --check scripts/bootstrap.mjs`.
