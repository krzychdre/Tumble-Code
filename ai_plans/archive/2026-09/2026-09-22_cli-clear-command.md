# `/clear`: a new conversation on a clean screen

## Why

`/new` already resets the task, but it leaves the whole previous conversation on
screen and in the terminal's scrollback. What the user asks for when they want a
fresh start is both halves: drop the context the model carries, and clear the
screen so the new conversation starts on a blank page.

`/new` keeps its current behaviour (useful when you want the old transcript
still readable above); `/clear` is the "wipe it" variant.

## What `/clear` does

1. Wipes the terminal, scrollback included.
2. Resets the CLI store, the seen-message ids and the first-text-skipped flag,
   sends `clearTask` to the extension host and re-requests commands and modes.
   This is exactly the `/new` path, shared as one function rather than copied.
3. Remounts the `<Static>` region so the welcome banner prints again, which is
   the confirmation that the clear happened and re-states workspace, model and
   mode on an otherwise empty screen.

## Wiping the screen without breaking ink

Raw escape codes written behind ink's back are a known trap in this codebase:
`useTerminalSize.ts:35` carries a comment from the VSCode-panel-resize bug where
a bare `\x1b[2J\x1b[H` made every later frame render at the top of the screen,
because ink positions each frame relative to the previous one.

The supported route is `useStdout().write`, which is ink's `writeToStdout`
(`ink/build/ink.js:210`): it erases the live frame with `log.clear()`, writes
the payload, then reprints the frame through `log()`, so ink's cursor
bookkeeping stays true. The payload is the same sequence `ansi-escapes` uses for
`clearTerminal`, inlined rather than adding a dependency the packaged CLI would
have to resolve at install time: `\x1b[2J\x1b[3J\x1b[H` everywhere except
Windows, where it is `\x1b[2J\x1b[0f`.

The wipe runs _before_ the store reset, so the banner that the reset's re-render
prints lands on the cleared screen instead of being wiped by it.

Residual, documented rather than fixed: ink accumulates every `<Static>` line it
ever printed in its private `fullStaticOutput`, and reprints all of it in the
`lastOutputHeight >= rows` branch (`ink.js:181`). A cleared conversation could
therefore reappear if that branch ever ran. It is unreachable here by
construction, because `TailViewport` caps the dynamic tail at `rows - 2`, which
is exactly why that clamp exists.

## The promotion watermark has to be reset too, and today it is not

`App.tsx` keeps `prevStaticCount`, a monotonic high-water mark of how many
messages have been promoted into `<Static>`, so a message can never fall back
out of scrollback. On a store reset the watermark is never lowered:

```
reset()        → messages: []      effect: length is 0, so the else branch runs,
                                   prevStaticCount stays at (say) 20
first message  → messages: [m1]    prevIds is [], so this counts as an
                                   "extension", else branch again, watermark 20
render         → effectiveStaticCount = max(20, staticCount) = 20
                 staticMessages = messages.slice(0, 20) = [m1]
```

So the first messages of the next task are promoted into scrollback
_immediately_, including a `partial` one that is still streaming. That is the
failure the promotion rule exists to prevent (a streaming tail baked into
scrollback cannot be re-rendered, which is the 2026-09-21 "answer rendered
twice" family). `/clear` would inherit it, and `/new` has it today.

The fix is one clause: an empty transcript resets the watermark to zero. The
rule is extracted from the effect into `nextPromotion()` in `transcript.ts` so
it can be stated and tested on its own:

| transcript vs. what was printed          | remount `<Static>` | watermark     |
| ---------------------------------------- | ------------------ | ------------- |
| empty (store was reset)                  | no                 | 0             |
| diverged (task switch, ids do not match) | yes                | 0             |
| an extension of the printed prefix       | no                 | max(old, new) |

## Files

- `lib/utils/commands.ts`: `/clear` with a new `clearConversation` action, and
  `/new`'s description reworded so the difference between the two is visible in
  the picker.
- `ui/stores/uiStateStore.ts`: `transcriptClearEpoch` plus `clearTranscript()`,
  which bumps it and resets `transcriptReprintEpoch` to 0 (after a clear there
  is no earlier printing to distinguish a reprint from, so the `<Static>` head
  is the welcome banner again, not the ctrl+o divider).
- `ui/hooks/useTaskSubmit.ts`: the shared reset, the new action, the wipe.
- `ui/App.tsx`: the clear epoch joins the `<Static>` key; the promotion effect
  calls `nextPromotion()`.
- `ui/transcript.ts`: `nextPromotion()`.

## Tests

- `transcript.test.ts`: the three promotion cases above, including "an empty
  transcript drops the watermark" and "the next message after a reset is not
  promoted while it is still streaming".
- `useTaskSubmit.test.tsx`: `/clear` empties the store, sends `clearTask` plus
  the two re-requests, bumps the clear epoch, and writes the clear sequence to
  stdout; `/new` does all of that except the wipe and the epoch bump.
- `commands.test.ts`: `/clear` is offered by the autocomplete and resolves to
  the new action.
- `uiStateStore.test.ts`: `clearTranscript()` bumps one epoch and zeroes the
  other.

The `/clear` wipe assertion was checked for being vacuous: replacing
`write(CLEAR_TERMINAL)` with a no-op fails exactly that one test and nothing
else.

## Verified in a real terminal, not only against the fake stdout

Unit tests render to `ink-testing-library`'s stub, which cannot show whether ink
keeps painting in the right place afterwards, and that is the half of this
change with a history of going wrong. So the sequence was reproduced in a pty
(`pexpect` + `pyte`, 24x90) with a minimal ink app of the same shape: a
`<Static>` region of 25 lines, a dynamic tail below it, then `useStdout().write`
of the clear sequence, a bumped `<Static>` key and a one-item transcript, then a
dynamic tail that keeps ticking for another two seconds.

```
before                     after                       settled (12 more frames)
 0|OLD-LINE-4               0|BANNER-AFTER-CLEAR        0|BANNER-AFTER-CLEAR
 ...                        1|TAIL tick=5               1|TAIL tick=12
20|OLD-LINE-24              2|PROMPT >                  2|PROMPT >
21|TAIL tick=1
22|PROMPT >
```

Both things that matter hold: the old transcript is gone with no leftover rows,
and the tail keeps redrawing in place afterwards instead of walking up the
screen, which is what the raw-escape version of this did in the
VSCode-panel-resize bug.
