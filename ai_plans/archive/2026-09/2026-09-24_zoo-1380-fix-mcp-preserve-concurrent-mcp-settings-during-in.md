# Zoo #1380 port: creating mcp_settings.json no longer clobbers a concurrent config

**Status:** ported, one commit on the zoo port branch
**Upstream:** Zoo-Code #1380 (commit 4436ac537), by Eason Liang and Elliott de Launay
**Touched:** `src/services/mcp/McpHub.ts`, `src/services/mcp/__tests__/McpHub.settingsCreation.spec.ts`, `src/services/mcp/__tests__/McpHub.spec.ts`

## Symptom

On a fresh settings directory, two processes starting at once (two editor windows, or the CLI and
the extension, which share the file through `ROO_MCP_SETTINGS_PATH`) can both see the global MCP
settings file as absent. The slower one then overwrites the config the faster one just wrote with
the empty `{ "mcpServers": {} }` stub, so the user's servers vanish.

## Root cause in our code

`McpHub.getMcpSettingsFilePath` (`src/services/mcp/McpHub.ts:493-505`) is check-then-write:
`fileExistsAtPath` followed by an unconditional `fs.writeFile`, which truncates whatever appeared
on disk between the two calls.

## Fix

The stub is written with `fs.writeFile(..., { flag: "wx" })`, an exclusive create (`O_CREAT |
O_EXCL`): the operating system refuses it atomically if the file already exists. `EEXIST` is
treated as success, because a file someone else created is exactly what we wanted; any other error
still propagates. The fast path (file exists, no write) is unchanged.

This is simpler than Zoo's fix, which routes the stub through `safeWriteJson` with a new `merge`
callback under the advisory lock. Our `safeWriteJson` has no `merge` option, and the lock only helps
against writers that also take it; the exclusive create protects against any writer.

## Tests

New `McpHub.settingsCreation.spec.ts` runs `getMcpSettingsFilePath` on a real temporary directory.
It controls `fileExistsAtPath` to reproduce the race: the check reports "absent" while a concurrent
config is already on disk. Before the fix the file was replaced by the empty stub (assertion
failure showing the stub); after it the concurrent config is kept byte for byte. A second case
checks the stub is still created when nothing exists. The existing `McpHub.spec.ts` assertion on
the create call now includes the `{ flag: "wx" }` option; all 53 tests in `services/mcp` pass.

## Not ported

- Zoo's `safeWriteJson` merge callback and its spec mock changes (not needed with `wx`).
- Zoo's lock-based integration test (tests the merge approach we did not take).
- Follow-up, out of scope: `webviewMessageHandler.ts:1284-1287` creates the project `.roo/mcp.json`
  with the same check-then-write pattern, but only on an explicit user click, so a race is unlikely.
