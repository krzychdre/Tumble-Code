# CLI: text meant to be dim was drawn at full strength in GNOME Terminal

**Status:** done on `fix/cli-dim-on-rgb-colours` (off `main` `0b3eb66ff`), NOT committed (user's request)
**Follows:** `2026-09-23_cli-transcript-visual-hierarchy.md` (found the bug, fixed it for tool results
and "∴ Thinking", left the other sites as a caveat)
**Touched:** `apps/cli/src/ui/theme.ts` (new `dimmed()`), 13 components under `apps/cli/src/ui/components/`,
new test `apps/cli/src/ui/__tests__/dimColours.test.tsx`

## The bug

ink's `<Text dimColor color="#A3BABF">` becomes SGR `38;2;163;186;191` (an RGB foreground) plus
SGR `2` (dim). VTE, the terminal library behind GNOME Terminal and Ptyxis, applies dim only to
palette colours:

```c
/* Handle dim colors.  Only apply to palette colors, dimming direct RGB wouldn't make sense. */
```

chalk sends every hex colour as RGB once `COLORTERM=truecolor`, which GNOME Terminal exports. So
every `dimColor` next to a hex colour was drawn at full strength for the user, while xterm,
alacritty, kitty, iTerm2 and xterm.js (VS Code) do dim it. `dimColor` on the default colour or
on a named one (`"cyan"`) is a palette colour and was always fine.

## Inventory

`grep dimColor apps/cli/src` (tests excluded) gave 49 hits. Each was read in context, including
the parent `<Text>`, because a bare `dimColor` inside a parent with a hex colour inherits that
colour and is broken too. Result:

- **Broken, fixed (24 sites in 13 files):** `SystemMessage`, `Spinner` (timer suffix),
  `TodoDisplay` and `TodoChangeDisplay` (count, `[done]`/`[started]`/`[new]`, finished items),
  `FileWriteTool` (hunk header, context lines, `… more lines`, `… more hunks`, `(outside
workspace)`), `FileReadTool` and `GenericTool` (`(outside workspace)`), `SearchTool` (hit rows),
  `SelectList` (descriptions), `Markdown` (link address, fence language twice, blockquote, rule,
  table separator), `ContextGauge` (empty cells), `InputArea` (the `❯` while the model works, which
  therefore never dimmed in GNOME Terminal), `Bullet` (the `dim` prop on a coloured status;
  latent, no caller passes `dim` today).
- **Correct, untouched:** every bare `dimColor` (welcome banner, footer, pickers, dialogs,
  scroll indicators, placeholder, divider, tail notice). None sits inside a parent with a hex
  colour; the autocomplete rows use the named colour `cyan`. The running `Bullet` blink uses the
  default colour and keeps SGR dim, so it follows the user's terminal profile.

## Change

- `theme.dimmed(color)`: `#RRGGBB` with every channel at 2/3 (xterm's dim formula, which VTE uses
  for palette colours), rounded. `dimmed(secondaryText)` is exactly the existing `theme.faint`
  (`#6D7C7F`). Anything that is not `#RRGGBB` is returned as is (a named colour is a palette colour).
- Each broken site drops `dimColor` and takes the dimmed value: `theme.faint` where the colour was
  `secondaryText`, `theme.dimmed(x)` otherwise.
- **Nested colours.** SGR dim applies to a whole subtree, a colour only to its own text. Two
  places had coloured children under a dim parent, and each child now gets its own dimmed colour:
  the search hit row (file, `:`, line number) and the blockquote. For the blockquote,
  `renderTokens`/`renderInline` in `Markdown.tsx` take an optional `faint` flag that runs every
  token colour (base, code, link) through `dimmed`.
- No `dimColor` is ever paired with a pre-dimmed colour: terminals that do dim RGB would darken it
  twice.

## Two deliberate calls (user may want to revisit)

The rule "draw what a dimming terminal draws" was applied literally everywhere, including two
colours that were dark before dimming. Measured on the Ubuntu profile background `#300A24`
(WCAG contrast ratio):

| Text                          | Before (GNOME Terminal) | Now               |
| ----------------------------- | ----------------------- | ----------------- |
| Finished TODO, strikethrough  | `#5E7175`, 3.43:1       | `#3E4B4E`, 1.94:1 |
| Context gauge empty cells `░` | `#505354`, 2.27:1       | `#353738`, 1.47:1 |

Both now match what VS Code's terminal already showed. The finished TODOs stay readable. The gauge's
empty cells are barely visible; a one-value alternative is `theme.subtle` without dimming (3.43:1),
which is what the theme comment ("subtle: empty gauge cells") and `TodoDisplay`'s own progress bar
use. Not changed here because it is a design decision, not the bug.

## Tests

`dimColours.test.tsx` renders with `FORCE_COLOR=3` and `COLORTERM=truecolor` set in `vi.hoisted`
(before ink loads chalk). `FORCE_COLOR` alone is not enough: with `TERM=xterm` chalk stops at 16
colours, turns every hex colour into a palette one and hides the bug (measured: `\e[37m\e[2m`).

- A small SGR parser splits a frame into runs with their dim flag and RGB foreground.
- Detector self-checks: flags `dimColor` + hex, passes `dimColor` alone and `dimColor` + `"cyan"`.
- `dimmed`: equals `faint` for `secondaryText`, 2/3 per channel, named colours untouched.
- 29 cases, one per fixed site: no run is dim on RGB, AND the snippet that used to be dim is drawn
  in the expected darker colour. The second half matters: deleting `dimColor` everywhere would pass
  the first half and brighten everything.
- The running bullet keeps SGR dim on the default colour; the idle `❯` keeps its full colour.
- **Red first:** before the component changes all 29 cases failed and the rest passed (once the
  test wrapped `InputArea` in the `TerminalSizeProvider` it requires; without it the frame was
  ink's error screen, a defect of the test, not of the component).

Gates: `tsc --noEmit` 0, `eslint --max-warnings=0` 0, vitest 971 passed / 1 skipped (the
pre-existing skip; +37 new), `pnpm knip` 0, `pnpm build` (tsup) 0.

**Visual check.** `/tmp/cli-viz/render_dim.mjs` renders every touched component (TODO list, diff,
read outside the workspace, search hits, Markdown, system message, select list, spinner, input with
footer) from `main`'s source (`git archive` into `/tmp/cli-viz/before`) and from the working tree,
and `paint.py` paints both with VTE's rule. Text runs drawn dim on RGB: 41 before, 0 after.
Side by side: `/tmp/cli-viz/dim-compare.png`. Not committed, like the other scripts there.
