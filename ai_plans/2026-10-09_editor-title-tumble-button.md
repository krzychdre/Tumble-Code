# Tumble button in the editor title bar

**Status:** implemented on `feat/editor-title-tumble-button`
**Related plans:** replaces the reverted `openInEditorOnStartup` setting (#835, reverted by #837)
**Touched:**

- `packages/types/src/vscode.ts` (command id `editorTitleButtonClicked`)
- `src/activate/registerCommands.ts` (command callback)
- `src/core/webview/ClineProvider.ts` (`getEditorTab`)
- `src/package.json` (command with icon, `editor/title` menu entry)
- `src/assets/icons/editor-title-{light,dark}.svg`
- tests in `src/activate/__tests__/registerCommands.spec.ts`

## Request

The owner wants to start Tumble Code in an editor tab with one click on an
icon in the editor title bar, where Claude Code and Codex put theirs, instead
of opening the sidebar and clicking "Open in Editor". A first attempt opened
the tab automatically at startup; that was not the request and was reverted.

## Design

- New command `tumble-code.editorTitleButtonClicked`, titled "Open in Editor"
  (existing translations), shown in `editor/title` group `navigation@100` on
  every editor except the Tumble tab itself
  (`activeWebviewPanelId != tumble-code.TabPanelProvider`).
- Click: if a Tumble editor tab is open, `reveal()` it; else open one through
  the existing `openClineInNewTab`. One click never stacks duplicate tabs.
- "Is a tab open" comes from `ClineProvider.getEditorTab()`, which scans the
  live provider instances. `panelRegistry` is not used: `setPanel(..,
  "sidebar")` forgets the tab as soon as the sidebar view resolves. A closed
  tab disposes its provider, so it leaves the instance set.
- Icon: `icon.svg` (the activity bar spiral) with fixed stroke colours, because
  file icons in menus do not get `currentColor` from the theme; stroke width 7
  instead of 5 so it reads at 16 px. Checked in a headless Firefox render on
  dark and light backgrounds.

## Verification

- Unit tests for the command (reveal vs open).
- `tsc --noEmit` in `src`, eslint on touched files.
