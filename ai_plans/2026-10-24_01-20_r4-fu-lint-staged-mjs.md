# r4 follow-up: lint-staged formats .mjs and .cjs

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")

## Touched files

- `package.json` (`lint-staged`)
- six scripts under `scripts/` (formatting only)

## Problem

The `lint-staged` glob `*.{js,jsx,ts,tsx,json,css,md}` left `.mjs` and `.cjs` out, so the pre-commit hook never
formatted them and six scripts drifted from Prettier.

## Change

The glob is `*.{js,mjs,cjs,jsx,ts,tsx,json,css,md}`. `prettier --write` on the six files that
`prettier --list-different '**/*.{mjs,cjs}'` reported: `scripts/check-settings-defaults.mjs`,
`scripts/find-test-only-exports.mjs`, `scripts/find-unused-i18n-keys.mjs` and the specs
`check-settings-defaults`, `check-webview-radius` and `find-test-only-exports` in `scripts/__tests__/`.

## Tests

`node --test 'scripts/__tests__/*.test.mjs'`: 49 passed before and after. `prettier --list-different` on
`**/*.{mjs,cjs}` is empty afterwards.
