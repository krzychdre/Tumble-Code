# UI frame language: Settings and Modes

**Status:** done on `feat/ui-frame-settings`, PR open, not merged.
**Related plans:** `2026-10-09_ui-frame-language.md` (the tokens and rules this branch applies).
**Demo:** `assets/2026-10-09_ui-frame-language-demo-screens.html`, sections "Settings" and "Modes", Proposal column.

## Touched files

New: `webview-ui/src/components/settings/SettingsCard.tsx` (`SettingsCard`, `SettingsNested`,
`settingDescription`, `checkboxDescription`).

Settings: `SettingsView.tsx`, `Section.tsx`, `SectionHeader.tsx`, `SettingsSearch.tsx`, `SettingsSearchInput.tsx`,
`SettingsSearchResults.tsx`, `ApiOptions.tsx`, `ModelPicker.tsx`, `ModelInfoView.tsx`, `TemperatureControl.tsx`,
`Verbosity.tsx`, `AutoApproveSettings.tsx`, `AutoApproveToggle.tsx`, `AutoApproveModeSelector.tsx`,
`MaxLimitInputs.tsx`, `TerminalSettings.tsx`, `NotificationSettings.tsx`, `UISettings.tsx`,
`ContextManagementSettings.tsx`, `PromptsSettings.tsx`, `ExperimentalSettings.tsx`, `ExperimentalFeature.tsx`,
`ImageGenerationSettings.tsx`, `CustomToolsSettings.tsx`, `CheckpointSettings.tsx`, `SkillsSettings.tsx`,
`SlashCommandsSettings.tsx`, `MemorySettings.tsx`, `WebToolsSettings.tsx`, `SubagentSettings.tsx`,
`LanguageSettings.tsx`, `About.tsx`; providers: `shared.tsx`, `ProviderDescriptorForm.tsx`, `OpenRouter.tsx`,
`LiteLLM.tsx`, `BedrockCustomArn.tsx`, `Bedrock.tsx`, `Vertex.tsx`, `OpenAICompatible.tsx`,
`OpenAICodexRateLimitDashboard.tsx`.

Modes: `ModesView.tsx`, `ModesViewHeader.tsx`, `ModeSelectorRow.tsx`, `ModePromptFields.tsx`, `ModeToolsSection.tsx`,
`ModeCustomInstructionsSection.tsx`, `SystemPromptSection.tsx`, `CreateModeDialog.tsx`.

Specs: `SettingsView.unsaved-dots.spec.tsx` (focus ring assertion), `provider-forms.table.spec.tsx` (API key notice
now shares a wrapper with its input), three provider-form snapshots updated.

## What changed per screen

- **Header**: the search box uses the default 26px input (no own `input-border`, height or focus border). The
  results dropdown has `border-frame-hover`, `rounded-floating` and a shadow; group headers draw a real
  `border-b border-frame`; the highlighted result is `bg-selected` instead of the full primary fill.
- **Sidebar**: divider `border-frame` (it was the sidebar background colour, so invisible). Tabs are 30px, inset
  (`mx-1.5`, `rounded-control`), in the description colour; hover `bg-surface-hover` + foreground; the active tab is
  `bg-selected` + foreground with a 2px focus bar drawn by a `before:` pseudo-element. The `ring-2` of the shared
  `TabTrigger` is cancelled (`focus:ring-0`) in favour of the 1px `focus-visible` outline. Compact (icon only)
  mode centres the icon in a 40px inset row.
- **SectionHeader**: editor background with `border-b border-frame` instead of the sidebar-coloured band.
  `Section` gets 16px top / 24px bottom padding to match.
- **Cards**: `SettingsCard` is a `bg-surface border-frame rounded-control` card; every direct child is a row padded
  10px 12px and separated by `border-t border-frame`, so call sites only list their settings. An optional small
  uppercase label above the card reuses an existing heading (Terminal Basic / Advanced, the Auto-approve
  read / write / follow-up / execute groups, Skills and Slash commands workspace / global). No new i18n keys.
  Applied to Providers (profile manager card + provider form card), Auto-approve, Terminal, Notifications, UI,
  Context management, Prompts, Experimental, Checkpoints, Skills, Slash commands, Memory, Web tools, Subagents,
  Language, About.
- **Descriptions**: one style, `text-sm text-vscode-descriptionForeground mt-0.5`; under a checkbox it is indented
  `ml-6` to the label text. The `ml-5`, `-mt-2`, `text-xs` and `text-muted-foreground` variants are gone from the
  sections above. The `-mt-2` under provider API keys / URLs was compensating the form gap; label and notice
  now share one wrapper instead.
- **Nested sub-options**: `SettingsNested` (1px `border-frame-hover` rule + indent) replaces
  `border-l-2 border-vscode-button-background` everywhere in settings.
- **Custom tools / Codex rate limits / Skills / Slash commands**: tool and limit cards use `bg-surface border-frame
  rounded-control`; skill and command rows lost the `border-transparent` box and sit as card rows; footers use
  `border-frame` with the 20px page gutter and description colour. The Skills mode dialog rows hover with
  `bg-surface-hover` and the separator is `bg-frame`.
- **Auto-approve tiles**: no more `!bg-orange-600 !text-white`. Tiles are outlined (`border-input-frame`,
  transparent); on = `bg-selected` + `border-vscode-focusBorder` + check icon; bypass / autonomous and the toggles
  they force = `bg-orange-600/15` + `border-orange-600`. `AutoApproveModeSelector` is also used by the composer
  popover, so it gets the same look there.
- **ApiOptions**: the Advanced disclosure trigger has the focus ring and a surface hover; the unavailable-provider
  note is framed with `border-frame`.
- **Modes**: the config dropdown in the header has `border-frame-hover`, `rounded-floating`, a shadow and inset
  items with `bg-surface-hover`; the mode combobox and its search are 26px; API configuration, prompt fields,
  tools and custom instructions sit in one `SettingsCard` with `font-medium` titles (was `font-bold`); the system
  prompt divider, `<pre>` and dialog footers use `border-frame`.

## Left as is

- The Modes header config menu items are `div`s without `tabIndex`; they got the focus-ring classes but are still
  not reachable by keyboard. Making them buttons is a behaviour change, out of scope for a styling branch.
- `McpServerChecklist` keeps `ml-6`: it is a list indented under its checkbox, which is the target alignment.
- `ModelInfoView` shows an em dash character as the empty price placeholder; it is UI text, not changed here.
- Provider sub-forms other than the API key / URL fields keep their own internal layout; the whole form sits in
  one card.

## Tests run

- `vitest run src/components/settings src/components/modes --maxWorkers=2`: 58 files, 849 tests passed.
- `vitest run src/components/chat/__tests__/ChatTextArea.toolbar.spec.tsx`: 16 passed (composer uses the mode selector).
- `tsc --noEmit -p .`, `eslint <touched files> --max-warnings=0`, `node ../scripts/check-webview-radius.mjs`: clean.
