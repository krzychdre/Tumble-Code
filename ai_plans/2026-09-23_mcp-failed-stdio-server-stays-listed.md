# MCP: a stdio server that cannot start vanished from the server list

**Status:** done on `feat/cli-mcp-support` (one branch for all CLI MCP work, off `main` `367d07e28`)
**Related plans:** `2026-09-23_cli-mcp-panel.md` (found while verifying it)
**Touched:** `src/services/mcp/McpHub.ts`, `src/services/mcp/__tests__/McpHub.spec.ts`

## Symptom

A server configured with a command that does not exist (`/nonexistent/bin/xyz`) was
missing from the CLI's `/mcp` panel and produced no failure notice, while every other
server was listed. The same holds in VS Code: the MCP view does not list it, and the only
trace is a transient error notification. Restart is impossible, since there is no row.

## Root cause

`McpHub.connectToServer`, stdio branch: `await transport.start()` runs while the transport
is being set up, so the stderr stream can be captured, and the connection object is pushed
to `this.connections` only afterwards. When the command is missing, the child process
emits `error` and `StdioClientTransport.start()` rejects. The `catch` looks the connection
up to record the status and the error, finds nothing, and rethrows. The caller
(`updateServerConnections`) only shows an error message. Result: no connection, no error,
no row; `restartConnection` finds nothing to restart either.

A server that starts and then fails (for example exits during the handshake) is not
affected: its connection is registered before `client.connect()`.

## Fix

In the `catch`, when no connection is registered, push a disconnected placeholder
(`createPlaceholderConnection`, whose `reason` becomes optional: absent means "failed to
start", so `disabled` follows the config) and record the error on it like on any failed
server. It then shows as failed with its error, and a restart starts the process again.

## Verification

- `McpHub.spec.ts` "a stdio server whose process cannot start": a transport whose
  `start()` rejects with `spawn /nonexistent/bin/xyz ENOENT`. Red before the fix
  (`expected undefined to be defined`), green after; the same test restarts the server and
  checks the transport is created again and the server stays listed once with its error.
- Real CLI, with the `/mcp` panel of the same branch (next commit): the panel lists
  `broken project failed` with `Error: spawn /nonexistent/bin/xyz ENOENT`, the startup
  notice appears, and print mode writes `[mcp] server "broken" (project) failed to start:
spawn /nonexistent/bin/xyz ENOENT` on stderr. Before the fix the same setup showed no row
  and no notice.
