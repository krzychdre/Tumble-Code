# CLI Markdown linear-time guard: a 2 s wall-clock budget flakes on CI

**Status:** done on `fix/cli-markdown-timing-budget`
**Related:** `ai_plans/2026-10-29_10-22_cli-inline-math-linear.md` (#1227), #1210, `ai_plans/2026-11-03_19-47_dependabot-round-follow-redirects.md`
**Touched:** `apps/cli/src/ui/components/__tests__/Markdown.test.tsx`

## Symptom

`platform-unit-test (ubuntu-latest)` on Dependabot PR #1240 (knip, typescript-eslint) failed on
`renders a line of unclosed \[ at once`: `expected 2013 to be less than 2000`. Nothing in that PR runs during
rendering.

## Cause

The five `renders a line of ... at once` cases guard the linear-time tokenizer of `Markdown.tsx` by rendering an
80 000 to 160 000 character line and asserting a wall-clock budget of 2000 ms. The budget was set against the
tokenizer, but most of the measured time is ink laying out the long line, which runs on a shared GitHub runner:

| Machine                          | Fixed code, per case | Old regex, escaped dollars |
| -------------------------------- | -------------------- | -------------------------- |
| this workstation                 | 213 to 445 ms        | 6204 ms                    |
| Ubuntu runner, green run on main | 869 to 1459 ms       |                            |
| Ubuntu runner, loaded (#1240)    | 2013 ms              |                            |
| Windows runner                   | 680 to 1376 ms       |                            |

A green run already used three quarters of the budget, so a loaded runner crossed it.

## Fix

The budget is 5000 ms. The regression stays red: with the pre-#1227 `INLINE_MATH` regex put back on purpose, the
escaped-dollars case took 6204 ms on this workstation (the runners are about three times slower) and failed with
`expected 6204 to be less than 5000`; the regex was then restored and all 38 Markdown tests pass.
