# CLI Bash rows print twice and a "collapsed" output fills the screen

## The report

A screenshot of a web research task (curl against DuckDuckGo and vendor pages)
showed three things in the transcript:

1. Every `Bash(curl …)` row appeared twice: first a copy with a grey bullet and
   either no output or the first two rows of it, then the real row with a
   green bullet and the full output.
2. Single characters sat alone at column 0 between output rows (`b` under a
   DuckDuckGo URL, `S` under the acse.pl page).
3. The acse.pl output, one 4000-character line, took about twenty rows even
   though the row was collapsed and should have said "… +N lines (ctrl+o)".

## What it was not

- **Not two messages.** `ui_messages.json` of the task has the known four
  messages per execution (`ask: command`, partial `say: command_output`, empty
  `ask: command_output`, final `say: command_output` under a new ts), and
  `useMessageHandlers` already routes both outputs to one row. The second
  `Bash` row on screen matches the final output exactly (20 lines = 5 shown +
  "+15 lines"); the first one matches no message.
- **Not the tail outgrowing the terminal.** A command whose first chunk wraps
  into more rows than the terminal has left no duplicate: `TailViewport` clips
  the tail to `rows - 2`, the header was clipped, not scrolled away.
- **Not the `CSI E` bottom-row bug** (`fix/cli-incremental-render-ghost-rows`,
  still unmerged). The recording that reproduced the duplicates executed
  `CSI E` on the bottom row zero times.

## Root cause

`ResultRow` lays out the `  ⎿  ` connector (a `Text`) and the body (a
`flexGrow` column) side by side. When the body is wider than the row, yoga
shrinks every flex item of the row in proportion, and the connector, which had
no `flexShrink={0}`, got 4 columns instead of 5. Ink prints all 5 anyway, so the
body starts at the right column but is one column too wide. Measured with
`ink-testing-library` at 100 columns: rows of 101 columns; with
`flexShrink={0}`: 100.

In a real terminal a 101-column row auto-wraps its last character onto a row of
its own (the lone `b` and `S`). Ink does not know about that row. When the
running command's row sits in the dynamic tail and ink erases the tail (to
print a promoted message into `<Static>`), it moves up as many rows as it
thinks the frame has, so the top rows of the frame stay on screen. The top of
the tail is the running `Bash(…)` header with its grey (running) bullet: one
overflowing row leaves the header alone, three leave the header and two output
rows, exactly as in the screenshot.

Reproduction (pexpect + pyte, installed build, 30x160, auto-approve): three
commands printing `N` + 450 × `x`, a 3 s sleep, then `koniec-N`. As installed:
every header twice, a lone `x` after each wrapped row. Branch build: every
header once, no lone characters.

## The second defect: collapsed means 5 lines, not 5 rows

`ResultRow` capped the body at `maxLines` logical lines and let each line wrap.
A 4000-character line is one line and twenty rows, so the collapsed row was as
tall as the expanded one.

## The fix

- `ElbowGutter` (exported from `ResultRow.tsx`) wraps the connector in a
  `Box flexShrink={0}`. `SearchTool` (match rows, whose context can be long)
  and the `FileWriteTool` diff preview (not affected today, its band is cut
  before layout) use it instead of their own copies.
- A capped `ResultRow` renders each visible line as its own `Text` with
  `wrap="truncate-end"`, so a line costs exactly one row and ends in `…` when
  cut. A blank line renders as a space, because an empty `Text` has no row.
  Uncapped (ctrl+o, `maxLines = Infinity`) keeps the single wrapping `Text`.

Every `ResultRow` caller benefits: file reads, searches, edits, the mode
switch and the generic tool row, not only Bash.

## Tests

- `CommandTool.test.tsx` "row geometry": no row wider than 100 columns in
  either mode (fails without `flexShrink={0}`), a collapsed row is exactly one
  row per line, expanded output keeps every character.
- `FileWriteTool.test.tsx`: a 300-character diff line stays within 100 columns.

## Left open

- The `CSI E` bottom-row drift is a separate bug with a finished fix on
  `fix/cli-incremental-render-ghost-rows` (1572d3605), never merged. In the
  recordings for this plan it ate the "… +N lines" row under a command.
- `<previous line repeated 3 additional times>` comes from the core's
  `Terminal.compressTerminalOutput`, not from the CLI, and is left as is.
