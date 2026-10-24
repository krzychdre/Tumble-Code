# r4: settings-defaults allowlist keyed by expression, not line

Status: done

Related plans: `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`

## Touched files

- `scripts/check-settings-defaults.mjs`
- `scripts/__tests__/check-settings-defaults.test.mjs`

## Problem

The D2 gate (`check-settings-defaults.mjs`, run in the knip job of `code-qa.yml`) allowed its justified
exceptions by `file:line`. Any edit above an exception moved the line and turned the gate red on unrelated
changes (#1044 shifted `ApiConfigManager.tsx`; #1046 had to re-key 135 to 137). The `src/extension/api.ts:358`
entry pointed at a blank line: the code there already reads `SETTINGS_DEFAULTS`.

## Change

`ALLOWED` maps `"<file>: <expression>"` to a reason, where the expression is the matched fallback without the
`,`/`(`/`{` anchor and the `obj?.` receiver (for example `currentApiConfigName || ""`). The violation report
prints the same expression, so a new justified exception is copied from the report. Each entry allows one
occurrence per file: a second identical fallback in the same file is a violation. The dead `api.ts` entry is
removed.

## Tests

- New case: an allowlisted expression (real `ComposerToolbar.tsx` entry) stays green with lines added above it,
  and a second occurrence in the same file is reported with its line and expression.
- Mutation checks: dropping the once-per-file rule turns the new case red; going back to `file:line` ids turns
  the new case and the real-tree case red; keeping the `?.` receiver in the expression turns the real-tree case red.
- `node --test 'scripts/__tests__/*.test.mjs'` (50 pass) and `node scripts/check-settings-defaults.mjs` on the repo (clean).

## Notes

The gate does not report allowlist entries that no longer match anything (it did not with line keys either); the
stale `api.ts` entry shows such a check would have value. It is left as a separate proposal.
