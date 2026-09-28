# UI §2.12 part c: one checkbox, one button with an icon variant, one icon button (2026-09-28)

Source: `ai_plans/2026-09-27_ui-modernization.md` §2.12 ("One checkbox, one button (with an `icon` variant), one
icon button, one text field") and roadmap item D12 ("three checkbox components, two buttons, three icon
buttons, three text inputs"). Third branch of the stack, based on `refactor/ui-12b-no-styled-components`.

## Inventory (verified with `git grep` on the stack base)

| Kind        | Before                                                                                                                                                                       | After                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkbox    | `ui/checkbox.tsx` (Radix, 7 uses in 5 files), `ui/vscrui-checkbox.tsx` (boolean `onChange`, 21 uses in 8 settings files), `ui/labeled-checkbox.tsx` (native input, 27 files) | `LabeledCheckbox` only, with `onCheckedChange(checked)` and `indeterminate` taken over from the vscrui adapter; `@radix-ui/react-checkbox` removed                                   |
| Button      | `ui/button.tsx` (`Button`, 62 files), `ui/themed-button.tsx` (7 uses in 5 files: 6 icon, 1 secondary)                                                                        | `Button` only; new `variant="icon"` (the former ThemedButton icon look, `.ui-button-icon` in index.css, default `type="button"`, 16px content wrapper)                               |
| Icon button | `chat/IconButton.tsx` (codicons), `chat/LucideIconButton.tsx` (lucide), `common/IconButton.tsx` (toolbar)                                                                    | `ui/icon-button.tsx` `IconButton`: `icon` is a codicon name or a lucide component; `variant="chrome"` (default, the two chat ones) or `"toolbar"` (built on `Button variant="icon"`) |
| Text field  | `ui/input.tsx` (`Input`, 10 files), `ui/themed-text-field.tsx` (23 files), `common/FormattedTextField` (3 files)                                                             | unchanged, see follow-ups                                                                                                                                                            |

## Behaviour and look changes (intended by the plan, not covered by "no change")

- The 7 former Radix checkboxes (history select-all and row, skill mode pickers in settings and the create
  dialog, worktree force delete) take the VS Code checkbox look (18px box, VS Code checkbox colours) instead of
  the 16px shadcn box; they are native inputs now, so `toBeChecked()` and label clicks behave as before.
- The terminal profile "Configure" button moves from the toolkit secondary look to `Button variant="secondary"`
  (same colours, the shared height and padding).
- Toolbar icon buttons (image viewer, Mermaid, zoom, modal close) gain the icon look's focus ring and pressed
  fill, a `type="button"`, and working tooltips: the old `common/IconButton` did not spread props, so the
  tooltip trigger's handlers and ref never reached the button and those tooltips never opened.
- Codicon chrome buttons (mode, API config, worktree selectors) use the lucide variant's disabled rules (no
  hover brightening while disabled); none of those call sites is ever disabled.

## Tests

1. Commit 1 (green on the parent branch): `ui/__tests__/primitives.call-sites.spec.tsx` pins the call sites that
   no other spec renders with the real primitive (history row checkbox, worktree force checkbox with label
   click and `worktreeForce`, Mermaid toolbar glyphs and click routing, code index reset buttons as non-submit
   titled buttons). `TaskGroupItem.spec` asserted Radix's `data-state`; it now asserts `toBeChecked()`.
2. Commit 2 keeps them green. Moved or renamed with the components: `vscrui-checkbox.spec` became
   `labeled-checkbox.checked-change.spec` (same assertions on `onCheckedChange`/`indeterminate`),
   `themed-button.spec` became `button.icon-variant.spec`. Spec mocks of the removed modules now mock
   `labeled-checkbox` / provide `LabeledCheckbox`, `Button` or the real `IconButton`.
3. `ChatRow.golden.json` regenerated: only the ErrorRow copy button changes (`ui-themed-button` ->
   `ui-button-icon`, `data-appearance` dropped, content span class renamed).

## Follow-ups (not done here)

- One text field: `Input` (10 files, shadcn look) vs `ThemedTextField` (23 files, toolkit look with start/end
  slots) vs `FormattedTextField` (3 files, a formatting wrapper). Needs a look decision and an API bridge
  (`onInput` vs `onChange`), so it is its own item.
- Raw `<input type="checkbox">` in `chat/ApiConfigSelector.tsx` (mode checklist) and
  `code-index/CodeIndexWorkspaceToggles.tsx` could move to `LabeledCheckbox`.
- `Button`'s remaining non-icon variants still carry shadcn names (`primary`, `secondary`, `ghost`, ...); the
  former toolkit primary look has no user left and was removed with ThemedButton.
