# CLI: `/mcp` panel, server status and failure notices

**Status:** done on `feat/cli-mcp-support` (one branch for all CLI MCP work, off `main` `367d07e28`)
**Related plans (same branch):** `2026-09-23_cli-global-mcp-config.md`, `2026-09-23_cli-mcp-approval-details.md`,
`2026-09-23_cli-allow-mode-approves-mcp.md`, `2026-09-23_mcp-failed-stdio-server-stays-listed.md`
**Touched:** `apps/cli/src/ui/components/McpPanel.tsx` (new) + test, `apps/cli/src/lib/utils/mcp-status.ts`
(new) + test, `apps/cli/src/ui/App.tsx`, `apps/cli/src/ui/store.ts` + test, `apps/cli/src/ui/stores/uiStateStore.ts`,
`apps/cli/src/ui/hooks/useMessageHandlers.ts` + test, `apps/cli/src/ui/hooks/useTaskSubmit.ts` + test,
`apps/cli/src/ui/hooks/useGlobalInput.ts` + test, `apps/cli/src/lib/utils/commands.ts` + test,
`apps/cli/src/agent/extension-host.ts` + test, `apps/cli/README.md`

## Request and decision

"MCP support like the VS Code version." The user chose, of the offered management options,
only the `/mcp` panel in the TUI (not `tumble mcp list`, not `mcp add/remove`, not a real
file watcher).

## What was missing (measured)

The CLI had no way to see its servers. A server that fails to start was silent: with a
project server whose command does not exist, a print-mode run printed nothing about it.

## Change

- **Data.** `useCLIStore.mcpServers`, fed by `mcpServersFromMessage`: McpHub's
  `mcpServers` pushes (sent after every connection change) and full `state` pushes. The
  core also sends single-field `state` pushes (`storageErrorMessage`), which must not
  clear the list, hence "full state only". The list survives `reset()` (`/new`, `/clear`)
  and `resetForTaskSwitch()`: McpHub is process-wide, not per task.
- **Panel** (`McpPanel.tsx`), an overlay like the TODO viewer, opened by the global
  command `/mcp` (`openMcpPanel`), bordered like the dialogs. Rows: pointer, a coloured
  state bullet (connected, connecting, disabled, failed), name, source, summary
  (`connected · N tools`, `failed`, `disabled`). Project servers first, as McpHub prefers
  them on a name clash; config order within each group. At most 8 rows with `↑ N more` /
  `↓ N more`, because the panel lives in the height-clamped tail. The selected server
  shows its config file (the global path is the one the global-config commit resolves, passed through
  host options) and either its tool names or its last error line.
- **Keys.** Arrows select; `r` restarts (`restartMcpServer`), `space` toggles
  (`toggleMcpServer`, McpHub writes `disabled` into the server's config file), `R`
  reloads both config files (`refreshAllMcpServers`; the shim's file watcher is a stub, so
  this is how an edit made during a session takes effect). These are the webview
  messages the VS Code MCP view sends, so no new core API. `Esc` is handled in
  `useGlobalInput`, before the task-cancel branch, so closing the panel never cancels a
  running task. The input area is inactive while the panel is open; a dialog that comes up
  meanwhile takes the keys.
- **Stale-closure trap.** The key handler first read the selection from the render
  closure. Two arrows arriving before a re-render (a held key, or a loaded machine) moved
  from a stale row: the "disabled server" test passed alone and failed in the full suite.
  The handler now reads through refs. The test "follows two arrows that arrive before a
  re-render" fails with the closure version and passes with refs.
- **Failure notice.** `takeNewMcpFailures` reports a failed server (disconnected, not
  disabled, with an error) once per server and error. TUI: a warning toast `MCP server
"x" failed to start · /mcp for details`. Print mode: `ExtensionHost` writes
  `[mcp] server "x" (project) failed to start: <last error line>` to stderr through the
  output manager (disabled in the TUI and for JSON output, so neither is corrupted).

## Verification

Real TUI under a pty (pexpect + pyte), fresh `HOME`, global `~/.roo/mcp.json` with
`globsrv` and a disabled `offsrv`, project file with `projsrv` and `broken`
(`/nonexistent/bin/xyz`):

- Before the core fix (`2026-09-23_mcp-failed-stdio-server-stays-listed.md`) `broken` was
  missing from the panel and no notice appeared: the core had dropped the server. With the
  fix (an earlier commit of the same branch): the toast appeared at startup, the
  panel listed `broken project failed`, selecting it showed
  `Error: spawn /nonexistent/bin/xyz ENOENT`, `r` showed `Restarting broken…` and it
  failed again as expected. Print mode wrote the `[mcp]` line on stderr, stdout untouched.
- `space` on `globsrv` turned it `disabled` (written to `~/.roo/mcp.json`); `R` reloaded;
  `Esc` closed the panel and returned the input.

Tests: `mcp-status.test.ts` (message shapes including the partial state push, failure
predicate, last error line, report-once), `McpPanel.test.tsx` (order, states, details,
keys, disabled server not restarted, held arrows, inactive, empty state, 8-row window),
`store.test.ts`, `useMessageHandlers.test.tsx`, `useTaskSubmit.test.tsx` (`/mcp` touches
neither the conversation nor the extension), `useGlobalInput.test.tsx` (Esc closes the
panel without `cancelTask`, and still cancels without the panel), `extension-host.test.ts`
(stderr once, nothing for healthy servers or messages without a list),
`commands.test.ts`.
