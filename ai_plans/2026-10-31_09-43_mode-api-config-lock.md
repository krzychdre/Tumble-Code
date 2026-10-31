# Lock one mode to its API configuration

**Status:** done on `feat/mode-api-config-lock`
**Related:** none
**Touched:** `packages/types` (`lockedApiConfigModes` global setting and default, `lockModeApiConfig` message),
`src/core/webview/ModeProfileBinding.ts`, `src/core/webview/messageHandlers/providerProfiles.ts`,
`webview-ui/src/components/chat/ApiConfigSelector.tsx`, `ComposerToolbar.tsx`, `modes/ModesView.tsx`,
`chat.json` in every locale, specs and snapshots

## Goal

The existing padlock (`lockApiConfigAcrossModes`, per workspace) keeps one profile across all modes. The owner wants
a lock per mode: a locked mode keeps its profile, its profile cannot be switched until the lock is removed, and
"Apply this configuration to other modes" leaves locked modes unchecked and unchanged. The toggle is a padlock in the
API configuration picker, next to the current mode.

## Change

- **State.** `lockedApiConfigModes: Record<modeSlug, true>` in global state, like `pinnedApiConfigs`. It is global
  because the mode bindings (`modeApiConfigs` in the profile store) are global too.
- **Message `lockModeApiConfig`** (`text` = mode, `bool` = lock, `values.configId` = shown profile). Locking first
  binds the shown profile to the mode: with the workspace lock on, the stored binding may differ from what the picker
  shows. Unlocking only drops the flag.
- **`ModeProfileBinding`.** `isModeLocked(mode)`:
    - `resolve` returns `locked` (keep the current profile) only for an unlocked mode, so entering a locked mode
      activates its own profile even while the workspace lock is on. Otherwise the user would sit in a locked mode on
      another mode's profile with the picker disabled.
    - `activateProviderProfile` and `upsertProviderProfile` do not rebind a locked mode. The settings page can still
      switch or save a profile while a locked mode is active; that changes the current profile, never the binding,
      and the next entry into the mode restores its profile.
- **Picker (`ApiConfigSelector`).** A row above the bottom bar shows the current mode with its padlock. While the
  current mode is locked the profile rows are disabled (pinning still works). In the bulk panel locked modes are
  unchecked, disabled and marked with a lock; opening the panel and "Select all" pick only unlocked modes.
- **Modes view.** The profile select of the active mode is disabled while that mode is locked.

## Tests

- `ClineProvider.modeProfileBinding.spec.ts`: a locked mode activates its profile under the workspace lock; a profile
  switch and a profile save leave a locked mode's binding alone.
- `webviewMessageHandler.lockApiConfig.spec.ts`: locking binds and records; unlocking drops only that mode.
- `ApiConfigSelector.spec.tsx`: locked mode unchecked, disabled, skipped by Select all and Apply; padlock title and
  callback in both states; rows disabled in a locked mode.
- `ChatTextArea.toolbar.spec.tsx`: the toolbar passes mode and locks and posts `lockModeApiConfig` for both states.
- Mutations (drop each guard in `ModeProfileBinding`, each branch of the handler, the unlocked filter, Select all,
  both `disabled`, the padlock callback, the toggled `bool`) each turned a test red.
- `registry.spec.ts` counts 138 message types; the state and global key snapshots gained `lockedApiConfigModes`.

## Notes

- The CLI takes provider settings per mode from its own settings file and ignores the profile store, so the lock
  has no effect there.
- The bulk panel's "current" label reads `modeApiConfigs`, which the state push strips as host-only, so it never
  shows. That predates this change and is left as is.
