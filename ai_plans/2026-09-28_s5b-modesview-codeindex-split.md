# S5 (second half): split ModesView and CodeIndexPopover by form section

Roadmap item S5 (`ai_plans/2026-09-27_simplification-roadmap.md`, Priority 4): "`ModesView` (1,264) and
`CodeIndexPopover` (897): split by form section." The `ChatTextArea` half of S5 is a separate branch.
Base: main @ ec2c3a7d6 (S6 merged).

Pure refactor: observable behavior must be identical. No assertion in any existing spec changes.

## 1. Line counts (verified on the base)

| File                                                        | Before | After |
| ----------------------------------------------------------- | -----: | ----: |
| `webview-ui/src/components/modes/ModesView.tsx`             |  1,264 |   317 |
| `webview-ui/src/components/code-index/CodeIndexPopover.tsx` |    897 |   223 |

New files, `webview-ui/src/components/modes/`:

| File                                  | Lines | Section                                                                     |
| ------------------------------------- | ----: | --------------------------------------------------------------------------- |
| `ModesViewHeader.tsx`                 |   140 | title, mode config file menu (own open state), marketplace, import          |
| `ModeSelectorRow.tsx`                 |   308 | mode picker + search, create / rename / delete / export, optimistic names   |
| `ModePromptFields.tsx`                |   180 | role definition, description, when to use; `PromptFieldHeader`              |
| `ModeToolsSection.tsx`                |   166 | tool groups (list or checkboxes) and the MCP server allowlist               |
| `ModeCustomInstructionsSection.tsx`   |   129 | per-mode custom instructions and the rules file link                        |
| `SystemPromptSection.tsx`             |    88 | preview / copy buttons (`SystemPromptActions`) and `SystemPromptDialog`     |
| `GlobalCustomInstructionsSection.tsx` |    86 | instructions for every mode and the workspace rules link                    |
| `modePromptUpdates.ts`                |    75 | `postAgentPrompt`, `postCustomMode`, `postAgentReset`, `readTextEventValue` |

New files, `webview-ui/src/components/code-index/`:

| File                            | Lines | Section                                                                          |
| ------------------------------- | ----: | -------------------------------------------------------------------------------- |
| `useCodeIndexSettings.ts`       |   300 | form state, secret placeholders, validation, atomic save and its answer, discard |
| `useIndexingStatus.ts`          |    40 | status seeded from the parent plus `indexingStatusUpdate` for this workspace     |
| `CodeIndexStatusSection.tsx`    |    59 | status line and progress bar                                                     |
| `CodeIndexDisclosure.tsx`       |    26 | collapsible group (open flag owned by the popover)                               |
| `CodeIndexSetupFields.tsx`      |   122 | embedder provider picker, provider form, Qdrant URL and key                      |
| `CodeIndexAdvancedFields.tsx`   |    97 | the two search sliders with reset buttons                                        |
| `CodeIndexWorkspaceToggles.tsx` |    64 | auto-enable and workspace toggles, disabled-workspace note                       |
| `CodeIndexActions.tsx`          |   113 | start / stop / clear buttons per indexing state, Save, save error                |

## 2. What stays in the coordinators, and why

- `ModesView` keeps the visually selected mode, the tools edit flag, the create / delete / system prompt
  dialogs and the single host listener (`systemPrompt`, `deleteCustomModeCheck`). The tools edit flag
  must reset on a user mode switch but not on a host-pushed mode change, so it cannot become section
  state keyed by the mode. `useExtensionState` stays (not migrated to selectors).
- `CodeIndexPopover` keeps `open`, the two disclosure flags and the discard dialog. The disclosure flags
  must stay in the popover: Radix unmounts `PopoverContent` on close, so section-local state would reset
  on every reopen (pinned by "remembers which disclosures were open after the popover is closed and
  opened again"). `useOpenRouterModelProviders` also stays in the popover so the query keeps running
  while the popover is closed, as before.
- The old combined listener for `indexingStatusUpdate` and `codeIndexSettingsSaved` is now two
  subscriptions (one per hook). They touch disjoint state, so the order does not matter.

## 3. Characterization tests (commit 1, pass on the base)

- `modes/__tests__/ModesView.sections.spec.tsx` (29 tests): header menu and marketplace, rename (duplicate
  guard, cancel), delete check and confirm, export, host-driven mode change, API profile select, the
  three prompt fields for built-in and custom modes (message shapes, trim rules, reset buttons, default
  `source`), tools list / checkboxes / MCP restriction / leaving edit mode on switch, per-mode and global
  instructions, system prompt preview dialog and copy.
- `code-index/__tests__/CodeIndexPopover.sections.spec.tsx` (22 tests): status line and progress bar,
  workspace filter of status updates, enable / auto-enable / workspace toggles, action buttons per state,
  provider switch (model cleared, Bedrock region and profile from a Bedrock API profile), sliders and
  resets, save answer handling, discard dialog, disclosure state across close.

## 4. React Compiler bailouts

8 before, 8 after. `CodeIndexPopover` bailed out on `currentSettingsRef.current = currentSettings` during
render. That line moved verbatim into `useCodeIndexSettings`, so the baseline entry moved with it
(`CodeIndexPopover.tsx: CodeIndexPopover` became `useCodeIndexSettings.ts: useCodeIndexSettings`), and the
popover component and all new section components now compile. Removing the render-time ref write (for
example a layout effect) would drop the count to 7 but changes timing, so it is left for a separate item.

## 5. Findings left as they are (not fixed here)

- A failed save (`codeIndexSettingsSaved` with `success: false`) sets the status to "error" and back to
  "idle" in the same handler, so the error text never renders (the comment says "clear after 5
  seconds"). Pinned as current behavior by "a failed save returns to the editable state at once and
  keeps the edits"; a fix is a separate item.
- `CodeIndexPopover.auto-populate.spec.tsx` re-implements the Bedrock auto-fill logic inline instead of
  rendering the component; the new sections spec now covers it through the real component.
