# Status bar item that opens Tumble Code in an editor tab

Status: done on `feat/status-bar-open-tumble` (cut from main 1739c83f1), pull request open, not merged.

Related plan: `editor-title-tumble-button` (the `.changeset` of the same name; the editor title button whose
command this item reuses).

Touched:

- `src/activate/statusBar.ts` (new)
- `src/activate/index.ts`
- `src/activate/registerCommands.ts`
- `src/extension.ts`
- `src/i18n/locales/*/common.json` (new key `statusBar.openTab`, all 18 locales)
- `src/activate/__tests__/statusBar.spec.ts` (new)
- `src/activate/__tests__/registerCommands.spec.ts`
- `src/__tests__/extension.spec.ts` (the `../activate` mock gains `registerStatusBarItem`)
- `.changeset/status-bar-open-tumble.md`

## Need

The only one-click way to open Tumble Code in an editor tab is the Tumble button in the editor title bar
(`tumble-code.editorTitleButtonClicked`, shown by the `editor/title` menu in `src/package.json`). VS Code draws that
bar only while an editor is open, so in an empty window, or after closing the last file, the button is gone and the
user has to go through the sidebar or the command palette. Claude Code solves the same problem with a permanent
entry at the right end of the status bar; the owner asked for the same.

## Fix

- `registerStatusBarItem(context)` in `src/activate/statusBar.ts` creates the item with
  `vscode.window.createStatusBarItem("tumble-code.openTab", StatusBarAlignment.Right, 100)`, sets `name` to
  "Tumble Code" (the stable id plus the name let the user hide it from the status bar's context menu), the text
  `$(sparkle) Tumble Code`, a localized tooltip `t("common:statusBar.openTab")`, shows it and pushes it to
  `context.subscriptions`. `src/extension.ts` calls it right after `registerCommands`.
- No new command. The item runs the existing `tumble-code.editorTitleButtonClicked` with the argument
  `STATUS_BAR_CLICK_SOURCE` (`"statusBar"`), so the reveal-or-open logic stays in one place: show the tab
  `ClineProvider.getEditorTab()` returns, else `openClineInNewTab`. The command reads its first argument only to
  pick the telemetry value: `TITLE_BUTTON_CLICKED` with `button: "statusBar"` for the status bar, `"editorTitle"`
  otherwise (the editor title menu passes the editor's URI, the command palette passes nothing). The event's
  property type is `{ button: string }`, so no type change was needed.
- No `package.json` contribution is needed: VS Code has no contribution point for status bar items, and a command
  run from a status bar item does not have to be listed in `contributes.commands` (this one is listed anyway).

## Decisions

- Icon: the extension contributes no icon font (`contributes.icons` is absent), and a status bar item can only
  show codicons or contributed font glyphs, not the SVG logo. `$(sparkle)` is the built-in codicon VS Code users
  read as "AI assistant". A contributed font with the tumbler spiral would be a later, separate change.
- Priority 100 on the right side: a higher priority places an item further left; 100 keeps it among the other
  extensions' items rather than pinned to either end. The user can move or hide it anyway.
- Reusing the editor title command instead of adding `statusBarItemClicked` keeps the footprint off
  `packages/types/src/vscode.ts`, `src/package.json` and the command map, which a parallel branch (multiple editor
  tabs) is editing.
- The CLI's `vscode-shim` implements `createStatusBarItem`, so activation in the CLI is unaffected (the item is
  created and never drawn).

## Tests

- `src/activate/__tests__/statusBar.spec.ts`: the item is created with the stable id, right alignment and
  priority; its name, text and tooltip; its command is the editor title command with the status bar argument; it
  is shown and registered for disposal.
- `src/activate/__tests__/registerCommands.spec.ts`: the editor title command reports `editorTitle` when called
  with a URI, `statusBar` when called with `STATUS_BAR_CLICK_SOURCE`, and from the status bar it reveals the open
  tab or opens a new one.

## Notes

- The tooltip is translated once, at activation. After a change of the Tumble Code language setting it shows the
  new language from the next window reload on; the item text is the product name and is not translated.
