# CLI: stacked copies of the footer and the spinner (incremental render ghost rows)

Branch: `fix/cli-incremental-render-ghost-rows` (off `main` 28751cad7).

## Report

While a task runs in auto-approve mode (the default), the bottom of the
screen fills with stale copies of the footer ("? for shortcuts ... 16%",
"... 18%", "... 20%", "... 21%") and of the spinner row ("Thwack... 195s",
"Thwack... 216s"). The copies are never erased.

## Root cause (proven)

`apps/cli/src/commands/cli/run.ts` renders the TUI with
`incrementalRendering: true` (so the tail does not blink on every spinner
tick). Ink 6.6.0's incremental log-update (`build/log-update.js`,
`createIncremental`) moves the cursor up to the top of the previous frame,
then for every row either writes `cursorTo(0) + row + eraseEndLine + "\n"`
(row changed) or writes `CSI E`, Cursor Next Line (row unchanged). Its
bookkeeping assumes both moves land one row lower.

They do, except on the bottom row of the screen: `\n` scrolls there, `CSI E`
does not (VT semantics; VTE, xterm and pyte agree). When a frame grows at the
bottom edge and a row that did not change (typically an empty spacer row at
the index of the previous frame's trailing newline slot) falls below the
bottom, the skip is swallowed. The rest of the frame lands one row too high,
the cursor ends one row higher than ink believes, and every later frame starts
higher still. The rows ink no longer reaches keep old footers and spinners.
Ink 7.1.1 (latest at the time of writing) still skips rows with `CSI E`, so
upgrading would not help.

### Evidence

Recorded with `/tmp/tumble-record/driver2.py` (pexpect + pyte, the method of
`2026-09-21_cli-tail-viewport-stale-height-scrolls-answer-away.md`), real
model (GLM-5.3 on the local llama.cpp), cwd `~/sig-modbus/...`:

- `ghosts2.py` judges only settled screens (no bytes for 50 ms, so a frame
  split across two reads is never counted) and flags a screen holding the
  spinner or the footer row twice.
- `cnl_bottom.py` counts `CSI E` executed while the cursor is on the bottom
  row.
- `counterfactual.py` replays a recording and substitutes `\r\n` for exactly
  those swallowed `CSI E`.

| recording                                  | swallowed `CSI E` | settled screens with ghosts |
| ------------------------------------------ | ----------------- | --------------------------- |
| old build, manual approvals (`-a`), 17x200 | 0                 | 0 / 861                     |
| old build, auto-approve, 17x200            | 12                | 59 / 321                    |
| same recording, counterfactual replay      | (replaced)        | 0 / 321                     |
| old build, auto-approve, 17x200, run 2     | 8                 | 5 / 103                     |
| old build, auto-approve, 30x200            | 6                 | 6 / 83                      |
| new build, auto-approve, 17x200 (2 runs)   | 0                 | 0 / 275, 0 / 92             |
| new build, auto-approve, 30x200            | 0                 | 0 / 81                      |

The first ghost of the first auto-approve recording (7.39 s) follows the
first two swallowed moves (7.21 s, 7.34 s). Manual approvals hide the bug
because the approval dialog replaces the input box and the frames rarely grow
at the bottom edge between two dialog frames.

## Fix

`apps/cli/src/ui/utils/scrollSafeStdout.ts`: `createScrollSafeStdout(stream)`
returns a Proxy of `process.stdout` whose `write` replaces every `CSI E` with
`\r\n`; everything else (`columns`, `rows`, `on`/`off("resize")`, `isTTY`) is
forwarded to the real stream with methods bound to it. `run.ts` passes it to
ink as `stdout`. `\r\n` is exactly the move ink's line count describes, on
every row, so the replacement fixes the bottom row and changes nothing
elsewhere. Ink's `useStdout().write` (used by `/clear` and ctrl+o) goes
through the same stream, which is harmless.

Rejected: turning `incrementalRendering` off (brings back the full repaint
blink it was enabled to avoid); patching `node_modules/ink` (the installed CLI
resolves its dependencies fresh at package time, see the dep-skew note, so a
pnpm patch would not reach users).

## Tests

- `apps/cli/src/ui/utils/__tests__/scrollSafeStdout.test.ts`: rewrite of an
  incremental frame, untouched other output, buffer pass-through, size and
  resize events forwarded.
- The pty A/B above is the end-to-end check.

## Found along the way, handled separately

- `<Static>` rows wider than the terminal (a single character wrapped onto a
  row of its own in the transcript): branch
  `fix/cli-static-rows-overflow-width`.
- The streaming answer clamped to the last 2-3 rows of the tail ("the last
  line fills up, moves and disappears until the answer is complete"): its own
  branch.
- `Markdown.tsx` treats every line containing `|` as a table boundary and
  renders it as a tab plus an ideographic space, so table rows and any prose
  with a pipe print as an empty bullet line. Not fixed yet.
