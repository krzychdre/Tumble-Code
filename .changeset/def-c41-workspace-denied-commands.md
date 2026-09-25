---
"tumble-code": patch
---

Auto-approval now honours commands denied in the VS Code settings (including a workspace's .vscode/settings.json), so a command the settings list as denied is no longer run just because a broader allowed prefix matches. Allowed commands still count only from your own settings, so a cloned repository cannot grant itself auto-execution.
