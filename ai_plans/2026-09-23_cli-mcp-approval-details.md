# CLI: MCP approval names the server, the tool and the arguments

**Status:** done on `fix/cli-mcp-approval-details` (off `main` `367d07e28`, independent of
the other MCP branches)
**Related plans:** `2026-09-23_cli-global-mcp-config.md`, `2026-09-23_cli-allow-mode-approves-mcp.md`,
`2026-09-23_cli-mcp-panel.md`
**Touched:** `apps/cli/src/lib/utils/mcp-ask.ts` (new) + test,
`apps/cli/src/ui/components/dialogs/ApprovalDialog.tsx` + test, `apps/cli/src/agent/ask-dispatcher.ts`,
`apps/cli/src/agent/__tests__/ask-dispatcher.test.ts` (new)

## Symptom

Asked to approve an MCP call, the user approved blind:

- TUI: `ApprovalDialog.buildBody` knew only `command` and `tool`; a `use_mcp_server` ask
  fell through to the fallback title `Use_mcp_server` with no body. The README already
  claimed the dialog shows `MCP tool` and "server+tool".
- Print mode (`-p --require-approval`): `AskDispatcher.handleMcpApproval` read
  `server_name` and `tool_name`, but the core writes `ClineAskUseMcpServer` in camelCase
  (`serverName`, `toolName`, `UseMcpToolTool.ts:70`, `accessMcpResourceTool.ts:52`). It
  printed `Server: unknown` and no tool. Reproduced with the real build: the run printed
  `[mcp request]` / `Server: unknown`.

Neither path showed the arguments, which is what the user actually approves.

## Change

- `parseMcpAsk(text)` reads the core's shape once, for both paths: kind (tool or
  resource), server, tool, URI, and the arguments pretty-printed as JSON lines (`{}` and
  a missing value give no lines; text that is not JSON is kept as it is).
- Dialog: title `MCP tool` / `MCP resource`; a bold `server › tool` line (or the server
  and the URI); then the argument lines, at most 12, each cut at the dialog width
  (`truncate-end`) with a `… +N lines` note. The dialog sits in the height-clamped tail
  (`TailViewport`), so an unbounded argument dump would push Yes / No out of view. Body
  lines became `{ content, bold, secondary, truncate }` records so a line can truncate
  while command lines keep wrapping (a command must stay fully readable).
- Print mode: `Server`, `Tool`, `Resource` from the parser, plus every argument line
  (a log, so no cap).

## Tests

- `mcp-ask.test.ts`: the core's exact shape, empty and missing arguments, non-JSON
  arguments, resources, and rejection of the old snake_case shape.
- `ApprovalDialog.test.tsx`: title and `server › tool` and arguments, the 12-line cap with
  its note and Yes still rendered, a 500-character argument staying on one row, resource.
- `ask-dispatcher.test.ts`: server, tool, arguments and the yes/no response for tools and
  resources.
- Red on `main`: the six new dialog and dispatcher tests fail against `main`'s
  `ApprovalDialog.tsx` and `ask-dispatcher.ts` (run in a throwaway worktree), and pass here.

## Out of scope, found on the way

In the default `allow` mode an MCP tool that is not on its server's `alwaysAllow` list
hangs the task (print mode reproduced: one request, then nothing for 40 s). Separate
branch, see `2026-09-23_cli-allow-mode-approves-mcp.md`.
