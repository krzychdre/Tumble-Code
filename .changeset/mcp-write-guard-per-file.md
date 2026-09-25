---
"tumble-code": patch
---

An edit of an MCP settings file is no longer ignored when Tumble Code has just saved the other MCP settings file. After Tumble Code wrote the global MCP settings (for example when you changed a server's timeout or allowed a tool), a change you made to the project `.roo/mcp.json` within the next 0.6 seconds was never loaded, and the same happened the other way round; each file now has its own short "this was our own save" window.
