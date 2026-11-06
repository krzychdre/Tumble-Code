# MCP stdio on Windows without our cmd.exe wrapper (audit X-5)

**Status:** done on `fix/sec-mcp-spawn`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` X-5 (owner decision: let the SDK spawn, no Windows test)
**Touched:**

- `src/services/mcp/McpConnectionManager.ts`: wrapper removed; `describeError` for spawn ENOENT; a closed connection no longer replaces the reason the transport gave
- `src/i18n/locales/*/mcp.json`: `errors.command_not_found`

## Problem

`createTransport` ran every Windows stdio command as `cmd.exe /c <command> <args>`. cmd.exe parses
the whole line again, so `&`, `|`, `%VAR%` and quotes inside args split or changed the command.

## Fix

The command and args go to `StdioClientTransport` unchanged. The SDK (1.32.2,
`dist/cjs/client/stdio.js:72`) spawns through `cross-spawn` 7.0.6 with `shell: false`; on Windows
`lib/parse.js` resolves the command through PATH and PATHEXT (`npx` to `npx.cmd`), and for a non-exe
runs `cmd.exe /d /s /c` with every argument `^`-escaped (double-escaped for `node_modules/.bin`
shims). Node version managers (fnm, nvm-windows, volta) ship `.cmd` or `.exe` shims, which this
covers; the old wrapper could not run a `.ps1`-only shim either, since `.ps1` is not in PATHEXT.

A missing command (spawn ENOENT) now shows `mcp:errors.command_not_found`, naming the command and
saying it must be installed and reachable through PATH or given as a full path. It surfaces two
ways:

- POSIX (and Windows when even `cmd.exe` cannot start): `transport.start()` rejects, the
  `connectToServer` catch records it.
- Windows, command not on PATH: cross-spawn starts `cmd.exe`, which exits with 1, and
  `enoent.js` turns that exit into an `error` event; the SDK forwards it to `onerror` after
  `start()` resolved, and `client.connect` then fails with `McpError(ConnectionClosed)`. The catch
  no longer appends that consequence when the transport already recorded a reason, so the hint
  stays the visible `server.error` (webview server row and CLI `/mcp` panel).

The CLI runs the same `McpHub`/`McpConnectionManager` from the extension bundle; no separate change.

## Tests

- `McpConnectionManager.spec.ts`: win32 command and args (with `&`, `%PATH%`) reach the SDK
  unchanged; Windows order (onerror ENOENT, then ConnectionClosed) keeps the hint; a bare
  ConnectionClosed still shows.
- `McpHub.spec.ts`: a server whose start rejects with ENOENT is listed with the hint, also after restart.

Mutations: no hint (2 red), no skip (1), skip every ConnectionClosed (1), wrapper back (1).

## Notes

- Not verified on a real Windows machine (owner accepted the risk). Smoke test: a server with
  `"command": "npx"` starts; one with a misspelled command shows the hint.
- Node reports a missing `cwd` with the same ENOENT; the schema defaults `cwd` to the workspace
  folder, so only a mistyped explicit `cwd` would show the command hint.
- A server that writes to stderr and then exits during start now keeps its stderr text as the
  visible error instead of "Connection closed" (both were in the log before).
- On Windows cmd.exe's own "is not recognized" line arrives on stderr; if it lands after the
  ENOENT event it becomes the visible error instead of the hint (stderr and exit order is not fixed).
