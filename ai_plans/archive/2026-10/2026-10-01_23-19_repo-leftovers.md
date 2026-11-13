# Repo leftovers: two one-off scripts, the Roomote config, the frozen root locales (B9)

Status: done (PR open, not merged)

## Touched files

- `scripts/find-missing-i18n-key.js` (deleted)
- `scripts/bench-task-persistence.ts` (deleted)
- `.roo/roomotes.yml` (deleted)
- `locales/` (deleted: 17 languages x README, CONTRIBUTING, CODE_OF_CONDUCT)
- `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (language link blocks at the top removed)
- `.dockerignore` (`!locales/` whitelist line), `.gitattributes` (`locales/**` linguist rule)
- `ai_plans/2026-09-28_p8-measurement.md` (note where the benchmark script went)

## Problem

- `scripts/find-missing-i18n-key.js`: no `package.json` script, workflow or doc calls it (`git grep` finds only its
  own usage line). It regex-scans for `t("...")` keys and checks every locale. CI already covers the same ground
  with `scripts/find-missing-translations.js` (every locale against English, `.github/workflows/code-qa.yml:25`)
  and `scripts/find-unused-i18n-keys.mjs --missing` (literal webview keys missing from English).
- `scripts/bench-task-persistence.ts`: the one-off P8 measurement from #622 (6a758ccf3). Its numbers and the
  thresholds for re-running it live in `ai_plans/2026-09-28_p8-measurement.md`. Nothing imports or runs it.
- `.roo/roomotes.yml`: configuration for the upstream Roomote cloud service, which this fork does not use.
- `locales/`: translated README, CONTRIBUTING and CODE_OF_CONDUCT frozen at upstream v3.53, still describing Roo
  Code. The English files linked to them from their first lines.

## Fix

Delete the files and the links into `locales/`. The `.dockerignore` and `.gitattributes` rules that named the root
`locales/` folder go too. References to `src/i18n/locales` and `webview-ui/src/i18n/locales` are untouched. The P8
doc gets a sentence that the script was removed and how to restore it from git.

## Tests

- `git grep` for each deleted path and for `](locales` finds nothing left.
- `pnpm knip`: exit 0.

## Notes

`find-unused-i18n-keys.mjs --missing` checks only webview keys, so a backend `t("...")` key that is missing from
`src/i18n/locales/en` is not caught by a static script; the extension's own i18n tests and the runtime fallback
cover that case, and the deleted script was never run anyway.
