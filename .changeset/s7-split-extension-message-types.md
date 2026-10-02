---
"tumble-code": patch
---

S7 refactor: the message types between the extension and its webview (`@tumble-code/types`) are split into one file per handler domain, mirroring `src/core/webview/messageHandlers/`, and each handler module only accepts its own domain's messages. 19 message names that nothing sent or handled in their direction were removed from the type unions. No behavior change.
