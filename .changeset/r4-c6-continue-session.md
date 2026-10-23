---
"tumble-code": patch
---

CLI internals: the TUI no longer carries a `continueSession` option that was always false (`--continue` is already resolved into a session id before the TUI starts), and the unread `isReady` field of the extension host hook is gone. No user-visible change.
