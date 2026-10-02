# One text input family: shadcn Input/Textarea with the VS Code field look

Status: part 1 of 2 on `refactor/webview-one-text-input` (Input/Textarea look, `start`/`end` slots, `useTextDraft`,
every call site outside `components/settings`). Part 2 (`refactor/webview-one-text-input-settings`, stacked on
part 1) migrates `components/settings` and `FormattedTextField`, then deletes `ThemedTextField`, `ThemedTextArea`,
`DecoratedVSCodeTextField`, `useToolkitTextValue` and the `.ui-text-field*` / `.ui-text-area*` CSS. Round 2 plan
item D3 step 2.

## Touched files (part 1)

- `webview-ui/src/components/ui/input.tsx`, `textarea.tsx`, `hooks/useTextDraft.ts` (new), `hooks/index.ts`
- `webview-ui/src/index.css` (marker rules for `.ui-input` / `.ui-textarea`)
- modes: `CreateModeDialog.tsx`, `ModePromptFields.tsx`, `ModeCustomInstructionsSection.tsx`,
  `GlobalCustomInstructionsSection.tsx`, `ModeSelectorRow.tsx`, `modePromptUpdates.ts`
- `history/HistoryView.tsx`, `cloud/CloudView.tsx`
- code-index: `EmbedderFormFields.tsx`, `CodeIndexSetupFields.tsx`, `embedderForms.tsx`
- chat (raw `<input>`): `ModeSelector.tsx`, `ApiConfigSelector.tsx`, `CommandPatternSelector.tsx`, `SubagentsPanel.tsx`
- specs: `ui/__tests__/input.spec.tsx` (new), `text-field.call-sites`, `text-area.call-sites`, modes specs,
  `CloudView.spec.tsx`, `ApiConfigSelector.spec.tsx`, `CommandPatternSelector.spec.tsx`

## Problem

Two control families for text. `ThemedTextField` (24 files) and `ThemedTextArea` (6 files) clone the removed
toolkit: their `onChange` is the native `change` event (fires when the field is left), so call sites read
`(e.target as HTMLInputElement).value` or cast `(e: any)`; per-keystroke handlers go through `onInput`; a label is
passed as children; `className` lands on a wrapper. The shadcn `Input` / `Textarea` (16 call sites) have React's
API but a different look (no fixed height, 12px padding, `text-base` line height 1.5).

## Fix

- `Input` / `Textarea` keep the shadcn API (React `ChangeEvent`, `className` on the element) and take the themed
  field's look, measured below: 26px high, 9px horizontal padding (`Textarea`: 9px all round), dropdown border,
  input colours, editor font size with `line-height: normal`, focus as a focusBorder-coloured border without
  outline, `#757575` placeholder, 40% opacity when disabled. `.ui-input` / `.ui-textarea` are markers for the
  unlayered rules in `index.css` (VS Code < 1.104 `input:focus` / `textarea:focus` outline, textarea scrollbar).
- `Input` gets optional `start` / `end` slots (the toolkit's `slot="start"` / `slot="end"`). With a slot the border
  moves to a wrapper and `className` goes there; the props stay on the `<input>`. Passing the prop at all (even
  `null`) selects the wrapper, so the history search's clear button can appear while typing without remounting
  the input (spec covers focus).
- `useTextDraft(value, onCommit?)` keeps the toolkit's "typed text stays until `value` changes" behaviour where it
  matters: fields that parse what is typed (code-index dimension) and fields that save only when left (mode role
  definition, description, when to use, custom instructions, global custom instructions: they rewrite the mode
  file or post to the host, so per-keystroke saving would also trim away a typed trailing space). `onCommit` runs
  on blur when the text changed, like the native `change` event.
- The rename field in `ModeSelectorRow` selects its text after focusing (the old field selected on focus).
- `CloudView` manual callback URL: the old native-`change` handler saw the text only on blur, so Enter read an
  empty state and the "auto-send when pasted" branch only ran on blur. Now the state follows every keystroke,
  Enter works, and the auto-send runs only for a paste (`inputType === "insertFromPaste"`), so a half-typed URL is
  never sent.
- Raw text `<input>`s in chat popovers (mode search, API config search, command pattern edit, subagent answer) use
  `Input` with their own size classes kept; their focus becomes the shared border colour instead of a ring.
  `UpdateTodoListToolBlock`'s inline underline editors stay raw inputs (a different control, not a boxed field).

## Visual check (headless Chrome, compiled `index.css` of main vs this branch)

Old markup (ThemedTextField/Area) against the new markup, 300px column, Dark+ like variables:

| case                                   | old                                                         | new                        |
| -------------------------------------- | ----------------------------------------------------------- | -------------------------- |
| field box                              | 300x26, border 1px #3c3c3c, bg #3c3c3c, 13px, padding 0 9px | identical                  |
| text area rows=4                       | 300x80, padding 9px                                         | identical                  |
| search with icon and clear button      | text starts at x=25.8                                       | identical                  |
| field in a flex column                 | next element at +38px                                       | identical                  |
| field in a block (`div`)               | 3.25px blank line box below (inline-block wrapper)          | gone                       |
| text area in a block                   | 4.25px blank below                                          | gone                       |
| field with a call-site `<label>` child | label line 15px (`line-height: normal`)                     | 16.25px (body line height) |

Existing shadcn `Input` users (marketplace search, install parameters, worktree modal, create-mode name/slug)
become 26px instead of about 29.5px and get 9px padding instead of 12px: the same look as every other field.
The chat popover inputs keep their size.

## Tests

- `input.spec.tsx`: props/`className` on the input and per-keystroke `onChange`; slot wrapper; an `end` slot
  appearing while typing keeps the same focused input; `Textarea` classes; `useTextDraft` keeps the typed text
  across re-renders, commits on blur only when changed, follows a new value.
- The DEP-9 characterization specs (`text-field.call-sites`, `text-area.call-sites`, ModesView re-render specs) keep
  pinning "saved when the field is left": leaving now fires `change` then `blur`.
- `CloudView.spec.tsx`: a typed URL is sent only on Enter, a pasted one at once.
- `ApiConfigSelector.spec.tsx` (barrel mock gets the real `Input`), `CommandPatternSelector.spec.tsx` (the row
  lookup skipped the input's own `flex` class).

## Notes / caveats

- Error borders (`border-[var(--vscode-inputValidation-errorBorder)]`) on the code-index fields were set on the
  toolkit wrapper, which has no border, so they never showed. On `Input` they now show on a field with an error.
