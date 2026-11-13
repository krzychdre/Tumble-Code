# R4 G3: round-3 and AP ids in docs/plan-ids.md

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section G).

## Touched files

- `docs/plan-ids.md`

## Problem

Code and docs on `main` name `R3-2`, `R3-3a`, `R3-3b`, `R3-7` to `R3-10`, `R3-12` (simplification round 3) and
`AP-2`, `AP-4` to `AP-8` (the API-provider rows of the 2026-07-11 code review register), but `docs/plan-ids.md`
explained none of them. The bare roadmap id `R3` reads like a member of the `R3-n` family.

## Change

- "Where the plans are" points `R3-1` to `R3-12` at `ai_plans/simplification_round3_audit_2026-10-02.md` and adds
  `AP-*` to the code review register row.
- "Short IDs that mean two things" separates the roadmap's `R3` from the `R3-n` items.
- A "Simplification round 3" table lists every `R3-n` id found outside `ai_plans/` with its PR.
- The code review register table gains the `AP-n` ids found in code.

## Tests

Docs only. `git grep` of `R3-[0-9]` and `AP-[0-9]` outside `ai_plans/`, `CHANGELOG.md` and `.changeset/` gives
exactly the ids now listed; `grep -c 'R3-12\|AP-7' docs/plan-ids.md` is 3.
