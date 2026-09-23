---
"tumble-code": patch
---

The CLI now reads its global MCP servers from `~/.roo/mcp.json`, the same format as a project's `.roo/mcp.json`, one level up. Until now the global list lived in a hidden file inside the CLI's internal storage (`~/.vscode-mock/global-storage/settings/mcp_settings.json`), and an `--ephemeral` run lost it entirely, so only project servers were ever connected in practice. The file is created empty on the first run. To share one list with the VS Code extension, set `mcpSettingsPath` in `~/.roo/cli-settings.json` to the extension's `mcp_settings.json`. Servers written into the old hidden file are no longer read; move them to `~/.roo/mcp.json`.
