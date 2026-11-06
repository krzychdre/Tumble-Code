---
"tumble-code": patch
---

Fixed: **MCP servers on Windows.** Arguments of a local MCP server are passed exactly as written, so values containing `&`, `|` or `%` no longer break or change the command. When the server's command cannot be found, the server list now says which command is missing and that it must be installed and reachable through PATH, or given as a full path.
