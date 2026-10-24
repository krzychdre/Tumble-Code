# r4: drop the last minimumReleaseAgeExclude entry

Status: done

Related plans: `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (day wave, 2026-10-24)

## Touched files

- `pnpm-workspace.yaml`

## Problem

`minimumReleaseAgeExclude` held `@asamuzakjp/dom-selector@10.0.5`, locked before pnpm 12 enforced its one-day
`minimumReleaseAge`. The version was published 2026-10-23T14:26:31Z, so it is older than a day from 14:27Z on
2026-10-24 and needs no exception.

## Change

The entry, the `minimumReleaseAgeExclude` key and its comment are removed.

## Tests

- `pnpm install --frozen-lockfile` after deleting every `node_modules` in the worktree, at 14:28Z: exit 0.
