---
"tumble-code": patch
---

Fixed: **MCP server toggle failures are reported.** Enabling or disabling an MCP server whose connection could not be re-established no longer fails silently; the error is logged and the server's error state is pushed to the server list instead of being swallowed as a capabilities refresh.
