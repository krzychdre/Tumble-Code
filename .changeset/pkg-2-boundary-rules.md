---
"tumble-code": patch
---

Internal: lint now rejects relative imports that reach into another workspace package and `vscode` imports in code shared with the webview, and the webview build cache now notices changes to that shared code.
