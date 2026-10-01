# Density tokens outside the chat (D2)

Status: done on `feat/webview-density-tokens-outside-chat` (PR open, not merged). Stacked on
`refactor/webview-typography-and-noise`, which is stacked on `chore/webview-small-leftovers` (same settings, Modes
and MCP files).

## Touched files

- `webview-ui/src/index.css`: two new density tokens (`--spacing-section`, `--spacing-page`) and their compact values
- Settings: `settings/Section.tsx`, `settings/SectionHeader.tsx`, and the row/group spacing in `About`, `ApiOptions`,
  `AutoApproveSettings`, `CheckpointSettings`, `ContextManagementSettings`, `CustomToolsSettings`,
  `ImageGenerationSettings`, `MemorySettings`, `NotificationSettings`, `PromptsSettings`, `SkillsSettings`,
  `SlashCommandsSettings`, `TemperatureControl`, `TerminalSettings`, `UISettings`, `WebToolsSettings`
- MCP: `mcp/McpView.tsx` (541 to 129 lines), new `mcp/ServerRow.tsx`, `mcp/McpEnabledToggle.tsx`,
  `mcp/McpResourceRow.tsx`, new `mcp/__tests__/ServerRow.spec.tsx`
- Modes: `ModesView`, `ModeSelectorRow`, `ModePromptFields`, `ModeToolsSection`, `ModeCustomInstructionsSection`,
  `SystemPromptSection`, `GlobalCustomInstructionsSection`, `McpServerChecklist`, `McpServerRestriction`
- `settings.json` in 18 locales (`ui.density` label and description), `react-compiler-bailouts.json`,
  `docs/05-webview-ui.md`

## Problem

The density tokens from UI-1 (`--spacing-row` 8px, `--spacing-block` 12px, `--spacing-gutter`, `index.css:34-36`)
were used only in `ChatRow.tsx` and the chat row renderers, so the `uiDensity` setting ("Chat density") changed
nothing outside the chat. The settings pages spaced themselves with literal Tailwind steps (`Section`:
`gap-4 py-2`, `SectionHeader`: `pt-6 pb-4`, groups `gap-3`, rows `mt-4`, `space-y-6`), the Modes page the same, and
the MCP page was almost all inline styles (45 `style={{...}}` objects in `McpView.tsx`, with the 350-line
`ServerRow` inside it; margins of 5, 10, 15 and 20px, `fontSize: "12px"` / `"13px"` / `"14px"`).

## Fix

- Two more density tokens, so the existing settings spacing maps one to one at the default density:
  `section` 16px (compact 12px) and `page` 24px (compact 16px), next to `row` 8px (4px) and `block` 12px (8px).
  Vertical spacing only; the horizontal paddings (`px-5`, the gutter) stay, so compact never squeezes text sideways.
- Settings: `Section` is `gap-section py-row`, `SectionHeader` `pt-page pb-section`, nested setting groups
  `gap-block`, setting rows `mt-section`, the `space-y-*` wrappers and empty states on the tokens. At the default
  density every replaced value is the same number of pixels as before.
- Modes page: the section margins (`mb-4`, `mb-3`, `mb-2`, `pb-4`, `mt-3`, `mt-2`) on the tokens; the dialogs keep
  their own spacing.
- MCP: `ServerRow` is its own file, Tailwind only, same layout (chevron, name with source badge, delete and restart,
  status dot, toggle; tabs, network timeout, error with retry). The page around it is Tailwind too. Changes worth
  knowing: the 10px gaps became 8px or 12px tokens and the 15px ones 12px; the status dot uses the chat's
  `--status-done/-waiting/-failed` tokens (charts green / yellow / error red) instead of the testing icon colours;
  the delete and restart codicons are the default 16px like every other icon button in settings (were 14px); the
  native timeout `<select>` shows the shared focus ring instead of `outline: none`. `ServerRow` now compiles with the
  React Compiler (removed from the bailout baseline).
- The setting is renamed "Density" with a description that names the chat, the settings and the MCP and Modes pages,
  in all 18 locales.

## Tests

- `mcp/__tests__/ServerRow.spec.tsx`: expand on click and the timeout select, the status dot per state, restart and
  delete (with the confirmation) without expanding, the error state with retry.
- `ui/__tests__/panels.call-sites.spec.tsx` (tabs of an expanded server) still passes unchanged.
- 49 spec files that import a touched component: pass. tsc, eslint, prettier, radius and React Compiler checks,
  translations, knip: clean.

## Notes

- Not converted yet: the settings tab list in `SettingsView` (fixed `h-12` rows), label/description spacing (`mt-1`,
  `mb-1`), dialogs, Marketplace and History. The tokens are in place for them.
- Still English in the MCP rows (from before): `Toggle <name> server` (aria-label), and `Returns`, `No description`,
  `Unknown` in `McpResourceRow`.
- The network timeout is still a native `<select>`; moving it to the shared `Select` belongs to the control-family
  item.
