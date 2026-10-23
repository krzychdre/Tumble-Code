# r4 follow-up: CLI follow-up countdown line states the real way to stop it

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during execution")
- `ai_plans/2026-10-24_00-35_r4-fu-cli-followup-countdown-arrows.md` (the arrow-key test)

## Touched files

- `apps/cli/src/ui/components/dialogs/FollowupDialog.tsx`
- `apps/cli/src/ui/components/dialogs/__tests__/FollowupDialog.test.tsx`
- `.changeset/r4-fu-cli-followup-cancel-text.md`

## Problem

In allow mode the follow-up dialog showed `Auto-selecting "X" in 60s` followed by an em dash and "press any key to
cancel". Only the up and down arrows stop the countdown (the `useInput` handler in `App.tsx`). The other keys the
dialog reacts to need no cancel: Enter and the digits answer at once, and picking "Type my own answer…" calls
`cancelCountdown()` and opens the input (where the countdown effect also stays off while `showCustomInput` is
set). Letters typed while the list is shown do nothing, because the list has no text field.

## Change

The line reads `Auto-selecting "X" in 60s, press an arrow key to stop`. No other user-visible string in
`apps/cli/src` contains U+2013 or U+2014; the remaining ones are in comments.

## Tests

- New `FollowupDialog` case asserts the countdown line; it fails with the old text.
- `FollowupDialog.test.tsx` and `App.characterization.test.tsx`: 15 passed, no snapshot contains the line, so none
  changed.
