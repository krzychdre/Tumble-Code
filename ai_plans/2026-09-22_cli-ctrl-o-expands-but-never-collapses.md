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

## Appendix: the pty run

pexpect 4.9.0 at 24 rows by 90 columns, fed into a `pyte` 0.8.2 `HistoryScreen`,
which also models the scrollback; its `erase_in_display(how=3)` resets that
history, the same thing xterm does with `\x1b[3J`, so its line count is a
meaningful answer to "is the scrollback gone". The probe imports react 19.2.3
and ink 6.6.0 by absolute path from `apps/cli/node_modules`.

One trap ruled out first: ink has a CI mode in which it never moves the cursor,
which would have made the whole measurement vacuous. `is-in-ci` reads only `CI`
and `CONTINUOUS_INTEGRATION`, neither of which was set, so ink ran its normal
cursor-tracking path.

Collapsed (20 messages, one line each) fills the screen exactly; expanded (three
lines each) is 60 lines, so most of it has to scroll off. Screens, right
stripped, rows renumbered from 0:

```text
A  start, collapsed              B  0.8s after ctrl+o          D  0.8s after ctrl+o again
 0|MSG-01 collapsed               0|MSG-14 expanded             0|MSG-01 collapsed
 …                                1|  body line 1 of MSG-14     …
19|MSG-20 collapsed               …                            19|MSG-20 collapsed
20|TAIL tick=4                   20|  body line 2 of MSG-20     20|TAIL tick=23
21|PROMPT >                      21|TAIL tick=7                 21|PROMPT >
scrollback: 0 lines              22|PROMPT >                    scrollback: 0 lines
                                 scrollback: 39 lines
```

At B the 39 scrollback lines are MSG-01 to MSG-13 expanded and nothing else, so
screen plus scrollback is exactly 60 lines: one copy. At D the scrollback is back
to 0 and the screen holds 0 rows containing "expanded". That is the direction
that did not work before.

The tail was sampled every ~250 ms for 3 s in each state. Expanded: `TAIL tick=`
on row 21 and `PROMPT >` on row 22 in all 11 samples, cursor at (23, 0), while
the tick ran 8 to 19. Collapsed: rows 20 and 21 in all 11 samples, cursor at
(22, 0), tick 24 to 35. The tail does not walk and does not duplicate.

The raw byte stream (4004 bytes, complete) shows one toggle as:

```text
\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G   ink's log.clear(): erase the 3-row tail
\x1b[2J\x1b[3J\x1b[H                        CLEAR_TERMINAL, exactly once per toggle
TAIL tick=4\r\nPROMPT >\r\n                 ink re-logs lastOutput at the top
\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G   erased again when the new Static output arrives
MSG-01 expanded\r\n  body line 1 …          the transcript, printed once
TAIL tick=4\r\nPROMPT >\r\n                 the tail, below it
```

Counted over the whole stream: the clear triple appears twice and never in
pieces, `MSG-01 collapsed` twice (start, second toggle) and `MSG-01 expanded`
once, 40 collapsed and 60 expanded lines in total. One copy per printing, never
two. React batched the verbosity flip and the epoch bump into one render, so
`<Static>` remounted once per toggle.

The re-log in the middle of that sequence is worth knowing about: for 16 to
22 ms the previous tail sits alone at the top of an otherwise empty screen. It
is inherent to ink's `writeToStdout`, which always reprints the live frame after
a write, and it is erased before the transcript prints. On a real terminal it
can show as a faint flash at the top left. Not fixed, because fixing it means
not going through ink, which is the bug this whole design avoids.

Terminal support is the one thing the probe cannot answer: pyte honours
`\x1b[3J`, and so do xterm, VTE, kitty, alacritty and the VSCode terminal, but a
terminal that ignores it would keep the old copy reachable by scrolling up even
though the visible screen is exactly as captured. The bytes the CLI sends are
the right ones; what a given terminal does with them is outside its reach.

A geometry margin found along the way: in the expanded state the tail's trailing
newline leaves the cursor on the very last row. One row more and every tick would
scroll the screen and push a transcript row into scrollback per frame. That is
precisely what `TailViewport`'s `rows - 2` clamp in `App.tsx` exists to prevent,
and it is the thing to watch if the tail ever grows.

What the probe does not cover, stated so nobody reads more into it than it says:
it mirrors the mechanism and the geometry, not the real app, so the welcome
banner, the header item, the real `TailViewport`, the picker-close path and the
`showInfo` toast are not exercised by it.
