# One select control in the webview (D3, step 1)

Status: done on `refactor/webview-one-select` (PR open, not merged).

## Touched files

- `webview-ui/src/components/settings/providers/ProviderDescriptorForm.tsx` (`SelectField`)
- `webview-ui/src/components/code-index/EmbedderFormFields.tsx` (`ModelDropdownField`)
- `webview-ui/src/components/settings/ImageGenerationSettings.tsx`
- `webview-ui/src/components/ui/badge.tsx` (new `count` variant, renders a `span`)
- `webview-ui/src/components/chat/rows/renderers/tool/ExpandableToolRows.tsx`,
  `webview-ui/src/components/chat/context-management/CondensationResultRow.tsx`
- deleted: `components/ui/themed-dropdown.tsx`, `components/ui/themed-badge.tsx` and their specs; their exports in
  `components/ui/index.ts`; the `.ui-dropdown*` and `.ui-badge*` blocks in `index.css` (190 lines)
- specs: `ui/__tests__/dropdown.call-sites.spec.tsx`, `ui/__tests__/badge.call-sites.spec.tsx`,
  `code-index/__tests__/CodeIndexPopover.per-provider.spec.tsx`, `settings/__tests__/ApiOptions.spec.tsx`,
  the descriptor form snapshot and the ChatRow golden file

## Problem

Two control families coexist in the webview: the shadcn/Radix controls (`Select` in 22 files) and the in-repo
clones of the removed VS Code toolkit (`Themed*`). `ThemedDropdown` (290 lines plus about 150 lines of `.ui-dropdown`
CSS) had only three users: the select field kind of `ProviderDescriptorForm` (MiniMax, Moonshot, Z.ai endpoints), the
embedding model of the codebase index and the image generation model. Next to the Radix `Select` used everywhere
else in the same settings pages they looked and behaved differently (different chevron, list, keyboard model).
`ThemedBadge` had two users and the `Badge` primitive one.

## Fix

- The three dropdowns are `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem`, the pattern
  `Vertex.tsx` and `Bedrock.tsx` already use. The field labels now point at the trigger (`htmlFor` + `useId`), so the
  combobox has an accessible name.
- Behaviour kept: a stored value the list does not offer shows the first option (provider endpoint) or the
  placeholder (embedding model). The embedding model list no longer has an "empty" option, because Radix items cannot
  have the value `""`: the "Select a model" text is the placeholder instead. Picking it back was never useful (an empty
  model is a validation error on Save).
- Behaviour dropped: the toolkit-only keyboard quirks (Arrow keys on the closed dropdown committing at once,
  type-ahead commit). The Radix select opens on Arrow keys and commits on Enter, like every other select here.
- `ThemedBadge` becomes `Badge variant="count"`: VS Code's badge colours, 18px tall, 11px text, as before, and the call
  sites' `style` / `className` now land on the one element. `Badge` renders a `span` (it sits inside buttons in the chat
  row titles). The ChatRow golden diff is the six badge renders: one `span.ui-badge > span.ui-badge-control` pair
  becomes one `span` with utility classes; the pill keeps its 18px height, so the row height does not change.
- No `.ui-*` class in `index.css` is left without a user (checked by grepping every class name in the TSX sources).

Left as they are:

- `ThemedRadio` (1 user, `CreateModeDialog`) and `ThemedPanels` (1 user, `McpView`): there is no direct equivalent
  any more (the unused Radix `RadioGroup` was deleted in #671 and there is no Tabs primitive). Replacing them means
  adding a new primitive; that belongs to the next step together with the MCP view restyle.
- `ThemedTextField` (21 files) and `ThemedTextArea` (6) wait for the owner's decision. Note for that step:
  `ThemedTextField.onChange` is typed `(event: Event) => void` and passes the native `change` Event (the toolkit's
  contract), and `onInput` is used the same way, which is why there are about 55 `(e: any)` casts in the webview call
  sites. Moving to `Input` / `Textarea` with React's `ChangeEvent<HTMLInputElement>` removes them.

## Tests

- `dropdown.call-sites.spec.tsx` rewritten for the Radix select: options listed by opening the list, a choice saves
  once and is not echoed back on prop changes, unknown values fall back as described, the label names the trigger,
  the error class lands on the trigger. The toolkit's "Arrow key on the closed dropdown commits" case is removed with
  the behaviour.
- `badge.call-sites.spec.tsx`: the call sites' class and font size on the `count` badge.
- `CodeIndexPopover.per-provider.spec.tsx`: finds the model field by its accessible name.
- Descriptor form snapshots (10) and ChatRow golden (6 renders) regenerated and reviewed.

## Notes

- `provider-forms.openai-native.spec.tsx` snapshots fail on main since #702 (the info icon got `aria-hidden`); that is
  not touched here.
