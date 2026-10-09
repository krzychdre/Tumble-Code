# Open Tumble Code in an editor tab on startup

**Status:** implemented on `feat/open-in-editor-on-startup`
**Related plans:** none (builds on `replaceOrphanedTabs`, PR #638)
**Touched:**

- `src/activate/registerCommands.ts` (`replaceOrphanedTabs` returns a boolean, new `openStartupTab`)
- `src/extension.ts` (activation calls `openStartupTab`)
- `src/package.json`, `src/package.nls*.json` (setting `tumble-code.openInEditorOnStartup`)
- `src/activate/__tests__/registerCommands.spec.ts`, `src/__tests__/extension.spec.ts`

## Request

The owner works with Tumble Code in an editor tab. Today every new window
needs two clicks: open the sidebar, then "Open in Editor".

## Design

- A VS Code setting `tumble-code.openInEditorOnStartup` (boolean, default
  `false`, so other users keep the sidebar-only start). It is a plain
  `contributes.configuration` property, read once at activation, so it needs
  no webview settings UI and no `ContextProxy` key.
- Activation already runs `replaceOrphanedTabs`, which reopens a tab that a
  previous extension host left behind. `openStartupTab` runs it first and only
  opens a new tab when nothing was replaced, so a host restart never ends with
  two Tumble tabs.
- The new tab goes through `openClineInNewTab` unchanged: same column logic,
  same group lock, same provider wiring as the "Open in Editor" button.

## Not done

- Clicking the activity bar icon still shows the sidebar view; redirecting
  that click to the tab would fight VS Code's own view toggling.
- The tab is not revived by a panel serializer after a window reload; the
  setting reopens a fresh one instead, which is what the owner asked for.

## Verification

- Unit tests for `replaceOrphanedTabs` return values and `openStartupTab`
  (setting off, setting on, setting on with an orphan: exactly one panel).
- `tsc --noEmit` in `src`.
