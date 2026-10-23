# r4: follow-redirects 1.16.1 and DOMPurify 3.4.17 (dependency audit gate)

**Status:** done on `chore/r4-audit-follow-redirects-dompurify`.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`,
`ai_plans/2026-10-23_21-03_r4-a4k-pnpm-12.md` (where the red gate was found).

## Touched files

- `pnpm-lock.yaml` only.

## Problem

`pnpm audit --prod --json | node scripts/audit-gate.mjs` failed on main (pnpm 10.8.1 and 12.15.0 alike) with
four advisories published after the last lockfile change: GHSA-q3jh-wrc6-jgq8 and GHSA-8r9p-f939-6h3c
(`follow-redirects` 1.16.0, through axios) and GHSA-cg2g-xh64-v4q7 (critical) and GHSA-mrv2-3pqr-j5jr
(`dompurify` 3.4.16, webview).

## Change

`pnpm update -r --depth Infinity follow-redirects dompurify`: both are transitive and their parents' ranges
already accept the fixed versions, so only the lockfile moves (follow-redirects 1.16.1 from 2026-10-01,
dompurify 3.4.17 from 2026-10-12, both older than pnpm's one-day release age). The other lockfile lines are
pnpm re-keying peer suffixes (`supports-color`) for follow-redirects' optional `debug` peer; no other version
changes.

## Tests

- `pnpm install --frozen-lockfile`; the audit gate prints "No unaccepted high or critical advisories".
