# UI modernization proposals (2026-09-27)

Scope: the VS Code chat panel (`webview-ui/`), the cloud web panel (`self-hosted-cloudapi/src/web/`) and, briefly,
the CLI. Goal: calm, readable and pleasant screens that are quick to scan and fully usable from the keyboard.

Constraints taken from earlier decisions (the 2026-05-22 `ui-*` plans):

- Square corners everywhere (`--radius: 0`). No pills, no rounded cards.
- One monospace font (the editor font) for tool blocks and code.
- No new fonts; the VS Code panel uses only `--vscode-*` theme colors, so it follows every theme.
- Muted timestamps and live durations on blocks.

## 1. Shared design principles

1. **Hierarchy through weight, space and one accent line, not boxes.** Blocks separate by spacing and a 2px left
   border that carries status (running, done, failed). Avoid shadows and nested borders.
2. **One spacing scale and one type scale.** Every margin and font size comes from a token. No `px-[15px]`.
3. **Status never relies on color alone.** Pair color with an icon or a word ("failed", "running").
4. **Everything clickable is a real `<button>` or link**, reachable with Tab, with a visible focus ring from the
   theme's `focusBorder`.
5. **Long content is collapsed by default, with a count** ("Show all 214 lines"), and remembers its state per row.
6. **Motion is short and optional.** Respect `prefers-reduced-motion` everywhere.
7. **Skeletons, not spinners or blank screens**, for anything that loads longer than ~150 ms.

## 2. VS Code chat panel

### 2.1 Tokens (`webview-ui/src/index.css`, `@theme`)

```css
@theme {
	--spacing-row: 8px; /* between rows inside a block */
	--spacing-block: 12px; /* between chat blocks */
	--spacing-gutter: 12px; /* panel side padding */
	--text-meta: calc(var(--vscode-font-size) * 0.85); /* timestamps, counters */
	--border-status: 2px;
}
:root {
	--status-running: var(--vscode-textLink-foreground);
	--status-done: var(--vscode-charts-green);
	--status-failed: var(--vscode-errorForeground);
	--status-waiting: var(--vscode-charts-yellow);
	--ring: var(--vscode-focusBorder); /* today it maps to input-border, often transparent */
}
[data-density="compact"] {
	--spacing-row: 4px;
	--spacing-block: 8px;
}
```

Replace the literal paddings in `ChatRow.tsx` and `rows/renderers/shared.tsx` with these tokens. Add a
"Density: comfortable / compact" choice in `settings/UISettings.tsx` that sets `data-density` on the root.

### 2.2 One `ToolBlock` primitive (`common/ToolUseBlock.tsx`)

Today tool rows are styled in several places with inline objects and leaked `border-radius` values. One component:

```
|  [icon] read_file   src/core/task/Task.ts          12:04:31  2.1s  [v]
|  ------------------------------------------------------------------
|  (body: max 300px, mono, scrolls)
|  Show all 214 lines
```

- Header is a `<button aria-expanded aria-controls>`: icon, mono tool name, a path chip that opens the file, a
  right-aligned `BlockTimestamp`, a chevron.
- The chevron is visible at 60% opacity by default (today it is `opacity-0` until hover, so keyboard users never
  see it); 100% on hover or `:focus-visible`.
- The left border is `--border-status` wide in the status color; failed blocks also get a "failed" label.
- `CommandExecution.tsx` already does the header correctly; copy its pattern.
- Remove the hard-coded radii in `ExpandableToolRows`, `EditFileToolRow`, `UpdateTodoListToolBlock`, `McpView`,
  `ContextMenu`, `CodeBlock`, `MarkdownBlock`, `Thumbnails`, `ImageViewer`, `IconButton`, `MermaidButton` and the
  `.ui-*` rules; add a lint check that rejects `borderRadius` and `rounded-[` literals.

### 2.3 Task header (`chat/TaskHeader.tsx`)

- Drop `shadow-lg` and `rounded-xl`; use a 1px `--vscode-panel-border` bottom border. Flat, like the editor tabs.
- Cap the expanded details at ~40vh with its own scroll so it never pushes the chat off screen.
- One `CostWithTooltip` component instead of two copies.
- Replace the unicode arrows in the token row with lucide `ArrowUp` / `ArrowDown` plus `aria-label`.
- Make the clickable header area a `<button>` with `aria-expanded`.

### 2.4 Context bar (`chat/ContextWindowProgress.tsx`)

- 3px tall instead of 1px, square ends.
- Used part turns `--status-waiting` above 75% and `--status-failed` above 90%, with the percentage as text.
- `role="progressbar"`, `aria-valuenow`, `aria-valuemax`, `aria-label="Context used"`.

### 2.5 Composer (`chat/ChatTextArea.tsx`)

- A single 1px `focusBorder` outline on focus (today border and outline double up).
- A quiet hint row under the input: `Enter send - Shift+Enter new line - @ mention - / command`, at `--text-meta`.
- `aria-label` on the textarea; the `@`/`/` menu (`ContextMenu.tsx`) becomes `role="listbox"` with
  `aria-activedescendant`, so screen readers announce the highlighted item.
- Attachments (`Thumbnails.tsx`) as square 48px tiles with a remove button that appears on focus as well as hover.

### 2.6 Action bar (`ChatView.tsx`)

- A real disabled style instead of 50% opacity.
- Shortcuts: Ctrl/Cmd+Enter for the primary action, Esc for the secondary; shown in the tooltips.
- Pick the tooltip from a `kind` returned by `useAskButtons` (`retry`, `save`, `approve`...) via a lookup table,
  not by comparing translated button labels in a nine-level ternary.

### 2.7 Diffs (`common/DiffView.tsx`, `CodeAccordion.tsx`)

- Below 400px panel width (container query), one merged line-number gutter instead of two 45px columns; this
  gives back ~60px of code width in the sidebar.
- Collapse unchanged runs longer than six lines into "... 18 unchanged lines" buttons.
- A sticky file header with `+12 -3` counts and "Open diff".
- Keep the `--vscode-diffEditor-*` colors.

### 2.8 Todo list (`chat/TodoListDisplay.tsx`, `UpdateTodoListToolBlock.tsx`)

- Header as a button with `aria-expanded`, and a thin progress bar next to `3/7`.
- Move the 32 inline style objects to classes (this also removes the leaked radii).

### 2.9 History (`history/HistoryView.tsx`, `TaskItem.tsx`)

- Rows are `<button>`s (today they cannot be reached with the keyboard).
- Group by day ("Today", "Yesterday", "2026-09-24") with sticky group headers.
- An empty state for no history and for no search results, with a "Clear search" action.
- Keep the full `yyyy-mm-dd hh:mm:ss` timestamp, right-aligned in tabular numerals.

### 2.10 Settings (`settings/SettingsView.tsx`)

- A dot on the Save button and on each tab that has unsaved edits (`isChangeDetected` already exists).
- Remove `focus:ring-0` from the tab triggers.
- A search box at the top that filters sections by label (the labels are already in `SETTINGS_SCHEMA`).

### 2.11 Loading, empty states, motion, meta text

- Replace `return null` before hydration in `App.tsx` with a three-line skeleton in
  `--vscode-editor-inactiveSelectionBackground`.
- Skeletons for `CodeBlock` while Shiki loads and for `MermaidBlock` while Mermaid loads.
- Global reduced-motion rule in `index.css`:
  `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
- `BlockTimestamp`: `--text-meta` size, no extra opacity on the duration, `tabular-nums` so the live counter does
  not jitter.
- Missing translations: `"Arguments: "` in `ExpandableToolRows.tsx`, `aria-label="Clear search"` in
  `HistoryView.tsx`.

### 2.12 Clean-up that makes the above cheaper

One checkbox, one button (with an `icon` variant), one icon button, one text field; lucide plus codicons only
(drop `@radix-ui/react-icons` and `react-icons`); CodeBlock, MarkdownBlock, MermaidBlock and `settings/styles.ts`
moved from styled-components to Tailwind and `@layer components`, then the dependency removed. Regenerate
`ChatRow.golden.json` in the same pull request.

## 3. Cloud web panel

The panel already has a good token set on `:root` in `static/app.css` (surfaces, text levels, one amber accent,
data hues, a 4px spacing scale, a type scale) and no build step. Keep both.

### 3.1 Light theme

- Redefine only the `:root` tokens under
  `@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ... } }` and under
  `:root[data-theme="light"]`: light surfaces, `--line` as low-alpha black, a darker amber (about `#9a5b00`) so
  the accent passes AA on white, data hues around 45% lightness.
- `<meta name="color-scheme" content="dark light">` in `base.html`.
- Replace the hard-coded topbar `rgba(13,17,23,.85)` with `color-mix(in srgb, var(--bg) 85%, transparent)`.
- A three-state toggle (auto, dark, light) in the topbar, stored in `localStorage`.
- `metrics.js` reads chart colors from the CSS variables (`getComputedStyle`) instead of hex literals, and
  re-draws on a `matchMedia` change.

### 3.2 Task list (`tasks_list.html`, `tasklist.js`, `routers/web_tasks.py`)

- A header row for the nine columns (today only two are labelled), sticky under the topbar.
- Server-side sorting by updated, cost, tokens or messages (`?sort=&dir=`, allow-listed), keeping the pager links.
- Zebra rows through `--surface-1`, and a compact density toggle that changes the row padding.
- Filters as plain GET form fields (work without JavaScript): project, model, grade, date range, has subtasks.
  Active filters shown as removable chips (square, per the house style).
- Progressive enhancement: submit the filter form 300 ms after typing and swap the list from the same HTML
  response with `fetch` and `DOMParser` (~30 lines, no htmx).
- Below 640px, each row becomes a two-line card: title and badges, then a wrapping line of numbers. Selection
  checkboxes appear only in a "Select" mode. The pager shows only previous, next and "3 / 12".

### 3.3 Task detail (`task_detail.html`, `render.js`)

- A slim timeline beside the conversation on wide screens (collapsed on top on phones): one tick per API request,
  height proportional to cost, `--d-error` for failures and retries, `--d-you` for user messages. Clicking a tick
  scrolls to the message. The data is already in the page; no new endpoint.
- "Next error" and "next user message" buttons.
- `content-visibility: auto; contain-intrinsic-size: 0 120px` on message rows, which makes long runs render much
  faster.
- A skeleton instead of the "Rendering conversation..." text.

### 3.4 Metrics (`metrics.html`, `metrics.js`)

- The three charts could be server-rendered inline SVG, like the existing grade and kind bars. That removes the
  290 KB Chart.js file, and the charts follow the theme and print. If Chart.js stays, give each chart box a fixed
  aspect ratio and a skeleton until it mounts.
- Each `<canvas>` gets `role="img"` and an `aria-label` summary, linked to the breakdown table below it.

### 3.5 Accessibility and polish

- A skip link in `base.html` and `id="main"` on `<main>`.
- Raise `--text-faint` from `#6b7885` (~4.1:1 on the background, fails AA for small text) to about `#7d8a97`.
- `<caption>` and `scope="col"` on the data tables; `role="status" aria-live="polite"` on the live-status line;
  `aria-hidden` on decorative emoji.
- Fold the seven one-off font sizes into the type scale; add `--t-h1: clamp(1.25rem, 1rem + 1vw, 1.5rem)`.
- Move the two inline `onsubmit` confirms into `data-confirm` handlers, replace inline `display:none` with the
  `hidden` attribute, then add a Content Security Policy header.
- Empty states that explain the next step: a "connect your extension" panel with the API URL to copy; for a
  filtered list, the active filters with one-click removal.

## 4. CLI (brief)

- Honour `NO_COLOR` and `FORCE_COLOR`.
- A status line showing the cloud or bridge connection and an offline marker.
- `tumble doctor`: checks the extension bundle, ripgrep, Node version, MCP config and cloud reachability.
- Ctrl+R reverse search over input history (`useInputHistory` exists), an interactive resume picker, `/copy` for
  the last answer or code block, `/export` to Markdown.
- After a crash, print the debug log path and suggest `--debug`.

## 5. Order

1. Tokens (2.1), focus ring (`--ring`), reduced motion, radius clean-up: small and they unlock the rest.
2. `ToolBlock` (2.2), task header (2.3), context bar (2.4): the most visible change in daily use.
3. Composer, action bar and history keyboard access (2.5, 2.6, 2.9).
4. Cloud: list headers and sorting, filters, contrast and skip link, then the light theme, then the timeline.
5. Diffs, todo list, settings search, SVG charts.

Each step is its own pull request with before and after screenshots in light, dark and high-contrast themes.

## Progress log — krok 3 (2026-09-28)

Step 3 of §5 landed as three stacked PRs, each squash-merged right after its
touched specs went green:

- **§2.5 Composer — PR #588** (`9120a384e`): single visible focus outline on
  the composer (the textarea keeps the ring; nested toolbar buttons drop
  theirs), quiet hint row, `aria-label`s on every control, the ContextMenu
  rendered as `role="listbox"` with `aria-activedescendant`, square 48px
  attachment tiles. Built on the post-#569 hooks (`useMentionMenu`,
  `useHighlightLayer`, `ComposerToolbar`).
- **§2.6 Action bar — PR #593** (`996fd30db`): `useAskButtons` now sets an
  `AskButtonKind` per slot; new `askButtonTooltips.ts` maps kind → tooltip
  key (replacing the translated-label ternary chains) and appends the
  shortcut; Ctrl/Cmd+Enter answers primary and Esc answers secondary;
  `.disabled-action-button` gives disabled buttons a real disabled style.
- **§2.9 History — PR #601** (`339376ba8`): history rows and subtask rows are
  real `<button>`s; `toDayRows()` interleaves Today/Yesterday/date headers
  into the Virtuoso data while the parent-child tree grouping stays intact;
  empty states for no-history and no-search-hits (search-empty checked
  first because `tasks` is already filtered); `tabular-nums` on footer
  timestamps/costs; 4 new locale keys × 18 locales.

Deviations from the letter of the plan: tooltips are asserted at the
lookup-table layer (Radix tooltip portals don't open reliably in jsdom), and
the day header is a Virtuoso row rather than a DOM section (keeps the
virtualized list). ChatRow.golden.json untouched — no chat-row rendering
changed. VSIX rebuild still owed before any of this is visible in the
installed extension.
