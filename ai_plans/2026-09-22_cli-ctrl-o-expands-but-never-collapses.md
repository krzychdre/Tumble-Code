# ctrl+o expands the transcript but never collapses it

## The report

Pressing ctrl+o prints the whole transcript again, expanded, under the copy
that is already there. Pressing it again does nothing visible, so there is no
way back to the compact view without starting a new session.

## Why the way back was missing

The transcript lives in ink's `<Static>` region, which prints every item once
into native terminal scrollback and never rewrites it. Expanding therefore
could not edit what was on screen; it had to print a second copy, which is what
bumping `transcriptReprintEpoch` (part of the `<Static>` key) does.

Collapsing deliberately did nothing, and the old comment in `uiStateStore.ts`
says why: a reprint in that direction "would duplicate the transcript for no
gain". That reasoning is right as far as it goes. It just leaves the shortcut
working in one direction only.

## The decision

The user picked, out of two offered options, the one that makes ctrl+o a real
toggle: **each press clears the terminal (screen and scrollback) and prints the
transcript again at the new verbosity.** The rejected alternative was to append
a collapsed copy under the expanded one, which destroys nothing but leaves a
pile of copies in the buffer after a few presses.

What this costs, stated plainly: whatever was in the terminal before the CLI
started is wiped too. Nothing of the session is lost, because the transcript is
reprinted in full immediately afterwards.

## How it works

1. `useGlobalInput` writes `CLEAR_TERMINAL` through ink's `useStdout().write`,
   then toggles.
2. `toggleVerboseTranscript` now bumps `transcriptReprintEpoch` in BOTH
   directions, so the `<Static>` key changes either way and ink reprints.
3. The reprint lands on an empty screen, so "print it again" stops meaning "one
   more copy" and starts meaning "the only copy".

The wipe must come first, exactly as in `/clear`: the reprint is a consequence
of the state change, so a wipe after it would erase what it just printed.

`CLEAR_TERMINAL` moves out of `useTaskSubmit.ts` into `ui/utils/clearTerminal.ts`,
shared by its two callers. It keeps the warning it was written with: this
sequence may only ever go through `useStdout().write`, which is ink's
`writeToStdout` (erase the live frame, write, reprint the frame). A raw write to
`process.stdout` is the VSCode-panel-resize bug that `useTerminalSize.ts` still
carries a comment about, where every later frame rendered at the top of the
screen.

## The head of a reprint

A reprint used to open with a fixed divider, `-- expanded transcript (ctrl+o to
collapse) --`, because it always was an expansion. It now names the verbosity it
is printing at and the way back out of it, so a collapsed reprint reads
`-- collapsed transcript (ctrl+o to expand) --`.

The welcome banner also comes back at the head of every reprint, which used to
be forbidden on the grounds that "the banner already sits in scrollback above
and repeating it would read as a second session start". The wipe removes that
grounds: the banner is gone, and the reprint is the only thing that can put the
session's context (workspace, provider, model, mode) back on screen. Press
ctrl+o once on a fresh session and, without this, the banner would be wiped for
good.

That in turn forces a second change. `welcomeProps` in `App.tsx` was frozen on
first render, so a reprinted banner would have restated the mode and model the
session OPENED with, not the ones in force now, and modes change mid-session
(shift+tab). The memo now tracks its inputs. This cannot disturb the banner
already in scrollback, because ink prints a `<Static>` item once and never
rewrites it; the props only ever decide what a printing that has not happened
yet will say.

## Files

- `ui/utils/clearTerminal.ts`: new home of the escape sequence.
- `ui/hooks/useTaskSubmit.ts`: imports it instead of declaring it.
- `ui/hooks/useGlobalInput.ts`: the wipe on ctrl+o.
- `ui/stores/uiStateStore.ts`: the epoch bumps in both directions.
- `ui/transcript.ts`: the banner heads every printing, the label follows the
  verbosity.
- `ui/App.tsx`: `welcomeProps` stops being a first-render snapshot.
- `lib/utils/input.ts` and `components/autocomplete/triggers/HelpTrigger.tsx`:
  the shortcut's description said "to expand", which was true and is now half
  the truth.

## Tests

- `useGlobalInput.test.tsx` (new): ctrl+o expands then collapses; the epoch is
  bumped in both directions; the clear sequence reaches stdout; the wipe is
  written BEFORE the state change.
- `uiStateStore.test.ts`: the "turning verbose off leaves the epoch untouched"
  case is inverted, because that was the bug.
- `transcript.test.ts`: the reprint head is banner plus verbosity header, and
  the label names the verbosity and its way out.

## Verified in a pty, not only against the fake stdout

Unit tests render into `ink-testing-library`'s stub, which cannot show whether
ink keeps painting in the right place after a clear. That is the half of this
change with a history of going wrong, so the sequence was also reproduced in a
real pty (pexpect + pyte, 24x90) with a minimal ink app of the same shape: a
`<Static>` region of 20 messages that grow from one line to three when
expanded, a ticking dynamic tail and a prompt line below it, and ctrl+o wired to
`write(CLEAR_TERMINAL)` followed by the state change.

See the appendix below for the captured screens.
