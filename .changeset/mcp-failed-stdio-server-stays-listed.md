---
"tumble-code": patch
---

An MCP server whose command cannot be started (for example a mistyped path) no longer disappears from the MCP server list. It used to vanish together with its error, leaving only a short notification, and it could not be restarted. It now stays listed as disconnected with the reason, such as "spawn /path/to/server ENOENT", and restarting it tries to start the process again.
