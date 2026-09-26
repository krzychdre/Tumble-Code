---
"@roo-code/vscode-webview": patch
---

Load Shiki themes lazily instead of registering all 65 bundled themes at webview startup. Only `github-light`/`github-dark` are ever used; they are now loaded on demand (and the startup pre-warm loads just the one matching the current VS Code theme), cutting highlighter initialization from ~50 ms to ~1 ms.
