---
"tumble-code": patch
---

Buttons that came from Microsoft's deprecated webview UI toolkit now come from the extension itself: the copy buttons on chat messages and diff errors, the terminal profile Configure button, the add and remove buttons for custom headers of OpenAI-compatible providers, and the reset buttons in the codebase index settings. They look and behave the same. One small difference: the 3px strip around the copy button of a diff error no longer counts as part of the button, so a click there expands the error like the rest of the header.
