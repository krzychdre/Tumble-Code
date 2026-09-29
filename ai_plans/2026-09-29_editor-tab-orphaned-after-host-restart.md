# Editor tab dead after an extension host restart

Date: 2026-09-29. Branch: `fix/editor-tab-revive`.

## Symptom

In the Tumble Code editor tab, clicking a task in "Recent Tasks" does nothing,
and "View all" does nothing either. The sidebar works.

## Root cause (proven)

Both actions are round trips: the webview posts `showTaskWithId` / `switchTab`
to the extension, which answers with an `action` message. Nothing on the
webview side is wrong.

A `WebviewPanel` outlives a restarted extension host. Installing a VSIX with
`code --install-extension` into a running VS Code ends with "Restart
Extensions", which restarts only the host (the user's log shows it at 08:48,
"Channel has been closed", with no window reload). The tab keeps showing the
old page, so it looks alive and local UI (typing, expanding rows) still works,
but its messages reach no provider. The new host re-resolves the sidebar
`WebviewView` itself, so the sidebar recovers; the editor tab never does.

Reproduced in an isolated VS Code 1.139.1 (own `--user-data-dir` and
`--extensions-dir` under `/tmp/vscrepro`, Xvfb, driven through the Chrome
DevTools Protocol):

| build            | before host restart                | after host restart      |
| ---------------- | ---------------------------------- | ----------------------- |
| main (16b0a3a41) | View all opens History, task opens | both do nothing         |
| this branch      | same                               | tab replaced, both work |

A marker set on `window` in the tab survives the restart on main (same page,
orphaned) and is gone with the fix (fresh page).

## Approaches measured and rejected

1. `registerWebviewPanelSerializer`: VS Code calls the serializer only for
   editor inputs restored with a window (`$registerSerializer` registers a
   resolver for unresolved inputs). A live tab is not re-resolved on a host
   restart; the marker survived.
2. Close the tab in `deactivate` and reopen it on the next activation: when
   `deactivate` runs on a host restart, messages no longer reach the window.
   Measured with a file log: `getTabPanel()` is set, `panel.dispose()` runs,
   the tab stays; `workspaceState.update` never resolves.

## Fix

`replaceOrphanedTabs` (src/activate/registerCommands.ts), called once during
activation right after `registerCommands`: any tab in `vscode.window.tabGroups`
whose `TabInputWebview.viewType` ends with `ClineProvider.tabPanelId` cannot
belong to this host yet, so it is a leftover. Close them and open a new tab in
the first one's group (`openClineInNewTab` got an optional `viewColumn`; the
old group is locked, so it stays open and empty otherwise).

A window reload is unaffected: without a serializer VS Code drops the tab, so
there is nothing to replace.

## Tests

- `src/activate/__tests__/registerCommands.spec.ts`: no Tumble tab, no-op;
  orphaned tab closed and a new one opened in its column without a new group.
- `src/__tests__/extension.spec.ts`: the `../activate` mock gains
  `replaceOrphanedTabs`.

## Residual

- A task that was running in the old tab is lost with the old host anyway; the
  new tab opens on the welcome screen.
- Side finding, not fixed here: `panelRegistry` keeps one panel, so with the
  sidebar resolved after the tab, `focusPanelRequest` from a tab click focuses
  the sidebar (seen as `blur` on the tab window during the repro).
