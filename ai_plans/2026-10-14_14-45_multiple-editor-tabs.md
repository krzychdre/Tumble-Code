# Several Tumble Code editor tabs

**Status:** implemented on `feat/multiple-editor-tabs`, pull request open, not merged
**Related plans:** `2026-10-09_editor-title-tumble-button.md` (the Tumble button in the editor title bar),
`2026-10-14_14-30_status-bar-open-tumble.md` (the status bar entry, which runs the same command),
`2026-09-29_editor-tab-orphaned-after-host-restart.md` (its "side finding" is fixed here)
**Touched:**

- `src/core/webview/ClineProvider.ts` (recency per provider, `getEditorTab`, `getVisibleInstance`,
  `getLastActiveInstance`, `revealView`, `findTaskHost`, `showTaskWithId`)
- `src/core/webview/panelRegistry.ts` and its spec (deleted)
- `src/activate/registerCommands.ts` (`focusInput`, `focusPanel`, `replaceOrphanedTabs`, `openClineInNewTab`)
- `src/utils/focusPanel.ts`, `src/core/webview/messageHandlers/settings.ts` (`focusPanelRequest`)
- `src/package.json` (icon for `openInNewTab`, `editor/title` button, `alt` on the Tumble button)
- `scripts/test-only-exports-allowlist.mjs`, `src/__tests__/layering.spec.ts`, `docs/architecture.md`,
  `docs/02-extension-host.md`
- tests: `src/core/webview/__tests__/ClineProvider.multipleTabs.spec.ts` (new),
  `src/activate/__tests__/registerCommands.spec.ts`, the `focusPanelRequest` routing snapshot, and three stand-in
  providers that now need `findLiveTask`

## Symptom

The owner: "Tumble in the editor is only one; I want to be able to open another Tumble instance in the editor."
The Tumble button in a file editor's title bar only ever shows the one open tab. A second tab could be opened only
through "Open in Editor" in the `...` overflow menu of a Tumble tab or the command palette, and with two tabs open
several things went wrong.

## What was happening

1. **No visible way to open a second tab.** `editorTitleButtonClicked` reveals the tab `getEditorTab()` returns
   and opens one only when none is open (`registerCommands.ts:111` on main). `popoutButtonClicked` and
   `openInNewTab` do open a new tab every time, but in a Tumble tab the first sits in `overflow@2` of `editor/title`
   and the second has no menu entry at all (`src/package.json`).
2. **One tab reference for N tabs.** `panelRegistry.ts` kept one `tabPanel`. Every tab set it on resolve
   (`ClineProvider.ts:912` on main) and on creation (`registerCommands.ts:297`), and each tab's `onDidDispose` set it
   to `undefined` (`registerCommands.ts:313`). With tabs A and B open, closing either one forgot the tab reference
   while the other was still open; with B open last, the registry pointed at B whatever the user did in A. A
   scratch spec on main confirmed it: after closing B, `getTabPanel()` did not return A.
3. **A click in one tab jumped to the other tab.** The webview of every editor tab posts `focusPanelRequest` on
   any click outside an input (`webview-ui/src/App.tsx:221`,
   `useAddNonInteractiveClickListener`). The handler ran the global `focusPanel` command (`settings.ts:273` on
   main), which revealed the registry's tab (`registerCommands.ts:184`, `focusPanel.ts:22`), that is B, with
   `reveal(ViewColumn.Active, false)`. So a click on a button in tab A brought B to the front in A's place (same
   group) or moved B into A's group (side by side), out of its own locked group. With B closed, the registry was
   empty and every click in A opened the sidebar instead.
4. **"Reveal" went to the newest tab, not the one in use.** `getEditorTab` and `getVisibleInstance`
   (`ClineProvider.ts:857`, `:865` on main) returned the last instance in creation order (`findLast`). The Tumble
   button and the status bar entry therefore always revealed the newest tab, and the title-bar buttons of two
   visible tabs (`plusButtonClicked` and the others, through `getVisibleProviderOrLog`) acted on the newest one. A
   scratch spec on main confirmed it: after focusing A, `getEditorTab()` still returned B's panel.
5. **A second tab could leave an empty editor group.** With no text editor visible, `openClineInNewTab` ran
   `workbench.action.newGroupRight` (a new group right of the active one) and then opened the tab in
   `ViewColumn.Two` (`registerCommands.ts:285-288`). Clicking "Open in Editor" in a Tumble tab sitting in column two
   created column three, put the new tab in column two (the first tab's locked group) and left column three empty.
6. **Only the first orphaned tab was replaced.** `replaceOrphanedTabs` closed every tab a restarted extension host
   left behind but reopened one, in `orphans[0]`'s group (`registerCommands.ts:260`). With two tabs before the
   restart, the user got one back, and a second locked group stayed open and empty.
7. **The same task could run in two panels.** `showTaskWithId` looked for a live instance only in its own provider's
   `TaskSlot` (`ClineProvider.ts:1438` on main). Opening, from tab B's history, a task that tab A (or the sidebar)
   was running built a second `Task` with the same id, both writing the same task files. Possible before with the
   sidebar plus one tab; several tabs make it much more likely.

## Failure surface

| Situation                                                   | Before                                    | After                                                                |
| ----------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Open a second tab                                           | overflow menu of a Tumble tab, or palette | button in the Tumble tab's title bar; Alt+click on the Tumble button |
| Close tab B while A stays open, then focus command          | sidebar opens (registry empty)            | tab A is focused                                                     |
| Click a button in tab A, tab B opened later                 | B jumps to the front or into A's group    | A stays, nothing moves                                               |
| Tumble button / status bar after working in the older tab A | reveals the newest tab B                  | reveals A                                                            |
| Second tab, no text editor visible, first tab in column two | new tab in column two, empty column three | new tab beside the first, no new group                               |
| Restart Extensions with two Tumble tabs open                | one tab back, one empty locked group      | two tabs back, each in its group                                     |
| History click in B on a task A is running                   | second `Task` with the same id in B       | A shows the task and is revealed                                     |

## Fix

- **One source of truth for open panels.** `panelRegistry.ts` is deleted. `ClineProvider` already keeps every live
  provider in `activeInstances`; each provider now also records when the user was last in its panel
  (`markActivated`: on resolve, when its tab becomes active, when the sidebar becomes visible). One private helper,
  `mostRecentlyActive(filter)`, picks the most recent live provider; ties (never activated) go to the newest, as
  `findLast` did. It skips a provider being disposed: a closed tab's provider stays in the set until its async
  `dispose` ends, and its panel is already gone. On top of it: `getEditorTab` (tabs only), `getVisibleInstance`
  (visible panels), `getLastActiveInstance` (any panel). The commands read these; `ClineProvider` still does not
  import `src/activate`.
- **`revealView`** brings a provider's own panel to the front: a tab with `reveal(undefined, false)` (in its own
  group, never pulled into the active group) unless it is already active, the sidebar with its `.focus` command.
  `focusPanel` (the util behind the `focusPanel` and `focusInput` commands) calls it on `getLastActiveInstance()`,
  or opens the sidebar container when no panel is open. `focusInput` still posts `focusInput` only to the sidebar.
- **`focusPanelRequest`** calls `revealView` on the provider whose webview sent it, so a click focuses the tab
  that was clicked.
- **New tab placement:** `openClineInNewTab` without a column opens beside `getEditorTab()` (its `viewColumn`),
  in the Tumble group, before the old "right of the editors" logic applies. The explicit dispose hook and
  `setPanel` calls are gone; `resolveWebviewView` already disposes the provider when the tab closes.
- **`replaceOrphanedTabs`** opens one tab per orphan, in that orphan's group.
- **`showTaskWithId`**: when this provider does not run the task and another live provider does
  (`findTaskHost`, which now skips disposing providers), it asks that provider to show it and reveals it.
- **Menus:** `openInNewTab` gets the `$(empty-window)` icon and a `navigation@5` entry in the Tumble tab's title
  bar, replacing the `popoutButtonClicked` overflow entry there (the sidebar keeps its own). The Tumble button in
  file editors gets `"alt": "tumble-code.openInNewTab"`, so Alt+click opens a fresh tab. The existing command
  (title "Open In New Tab", translated in every locale) is reused rather than adding a second command that does the
  same thing.

## Tests

- `ClineProvider.multipleTabs.spec.ts` (real providers, fake panels whose focus and close the test drives):
  `getEditorTab` follows focus; closing one tab keeps the other for all three lookups even before the dispose
  ends; `getVisibleInstance` follows focus and the sidebar; `getEditorTab` never returns the sidebar; a
  `focusPanelRequest` from A reveals A only and runs no command; `revealView` leaves an active tab alone and focuses
  the sidebar; `showTaskWithId` in B for a task A runs shows it in A without reading B's history.
- `registerCommands.spec.ts`: `openInNewTab` with a Tumble tab in column three opens in column three without
  `newGroupRight`; the first tab still opens in a new group; two orphans give two tabs in their columns;
  `focusPanel` reveals the last active panel or opens the sidebar; `focusInput` posts to the sidebar only when it
  was used last.
- Before the fix, a scratch spec on main failed on items 2 and 4 (`getEditorTab()` returned B after focusing A;
  the registry did not return A after closing B). The new `openInNewTab`, orphan and `focusPanelRequest` tests
  assert the opposite of the old code paths quoted above.
- Stand-in providers in `ClineProvider.task-slot.spec.ts` and `task-resume-ui.spec.ts` gained `findLiveTask`;
  `ClineProvider.historyReopenAllowList.spec.ts` clears `activeInstances` per test, because providers of earlier
  tests were never disposed and still held a task with the same id.

## Notes

- The tab title stays "Tumble Code" for every tab. A per-task title would have to follow every task switch in
  the tab; not worth it for this change. VS Code shows the tabs side by side, so the user tells them apart by
  position.
- The title-bar buttons of the sidebar still act on `getVisibleInstance()`. When a Tumble tab is visible and was
  used after the sidebar, a click on the sidebar's "+" reaches the tab, as before (then always). VS Code passes
  no reliable "which view" argument to `view/title` commands for webview views; left as it is.
- Two tabs on the same `ContextProxy` already refresh each other's settings (`onSharedSettingsChanged`), and each
  has its own `TaskSlot`, so tasks in different tabs do not interfere. Changes of the history list reach every
  panel through the shared `TaskHistoryStore`.
