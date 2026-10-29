# Deleting a project MCP server started the declined ones

**Status:** fixed on `fix/mcp-delete-keeps-consent`
**Related:** security audit 2026-10-28, section 1 (residual after ba3e88fec)
**Touched:** `src/services/mcp/McpHub.ts`, `src/services/mcp/__tests__/McpHub.spec.ts`

## Symptom

A project `.roo/mcp.json` holds a server `x` the user agreed to and a server `y` the user declined. Deleting `x`
from the MCP settings view started `y` without asking.

## What was happening

Every path that starts servers from a settings file filters them through `McpHub.startable()`, which keeps only the
project servers whose launch settings the user agreed to (`ProjectMcpTrust`). `deleteServer` was the one exception:
after writing the file without the deleted server it passed the whole remaining `mcpServers` map straight to
`updateServerConnections`, which connects every server in the map.

## Fix

`deleteServer` passes the remaining servers through `startable()` like the other callers. Global servers are
unaffected (`startable` returns them unchanged). The CLI runs the same `McpHub`, so it is covered too.

## Tests

`McpHub.spec.ts`: "does not start a declined server when another server of the same file is deleted". Red before the
fix (`project:y` connected, `bash` spawned), green after.

## Not fixed

Nothing left in this path; `updateServerConnections` is now called without `startable()` only for the empty map on
project cleanup and for the global file's raw fallback.
