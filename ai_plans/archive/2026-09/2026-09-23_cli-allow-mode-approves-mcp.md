# CLI: `allow` mode hung on every MCP tool that was not on its server's `alwaysAllow` list

**Status:** done on `feat/cli-mcp-support` (one branch for all CLI MCP work, off `main` `367d07e28`)
**Related plans:** `2026-09-23_cli-global-mcp-config.md`, `2026-09-23_cli-mcp-approval-details.md`,
`2026-09-23_cli-mcp-panel.md`
**Touched:** `apps/cli/src/lib/utils/permissions.ts` + test, `apps/cli/README.md`

## Symptom

In the CLI's default permission mode (`allow`, "Allow actions without approval"; the README
says "Browser and MCP actions are auto-approved"), a task that calls an MCP tool stops
forever after the model's tool call. No dialog, no error: the TUI spinner keeps running.

## Root cause

`allow` sends `alwaysAllowMcp: true` but leaves `autoApprovalMode` at `default`. In that
tier `checkAutoApproval` approves `use_mcp_tool` only when
`alwaysAllowMcp && isMcpToolAlwaysAllowed(...)`, i.e. only for tools listed under the
server's `alwaysAllow` in the MCP config (`src/core/auto-approval/index.ts`, the
`use_mcp_server` branch). That is the VS Code design: a global toggle plus a per-tool
checkbox. Every other MCP tool gets the decision `ask`, and nothing in `allow` mode answers
an ask: the TUI shows asks as transcript rows instead of dialogs when `nonInteractive`, and
print mode's `AskDispatcher.handleMcpApproval` returns "auto-approved by extension
settings" without responding. A fresh `~/.roo/mcp.json` (next commit) has no `alwaysAllow`
lists at all, so every MCP call would hang.

The CLI cannot answer the ask itself: the core posts the ask message even when it has
auto-approved it (`TaskAskSay`), so the CLI cannot tell a waiting ask from an approved
one, and a stray "yes" would be consumed by the next ask.

## Fix

`allow` now also sends `autoApprovalMode: "bypass"`, the core's documented tier for
"approve permission asks without the per-item toggles" (`packages/types/src/global-settings.ts`).
Compared with `default` plus the CLI's all-true toggles, bypass:

- approves MCP tools without a per-tool list (the fix; already covered by
  `checkAutoApproval.spec.ts` "approves MCP usage without per-tool allow");
- approves the few tool asks that are neither read-only nor write actions, which fell
  through to `ask` (and would have hung the same way);
- ignores `deniedCommands`. The CLI never sets that list (its state holds none); noted in
  the code comment.

Unchanged: follow-up questions still ask, the plan-approval gate (`switchMode`/`newTask`
out of a planning mode, `reviewPlan`) still asks, and `ask` mode's `autoApprovalEnabled:
false` kill switch still overrides every tier.

## Verification

Fake OpenAI server whose request 1 calls `mcp--projsrv--list_handoffs` and whose later
requests complete; project `.roo/mcp.json` with `projsrv` and no `alwaysAllow`; each run
on a FRESH `HOME`.

| Build           | Print mode (`-p --oneshot`) | TUI (`--oneshot`, under `script`)              |
| --------------- | --------------------------- | ---------------------------------------------- |
| without the fix | killed at 40 s, 1 request   | killed at 40 s, 1 request, spinner at 37 s     |
| with the fix    | exit 0, 2 requests          | exit 0, 2 requests, "No handoffs." then "done" |

Trap met on the way, worth keeping: the CLI persists every `updateSettings` into its own
store (`~/.vscode-mock/global-storage/global-state.json`). A first "before" measurement on a
`HOME` that had already run the fixed build passed, because `autoApprovalMode: "bypass"`
had been persisted by that earlier run. Before/after comparisons of permission settings
need a fresh `HOME` per run. Also: a fake server that keys "call the tool" on a global
request counter only does so for the first run after it starts; restart it per run.

## Tests

`permissions.test.ts` pins the `allow` profile including `autoApprovalMode: "bypass"`. The
core behaviour it relies on is tested in `src/core/auto-approval/__tests__/checkAutoApproval.spec.ts`.
