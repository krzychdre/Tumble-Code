# Webview i18n and accessibility leftovers (round 2, D7)

Status: done on `fix/webview-i18n-and-a11y-leftovers`

## Touched files

- 18 webview locales (`webview-ui/src/i18n/locales/*/{chat,common,history,settings,prompts}.json`): 39 new keys,
  translated in every locale.
- Hard-coded strings: `chat/UpdateTodoListToolBlock.tsx`, `chat/ContextMenu.tsx`, `modes/McpServerChecklist.tsx`,
  `modes/McpServerRestriction.tsx`, `modes/CreateModeDialog.tsx`, `settings/providers/Bedrock.tsx`,
  `chat/rows/renderers/say/StatusRows.tsx`, `chat/rows/renderers/tool/ExpandableToolRows.tsx`,
  `common/CodeAccordion.tsx`, `chat/AutoApproveDropdown.tsx`, `chat/Markdown.tsx`, `common/ImageBlock.tsx`.
- Literal `aria-label` / `title` / `placeholder`: `history/HistoryView.tsx`, `settings/SettingsSearchInput.tsx`,
  `common/TelemetryBanner.tsx`, `chat/CommandPatternSelector.tsx`, `chat/OpenMarkdownPreviewButton.tsx`,
  `chat/ApiConfigSelector.tsx`, `chat/AutoApproveDropdown.tsx`, `chat/ModeSelector.tsx`,
  `modes/GlobalCustomInstructionsSection.tsx`, `modes/ModeCustomInstructionsSection.tsx`,
  `settings/providers/OpenRouter.tsx`, `chat/Markdown.tsx`, `common/ImageBlock.tsx`.
- Decorative icons: about 60 component files (codicons), plus the 15 lucide icons with `aria-label="... icon"`.
- Focus rings: `settings/{SettingsSearchInput,CreateSlashCommandDialog,CreateSkillDialog,SettingsSearchResults}.tsx`,
  `common/MermaidButton.tsx`, `chat/{ModeSelector,ApiConfigSelector,SubagentsPanel,UpdateTodoListToolBlock}.tsx`,
  `code-index/CodeIndexDisclosure.tsx`.
- Specs: `UpdateTodoListToolBlock.spec.tsx`, `UserEditTodosRow.spec.tsx`, `OpenMarkdownPreviewButton.spec.tsx`,
  `ApiConfigSelector.spec.tsx`, `ChatRow.run-slash-command.spec.tsx`, `ChatRow.golden.json`.

## Problem

- English text rendered directly: `UpdateTodoListToolBlock.tsx:39,215,233,246,274,306,321` (and the rest of that
  block: Edit/Done, Add, Cancel, "+ Add Todo", the delete confirmation, Delete, status names),
  `ContextMenu.tsx:172,305`, `McpServerChecklist.tsx:45` (and "(not connected)"), `McpServerRestriction.tsx:138` and
  `CreateModeDialog.tsx` ("Restrict to specific MCP servers"), `Bedrock.tsx:59`, `StatusRows.tsx:158`,
  `ExpandableToolRows.tsx` ("Arguments:"), `CodeAccordion.tsx` ("User Edits"), `AutoApproveDropdown.tsx:337`
  ("Enabled"), `Markdown.tsx:36` ("Copy as markdown"), `ImageBlock.tsx:61` (alt "AI Generated Image").
- Literal attributes: `HistoryView.tsx:158`, `SettingsSearchInput.tsx:67`, `TelemetryBanner.tsx:37`,
  `CommandPatternSelector.tsx:119`, `OpenMarkdownPreviewButton.tsx:30,33`, `ApiConfigSelector.tsx:266,362,369`,
  `AutoApproveDropdown.tsx:333`, `ModeSelector.tsx:253`, `GlobalCustomInstructionsSection.tsx:70`,
  `ModeCustomInstructionsSection.tsx:121`, `OpenRouter.tsx:83`, `UpdateTodoListToolBlock.tsx:274,306,307,321`.
- 15 lucide icons carried `aria-label="... icon"` (e.g. `FileToolRows.tsx:25`), so screen readers read "Read file
  icon" before the row title.
- Codicon spans (`<span className="codicon ...">`) next to visible text or inside a labelled control had no
  `aria-hidden`.
- `outline-none` / `focus:outline-0` removed the focus outline with nothing in its place on several inputs and
  buttons (e.g. `CreateSkillDialog.tsx:171`, `ModeSelector.tsx:258`).

## Fix

- New keys (English in `en`, real translations in the other 17 locales). Existing keys are reused where the text is
  the same: `chat:autoApprove.toggleAriaLabel`, `prompts:modes.selectMode` ("Search modes"),
  `settings:sections.slashCommands`, `common:confirmation.editMessage` / `deleteMessage`.
- Lucide "... icon" labels become `aria-hidden="true"`. The edit and delete icons in the user message row
  (`UserFeedbackRow.tsx`) were the only name of two clickable `div`s; those are now buttons labelled with the
  existing "Edit Message" / "Delete Message" strings (and they also show on keyboard focus). They are `display: block` like
  the `div`s they replace, so the line box and the row height stay the same.
- Codicons: `aria-hidden="true"` was added by a script that only touches a codicon element without `onClick`,
  `role`, `title`, `aria-label`, `tabIndex` or `slot`, with no children, and whose parent (up to three levels) has
  visible text or an `aria-label` / `title`. 115 codicons. The file icon in the context menu had `alt="Mode"`; it is
  now `alt=""` and hidden.
- The three `aria-label`led `div`s in `ApiConfigSelector` get `role="group"` so the label is announced.
- Focus: `outline-none` / `focus:outline-none` / `focus:outline-0` replaced by the shared `focus-ring` class
  (`index.css`, 1px `--ring` outline on `:focus-visible`) in 10 places.

## Tests

- `node scripts/find-missing-translations.js`: all locales complete.
- Specs that assert the old English strings now assert the keys (the test `t` returns keys).
- `ChatRow.golden.json` regenerated once after rebasing on #692 (87 entries): `aria-hidden` added, `aria-label="...
icon"` removed, translated text now shows its key, the two user message icon `div`s are buttons.

## Left out (with reason)

- `ui/themed-progress-ring.tsx` keeps its default `aria-label="Loading"`: the ui primitives do not depend on the
  translation context, and importing it there pulls the i18next setup into every spec that mocks `react-i18next`
  without `initReactI18next` (20 specs). Call sites can pass a translated `aria-label`.
- 31 codicons are the only content of a button that has no accessible name (e.g. `ApiConfigManager.tsx:215-289`,
  `ModeSelectorRow.tsx:153-297`, `history/{Copy,Delete,Export}Button.tsx`, `MermaidBlock.tsx:154`,
  `ChatView.tsx:594`, `CheckpointMenu.tsx:107`, `QueuedMessages.tsx:101`, `ErrorRow.tsx:218`,
  `ui/icon-button.tsx:57`): the icon is not decorative there; the fix is an `aria-label` on the button (usually the
  text of its tooltip), a separate item.
- `outline-none` kept where something else marks focus: `ui/badge.tsx`, `common/Tab.tsx`,
  `CommandPatternSelector.tsx:111`, `QueuedMessages.tsx:78` (ring on focus), `ui/select.tsx` (focus-visible border),
  `ui/command.tsx` (input inside a bordered field, items show the selection background), `ui/popover.tsx` (the
  popover container), `ChatTextArea.tsx:452,457` (non-focusable wrappers).
- Not translated: brand names, URLs (`CloudView.tsx:267` placeholder), the `alt="Roo logo"` brand image, code
  comments.
