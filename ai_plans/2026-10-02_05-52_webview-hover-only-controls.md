# Hover-only controls reachable and visible from the keyboard

Status: done on `fix/webview-hover-only-controls` (follow-up of simplification round 2; the list comes from the
"Left out" section of `ai_plans/2026-10-01_23-20_webview-tool-rows-use-toolblock.md`).

## Touched files

- `webview-ui/src/components/chat/ReasoningBlock.tsx`
- `webview-ui/src/components/chat/ErrorRow.tsx`
- `webview-ui/src/components/chat/WarningRow.tsx`
- `webview-ui/src/components/chat/FollowUpSuggest.tsx`
- `webview-ui/src/components/chat/AnnotateButton.tsx`, `OpenMarkdownPreviewButton.tsx`
- `webview-ui/src/components/chat/ApiConfigSelector.tsx`
- `webview-ui/src/components/history/TaskItem.tsx`, `TaskItemFooter.tsx`, `SubtaskRow.tsx`, `CopyButton.tsx`,
  `ExportButton.tsx`, `DeleteButton.tsx`
- specs: `ReasoningBlock`, `ErrorRow`, `FollowUpSuggest`, `ApiConfigSelector`, `TaskItemFooter`; golden
  `ChatRow.golden.json`

## Problem

Controls hidden with `opacity-0 group-hover:opacity-100` stay invisible to a keyboard user, and some were not
focusable at all:

- `ReasoningBlock.tsx:42-57`: the header was a `div` with `onClick` (not reachable with Tab), its chevron hover-only.
- `ErrorRow.tsx:203-212` (diff error): the header was a `div` with `onClick`; the copy button and chevron
  hover-only. `ErrorRow.tsx:249` and `WarningRow.tsx:59`: the docs link hover-only.
- `FollowUpSuggest.tsx:155-167`: "copy to input" was a `div` with `onClick`, no accessible name, hover-only.
- `AnnotateButton.tsx:30`, `OpenMarkdownPreviewButton.tsx:35`: real buttons, but hover-only.
- History: `TaskItemFooter.tsx:58` hides the copy/export/delete buttons until hover; the row arrows
  (`TaskItem.tsx:107`, `SubtaskRow.tsx:52`) too.
- `ApiConfigSelector.tsx:155-199`: each config entry was a `div` with `onClick`; the pin button had
  `tabIndex={-1}` and was hover-only.
- `UserFeedbackRow.tsx:124,133` (listed in the source plan) already had real buttons with
  `focus-visible:opacity-100`; nothing to do there.

## Fix

- One pattern, next to `group-hover:opacity-100`: `group-has-focus-visible:opacity-100` (the control shows while
  anything in its group has keyboard focus). Where the group element is itself the focused button (history rows,
  subtask row) `group-focus-visible:opacity-100` is added as well, because `:has()` only looks at descendants.
  Checked against Tailwind 4.3.3: `group-has-focus-visible` compiles to `:where(.group):has(:focus-visible) *`.
  Mouse clicks do not trigger it (buttons do not match `:focus-visible` after a click), so the mouse look is
  unchanged.
- Real buttons, no layout change: the ReasoningBlock header becomes a `<button aria-expanded>` with the same flex
  classes plus `w-full` (its inner `div`s become `span`s with the same classes, valid inside a button); the diff
  error title becomes a `<button aria-expanded>` without its own handler, so its click bubbles to the header that
  already toggles (the copy button stays outside it, no nested buttons); the follow-up copy control becomes a
  `<button>` named with the existing `chat:followUpSuggest.copyToInput` key; each API config entry gets the
  ToolBlock overlay pattern (a `<button>` whose `::before` covers the row, the pin button `relative` above it, its
  `tabIndex={-1}` removed). The custom preflight already resets padding, border, background and font on buttons.
- `focus-ring` (the shared focus outline) on the new and the hover-only buttons.

## Tests

- `ReasoningBlock.spec.tsx`: header is a button with `aria-expanded` that toggles; chevron has the focus class.
- `ErrorRow.spec.tsx`: the diff error title is a named button that toggles; the controls and the docs link carry
  the focus class.
- `FollowUpSuggest.spec.tsx`: the copy control is a named button with the focus class and copies with shift; the
  "only usable suggestions" test counts answer buttons only.
- `ApiConfigSelector.spec.tsx`: the pin button is found by name (the old lookup `closest("div")` never found it,
  so "maintains search value when pinning" did not click anything); new test: the pin button is not
  `tabindex=-1`, has the focus class, and the entry is a button that selects.
- `TaskItemFooter.spec.tsx`: the action container has both focus classes.
- Golden `ChatRow.golden.json` (deliberate): `reasoning` (header `div` to `button`, inner `div`s to `span`s, focus
  class), `diff_error` (title `div` to `button`, focus class), `followup` (copy `div` to named `button`, focus
  class), `api_req_started failed` and `api_req_retry_delayed unknown code` (focus class on the docs link). Only
  tags, attributes and classes change; every box keeps its display, padding, margin and font, so row heights are
  unchanged.

## Notes / caveats

- History rows: `TaskItem` is a `<button>` that contains the footer buttons and, in selection mode, a checkbox
  (nested interactive content, pre-existing from #601). They are still reachable with Tab in Chromium, and now
  visible when focused; restructuring the row into the overlay pattern is a separate, larger change.
- The ApiConfigSelector list has no arrow-key navigation; entries are now reachable with Tab, which is the minimum.
