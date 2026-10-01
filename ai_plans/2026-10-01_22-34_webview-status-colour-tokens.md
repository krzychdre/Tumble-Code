# Status colours from `--status-*` tokens instead of the Tailwind palette (round 2, D4)

Status: done on `refactor/webview-status-colour-tokens`

## Touched files

- `webview-ui/src/components/chat/{McpExecution,CommandExecution,CommandPatternSelector,CodebaseSearchResult,ShareButton}.tsx`
- `webview-ui/src/components/chat/checkpoints/CheckpointSaved.tsx`, `webview-ui/src/components/chat/rows/renderers/say/MessageRows.tsx`
- `webview-ui/src/components/code-index/{CodeIndexStatusSection,CodeIndexSetupFields,EmbedderFormFields}.tsx`
- `webview-ui/src/components/common/DiscardChangesDialog.tsx`
- `webview-ui/src/components/marketplace/components/{MarketplaceInstallModal,MarketplaceItemCard}.tsx`
- `webview-ui/src/__tests__/theme-colours.spec.ts` (new guard)
- `webview-ui/src/components/code-index/__tests__/CodeIndexPopover.per-provider.spec.tsx`, `webview-ui/src/components/ui/__tests__/dropdown.call-sites.spec.tsx` (error class assertions)
- `.changeset/webview-status-colour-tokens.md`

## Problem

52 Tailwind palette classes in 16 files used fixed colours (`text-green-500`, `bg-red-600`, ...) that ignore the VS
Code theme, while `index.css:213-216` defines `--status-running` (textLink), `--status-done` (charts.green),
`--status-failed` (errorForeground) and `--status-waiting` (charts.yellow) for exactly this, already used by
`ToolBlock.tsx:24-27`, `TodoListDisplay.tsx:98` and `ContextWindowProgress.tsx:68-70`.

## Fix

Status colours use the tokens through Tailwind arbitrary values, as `TodoListDisplay` already does
(`bg-[var(--status-done)]`); opacity modifiers (`/10`, `/20`, `/30`) compile to `color-mix(...)` in Tailwind 4.3
(checked with Tailwind's `compile()` on the new class names). Colours that are not a status use the existing
`--color-vscode-*` theme classes or a `--vscode-*` arbitrary value.

Every replaced class (38 of the 52 occurrences replaced, the 14 orange ones kept):

| File                                                     | Before                                                 | After                                                                                         | Why                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `chat/McpExecution.tsx:224-225`                          | `bg-lime-400` (started or completed)                   | `bg-[var(--status-running)]` (started), `bg-[var(--status-done)]` (completed)                 | status; started and completed were one colour, now split like ToolBlock |
|                                                          | `bg-red-400`                                           | `bg-[var(--status-failed)]`                                                                   | status                                                                  |
| `chat/CommandExecution.tsx:211`                          | `bg-yellow-500` (running, pulsing)                     | `bg-[var(--status-running)]`                                                                  | status                                                                  |
| `chat/CommandExecution.tsx:221`                          | `bg-green-600` / `bg-red-600` (exit code)              | `bg-[var(--status-done)]` / `bg-[var(--status-failed)]`                                       | status                                                                  |
| `chat/CommandExecution.tsx:230`                          | `bg-red-600`                                           | `bg-[var(--status-failed)]`                                                                   | status                                                                  |
| `chat/rows/renderers/say/MessageRows.tsx:74`             | `border-green-600/30`                                  | `border-[var(--status-done)]/30`                                                              | the "task completed" rail, done status                                  |
| `chat/ShareButton.tsx:169`                               | `text-green-600 dark:text-green-400`                   | `text-[var(--status-done)]`                                                                   | success message                                                         |
| `code-index/CodeIndexStatusSection.tsx:33-36`            | `bg-gray-400` (Standby)                                | `bg-vscode-descriptionForeground`                                                             | idle, not a status colour                                               |
|                                                          | `bg-yellow-500` (Indexing)                             | `bg-[var(--status-running)]`                                                                  | status                                                                  |
|                                                          | `bg-green-500` (Indexed)                               | `bg-[var(--status-done)]`                                                                     | status                                                                  |
|                                                          | `bg-red-500` (Error)                                   | `bg-[var(--status-failed)]`                                                                   | status                                                                  |
| `marketplace/components/MarketplaceInstallModal.tsx:241` | `text-green-500`                                       | `text-[var(--status-done)]`                                                                   | "installed"                                                             |
| `marketplace/components/MarketplaceInstallModal.tsx:354` | `text-red-500 bg-red-500/10 border-red-500/20`         | `text-[var(--status-failed)] bg-[var(--status-failed)]/10 border-[var(--status-failed)]/20`   | install error                                                           |
| `marketplace/components/MarketplaceItemCard.tsx:161`     | `bg-green-600/20 text-green-400 border-green-600/30`   | `bg-[var(--status-done)]/20 text-[var(--status-done)] border-[var(--status-done)]/30`         | "installed" badge                                                       |
| `code-index/CodeIndexSetupFields.tsx:97,113`             | `border-red-500` (x2)                                  | `border-[var(--vscode-inputValidation-errorBorder)]`                                          | form validation, not a status                                           |
| `code-index/EmbedderFormFields.tsx:66,101,119`           | `border-red-500` (x3)                                  | `border-[var(--vscode-inputValidation-errorBorder)]`                                          | form validation                                                         |
| `common/DiscardChangesDialog.tsx:31`                     | `text-yellow-500`                                      | `text-vscode-editorWarning-foreground`                                                        | warning icon                                                            |
| `chat/CommandPatternSelector.tsx:138`                    | `bg-green-500/20 text-green-500 hover:bg-green-500/30` | `bg-vscode-charts-green/20 text-vscode-charts-green hover:bg-vscode-charts-green/30`          | "allowed" toggle, not a run status                                      |
| `chat/CommandPatternSelector.tsx:140`                    | `hover:text-green-500 hover:bg-green-500/10`           | `hover:text-vscode-charts-green hover:bg-vscode-charts-green/10`                              | same                                                                    |
| `chat/CommandPatternSelector.tsx:160`                    | `bg-red-500/20 text-red-500 hover:bg-red-500/30`       | `bg-vscode-errorForeground/20 text-vscode-errorForeground hover:bg-vscode-errorForeground/30` | "denied" toggle                                                         |
| `chat/CommandPatternSelector.tsx:161`                    | `hover:text-red-500 hover:bg-red-500/10`               | `hover:text-vscode-errorForeground hover:bg-vscode-errorForeground/10`                        | same                                                                    |
| `chat/CheckpointSaved.tsx:90`                            | `text-blue-400`                                        | `text-[var(--vscode-charts-blue)]`                                                            | checkpoint label accent                                                 |
| `chat/CodebaseSearchResult.tsx:38`                       | `text-gray-500`                                        | `text-vscode-descriptionForeground`                                                           | secondary text                                                          |

Kept on purpose (the bypass/autonomous orange of #640, the same colour as the frame accent):
`AutoApproveModeSelector.tsx:35,42`, `AutoApproveToggle.tsx:124`, `AutoApproveDropdown.tsx:214,278`
(`bg-orange-600`, `border-orange-600`, `text-orange-500`).

## Tests

- New `webview-ui/src/__tests__/theme-colours.spec.ts` scans production `.ts/.tsx` files for palette colour classes
  and allows only the three orange classes. Checked that it fails when a palette class is added.
- Two specs asserted the old `border-red-500` error class on the model dropdown; they now assert the
  `inputValidation-errorBorder` class (same behaviour: the class is present when the field is invalid).
- Specs of every touched component (17 files, incl. `CodeIndexPopover.*`, `CommandExecution`, `McpExecution`,
  `CommandPatternSelector`, `ShareButton`, `MarketplaceItemCard`, `CheckpointSaved`, `ChatRow` golden renders): pass.
  No golden file contained the replaced classes, so no golden was regenerated.
- `tsc --noEmit -p webview-ui`, eslint, prettier, `pnpm knip`: ok.

## Notes / caveats

- Visible change in dark themes: the "running" dot of commands, MCP calls and code indexing changes from yellow
  (or lime for MCP) to the theme's link colour, which is what tool blocks already use for running. The completed
  MCP dot changes from lime to charts.green. Other colours stay close to what they were in the default dark theme.
- `--status-waiting` has no new user: none of the replaced colours meant "waiting for the user".
- Not checked visually in a running VS Code (no build allowed in helper worktrees).
