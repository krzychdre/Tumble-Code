---
"@tumble-code/vscode-webview": patch
---

Deduplicate the `webviewDidLaunch` post: remove App.tsx's copy and keep the ExtensionStateContextProvider one, so the extension host no longer builds and sends the full state (including the whole task history) twice at webview startup.
