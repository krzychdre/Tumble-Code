# Glossary of plan IDs used in code comments (E1)

Status: done (PR open, not merged)

## Touched files

- `docs/plan-ids.md` (new)
- `docs/README.md`, `docs/architecture.md` (one link each)

## Problem

About 900 code comments, test names and docs on `main` name plan items (`CORE-R3` alone 154 times, `API-7` 71,
`DEF-C*` and `DEF-S*` about 200, plus bare roadmap IDs such as `P9`, `R11`, `D11`). Most of them come from the
2026-09-24 refactor plan, which lives only on the unmerged branch `docs/refactor-plan-2026-09-24`, so a reader of
`main` cannot resolve them. Some short IDs also collide: `WS-1` to `WS-8` were used by two July plans, and bare
`D3`, `D4`, `P1`, `P8` mean something else in three files.

## Fix

`docs/plan-ids.md` lists every ID found outside `ai_plans/` and `CHANGELOG.md`: the ID, one sentence on what it was,
and the pull request(s) (from the merge commit subjects on `main`, or from the plan's status notes). The colliding
IDs get their own section. Code comments are not rewritten in this PR.

Search used (git grep, so ignored folders are skipped):

    git grep -ohE "\b(CORE-R[0-9]+|DEF-[CSP][0-9]+|API-[0-9]+|WS-[A-Z0-9]+|WEB-[0-9]+|PKG-[0-9]+|CB-[0-9]+|SVC-[0-9]+|TEST-[0-9]+|CAPI-M[0-9]+|CLI-F?[0-9]+|DEP-[0-9]+|TL-[0-9]+)\b" -- ':!ai_plans' ':!**/CHANGELOG.md'

plus a manual pass over the bare `D`, `P`, `R`, `S`, `F` numbers in comments (test data such as `task: "P3"`,
`DeepSeek-R1`, the `F5` key and priority words like "memory is P3" were left out).

## Tests

Docs only. A loop checked that every ID from the search has a row; Prettier applied.

## Notes

- The refactor plan branch exists only in the owner's clone (`git ls-remote origin` does not list it).
- The page links four July/August plans by their current path. If the `ai_plans/` archive move (E2) lands after
  this, its reference check must include `docs/plan-ids.md`.
