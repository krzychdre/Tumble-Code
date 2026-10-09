# UI frame language: composer, toolbar and popovers

**Status:** implemented on `feat/ui-frame-composer` (not merged; the coordinator merges).
**Related plans:** `2026-10-09_ui-frame-language.md` (tokens, rules, branch split).

## Touched files

- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ComposerToolbar.tsx`
- `webview-ui/src/components/chat/ComposerActionButtons.tsx`
- `webview-ui/src/components/chat/ModeSelector.tsx`
- `webview-ui/src/components/chat/ApiConfigSelector.tsx`
- `webview-ui/src/components/chat/AutoApproveDropdown.tsx`
- `webview-ui/src/components/chat/WorktreeSelector.tsx`
- `webview-ui/src/components/chat/IndexingStatusBadge.tsx`
- `webview-ui/src/components/chat/MemoryActivityBadge.tsx`
- `webview-ui/src/components/chat/ContextMenu.tsx`
- `webview-ui/src/components/cloud/CloudAccountSwitcher.tsx`
- `webview-ui/src/components/code-index/CodeIndexPopover.tsx`
- `webview-ui/src/components/code-index/CodeIndexStatusSection.tsx`
- `webview-ui/src/components/code-index/CodeIndexWorkspaceToggles.tsx`
- Specs: `chat/__tests__/ApiConfigSelector.spec.tsx`, `ChatTextArea.lockApiConfig.spec.tsx`,
  `ChatTextArea.toolbar.spec.tsx`, `ModeSelector.spec.tsx`.

`OrganizationSwitcher.tsx` needed no change: it uses the shared `SelectTrigger` defaults.

## What changed per screen

### Composer

- Idle border stays `border-composer-idle-border` (now the 13% frame), hover raises it to `border-frame-hover`
  through a `group/composer` hover on the wrapper (the highlight layer sits above the textarea with
  `pointer-events-none`, so both layers switch together). Focus keeps the `frame-accent` outline. Both layers are
  `rounded-control`.
- The bottom hint line ("@ to add context ...") moved from inline styles with a 50% foreground mix to
  `text-vscode-descriptionForeground`, `select-none`, `pointer-events-none`.
- The @-mention wrapper lost its black `drop-shadow-md` filter; the menu draws its own theme shadow.
- `ComposerActionButtons`: one shared base (28px square, `rounded-control`, description colour, the standard focus
  ring) and one interactive state (`hover:bg-surface-hover`, `hover:text-vscode-foreground`). Every
  `rgba(255,255,255,..)` hover, active and border class is gone, and so is the 50% / 60% resting opacity on the
  image, enhance and cancel buttons. The show/hide by content (`opacity-0 pointer-events-none`) and the disabled
  image button (`opacity-40`) are state, not text dimming, and stay. The stop button hovers to the theme button
  hover colour.

### Toolbar triggers

Mode, API configuration, auto-approve and worktree triggers: `h-[22px] px-[7px] text-xs rounded-control`,
`border-frame`, hover `border-frame-hover` + `bg-surface-hover`, the standard focus ring, no `opacity-90`.

- Mode: the "not yet opened" filled primary chip is kept (with a transparent border so it stays 22px).
- Auto-approve: bypass / autonomous keep the `border-orange-600 text-orange-500` look, now without `!important`;
  hover no longer replaces the orange border.
- Worktree: was a 14px-text, 8px-padded borderless button with white rgba hover; now the same chip.
- Right-hand icons: `MemoryActivityBadge` and `IndexingStatusBadge` are 22x22 framed boxes with 14px icons in the
  description colour (status colours unchanged); busy memory draws a green icon in a frame mixed from
  `--vscode-charts-green` at 45%. `opacity-85` is gone. The memory badge is a `role="status"` span and is not
  focusable, so it has no focus ring (adding a tab stop would change behaviour). The cloud account switcher
  trigger is 22x22 with the same frame and focus ring (was 18px, 90% opacity that faded to 50% on hover). The
  toolbar row is 22px high with a 4px gap.

### Popovers

- Sections are separated by `border-frame` (was `dropdown-border` / `panel-border`).
- Search inputs (mode, API configuration) drop `h-8 ... border-vscode-input-border` and use the shared `Input`
  default; the clear icon is description colour instead of 50% opacity.
- Items are inset (`mx-1`, `rounded-control`), hover `bg-surface-hover`, selected `bg-selected` plus a focus-colour
  check (was `list-activeSelection`). Titles are `font-semibold` instead of bold.
- No `opacity-40..70` on icons or text: model ids, "current" tags, the "primary" worktree tag, info icons, the
  lock / apply-to-modes footer icons and the "no results" lines use `text-vscode-descriptionForeground`.
- API configurations: the sticky pinned header uses the popover background (`bg-popover`) and `border-frame`.
  Small uppercase group labels show the existing `chat:apiConfigGroups.pinned` / `.all` strings when pinned
  configurations exist (`aria-hidden`, the groups already carry the same `aria-label`). The pin button is always
  visible (was hover-only), description colour, `bg-accent` when pinned. The row focus outline uses the focus
  colour with rounded corners.
- Modes: no group labels. Built-in and custom modes can be told apart from the data, but there are no existing
  translated "Built-in" / "Custom" strings and the branch must not add i18n keys.
- Auto-approve: tiles are 28px `ghost` buttons with `border-input-frame`, off = transparent with hover fill,
  on = `bg-selected` + `border-vscode-focusBorder` + a check, forced = `bg-orange-600/15` + `border-orange-600` and
  an orange check (no `!bg`/`!text-white`). All / None are 22px small ghost buttons with 12px text. The settings
  gear is description colour with a hover colour.
- Worktree: the header gets padding, `border-frame` and a 13px semibold title.

### @-mention menu (ContextMenu)

Inline styles became classes: `rounded-floating`, `border-frame-hover`, shadow from `--vscode-widget-shadow`
(was `rgba(0,0,0,.25)`), dropdown background and foreground. Rows are inset and rounded, the selected row
(mouse hover selects, as before) is `bg-selected` instead of `list-activeSelection`. Section headers are small
uppercase description-colour labels over a `border-frame` line. Descriptions, argument hints and folder paths
use the description colour instead of 50-75% opacity. The slash-command settings button lost its JS
`onMouseEnter`/`onMouseLeave` opacity handlers and got a hover fill and focus ring. The DOM structure (children
of the listbox) is unchanged, so the scroll-into-view effect keeps working.

### Code index popover

Header `border-frame` with a 13px semibold title; the progress bar track is `bg-frame-hover` with
`rounded-control`; the status square is `rounded-control`. The two native checkboxes in
`CodeIndexWorkspaceToggles` became `LabeledCheckbox` with the same `id`s, so the shared 16px checkbox look
applies and the label wraps the box.

## Tests run

- `vitest run` on the 9 touched chat specs, the 2 cloud switcher specs and `components/code-index`
  (`--maxWorkers=2`): 16 files, 250 tests passed.
- `tsc --noEmit -p .`: clean. `eslint` on all touched files `--max-warnings=0`: clean.
  `node ../scripts/check-webview-radius.mjs`: exit 0.

Spec updates: the pin button test now asserts it is always visible; the lock toggle asserts the description
colour instead of `opacity-60`; the enhance button asserts `opacity-100` with content; the pinned sticky header is
found by `bg-popover`; the mode name lookup uses `.font-semibold`.
