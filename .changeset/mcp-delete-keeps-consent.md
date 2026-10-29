---
"tumble-code": patch
---

Fixed: **Deleting a project MCP server no longer starts the ones you declined.** Removing one server from a project's `.roo/mcp.json` restarts only the servers you agreed to; the others still wait for your consent.
