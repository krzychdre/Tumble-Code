# CLI: the tail viewport's stale height scrolls the finished answer off the screen

**Date:** 2026-09-21
**Branch:** `fix/cli-tail-viewport-stale-height` (forked from `main` = `ce2c52c9c`, the
first main that contains the CLI stack, PR #166)
**Status:** implemented, verified with byte captures before and after

Writing and coding rule for every implementer of this plan: never use an em dash
or an en dash anywhere (code, comments, tests, commit messages, UI strings). Use a
hyphen, a comma, a colon or parentheses. Existing files still contain em dashes in
old comments; do not add new ones and do not rewrite old ones outside the lines
you touch.

## Problem

User report (installed build `0.2.0-local.ce2c52c9c`, GNOME Terminal 51x211,
model GLM-5.3 on a local llama.cpp): when the model finishes an answer, the CLI
"clears the existing window and wants to answer from a new line", and once "it
cleared everything and did not answer at all".

## Evidence

### Session forensics (task `01a0c547-8c99-7255-80db-e56788725631`)

- Every answer of the session is present and complete in `ui_messages.json`
  (`say: completion_result`, `partial: false`), so the answers were produced and
  delivered to the TUI; the loss is in what the terminal shows.
- No message of the six newest CLI tasks contains an ESC byte, so the
  "raw clear-screen sequence inside tool output" hypothesis is refuted for
  these sessions.
- After the last answer (23 lines, finalized 20:44:53.919) the user typed `?`
  48 s later and then pressed Escape (`api_req_started` carries
  `cancelReason: "user_cancelled"`, followed by `ask: resume_task`). That is a
  user probing an empty screen, not the model clearing anything.

### Byte capture (the proof)

`/tmp/tumble-record/driver.py` drives the installed `tumble` in a pseudo
terminal (pexpect), answers approval dialogs, and records every byte with
timestamps; `/tmp/tumble-record/trace.py` replays the bytes through pyte (a
terminal emulator in Python) and dumps the screen around every large
`eraseLines` run. Recording of the OLD build at 40x150, end of turn 0 (the
model answered with an 18-line `completion_result`):

1. `t=44.70 s`: the dynamic tail fills rows 0-38 (39 rows, the hard cap
   `rows - 2` plus the spinner row), cursor on row 39. Ink promotes the finished
   turn into `<Static>` and, as its `onRender` does for new static output, runs
   `log.clear()` = `eraseLines(39)`, writes the promoted transcript (63 rows:
   tool results and the answer), then writes the next dynamic frame.
2. That next frame is 38 rows tall although its content is only the input box
   (5 rows): 33 blank rows above the box. Writing it pushes 63 + 33 rows into
   scrollback; pyte's history grows from 5 to 68 rows in this one step. The
   screen now shows the LAST line of the answer on row 0, blank rows 1-34, the
   input box on rows 35-38.
3. `t=44.71 s`: the viewport has re-measured, the frame shrinks to 5 rows, ink's
   incremental renderer emits `eraseLines(34)` + `cursorUp(5)` and redraws the
   input box on rows 2-5. Final screen: one answer line on row 0, the prompt
   right under it, 33 empty rows below. The rest of the answer sits above the
   window, in scrollback.

That is exactly "the window got cleared and the prompt is at the top". When the
last promoted item is not the answer's last line (the `attempt_completion` tool
row that `handleAskMessage` appends after every `completion_result`), row 0
shows that row instead and the answer is entirely out of sight: "cleared
everything and did not answer".

## Root cause

`apps/cli/src/ui/components/TailViewport.tsx` (before this fix) capped the tail
by measuring the content in a `useEffect` after each commit and feeding the
result back through state as a fixed `height` on the outer `Box`
(`justifyContent="flex-end"`, `overflowY="hidden"`). The 2026-08-07 addendum
assumed "the one-frame lag after a content jump only affects which rows are
clipped, the cap itself always holds". The cap holds, but the fixed height also
sets a FLOOR for one frame: when the content collapses (idle promotion moves the
whole tail into `<Static>`), the next frame still has the previous, full-screen
height, and `flex-end` fills the top with blank rows. Ink writes that frame
directly after the promoted transcript, so the tall blank frame scrolls the
freshly printed answer off the screen.

## Fix

Replace the measured fixed height with a yoga max-height on the outer box
(ink 6.6.0 exposes no `maxHeight` prop on `Box`, so the call goes through the
`DOMElement.yogaNode` that ink hands out through the ref). With a max-height the
box is never taller than its content, so there is no filler frame and nothing
to lag. `flex-end` still bottom-anchors an overflowing tail, `flexShrink={0}` on
the inner box still makes it overflow instead of squashing.

Timing detail found while implementing (recorded because it is not obvious):
ink computes the layout and writes the frame in the reconciler's
`resetAfterCommit`, and React runs that hook AFTER the mutation phase but BEFORE
layout effects. A `useLayoutEffect` therefore sees the layout of the frame that
was already written (probe: `getComputedHeight()` returned 10 for a 4-row cap).
Hence two hooks:

- `useInsertionEffect` (mutation phase, before the layout) re-applies the cap on
  updates, so a cap decrease (terminal shrink) takes effect in the same frame;
- `useLayoutEffect` applies the cap on mount, when the node did not exist before
  the commit, and forces one extra commit only if that first frame exceeded the
  cap. In the app the viewport mounts once, with a tiny tail, so this path is a
  safety net.

Files:

- `apps/cli/src/ui/components/TailViewport.tsx`: the change above.
- `apps/cli/src/ui/components/__tests__/TailViewport.test.tsx`: the regression
  test "shrinks with the content in the same frame" (every frame after the
  collapse must be exactly the short content; the old code produced
  `"\n\n\nonly"`), plus "applies a lower maxRows in the same frame" and the
  mount case (at most one uncapped frame, corrected in the same tick).

## Verification

- `pnpm vitest run src/ui/components/__tests__/TailViewport.test.tsx` in
  `apps/cli`: the new shrink test fails on the old implementation
  (`"\n\n\nonly"` received) and passes on the new one.
- `apps/cli`: `pnpm check-types`, `pnpm lint` clean; `pnpm test` 683 passed,
  1 skipped.
- Root `pnpm knip`: exit 0.
- Byte capture of the NEW build with the same driver: see the addendum below
  for the numbers.

## Residuals (not fixed here, recorded so they are not rediscovered)

- The very first frame after a `TailViewport` mount is laid out without the
  cap (React limitation above). It is corrected one commit later; it only
  matters if the viewport ever mounts with a tall tail (today: only after the
  `error` early return in `App.tsx` clears).
- `sanitizeContent` (`apps/cli/src/ui/components/tools/utils.ts`) strips tabs
  and carriage returns only; an ESC sequence inside tool output would reach the
  terminal unfiltered. Not the cause of this report (no ESC byte in any message
  of the analysed sessions), but a latent gap.
- The approval dialog draws six blank rows inside its border (the `SelectList`
  reserves `maxVisible = 8` rows for two items). Cosmetic, separate.
