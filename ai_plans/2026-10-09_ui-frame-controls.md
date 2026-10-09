# UI frame language - controls, history and home (`feat/ui-frame-controls`)

**Status:** implemented on `feat/ui-frame-controls`, PR open, not merged (the coordinator merges).
**Related plans:** `2026-10-09_ui-frame-language.md` (tokens, rules, branch split).

## Touched files

- `webview-ui/src/components/ui/`: `button.tsx`, `icon-button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`,
  `searchable-select.tsx`, `command.tsx`, `popover.tsx`, `badge.tsx`, `tooltip.tsx`, `standard-tooltip.tsx`,
  `toggle-switch.tsx`, `slider.tsx`, `dialog.tsx`, `alert-dialog.tsx`.
- `webview-ui/src/index.css`: only the component rules `.disabled-action-button`, `.ui-checkbox*`,
  `.ui-button-icon`, `.ui-radio*`, `.ui-panels-indicator` / `.ui-panel-tab`, `.input-icon-button`. No token block changed.
- `webview-ui/src/components/history/`: `TaskGroupItem`, `TaskItem`, `TaskItemFooter`, `TaskDetails`, `SubtaskRow`,
  `SubtaskCollapsibleRow`, `CopyButton`, `ExportButton`, `DeleteButton`, `HistoryPreview`, `HistoryView`,
  `BatchDeleteTaskDialog`.
- `webview-ui/src/components/welcome/`: `RooTips`, `RooHero`, `WelcomeViewProvider`.
- `webview-ui/src/components/common/`: `Tab`, `TabButton`, `VersionIndicator`, `StaleBuildNotice`, `StorageErrorBanner`.
- Specs: `ui/__tests__/{toggle-switch,input,icons.call-sites}.spec.tsx`,
  `history/__tests__/{TaskGroupItem,TaskItem,TaskItemFooter,HistoryPreview}.spec.tsx`.
- Snapshots regenerated (class names only, outside the area but caused by the primitives):
  `settings/__tests__/__snapshots__/provider-forms.{descriptor,local-models,model-rules,openai-native}.spec.tsx.snap`.

## What changed per screen

### Controls (primitives)

- **Button**: 26px default, 22px `sm` (`lg` and `icon` also 26px), `rounded-control`, one focus ring
  (`focus-visible:outline-solid outline-1 outline-offset-1 outline-vscode-focusBorder`; `outline-solid` instead of
  the bare `outline` so a call site's `outline-none` cannot cancel it). Primary hovers to
  `button.hoverBackground`; secondary and `outline` are outlined (`bg-surface`, `border-input-frame`, hover
  `bg-surface-hover` + `border-input-frame-hover`); ghost hovers `bg-surface-hover`; destructive is outlined red text
  (border errorForeground 55%, hover fill 10%); `combobox` keeps the dropdown fill with the input frame.
- **IconButton**: chrome buttons in the description colour (was foreground at 85% opacity), hover `bg-surface-hover`
  and foreground (was `rgba(255,255,255,.03)`), the shared focus ring; toolbar buttons 22px (`sm`) / 26px (`md`) with
  `bg-surface-hover`. `.ui-button-icon` hover and pressed fill use `--surface-hover` (was `rgba(90,93,94,.31)`), 2px
  corners, focus ring offset 1px.
- **Input / Textarea**: `border-input-frame`, hover `border-input-frame-hover`, focus border plus 1px inset
  focusBorder outline, placeholder `descriptionForeground` (was `#757575`), `rounded-control`.
- **Select**: trigger 26px, input frame with hover, keeps its fill on hover (`hover:bg-transparent` removed),
  chevron in the description colour. Content `rounded-floating`, `border-frame-hover`, widget shadow; items hover
  `bg-surface-hover`, the chosen item `bg-selected`; separator `bg-frame`.
- **SearchableSelect / Command**: trigger uses the `combobox` look at 26px; command search row 26px under a
  `border-frame` hairline, icons in the description colour; items hover/keyboard highlight `bg-surface-hover`.
- **Popover**: keeps `border-frame-accent`, adds `rounded-floating` and the widget shadow.
- **Checkbox** (`.ui-checkbox`): 16px, `--toggle-border` outline, foreground outline on hover, checked = button
  background with the button-foreground check, focus ring. **Radio** gets the same outline, hover and focus ring,
  the dot in the button colour.
- **ToggleSwitch**: 28x16 outlined (`border-toggle-border`, transparent; on = button background with the
  button-foreground dot), foreground outline on hover, focus ring. Props, `role="switch"` and aria unchanged; both
  `size` values draw the same switch.
- **Slider**: 4px track in `bg-frame-hover`, filled range in the button colour, 14px thumb with an editor-colour
  ring and a button-colour outline (focusBorder on keyboard focus).
- **Badge**: `default` and `outline` are `border-input-frame` + `bg-surface`, `rounded-control`; `count` unchanged.
- **Tooltip**: one padding (`px-2 py-1`, StandardTooltip no longer adds `p-2`), `border-frame-hover`, shadow,
  `rounded-floating`.
- **Tabs** (`.ui-panels`): inactive tabs in the description colour, the indicator in `panelTitle.activeBorder` /
  focusBorder, a visible focus ring; `TabButton` hover `bg-surface-hover` and focus ring; `TabHeader` divider and
  `TabTrigger` focus use the frame / focus ring.
- **`.disabled-action-button`**: empty surface + frame + disabledForeground instead of a desaturated grey fill.

### Dialogs

`Dialog` and `AlertDialog`: one frame (`border-frame-hover`), `shadow-[0_8px_28px_var(--vscode-widget-shadow)]`,
`rounded-floating`, `p-4` in both; overlay derived from the theme
(`color-mix(editor background 55%, rgba(0,0,0,.35))`) instead of black 50%. AlertDialog action/cancel are the default
primary/secondary buttons (26px). The dialog close button is a 22px icon button with the focus ring.

### History view and Recent Tasks

- `TaskGroupItem` (and a flat search-mode `TaskItem`) is a card: `bg-surface`, `border-frame`, hover
  `bg-surface-hover` + `border-frame-hover`, `rounded-control`, 10px 12px padding, 8px between cards in both lists
  (`gap-2` in HistoryPreview, `mx-2 mb-2` per Virtuoso row in HistoryView).
- Title in the full foreground at weight 500 (was foreground 80% light); meta line and subtask rows in the
  description colour (no `/60`, `/80`); the open arrow is always visible in the description colour.
- The subtasks toggle sits under a `border-frame` hairline inside the card.
- Copy / export / delete are always visible, 22px, description colour, foreground on hover; accessible names kept.
- HistoryView: search input and selects at 26px, search icon in the description colour, batch bar `border-frame`.
- BatchDeleteTaskDialog warning box is a framed surface.

### Home / welcome

RooTips rows sit in one framed card (`bg-surface`, `border-frame`, hairlines between rows). RooHero's two
side gradients to `sideBar-background` (they showed as boxes in an editor tab) are removed. The welcome "import
settings" button and the Recent Tasks "View all" button have the focus ring; banner links in StaleBuildNotice and
StorageErrorBanner hover to `textLink.activeForeground` (was opacity 80%) and have the focus ring.

## Not done / notes

- `SubtaskCollapsibleRow` is a `div role="button"` without `tabIndex`, so it cannot get keyboard focus; making it
  focusable is a behaviour change and was left out.
- Chat call sites `MessageModificationConfirmationDialog` and `CheckpointRestoreDialog` still pass old
  secondary-button classes to `AlertDialogCancel` (chat area).

## Tests run

- `vitest run src/components/ui src/components/history src/components/welcome src/components/common --maxWorkers=2`:
  54 files, 511 tests passed.
- `vitest run src/components/settings/__tests__/provider-forms -u`: 50 snapshots updated (class names only), 186 passed.
- `tsc --noEmit -p .`, `eslint <touched files> --max-warnings=0`, `node ../scripts/check-webview-radius.mjs`: clean.
