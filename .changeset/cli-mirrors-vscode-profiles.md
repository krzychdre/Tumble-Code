---
"tumble-code": patch
---

New: **CLI: Runs each mode on its VS Code profile.** The `vscode` section of `~/.roo/cli-settings.json` now also holds your VS Code provider profiles and the modes they are bound to, without API keys, so the CLI uses the same provider, model and model details per mode. Provider settings you write in the file still win.
