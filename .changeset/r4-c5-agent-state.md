---
"tumble-code": patch
---

CLI internals: the agent loop state no longer carries a description text, a required-action label or a copy of the last message's timestamp, which nothing but a debug log read; one small builder makes every state. No user-visible change.
