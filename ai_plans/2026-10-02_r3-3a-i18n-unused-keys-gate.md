# R3-3a: CI gate for unused i18n keys

Item R3-3a of the simplification round-3 audit
(`ai_plans/simplification_round3_audit_2026-10-02.md`). Branch:
`chore/r3-3a-i18n-unused-keys-ci-gate`.

## What

1. Wired the existing `scripts/find-unused-i18n-keys.mjs` into CI: a new
   `Check for unused i18n keys` step in the `knip` job of
   `.github/workflows/code-qa.yml`, right after the
   `check-settings-defaults.mjs` step, running
   `node scripts/find-unused-i18n-keys.mjs --check`.
2. Deleted the one key the scan reported as unused — `common:ui.close` —
   from all 18 locale `common.json` files via the script's own
   `--write` mode (it removes the key from every locale, matching by
   plural base, and drops objects left empty). `common:ui.close` was
   unreferenced everywhere; `common:mermaid.buttons.close` and the
   `ui.search_placeholder` / `ui.no_results` siblings are still used and
   were untouched.

## Why

The unused-keys scan existed but only ran locally on demand; nothing
stopped a new unused key from landing on main. The `--missing` mode
(keys used but absent) was already enforced through the script's tests;
the mirror-image check (keys defined but never used) now has the same
status. Dead translation keys are deleted, not silenced — there is no
allowlist to grow.

The gate starts green because the deletion ships in the same PR.

## How

- The script's bare mode only lists candidates; only `--check`
  (`scripts/find-unused-i18n-keys.mjs:404`) exits 1. No script behavior
  was changed — this item is CI wiring plus the one key deletion only.
- Key deletion follows the established route: `node
scripts/find-unused-i18n-keys.mjs --write`, which rewrites every
  locale file it finds, so `find-missing-translations.js` (the
  completeness check) stays satisfied — all locales lose the key
  together.

## Test evidence

- `node scripts/find-unused-i18n-keys.mjs --check` → `Scanned 2567
source files, 1467 English keys, 0 unused.`, exit 0.
- `node --test scripts/__tests__/find-unused-i18n-keys.test.mjs` → all
  tests pass (the suite exercises the missing-keys mode against the
  real repo).
- `node scripts/find-missing-translations.js` → exit 0 (locale
  completeness unaffected).
- `pnpm knip` → no new findings from this change.
- `grep -rn "find-unused-i18n-keys" .github` shows the new step with
  `--check`.
