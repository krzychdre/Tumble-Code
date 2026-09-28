---
"tumble-code": patch
---

A failed "Clear Index Data" in the codebase index popover now shows why it failed (for example "no workspace folder open") under the popover buttons. The error used to be sent by the extension and then silently dropped. The extension also stops sending three messages nobody received (the colour theme, read from disk on every webview launch, a sign-out user update, and dropped chat images). A failed save of the codebase index settings now shows its error for 5 seconds instead of hiding it at once.
