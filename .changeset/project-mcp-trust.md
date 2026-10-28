---
"tumble-code": patch
---

Fixed: **Opening a repository no longer starts its MCP servers without asking.** The servers in a project's `.roo/mcp.json` start only after you agree to the commands or addresses they use, and you are asked again when those change. The CLI asks in the terminal; a run without a terminal starts only the servers you already agreed to.
