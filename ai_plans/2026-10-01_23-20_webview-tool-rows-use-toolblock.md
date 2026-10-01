# Tool rows use ToolBlock (round 2, D1)

Status: done on `feat/webview-tool-rows-use-toolblock`

## Touched files

- `webview-ui/src/components/common/ToolBlock.tsx` (+ `__tests__/ToolBlock.spec.tsx`)
- `webview-ui/src/components/common/CodeAccordion.tsx` (+ `__tests__/CodeAccordion.spec.tsx`)
- `webview-ui/src/components/chat/rows/renderers/tool/ExpandableToolRows.tsx`
- `webview-ui/src/components/chat/rows/renderers/tool/FileToolRows.tsx` (+ new `__tests__/ReadFileToolRow.spec.tsx`)
- `webview-ui/src/components/chat/__tests__/ChatRow.run-slash-command.spec.tsx`
- `webview-ui/src/components/chat/__tests__/__golden__/ChatRow.golden.json`

## Problem

`common/ToolBlock.tsx` (#577) was imported only by its own spec. The tool rows built their own expandable UI:

- `CodeAccordion.tsx` (the box of the edit, insert, list files and search files rows, and of the diff rows in
  `MessageRows`, `BatchDiffApproval`, `FileChangesPanel`): header was a `div` with `onClick`.
- `ExpandableToolRows.tsx:12-33`: three inline style objects; `:46,95` a `div` with `onClick`; chevron
  `opacity-0 group-hover:opacity-100` (`:59,108`).
- `FileToolRows.tsx:58`: the read file path line was a `div` with `onClick` (opens the file), icon hover-only (`:75`).

None of them could be reached with Tab; the hover-only chevrons never showed without a mouse.

ToolBlock itself could not host these rows: its whole header was one `<button>`, so the open diff and open file
buttons in `CodeAccordion` (and the "path chip that opens the file" its own doc suggested) would have been buttons
nested in a button, which is invalid HTML.

## Fix

One commit per step:

1. ToolBlock: the header is a `div`; the toggle is a `<button aria-expanded aria-controls>` whose `::before`
   covers the whole header, so a click anywhere on the header still toggles. `actions` sit beside the toggle with
   `relative`, above that overlay; `meta` (stats, progress) sits under it. The chevron is the codicon
   `chevron-up/down` the rows already used, 60% opacity, 100% on hover and while the toggle has keyboard focus
   (`group-has-[button[aria-expanded]:focus-visible]`). The body mounts only while expanded (no Shiki / diff render
   for collapsed rows, as before). Focus ring: the overlay gets a 1px `--ring` outline inset by 1px.
2. CodeAccordion renders ToolBlock (file and search rows, plus the other CodeAccordion users).
3. Skill and slash command rows render ToolBlock; `boxStyle`, `boxHeaderStyle`, `boxBodyStyle` are replaced by
   classes of the same sizes.
4. Read file row: the path line is a `<button>` (it has nothing to fold, so not a ToolBlock); the open icon also
   shows on `focus-visible`.

## Row heights and visual changes

Paddings, line boxes and margins are unchanged (`p-2` container and `p-0` toggle for CodeAccordion; `px-3 py-2.5`
header, `mt-1`, `px-4 py-3` body for skill / slash command), so no row height changes in the collapsed state. The
golden renders change only in markup and classes (21 + 6 + 4 entries). Deliberate visual differences:

- CodeAccordion shows the chevron also when the row has an open-file button (`newFileCreated`); it was hidden there
  although a click still toggled. Adds width, not height.
- A skill / slash command box without arguments or description has no chevron and does not toggle (it toggled an
  empty body).
- A skill / slash command body taller than 300px scrolls, like every ToolBlock body (expanded state only).
- The body area of CodeAccordion no longer shows a pointer cursor.

## Tests

- `ToolBlock.spec.tsx`: keyboard toggle (Enter and Space), actions outside the toggle and not toggling,
  `aria-controls` only while expanded, chevron classes for hover and focus.
- `CodeAccordion.spec.tsx`: the toggle is a button with `aria-expanded` inside the header; chevron present next to
  the open-file control.
- `ChatRow.run-slash-command.spec.tsx`: Enter on the header button expands; the ask/say equality check strips the
  per-instance `id` / `aria-controls`.
- `ReadFileToolRow.spec.tsx` (new): Tab reaches the path button and Enter posts `openFile`.
- Golden regenerated with `UPDATE_GOLDEN=1` after each step and reviewed.

## Left out

- Hover-only controls outside the tool renderers (`ReasoningBlock.tsx:54`, `UserFeedbackRow.tsx:124,133`,
  `ErrorRow.tsx:212,245`, `WarningRow.tsx:59`, `FollowUpSuggest.tsx:153`, `AnnotateButton.tsx:30`,
  `OpenMarkdownPreviewButton.tsx:32`, history rows, `ApiConfigSelector.tsx:194`): not tool rows; same fix pattern
  (`group-focus-visible` / `group-focus-within`) applies.
- `BatchFilePermission.tsx` and `UpdateTodoListToolBlock.tsx` still use `ToolUseBlockHeader`; they are not
  expandable tool rows.
- `CodeAccordion` still contains the literal "User Edits" (i18n item D7); ToolBlock's "failed" label is still
  English (no caller passes `status` yet).
- The 3 `ChatRow.golden-renders` entries broken on main by #673 are fixed by the coordinator separately; this branch
  keeps them as on main.
