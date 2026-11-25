---
"tumble-code": patch
---

New: **CLI: Runs with your VS Code settings.** The VS Code extension now keeps a `vscode` section of `~/.roo/cli-settings.json` up to date, so the CLI uses the same context, subagent, memory, prompt and experiment settings as the editor. Your own keys in the file still win, and the CLI keeps its own approval settings.
