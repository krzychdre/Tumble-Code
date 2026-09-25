---
"tumble-code": patch
---

Internal cleanup: the extension-only cloud URL and VS Code language model selector helpers moved out of the code shared with the webview, and the webview build now fails if it ever reaches extension-only code again. No behavior change.
