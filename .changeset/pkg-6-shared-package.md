---
"tumble-code": patch
---

Internal: the browser-safe helpers that lived in the extension's shared folder (mention and command parsing, todo lookup, cost and token-limit helpers, experiment flags, language names, tool groups) now live in the core and types packages, so the webview and the CLI import the same code. Nothing changes for the user.
