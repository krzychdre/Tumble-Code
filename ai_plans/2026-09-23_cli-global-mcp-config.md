# CLI: global MCP servers in `~/.roo/mcp.json` (`mcpSettingsPath` to point elsewhere)

**Status:** done on `feat/cli-mcp-support` (one branch for all CLI MCP work, off `main` `367d07e28`)
**Related plans (same branch):** `2026-09-23_cli-allow-mode-approves-mcp.md`,
`2026-09-23_cli-mcp-approval-details.md`, `2026-09-23_mcp-failed-stdio-server-stays-listed.md`,
`2026-09-23_cli-mcp-panel.md`
**Touched:** `src/services/mcp/mcpSettingsPath.ts` (new), `src/services/mcp/McpHub.ts` + spec,
`src/services/marketplace/SimpleInstaller.ts`, `src/services/marketplace/MarketplaceManager.ts`,
`apps/cli/src/lib/storage/mcp-settings.ts` (new) + test, `apps/cli/src/agent/extension-host.ts` + test,
`apps/cli/src/commands/cli/run.ts` + test, `apps/cli/src/commands/cli/list.ts`, `apps/cli/src/types/types.ts`,
`apps/cli/README.md`

## Request

"CLI needs MCP server support like the VS Code version: global and per project."

## What was actually broken (measured, not assumed)

The MCP machinery already runs in the CLI: the CLI loads the same core, and `McpHub` is
created by `ClineProvider`. Measured with the real build, an isolated `HOME`, a project
`.roo/mcp.json` and a fake OpenAI server that logs the `tools` of each request:

| Case                                                                                                     | Servers whose tools reached request 1 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| project `.roo/mcp.json` + server written into `~/.vscode-mock/global-storage/settings/mcp_settings.json` | both                                  |
| the same with `--ephemeral`                                                                              | project only                          |
| project server whose command does not exist                                                              | none, and nothing printed             |

So:

1. The global list lives in `~/.vscode-mock/global-storage/settings/mcp_settings.json`,
   because `McpHub.getMcpSettingsFilePath` derives it from `globalStorageUri`, which in the
   CLI is the shim's storage. Nobody knows that path; on this machine it held `{}` while
   the VS Code extension's file held five servers.
2. `--ephemeral` points the shim's storage at a temporary directory, so the global list
   disappears completely.
3. A failed server is silent and there is no way to see or manage servers (see the panel
   plan); the approval dialog shows no server, tool or arguments (approval-details plan);
   in `allow` mode an MCP tool outside its server's `alwaysAllow` list hangs the task
   (allow-mode plan, committed before this change on the same branch, so the README's
   "allow approves every MCP tool" holds at every commit).

## Decision (user)

The CLI's global list is its own file, `~/.roo/mcp.json`: the same format as the project
file, one level up, next to `cli-settings.json`. A `mcpSettingsPath` key in
`cli-settings.json` points it elsewhere, for example at the VS Code extension's
`mcp_settings.json` to share one list. Rejected: always reading the VS Code file (couples
the CLI to an editor install and its per-OS storage path) and merging both (needs a
second global source in `McpHub`).

## Change

- Core: `getGlobalMcpSettingsPath(settingsDir)` in `src/services/mcp/mcpSettingsPath.ts`
  returns `ROO_MCP_SETTINGS_PATH` when set, else `<settingsDir>/mcp_settings.json`.
  `McpHub.getMcpSettingsFilePath` and both marketplace call sites use it, so there is one
  answer to "where is the global MCP file". When the file is missing, `McpHub` now also
  creates its directory, because a fresh `~/.roo` may not exist and the settings watcher
  is started unawaited from the constructor (a throw there would be an unhandled
  rejection).
- Channel: an environment variable, following `ROO_CLI_RUNTIME`. `McpHub` reads the
  global file in its constructor during activation, before the CLI can send any webview
  message, so a message (the `cliModeProviderSettings` route) would arrive too late and
  the servers of the wrong file would already be spawned. The variable is set by
  `ExtensionHost` in its own process and restored on dispose; the VS Code extension host
  never has it, so the editor is unchanged.
- CLI: `resolveMcpSettingsPath(settings.mcpSettingsPath)` (leading `~` = home, relative =
  from `~/.roo`, blank = default) in `run.ts` and in `list.ts` (whose hosts also start
  `McpHub`; a settings file that does not parse falls back to the default there, so a
  listing never fails on it). `ExtensionHost` falls back to the default itself when the
  option is absent. The two `ROO_CLI_RUNTIME` save/restore fields became one
  `previousEnv` map.

Behaviour change: servers someone placed in the shim's `mcp_settings.json` are no longer
read. That file was undocumented and empty here; the changeset says where to move them.

## Verification

Real build, isolated `HOME`, fake OpenAI server, `tumble -p --oneshot`:

| Case                                               | Servers in request 1                                           |
| -------------------------------------------------- | -------------------------------------------------------------- |
| A: fresh home, server only in the old shim file    | project only; `~/.roo/mcp.json` created as `{"mcpServers":{}}` |
| B: `globsrv` in `~/.roo/mcp.json`                  | `globsrv`, `projsrv`                                           |
| C: B with `--ephemeral`                            | `globsrv`, `projsrv` (was: project only)                       |
| D: `"mcpSettingsPath": "~/shared/vscode_mcp.json"` | `sharedsrv`, `projsrv`                                         |

Tests: `McpHub.spec.ts` (default path, override, missing override file + directory),
`mcp-settings.test.ts` (default, blank, `~`, absolute, relative, `~` mid-name),
`extension-host.test.ts` (default and configured value, restore on dispose),
`run.test.ts` (default next to `cli-settings.json`, `mcpSettingsPath` with `~`).

## Left open

- The shim's `createFileSystemWatcher` is still a stub, so an edit to either MCP file
  during a session is not picked up by the file watcher. The `/mcp` panel (same branch)
  adds a manual reload (`R`); a real watcher was offered and not chosen.
