# MCP switches in an editor tab do not follow the server state

Status: done on branch `fix/mcp-hub-notify-all-webviews`.

## Problem (user report)

With Tumble Code opened as an editor tab (not the sidebar), the MCP server switch in the MCP settings cannot be
toggled reliably: the server really turns on or off, but the switch in the tab does not follow and keeps "changing
state underneath". The same goes for the per-tool "always allow" and "enabled for prompt" controls.

## Root cause (line numbers on main 294c8716c)

- `src/services/mcp/McpServerManager.ts:34` builds ONE hub for the whole extension with `new McpHub(provider)`, where
  `provider` is the ClineProvider that asked first (normally the sidebar).
- `src/services/mcp/McpHub.ts:46/56` keeps only that provider (`providerRef`), and `notifyWebviewOfServerChanges()`
  (`McpHub.ts:382`, target taken at `:414`) posts the `mcpServers` message to that one provider only.
- The editor-tab ClineProvider gets the same hub from `getInstance` and calls `registerClient()`
  (`src/core/webview/ClineProvider.ts:397`), which only bumped a counter (`McpHub.ts:131`).
- The tab gets the server list once, on `webviewDidLaunch` (`src/core/webview/messageHandlers/taskLifecycle.ts:34`),
  and never again. The webview store replaces its list only on an `mcpServers` message
  (`webview-ui/src/context/extensionStateReducer.ts:382`; a `state` push deliberately does not touch it).
- The switch sends the inverse of what it shows (`webview-ui/src/components/mcp/ServerRow.tsx:138`
  `disabled: !server.disabled`; `McpToolRow.tsx:26/37` the same for the tool controls). With stale props the second
  click sends the same value again, so the tab's controls fight the real state.
- Same design, second defect: when the creating provider (the sidebar) is closed first, the hub posts to nobody and
  reads the settings directory, client version, cwd and `mcpEnabled` from a closed provider.

## Fix

- `McpHub.registerClient(provider)` / `unregisterClient(provider)` keep a `Set` of client providers; the hub is
  disposed when the last client leaves (same rule as the old counter). `ClineProvider` passes `this`; it is the only
  caller (tests only mock the methods).
- `notifyWebviewOfServerChanges()` posts to every registered provider that is not disposed (`webviewTargets()`), or
  to the creator while nobody has registered yet (the initial connect runs before `getInstance` resolves). Each post
  has its own try/catch, so one failing webview does not keep the others stale.
- `liveProvider()`: the creator while it is open, else the first open registered client. Used for the settings
  directory, MCP servers directory, client version, workspace path and `mcpEnabled`.
- `McpHubProvider` gains an optional `readonly isDisposed`; `ClineProvider` already has the getter.
- No webview change: ServerRow and McpToolRow read `mcpServers` from the store, which now gets every push.

## Tests

`src/services/mcp/__tests__/McpHub.spec.ts`, block "server list pushed to every registered webview" (hub built with
the sidebar mock, sidebar and a second "editor tab" mock registered):

- a server toggle reaches the editor tab with `disabled: true` (fails on main: the tab gets nothing);
- an unregistered tab gets no more updates, the sidebar still does (guards the new Set; passes on main trivially);
- a rejecting sidebar post does not stop the tab's update (fails on main);
- with the creator disposed, the settings directory comes from the tab and only the tab is notified (fails on main).

Verified by running the block against the old `McpHub.ts` (3 failed, 1 passed) and the new one (4 passed). Also run:
`services/mcp`, `core/webview/__tests__/ClineProvider*`, `webviewMessageHandler*` (38 files, 784 tests), eslint on
the touched files. `tsc --noEmit` in src reports one error in `api/providers/fetchers/openrouter.ts` only, because
the worktree's linked `@roo-code/types` is the live tree's (without #731's Sonnet 5.5); unrelated to this change.

## Residuals

- `McpServerManager.instance` still points at the hub after the last client disposes it; a provider opened later
  gets that disposed hub. Pre-existing, not changed here (the sidebar normally lives as long as the extension).
- A ClineProvider disposed before `getInstance` resolves still registers afterwards and is never unregistered.
  Pre-existing; now harmless for notifications (disposed providers are skipped) but it keeps the hub alive.
