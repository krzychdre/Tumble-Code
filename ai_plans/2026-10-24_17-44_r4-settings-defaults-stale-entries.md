# r4: settings-defaults gate reports stale allowlist entries

Status: done

Related plans: `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`,
`ai_plans/2026-10-24_17-43_r4-settings-defaults-allowlist-key.md`

## Touched files

- `scripts/check-settings-defaults.mjs`
- `scripts/__tests__/check-settings-defaults.test.mjs`

## Problem

An `ALLOWED` entry whose exception was fixed or deleted stayed in the table and silently allowed the same
fallback to come back later in that file. The `src/extension/api.ts` entry lived on that way after its code
started reading `SETTINGS_DEFAULTS`.

## Change

`scan` returns the `ALLOWED` ids that matched no occurrence as `stale`, next to `violations`. The CLI lists
them under "ALLOWED entries that match nothing" and exits 1 when there are violations or stale entries.

## Tests

- New case: with the real `ComposerToolbar.tsx` exception present its entry is not stale; once the fallback is
  removed from that file the entry is reported as stale. The real-tree case asserts `stale` is empty.
- Mutation checks: never reporting stale ids turns the new case red; inverting the filter turns the new case and
  the real-tree case red; a mistyped entry on the real repo makes the CLI print it and exit 1.
- `node --test 'scripts/__tests__/*.test.mjs'` (51 pass) and `node scripts/check-settings-defaults.mjs` (clean).
