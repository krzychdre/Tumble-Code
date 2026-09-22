---
"tumble-code": patch
---

- Made the machine-specific settings `tumble-code.customStoragePath`, `tumble-code.autoImportSettingsPath`, `tumble-code.debugProxy.serverUrl`, `tumble-code.cloudApiUrl`, `tumble-code.cloudProviderUrl` and `tumble-code.clerkBaseUrl` machine-scoped, so values from User settings (or Settings Sync) on a laptop no longer leak into a Remote SSH window. Migration note: after this change, in a Remote SSH window the value of `tumble-code.cloudApiUrl` must be set in the "Remote [SSH: ...]" settings tab on the server; the User-settings value no longer applies there. This is intended behavior. The same applies to the other settings in the list.
- Added a "Working over Remote SSH" section to the README documenting where state lives (per-host on the server), how to install the extension "in SSH", which settings are machine-scoped, and a diagnostic checklist (disk space, quota, inotify limits, extension Output channel) for broken remote sessions.
