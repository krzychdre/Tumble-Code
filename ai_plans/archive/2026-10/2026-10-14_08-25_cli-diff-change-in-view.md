# CLI diff preview keeps the changed columns of a long line in view

Status: done on `fix/cli-diff-change-in-view` (cut from origin/main 6828ce7ab).

Related plans: `2026-09-22_cli-diffs-render-without-colours.md` (the coloured bands),
`2026-09-22_cli-bash-row-overflows-width.md` (why a band is cut, never wrapped).

Touched:

- `apps/cli/src/ui/components/tools/diffBand.ts` (new)
- `apps/cli/src/ui/components/tools/FileWriteTool.tsx`
- `apps/cli/src/ui/theme.ts`
- `apps/cli/src/ui/components/tools/__tests__/diffBand.test.ts` (new)
- `apps/cli/src/ui/components/tools/__tests__/FileWriteTool.test.tsx`
- `.changeset/cli-diff-change-in-view.md`

## Need

Owner report 2026-10-14, with a screenshot of the terminal UI: an `Edit` of `zdrowie/dziennik-cisnien.md` that
fixed a typo showed a removed band and an added band that read exactly the same, so the edit looked like a
duplicated line. The owner asked why the diff shows a removal before an addition "of the same line".

## What was happening

- The diff itself was right. The edited line is a 400-column sentence (line 84 of the diary, checked on disk),
  the typo was somewhere past column 300, and a unified diff shows a modified line as `-old` plus `+new`.
- `FileWriteTool.tsx` painted each diff line as one band of at most `MAX_DIFF_WIDTH` (100) columns, cutting
  the rest with an ellipsis (`bandLine`). The cut was blind: it kept columns 0..98 whatever the change was, so
  the two bands showed the identical prefix and the differing columns never reached the screen.
- A band is cut rather than wrapped on purpose: a wrapped band would spill a half-coloured second row and
  blow the dynamic tail's row budget (see the 2026-09-22 plan, D2). That constraint stays.

## Change

`diffBand.ts` is plain string work with no ink in it:

- `changeSpans(removed, added)` returns the columns between the common prefix and the common suffix of a
  pair, one span per side (a pure insertion gets an empty span on the removed side). Lines that share nothing
  get no span: a highlight over every column says no more than the band already does.
- `pairHunkLines(lines)` pairs the k-th removed line of a run with the k-th added line of the run that follows
  it, the way a unified diff lays a modification out, and records the spans. Context lines and the surplus of
  an uneven run pass through unchanged.
- `bandSegments(view, width)` builds the exactly `width`-wide band. When the line does not fit and the change
  would fall beyond the cut (fewer than 8 columns of it, or 1 for an empty span, in view), the band starts 12
  columns before the change and opens with `…` for the identical columns it skipped. Both lines of a pair share
  the same first differing column, so both bands shift by the same amount and stay aligned. The band is cut
  into `before`, `changed` and `after` so the renderer can paint the change.

`FileWriteTool.tsx` renders `changed` as a nested `<Text>` with `theme.diffAddedStrong` (`#3A8A45`) or
`theme.diffRemovedStrong` (`#AE3F50`) on top of the line's band. Checked with COLORTERM=truecolor that chalk
re-opens the band colour after the nested segment, so `after` keeps the band.

The highlight also applies when nothing is cut, so a one-character edit in a short line is visible at a glance,
as in Claude Code's word-level diff.

## Tests

- `diffBand.test.ts`: spans (prefix/suffix, insertion, no overlap, unrelated lines), pairing (runs, uneven
  runs, no pairing across context), bands (padding, cut, shift with lead context, shifted band still cut at the
  end, no shift when in view, removed side of an insertion stays aligned).
- `FileWriteTool.test.tsx`: the owner's case, a 300-column prefix and the change at the end, both rows carry
  `…` and the changed words and stay within 100 columns; a change already in view is not shifted.

## Verification

- `pnpm --filter @tumble-code/cli lint`, `check-types`, `vitest run src/ui --maxWorkers=2` (70 files, 789 tests).
- `pnpm knip` at the root.
