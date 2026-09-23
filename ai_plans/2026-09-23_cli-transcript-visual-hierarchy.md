# CLI: quieter tool rows, faint secondary text, visible user turns, clean start

**Status:** done on `feat/cli-transcript-visual-hierarchy` (one branch for all four points, off `main` `e2364b059`), committed, not pushed
**Related plans:** `2026-09-22_cli-bash-row-overflows-width.md` (ResultRow row geometry),
`2026-09-22_cli-clear-command.md` (clearing the screen from ink), `2026-08-05_cli-claude-code-style-ui-redesign.md` (theme)
**Touched:** `apps/cli/src/ui/theme.ts`, `apps/cli/src/ui/components/primitives/ResultRow.tsx` + new test,
`apps/cli/src/ui/components/tools/CommandTool.tsx` + test, `apps/cli/src/ui/components/tools/GenericTool.tsx` + new test,
`apps/cli/src/ui/components/messages/ThinkingMessage.tsx`, `apps/cli/src/ui/components/messages/UserMessage.tsx`,
`apps/cli/src/ui/utils/clearTerminal.ts`, `apps/cli/src/commands/cli/run.ts` + test,
`apps/cli/src/ui/components/__tests__/ChatHistoryItem.test.tsx`

## Request

From a screenshot of an Azure DevOps session in GNOME Terminal:

1. Do not display the results of Bash or MCP calls (each printed 5 or 12 lines).
2. If possible, make thinking and tool results a smaller font.
3. Give the user's messages a different colour, visible at first glance.
4. Clear the screen when the app starts.

## What was measured

**Font size (point 2) cannot be changed per row.** A terminal program sends characters and
SGR attributes; the font size belongs to the window. Only kitty has a text sizing protocol
(OSC 66). The user runs `gnome-terminal` 3.58 (VTE), which has none. The closest honest
substitute is a lower-contrast colour.

**The rows that were meant to be dim were not dim in VTE.** Tool results were drawn with
`dimColor color="#A3BABF"`. VTE applies SGR 2 (dim) only to palette colours:

```
/* Handle dim colors.  Only apply to palette colors, dimming direct RGB wouldn't make sense. */
if (attr->dim() && !(fore & VTE_RGB_COLOR_MASK(8, 8, 8))) [[unlikely]] {
        fore |= VTE_DIM_COLOR;
```

(`src/vte.cc`, GNOME/vte master, fetched 2026-09-23; the palette case scales each channel to
2/3, "magic formula taken from xterm".) GNOME Terminal exports `COLORTERM=truecolor`, so chalk
runs at level 3 and emits `38;2;163;186;191`: an RGB colour, drawn at full strength. That is
why the JSON of an MCP result in the screenshot was almost as bright as the answer.
`∴ Thinking…` used `dimColor` without a colour, i.e. the palette foreground, so it was dimmed.

**Method.** The real components were rendered with ink into a fake 110-column stdout
(`FORCE_COLOR=3 COLORTERM=truecolor`), and the ANSI frame was painted to PNG with VTE's rules
(Ubuntu profile background `#300A24`, foreground `#FFFFFF`, dim on palette colours only).
Before/after and four user-band candidates were compared on those images. Scripts:
`/tmp/cli-viz/render.mjs` and `/tmp/cli-viz/paint.py` (not committed).

## Change

- **Bash and MCP output (point 1).** `CommandTool`'s collapsed cap is `0`, and `GenericTool`
  uses `0` for `use_mcp_server` (the only tool name MCP rows carry; they are built from
  `say: mcp_server_response` in `useMessageHandlers`). `ResultRow` with `maxLines={0}` already
  printed the connector plus the tail alone, so a collapsed row is now
  `● Bash(cmd)` + `  ⎿  … +27 lines (ctrl+o)`. The counter stays on purpose: it says the call
  produced output and that ctrl+o shows it. A call without output prints the header alone.
  Expanded (ctrl+o) is unchanged: every line. Other tools (read, search, generic) keep their
  previews.
- **Faint secondary rows (point 2).** New theme key `faint: "#6D7C7F"` (2/3 of the old
  `#A3BABF`, the dim VTE would have applied to a palette colour). `ResultRow` (body, counter,
  `⎿` connector) and `ThinkingMessage` (one-liner and expanded body) use it WITHOUT `dimColor`,
  so the result is the same in VTE and in terminals that do dim RGB (xterm.js), which would
  otherwise darken it twice. Contrast on `#300A24` is about 4:1, readable when expanded.
- **User turns (point 3).** `userMessageBg` `#383a3e` (grey, close to both a grey and the
  aubergine background) becomes slate blue `#2F3E5A`; the `❯` is brand orange and bold, the
  text bold. Rejected candidates: teal `#1F4A55` (also good, more saturated) and brown
  `#4A3A1C` (reads as a warning).
- **Clean start (point 4).** `run()` writes `CLEAR_SCREEN` (`ESC[2J ESC[H`) to stdout as soon
  as it knows the interactive UI will start, before loading settings. That order matters: the
  two warnings printed before the UI (`chmod 600` on a world-readable key, an ignored
  `--terminal-shell`) come after the clear, so it never hides them. Writing to stdout directly
  is safe only because ink has not drawn a frame yet (see the comment in `useTerminalSize.ts`
  for why it is not safe later). It deliberately omits `ESC[3J`: `/clear` wipes the scrollback,
  the start must not destroy the shell history above (VTE even pushes the erased screen into
  the scrollback). Print mode never clears.

## Tests

- `CommandTool.test.tsx`: content assertions moved to the expanded view; new "hides the output
  behind a line counter when collapsed" (exactly 2 rows), "prints no counter for a command
  without output"; geometry test now "collapses to the header and the counter, however wide the
  output"; trailing newline counts `+1 line`, not `+2 lines`.
- `ResultRow.test.tsx` (new): the tail-under-body layout and the one-row-per-line cut moved
  here from `CommandTool` (they still guard read/search/generic previews); singular `line`;
  `maxLines={0}` prints exactly `  ⎿  … +3 lines (ctrl+o)`; uncapped prints no counter.
- `GenericTool.test.tsx` (new): MCP collapsed is 2 rows without the JSON; expanded prints it;
  a non-MCP tool keeps its preview.
- `ChatHistoryItem.test.tsx`: tab sanitization checked in the expanded view.
- `run.test.ts`: interactive run writes `CLEAR_SCREEN`, never `ESC[3J`, and before the
  `--terminal-shell` warning (a relative path warns on every platform); print mode never
  writes it. `ink.render` and the App are mocked; the print-mode `write` mock must call its
  callback, because print mode flushes with `write("", cb)` and waits.
- **Reverted on purpose:** cap back to 5, MCP set emptied, the clear commented out: 10 tests
  failed (all the new collapsed assertions plus the clear test); restored, all pass.
- Gates: `tsc --noEmit` 0, `eslint --max-warnings=0` 0, vitest 934 passed / 1 skipped
  (the pre-existing skip).
- **Real CLI in a pty** (pexpect + pyte, temp `HOME`, `tsup` build): with two lines printed by
  the shell first, the first bytes after them are `ESC[2J ESC[H`, no `ESC[3J` anywhere, and
  row 0 of the screen is `✻ Welcome to Tumble Code`.

## Caveats

- `dimColor` + a hex colour is still used in about 30 other places (Markdown secondary text,
  search match lines, diff context, TODO rows, SelectList descriptions, SystemMessage). All of
  them are not dim in VTE either. Out of scope here; the same `faint`-style fix applies if
  wanted.
- The onboarding screen (first run without a provider) is drawn after the clear, and the main
  UI starts below its last frame, as before.
- A failed MCP call (for example "Client does not support form elicitation") is hidden with the
  rest of the output; there is no error signal on `mcp_server_response` to colour the row.
- `.git/sequencer` held a stale cherry-pick of the two `/mcp` panel commits (from 12:38, both
  already on `main` via #186), which blocked `git switch`. Dropped with `git cherry-pick --quit`
  (sequencer state only; HEAD, index and tree untouched).
