---
"tumble-code": patch
---

MCP server switches and tool controls in a Tumble Code editor tab now follow the real server state. The server list was only pushed to the view that started MCP (normally the sidebar), so a tab kept showing the old state and the next click flipped it back. It now reaches every open view, and MCP keeps working when the sidebar is closed before a tab.
