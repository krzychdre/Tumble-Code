---
"tumble-code": patch
---

Approving an MCP call in the CLI now shows what is being approved. The terminal interface used to show only the title "Use_mcp_server", and print mode with `--require-approval` printed "Server: unknown" because it read the wrong field names. Both now name the server and the tool (or the resource URI) and list the tool's arguments. In the terminal interface the arguments are capped at 12 lines, each kept to one row, so the Yes and No choices always stay on screen.
