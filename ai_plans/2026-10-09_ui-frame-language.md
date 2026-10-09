# UI frame language - one border, one surface, one focus ring for the whole webview

**Status:** foundation on `feat/ui-frame-tokens`; per-screen branches follow (listed at the end).
**Related plans:** `2026-09-27_ui-modernization.md` (spacing and type tokens, square corners, now replaced for corners).
**Demos (approved by the owner 2026-10-09):** `assets/2026-10-09_ui-frame-language-demo-composer.html`,
`assets/2026-10-09_ui-frame-language-demo-screens.html`. Open them in a browser: left column today, right column
the proposal, dark and light theme.

## Symptom

The owner sent a screenshot of the home screen: the Recent Tasks rows had a hard light-grey 1px outline around an
empty box, 4px apart, so the list looked like a table. The mode and model selectors under the composer had a
different, almost invisible border, and the memory and code-index icons had none.

## What the code showed

Three read-only surveys of `webview-ui/src/components` found:

- **Eight border sources**: `panel-border`, `dropdown-border`, `input-border` (falls back to transparent),
  `editorGroup-border`, `widget-border`, `editor-lineHighlightBorder`, `sideBar-background` used as a border
  (the same colour as the background it sits on, so never visible) and hard-coded `rgba(255,255,255,0.08)` on the
  composer chips (invisible on a light theme).
- A bare `border` class resolved to `--vscode-input-border, transparent`, so every plain `border` vanished in themes
  that do not define `input.border`.
- **Nine control heights** (18, 20, 22, 24, 26, 28, 32, 36, 40, 48px).
- **Four focus styles** (`focus-ring`, `ring-ring`, `ring-focusBorder`, `outline-focusBorder`) and many interactive
  elements with none.
- Secondary text dimmed with `opacity-*` instead of the description colour, and buttons that only appear on hover
  (keyboard and touch users never see them).
- Hard-coded colours: `#757575` placeholder, `#3c3c3c` checkbox fallback, `rgba(90,93,94,.31)` icon hover, a cyan
  checkpoint gradient, a solid black dialog overlay.

## The rules

Tokens live in `webview-ui/src/index.css` (`@theme` maps them to Tailwind utilities, `:root` holds the values).

| Utility                           | Value                                     | Use                                                                      |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `border-frame`                    | foreground 13%                            | every card, block, popover section, chip, list, divider                  |
| `border-frame-hover`              | foreground 26%                            | hover of the above                                                       |
| `border-input-frame`              | theme `input.border`, else foreground 26% | inputs, selects, textareas, secondary buttons                            |
| `border-input-frame-hover`        | foreground 40%                            | hover of form controls                                                   |
| `border-toggle-border`            | foreground 45%                            | checkbox and switch outline (WCAG 1.4.11, 3:1 for small controls)        |
| `bg-surface` / `bg-surface-hover` | foreground 3% / 6%                        | fill of framed cards, hover of rows and ghost buttons                    |
| `bg-selected`                     | focus colour 18%                          | the chosen list item, an "on" tile; side navigation adds a 2px focus bar |
| `rounded-control`                 | 2px                                       | controls, cards, blocks (VS Code uses 2px for buttons and inputs)        |
| `rounded-floating`                | 4px                                       | popovers, menus, dialogs, tooltips                                       |

1. **Two heights**: 26px for form controls and buttons, 22px for compact toolbar chips and icon buttons.
2. **One focus ring**: `focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1
focus-visible:outline-vscode-focusBorder` (or the existing `.focus-ring` utility, which is the same thing).
3. **No text dimmed with opacity**: secondary text is `text-vscode-descriptionForeground`.
4. **No hover-only controls**: copy, docs, chevrons and row actions stay visible.
5. **No hard-coded colours**: derive from theme variables or the tokens above.
6. **Kept**: the `frame-accent` popover and composer-focus frame (orange when auto-approve is elevated), the 2px
   status edge on tool blocks, the spacing and type tokens from the 2026-09-27 plan.
7. **Corners**: `scripts/check-webview-radius.mjs` now allows exactly `rounded-control` and `rounded-floating`
   (with side forms like `rounded-t-control`) and still rejects every other `rounded*` class.

## Foundation changes (this branch)

- `index.css`: the tokens above; `--border` (what a bare `border` class draws) is now the frame instead of
  transparent; the body-level `--vscode-input-border` override points at `--input-frame`, so the theme's own
  `input.border` is honoured and themes without one get a visible outline; `composer-idle-border` is an alias of
  the frame (13%, was 25%).
- `scripts/check-webview-radius.mjs`: the two allowed corner classes and token values.
- The two demos copied into `ai_plans/assets/`.

## Per-screen branches

Each branch has its own plan file `2026-10-09_ui-frame-<area>.md` describing the files it touched.

1. `feat/ui-frame-controls` - `components/ui/*`, checkbox and icon-button CSS, history cards, home and welcome.
2. `feat/ui-frame-composer` - composer, toolbar chips, memory and index icons, mode/model/auto-approve/worktree
   popovers, @-mention menu, code-index popover.
3. `feat/ui-frame-chat` - task header, message rows, tool blocks, command and MCP output, errors, checkpoints,
   to-do, follow-ups, approve bar, queued messages, file-changes and subagents panels.
4. `feat/ui-frame-settings` - settings and modes.
5. `feat/ui-frame-views` - MCP, marketplace, cloud, worktrees, plan review, zoomable modal.
