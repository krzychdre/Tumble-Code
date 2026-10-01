# ai_plans

Working documents written before and during a change: the problem with file and line evidence, the chosen fix, the
tests, and what was left out. Every non-trivial bug fix, feature or refactor gets one, usually in the same pull
request as the code. These files record why something was done; how the code works today is described in
[`docs/`](../docs/README.md), which wins when the two disagree.

## Naming

`YYYY-MM-DD_HH-MM_slug.md`, for example `2026-10-01_23-18_e2e-drop-skipped-suites.md`: the date and time the plan
was started (24-hour clock, local time) and a short kebab-case slug. Plans before 2026-09-29 mostly have the date
only (`YYYY-MM-DD_slug.md`); both forms sort by date. One plan per branch; a multi-branch effort has one overview
plan plus one per branch.

Each plan starts with a title and a `Status:` line. Update the status when the work lands (for example
`Status: done, merged as #690`).

## Archive rule

A finished plan (its work merged, abandoned or superseded) moves to `ai_plans/archive/YYYY-MM/`, by the month in its
file name, with `git mv`. Before moving, rewrite every reference to its old path in the same commit: code comments,
`docs/`, `AGENTS.md`, other plans. A plain search for the file name finds them all.

- `archive/2026-05/` to `archive/2026-09/`: the plans dated before 2026-09-20, moved on 2026-10-01. Their own status
  lines are often stale ("Draft", "In progress"), but the work they describe is on `main`: a content audit on
  2026-09-27 found every branch of that period merged, and spot checks of the stale ones on 2026-10-01 agreed.
- `archive/undated/`: older plans without a date in the name (the May `Task.ts` split, deferred tool loading, the
  July refactor plans that the 2026-09-24 refactor plan replaced).
- `archive/` itself: three analyses archived earlier.

The top level holds the plans of the last two weeks, which are almost all finished as well, and three older CLI
plans (`2026-08-04_cli-bare-run-settings-sync.md`, `2026-08-04_cli-provider-parity.md`,
`2026-08-05_cli-claude-code-style-ui-redesign.md`) that stay until the `apps/cli` comments pointing at them are next
edited.

`assets/` holds the mode definitions (`reviewer-mode.yaml`, `vision-mode.yaml`) that the reviewer and vision mode
plans deploy; they are sources, not plans.

## Open plans

| Plan                                                                           | State                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`2026-10-01_simplification-round-2.md`](2026-10-01_simplification-round-2.md) | In progress: items A to E, one pull request each. Its Status table says which are merged.                      |
| [`2026-09-28_p8-measurement.md`](2026-09-28_p8-measurement.md)                 | Parked: JSONL task persistence is not needed yet. The plan lists the measured thresholds that would reopen it. |

## Roadmaps

- [`2026-09-27_simplification-roadmap.md`](2026-09-27_simplification-roadmap.md): what the 2026-09 refactor achieved
  and the R, D, P, S, F items that followed it (all done; P8 parked, see above).
- [`2026-10-01_simplification-round-2.md`](2026-10-01_simplification-round-2.md): the next round, with the owner's
  decisions.
- [`2026-09-27_ui-modernization.md`](2026-09-27_ui-modernization.md): UI proposals for the VS Code panel, the cloud
  web panel and the CLI; its progress logs record what landed in steps 1 to 5.
- The 2026-09-24 refactor master plan (`ai_plans/2026-09-24_refactor/`) is intentionally kept on the unmerged
  branch `docs/refactor-plan-2026-09-24`; `docs/architecture.md` explains why, and `docs/plan-ids.md` says what
  each of its item IDs in the code means.
