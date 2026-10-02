# One text input family: shadcn Input/Textarea with the VS Code field look

Status: done in two stacked PRs. Part 1 on `refactor/webview-one-text-input` (Input/Textarea look, `start`/`end` slots, `useTextDraft`,
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
  once per edit, on blur or Enter in a single-line field, when the text changed: like the native `change` event.
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

## Part 2: settings and the removal (`refactor/webview-one-text-input-settings`)

Touched: every `components/settings` file that used `ThemedTextField` / `ThemedTextArea` (providers: `shared`,
`Vertex`, `OpenRouter`, `LiteLLM`, `BedrockCustomArn`, `Bedrock`, `ProviderDescriptorForm`, `OpenAICompatible`,
`QwenCode`; `WebToolsSettings`, `MemorySettings`, `ImageGenerationSettings`, `ApiConfigManager`,
`ContextManagementSettings`, `PromptsSettings`), the existing shadcn `Input` users there (`AutoApproveSettings`,
`CreateSkillDialog`, `CreateSlashCommandDialog`), `MaxCostInput`, `MaxRequestsInput`, `common/FormattedTextField.tsx`.
Deleted: `ui/themed-text-field.tsx`, `ui/themed-text-area.tsx`, `ui/hooks/useToolkitTextValue.ts`,
`common/DecoratedVSCodeTextField.tsx`, their specs, and 186 lines of `.ui-text-field*` / `.ui-text-area*` CSS.

- A field whose label was passed as children becomes `<label className="block w-full leading-[normal]"><span
className="block font-medium mb-1">...</span><Input /></label>`: the label wraps the input (implicit
  association, a click on the label focuses the input as before) and `leading-[normal]` keeps the old label line
  height, so the labelled fields measure the same as on main (table below). A help text that sat between label and
  field (descriptor text fields) stays there. OpenRouter's key label shares its row with the balance, so it names
  the input with `htmlFor` instead.
- `onInput` becomes `onChange`; the `(e: any)` / `(e: unknown)` casts and `as HTMLInputElement` reads on these
  fields are gone (18 casts; the 37 left in `webview-ui/src` are on checkboxes, sliders and selects, not text).
  `useProviderField` no longer accepts a native `Event`.
- Fields that parse what is typed keep the typed text with `useTextDraft`: the descriptor integer fields (a value
  below the minimum is not stored but stays shown while typing) and the OpenAI-compatible custom model numbers.
  The four price fields still save when the field is left or on Enter (native `change` before), through
  `useTextDraft`'s `onCommit`. They are one local `ModelInfoNumberField` with a `PriceLabel` instead of six copies.
- The OpenAI-compatible number fields had a `style={{ borderColor }}` (green/red by value) set on the toolkit
  wrapper, which has no border, so it never showed; it is dropped rather than switched on.
- `FormattedTextField` (max cost / max requests) renders `Input` directly; the `$` is a `start` slot.
  `DecoratedVSCodeTextField` drew its own `input.border` overlay (a different colour from every other field, and
  the text colour in themes without `input.border`) and placed the text 24px from the left; the field now has the
  standard border and the text 8px closer to the `$`.
- Rename profile selects its text on focus, as the old field did. The command inputs next to the 32px "Add"
  buttons in auto-approve get `h-8`: before, their auto height let the row stretch them to the button height.
- Existing `Input` users in settings drop the classes that repeated the base look (`bg-*`, `text-*`, `border-*`,
  `px-3 py-2`, `focus-ring`); the skill and slash command dialog name fields become the standard 26px.

Visual check of part 2 (same harness, main vs branch): labelled field, field with help text, price field with
info icon: input at the same offset (19, 35.72, 21px) and the next element at the same offset. Max cost: same
height, standard border, text 8px further left.

Tests: the provider form snapshots (`provider-forms.*.snap`, 50 entries) change only by the markup above; the
table spec finds a field through its label (wrapping or `htmlFor`) instead of `.ui-text-field`; the Ollama context
window cases start from a stored value so that every typed value is a real edit (React reports no change for
typing the value already shown); the QwenCode call-site spec keeps the settings value in state because the field is
controlled; barrel mocks use the real `Input` / `Textarea`. The DEP-9 characterization specs stay and pass.
