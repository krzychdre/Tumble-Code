---
"tumble-code": patch
---

Fixed: **Protected configuration files stay protected from shell commands and from subfolders.** A command that would write a protected file such as `.roo/mcp.json` or `.vscode/settings.json` now asks first, even when the command itself is auto-approved, and protection also covers the workspace root when a task runs in a subfolder, your own `~/.roo` and VS Code's user settings, and links that lead to those files.
