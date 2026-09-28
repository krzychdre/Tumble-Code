# UI step 5c: settings (§2.10 of 2026-09-27_ui-modernization.md)

Branch `feat/ui-5c-settings`, off `origin/main` (19d6d7dc7), independent of 5a and 5b (it adds a key to
`settings.json`, which neither of them touches).

## Search: already done, not redone

The third §2.10 bullet (a search box that filters sections by label) landed in #545: `SettingsSearch` in the
header over a static index (`settingsSearchIndex.ts`, tab titles, Modes/MCP headings, experiment flags) merged
with the runtime `SearchableSetting` registrations. Verified on this branch: `SettingsView.static-search-index`
and `SettingsView.lazy-tabs` specs pass unchanged. Nothing in this branch touches it.

## What

- `settingsDraftStore.ts` (the D13 Save buffer from #585): a scope, `setScope(scope)`, and
  `getDirtyScopes()`. Every write that marks the buffer dirty records the current scope: `setField` with a real
  change, a user edit through `setApiConfigurationField` (not a form syncing its own defaults), an experiment
  toggle and an explicit `setDirty(true)`. A clean buffer (Save, merge, discard) has no scopes. The snapshot
  keeps its identity until it changes, so it is a valid `useSyncExternalStore` snapshot.
- `useCachedSettings.ts`: exposes `dirtyScopes`.
- `SettingsView.tsx`: a layout effect sets the scope to the open tab. Only the open tab is mounted, so every
  edit is attributed to the tab it happened in. An `UnsavedDot` (6px square in the text colour, `aria-hidden`)
  shows on the Save button while `isChangeDetected` and on every tab in `dirtyScopes`, which also get
  `data-unsaved="true"` and sr-only text `settings:header.unsavedChanges` (new key, 18 locales).
- The tab triggers no longer pass `focus:ring-0`, so `TabTrigger`'s own `focus:ring-2` in `focusBorder` shows.

## Why

With Save disabled or enabled as the only cue, after edits in several tabs it was impossible to see where the
unsaved changes were before discarding them; and the tab list had no visible keyboard focus.

## Deviations

- Tab attribution is by scope (the open tab) instead of a key-to-tab table: no such table exists (the settings
  schema has no section column), and an edit can only come from the mounted tab. Editing a value back to its
  original keeps the dot, like the existing dirty flag keeps Save enabled.
- The dot uses the text colour (`bg-current`), like the dirty marker of an editor tab, rather than a status
  colour, so it reads on the primary Save button and on the selected tab.
- `TabTrigger` itself still uses `focus:` rather than `focus-visible:`; changing the shared tab primitive is left
  to the §2.12 primitives work.

## Tests

- `components/settings/__tests__/settingsDraftStore.dirtyScopes.spec.ts` (7, new).
- `components/settings/__tests__/SettingsView.unsaved-dots.spec.tsx` (4, new, real sections over the real
  buffer).
- Related specs run unchanged: SettingsView, change-detection, draft-buffer, unsaved-changes, save-defaults,
  static-search-index, lazy-tabs, SettingsDraftContext, TerminalSettings.profile.
