---
"tumble-code": patch
---

Connecting to an MCP server over SSE no longer replaces the process-wide `EventSource` in the extension host. The MCP SDK creates its own EventSource, so the replacement never affected MCP connections; it only changed a global that other code could see. The unused `reconnecting-eventsource` library is no longer shipped in the extension bundle, and 25 other dependency declarations that nothing used were removed from the workspace.
