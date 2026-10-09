# Keyboard access: history subtask toggles and the modes config menu

## Status

Done on branch `feat/a11y-history-modes` (round 2 of the frame-language work: keyboard access and labels).

## Related plans

- 2026-10-09_ui-frame-language.md ("Open items": `history/SubtaskCollapsibleRow` and `modes/ModesViewHeader`)

## Touched files

- webview-ui/src/components/history/SubtaskCollapsibleRow.tsx
- webview-ui/src/components/history/SubtaskRow.tsx
- webview-ui/src/components/history/TaskGroupItem.tsx
- webview-ui/src/components/history/__tests__/SubtaskRow.spec.tsx
- webview-ui/src/components/history/__tests__/TaskGroupItem.spec.tsx
- webview-ui/src/components/modes/ModesViewHeader.tsx
- webview-ui/src/components/modes/__tests__/ModesView.sections.spec.tsx

## What changed per screen

### History: "N subtasks" toggle (task card and nested subtasks)

- Problem: the toggle was a `div role="button"` without `tabIndex` and without key handling, so Tab skipped it
  and Enter/Space did nothing. The same component draws the nested toggle inside `SubtaskRow`, so both had it.
- Fix: `SubtaskCollapsibleRow` is now a real `<button type="button">`, full width (`w-full`, `text-left`,
  transparent background, no own border so the card's `border-t border-frame` hairline still draws), with the
  focus ring. `aria-expanded` and the existing expand/collapse `aria-label` stay. The click handler is the same
  (`stopPropagation` then `onToggle`), so toggling still never opens the task. The chevron is `aria-hidden`.
- Related fix: a collapsed list stays mounted (it animates `max-h`), so its rows were still reachable with Tab
  while invisible. The collapsed containers in `TaskGroupItem` and `SubtaskRow` now get `inert`, which takes
  them out of the Tab order until they are expanded.

### Modes: config file menu (`{}` button in the header)

- Problem: the two menu entries were `div`s triggered on `mousedown`; the keyboard could not reach them and the
  trigger closed the menu on blur, so focus could not move into it.
- Fix (menu button pattern): the trigger has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`.
  The menu is `role="menu"` with two `<button role="menuitem">` entries (roving focus, `tabIndex=-1`).
  Opening it (click, Enter, Space or Arrow Down on the trigger) focuses the first entry; Arrow Up/Down (wrapping),
  Home and End move; Enter/Space picks; Escape closes and returns focus to the trigger; Tab away closes it.
  Closing on blur now happens on the wrapper only when focus leaves both trigger and menu, which replaces the
  old 200 ms blur timer.
- Mouse behaviour: same result. Entries keep `mousedown` `preventDefault` (focus does not jump) and now act on
  `click`; a click anywhere else still closes the menu through the existing document listener. Visual classes
  from the restyle are unchanged (an entry also shows the hover background when it has focus).

No new i18n keys (the menu reuses `prompts:modes.editModesConfig` as its label).

## Tests run

Written first and confirmed failing on main (5 failures), then green after the fix:

- `SubtaskRow.spec.tsx`: nested toggle is a button, reached by Tab after the task row, Enter and Space toggle,
  no `showTaskWithId`; collapsed child list is `inert`, expanded is not.
- `TaskGroupItem.spec.tsx`: toggle is a `type="button"` with `aria-expanded` and the focus ring, reached with Tab,
  Enter/Space toggle, does not open the task, a parent click handler is not reached; `subtask-list` is `inert`
  only when collapsed.
- `ModesView.sections.spec.tsx`: trigger aria, Enter opens with focus on the first item, Arrow keys wrap, Escape
  returns focus to the trigger, Enter/Space pick, Tab away closes; the existing mouse test now sends
  mousedown + click.

Commands (from webview-ui):

- `vitest run src/components/history src/components/modes --maxWorkers=2`: 22 files, 236 tests passed
- `tsc --noEmit -p .`: clean
- `eslint <touched files> --max-warnings=0`: clean
- `node ../scripts/check-webview-radius.mjs`: clean
