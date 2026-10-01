---
"tumble-code": patch
---

Installing or removing a marketplace MCP server now replaces the MCP settings file in one step, so a crash or a full disk in the middle of the write can no longer leave a cut-off `mcp.json`. Removing a server from a settings file that holds invalid JSON now shows an error instead of claiming success, and a broken settings or modes file is logged instead of looking like "nothing installed".
