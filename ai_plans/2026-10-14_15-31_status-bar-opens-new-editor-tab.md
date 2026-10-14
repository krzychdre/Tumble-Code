# Status bar item opens a new Tumble editor tab

Status: done on `feat/status-bar-new-editor-tab` (cut from main 3d19986b1), pull request open, not merged.

Related plans: `ai_plans/2026-10-14_14-30_status-bar-open-tumble.md` (the status bar item),
`ai_plans/2026-10-14_14-45_multiple-editor-tabs.md` (several editor tabs, `openInNewTab` in the tab title bar).

Touched:

- `src/activate/statusBar.ts`
- `src/activate/registerCommands.ts`
- `src/i18n/locales/*/common.json` (`statusBar.openTab`, all 18 locales)
- `src/activate/__tests__/statusBar.spec.ts`
- `src/activate/__tests__/registerCommands.spec.ts`
- `docs/02-extension-host.md` ("Several panels at once")
- `.changeset/status-bar-open-tumble.md`, `.changeset/multiple-editor-tabs.md` (both still unreleased)

## Symptom

Owner request: "Klik na dole z prawej ma też otworzyć nową instancję Tumble w edytorze, jeśli inna już jest
otwarta" (a click on the item at the bottom right should open a new Tumble instance in the editor also when
another one is already open).

## What was happening

- `src/activate/statusBar.ts:31` (on main 3d19986b1): the "$(sparkle) Tumble Code" item ran
  `tumble-code.editorTitleButtonClicked` with the argument `STATUS_BAR_CLICK_SOURCE`.
- `src/activate/registerCommands.ts:105-116` (main): that command asked `ClineProvider.getEditorTab()` and, when a
  Tumble tab existed, only called `tab.reveal()`. A new tab was opened only when none existed. The argument was
  used only to report `TITLE_BUTTON_CLICKED` with `button: "statusBar"` instead of `"editorTitle"`.

So with one Tumble tab open, the status bar item could never open a second one.

## Fix

- The status bar item now runs `tumble-code.openInNewTab` (`statusBar.ts:32`) with the same argument
  `STATUS_BAR_CLICK_SOURCE`. That command already always opens another tab through `openClineInNewTab`, beside
  the Tumble tab used last (since #888), and opens the first one when none exists. No new command id was needed.
- `openInNewTab` (`registerCommands.ts:116`) takes an optional first argument and reports
  `TITLE_BUTTON_CLICKED` with `button: "statusBar"` only when it is `STATUS_BAR_CLICK_SOURCE`. Its other callers
  ("Open In New Tab" in a Tumble tab's title bar, Alt+click on the editor title button, the command palette) do
  not pass that string and stay unreported, as before.
- `editorTitleButtonClicked` (`registerCommands.ts:102`) no longer reads an argument: only the file editor's title
  bar runs it now, so it always reports `"editorTitle"` and keeps its reveal-or-open behaviour unchanged.
- Tooltip `common:statusBar.openTab` now says "Open Tumble Code in a new editor tab", translated in every locale.
- Doc comments in both files, `docs/02-extension-host.md` and the two pending changesets describe the new
  behaviour. The changesets were edited instead of adding a third one because both are still unreleased and would
  otherwise put contradictory sentences into the same changelog.

## Tests

- `src/activate/__tests__/statusBar.spec.ts`: the item's command is `tumble-code.openInNewTab` with the status
  bar argument.
- `src/activate/__tests__/registerCommands.spec.ts` (`openInNewTab`): from the status bar with a Tumble tab open,
  a new panel is created in that tab's column, the open tab is not revealed, and the click is reported as
  `statusBar`; from the status bar with no tab, a panel is created; without the argument nothing is reported.
  The two status bar cases under `editorTitleButtonClicked` were removed (that command no longer serves it).
- Ran: both specs (20 passed), `tsc --noEmit` in `src`, eslint on the touched files, `pnpm knip` (exit 0).

## Notes

- The telemetry event and value are unchanged (`TITLE_BUTTON_CLICKED`, `button: "statusBar"`), so cloud metrics
  keep counting status bar clicks under the same key.
- The tooltip is still translated once at activation, as before.
