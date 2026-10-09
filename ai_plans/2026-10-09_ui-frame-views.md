# UI frame language: MCP, marketplace, cloud, worktrees, plan review, zoom modal

**Status:** done on `feat/ui-frame-views`, PR open, not merged.
**Related plans:** `2026-10-09_ui-frame-language.md` (the tokens and rules; this is branch 5 of its list).

## Touched files

- `webview-ui/src/components/mcp/ServerRow.tsx`, `McpView.tsx`, `McpToolRow.tsx`, `McpResourceRow.tsx`
- `webview-ui/src/components/marketplace/MarketplaceView.tsx`, `MarketplaceListView.tsx`,
  `components/MarketplaceItemCard.tsx`, `components/MarketplaceInstallModal.tsx`
- `webview-ui/src/components/cloud/CloudView.tsx`
- `webview-ui/src/components/worktrees/WorktreesView.tsx`, `CreateWorktreeModal.tsx`, `DeleteWorktreeModal.tsx`
- `webview-ui/src/components/plan-review/PlanReviewSurface.tsx`
- `webview-ui/src/components/common/ZoomableModal.tsx`, `ZoomControls.tsx`, `ImageViewer.tsx`
- `webview-ui/src/i18n/locales/*/mcp.json` (new `serverStatus.state.*`, all 18 locales)
- specs: `mcp/__tests__/ServerRow.spec.tsx`, `mcp/__tests__/McpToolRow.spec.tsx`,
  `common/__tests__/ImageViewer.spec.tsx`

## What changed per screen

### MCP

- `ServerRow` header is a framed card (`bg-surface`, `border-frame`, `rounded-control`); expandable rows get
  `hover:bg-surface-hover hover:border-frame-hover`. The tools body and the error body attach under it with
  `border-t-0` and `rounded-b-control`, so card and body read as one block.
- Keyboard: on a connected server the chevron and name are a real `<button aria-expanded>` with the focus ring.
  Its click bubbles to the existing row handler, so mouse behaviour is unchanged and no interactive element is
  nested in another.
- Status: the dot (now `aria-hidden`) gets a word next to it. No suitable string existed, so
  `mcp:serverStatus.state.{connected,connecting,disconnected,disabled}` was added to every locale.
- Disabled servers use the description colour instead of `opacity-60`.
- 8px between servers (`gap-row`, the extra `mb-row` is gone); 12px above the button grid.
- Tool rows: hairlines and the parameters box use `border-frame` (box also `rounded-control`); every `opacity-*`
  on text became `text-vscode-descriptionForeground`. Resource rows: same. `McpErrorRow` untouched (keeps its
  coloured edge).

### Marketplace

- Tab strip: track is `border-b border-frame` (was a 2px `input-border` bar), indicator `bg-vscode-focusBorder`,
  tabs 26px with hover fill, focus ring, inactive tab in the description colour.
- Item card: `bg-surface`, `border-frame`, hover `bg-surface-hover` + `border-frame-hover`, `rounded-control`;
  title `text-base` (was `text-lg`). Install/Remove buttons 22px.
- Tag chips outlined (`border-input-frame`, description colour, `rounded-control`, 22px), active tag uses the
  focus colour; Installed chip is green text with a green 45% border and no fill.
- Group dividers `bg-frame`; filter selects lose their local `h-7` (the shared 26px applies); the command list
  divider uses `divide-frame`; the "clear all filters" button uses the secondary variant instead of hand-copied
  colours.
- Install modal: relies on the shared dialog; link gets the focus ring, the disabled scope label uses the
  description colour, the validation box is `rounded-control`.

### Cloud

- Task-sync block `border-y border-frame` (was `widget-border`); the three hand-made underline link buttons
  get `focus-ring`; the URL pill label uses the description colour instead of `foreground/75`.
- Gutters: content uses `px-gutter` and the per-block `ml-4` / `pl-4` / `px-4` offsets are gone, so every block
  starts at the same edge.

### Worktrees

- Rows are cards (`bg-surface`, `border-frame`, `rounded-control`, hover); the current worktree is `bg-selected`.
  8px between rows.
- Keyboard: on switchable rows the branch/path block is a `<button>` with the focus ring (click bubbles to the row).
- Footer border is `border-frame` (was `sideBar-background`, invisible) and drawn once instead of twice.
- List gutter `px-5` like the header and footer (was `px-4`).
- Modals: info box `bg-surface border-frame rounded-control`, warning / error / progress boxes `rounded-control`,
  loading row 26px.

### Plan review

- Inline `rgba`/hex fallbacks replaced with theme vars or `color-mix` (diff backgrounds, gutter edges, highlight).
- Header, footer and notes-panel borders `border-frame`; annotation cards `border-frame rounded-control bg-surface`.
- Raw textareas: `border-input-frame`, hover `border-input-frame-hover`, focus `border-vscode-focusBorder`,
  `rounded-control`.
- Close, edit and delete icon buttons and the floating "Add note" chip get the focus ring; the inline note
  editor is a floating surface (`rounded-floating`, `border-frame-hover`, shadow from `--vscode-widget-shadow`).

### Zoom modal and image viewer

- `ZoomableModal`: `border-frame-hover`, `rounded-floating`, shadow from `--vscode-widget-shadow`; tab strip and
  footer `border-frame`; zoom badge without `opacity-80`, framed.
- `ZoomControls`: zoom label in the description colour.
- `ImageViewer`: the zoom/copy/save toolbar is always visible (was hover-only), framed.

## Not done / out of scope

- `CloudUpsellDialog.tsx`: nothing to change beyond the shared dialog.
- `CloudView` keeps `opacity-50` on the benefits block while sign-in is in progress (it dims a whole block as a
  state, not secondary text).
- `CreateWorktreeModal`: the browse icon is a clickable svg without a button or accessible name; fixing it needs a
  new i18n key, left for later.
- `common/TabButton.tsx` (used in the zoom modal tab strip) is outside this branch.

## Tests run

- `vitest run src/components/mcp src/components/marketplace src/components/cloud src/components/plan-review
  src/components/common/__tests__/ImageViewer.spec.tsx`: 18 files, 165 tests passed.
- `vitest run` MermaidBlock, content-blocks.styles, MarkdownBlock golden renders, `src/i18n/__tests__`: 8 files,
  445 tests passed.
- `tsc --noEmit -p .`, `eslint` on the touched files (`--max-warnings=0`), `check-webview-radius.mjs`,
  `find-missing-translations.js`: all clean.
