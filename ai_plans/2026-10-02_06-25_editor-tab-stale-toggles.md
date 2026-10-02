# Switches in an editor tab go stale or flip back (beyond MCP)

Status: done on branch `fix/editor-tab-stale-toggles`.

## Problem (user report)

"When Tumble is opened in editor I cannot toggle switches in mcp config (they are changing state underneath as I see
mcp turned on/off). Check switches, checkboxes etc in editor mode."

"Editor mode" means Tumble opened as an editor tab: a second ClineProvider with its own webview next to the sidebar
one. The MCP case itself was fixed separately (#733, plan `2026-10-02_06-06_mcp-hub-notify-all-webviews.md`). This
round audits every other switch, checkbox, toggle and select for the same bug class: a reply or a state push that
reaches one webview only, controls that compute the new value from stale props (`!x`), and pushes that reset an
in-progress edit.

## Audit (line numbers on main 0f3fde546)

| Control / path | Verdict | Evidence |
| --- | --- | --- |
| Every immediate setting switch (auto-approve dropdown, MCP enabled, worktrees "show in home", custom tools, mode tool groups, ...) seen from the OTHER panel | CONFIRMED | All providers share one ContextProxy (`src/extension.ts:229`, `src/activate/registerCommands.ts:256`). The handler refreshes only the writer: `messageHandlers/settings.ts:111` (`updateSettings`), `:259` (`autoApprovalEnabled`), `customModes.ts:41`. No state refresh when a panel becomes visible, only a `didBecomeVisible` action (`ClineProvider.ts:843/854`). The other panel keeps the old value; controls send the inverse of what they show (`AutoApproveDropdown.tsx:129`, `WorktreesView.tsx:127`, `ModeToolsSection.tsx:48` builds groups from stale props), so the first click there re-sends the persisted value |
| Auto-approval changed from the web cockpit (remote-control bridge) | CONFIRMED | `src/extension/bridge.ts:71/76` binds the bridge to the sidebar provider; `packages/cloud/src/bridge/commandHandlers.ts:32` pushes that one webview; an editor tab never learns the change |
| Cloud task-sync switch, cloud account facts (`CloudView.tsx:142`) | CONFIRMED | `src/extension.ts:281` pushes cloud auth / settings / user-info events to `getVisibleInstance()` only, which is `findLast` over the visible instances (`ClineProvider.ts:726`): with the sidebar and a tab both on screen only the tab is refreshed |
| Code index popover "Enable codebase indexing" box and every field of its form | CONFIRMED (not editor-specific, same symptom) | `useCodeIndexSettings.ts:59-91` reseeds `currentSettings` whenever `codebaseIndexConfig` changes identity; the reducer builds a new object on every `state` push (`extensionStateReducer.ts:244`) and on every `messageAdded` that carries state (`:292`). While a task streams, an unticked box flips back within a message |
| Code index workspace switches (`CodeIndexWorkspaceToggles.tsx:26/45`) | CONFIRMED (minor) | `useIndexingStatus.ts:25` copies 5 fields of `indexingStatusUpdate` and drops `workspaceEnabled` / `autoEnableDefault`; the parent badge keeps the full status (`IndexingStatusBadge.tsx:40`) and its prop effect restores it one commit later, so the user sees at most a one-frame flicker of the fallback values |
| Code index toggles: reply path | REFUTED | `codeIndex.ts:280/305` reply with `indexingStatusUpdate` via `ctx.provider`; the progress subscription is per provider (`ClineProvider.ts:1569`) |
| Skills settings (mode checkboxes) | REFUTED | `SkillsManager` is per provider (`ClineProvider.ts:397`); replies via `provider.postMessageToWebview` (`skillsMessageHandler.ts:23`) |
| Marketplace install state | REFUTED | `MarketplaceManager` per provider (`ClineProvider.ts:402`), replies via `ctx.provider` |
| Custom modes (tool groups, MCP restriction) reply path | REFUTED for the writer | `CustomModesManager` per provider (`ClineProvider.ts:382`), `updateCustomMode` pushes `ctx.provider` (`customModes.ts:41`); the other panel was the confirmed row 1 (the handler writes `customModes` through the ContextProxy) |
| MCP server restriction checklist in Modes | REFUTED | reconciles on content, not identity (`McpServerRestriction.tsx:88`) |
| SettingsView controls (Save buffer) | REFUTED | bound to the draft store; reseeded only when `currentApiConfigName` changes or on import (`SettingsView.tsx:193/208`); a plain state push does not touch the buffer |
| Optimistic switches in the writer's own panel (auto-approve, MCP enabled, task sync, worktrees) | REFUTED | set the local value first, then the writer's own push carries the same value |
| Title-bar commands, keybinding `toggleAutoApprove`, `handleUri`, `runPromptAction`, PlanReviewPanel, agent-interchange | REFUTED | `getVisibleInstance()` / `getInstance()` route a user command to the panel on screen; no state is pushed to the wrong panel |
| `TelemetryService.setProvider(this)` (`ClineProvider.ts:351`) | REFUTED (not UI) | last provider wins for telemetry properties only |

## Root causes

1. Shared settings, per-panel refresh. Every panel reads its settings from the one shared ContextProxy, but the code
   that writes a setting pushes only the webview it serves (or the sidebar, for the bridge). Nothing refreshed the
   other panels, not even on becoming visible.
2. The cloud listener in `extension.ts` pushed one visible panel instead of every panel.
3. The code index form reseeded on object identity, which every state push changes.

## Fixes

- `ContextProxy.onDidChangeValues(listener)`: called after every write (`updateGlobalState`, including pass-through
  keys, `storeSecret`, `resetAllState`; `setValue` / `setValues` go through these), once the cache holds the new
  value. A throwing listener is logged and does not block the others.
- `ClineProvider` subscribes in its constructor; on a change it pushes its webview the state without the chat
  messages and without the history, coalesced over 50 ms, only while it has a view and another live provider shares
  the same proxy. A lone panel (and the CLI) behaves exactly as before. Disposal unsubscribes and clears the timer.
  The writer gets one redundant push in two-panel mode, which carries the same values.
- `ClineProvider.postStateToAllWebviewsWithoutClineMessages()`; `extension.ts` uses it for the cloud events.
- `useCodeIndexSettings` reseeds only when `JSON.stringify(codebaseIndexConfig)` differs from the last seeded value.
- `useIndexingStatus` keeps every field of `indexingStatusUpdate`.

## Tests

- `src/core/webview/__tests__/ClineProvider.sharedSettings.spec.ts` (new; sidebar + editor tab sharing one real
  ContextProxy): a switch flipped in the tab reaches the sidebar, one flipped in the sidebar reaches the tab, a bridge
  style direct write reaches both, a burst is one push, a lone panel gets no extra push, a closed tab stops listening,
  the static pushes every panel. Against the old ClineProvider/ContextProxy: 5 failed, 2 passed (the two negative
  cases); with the fix: 7 passed.
- `src/core/config/__tests__/ContextProxy.spec.ts`, block `onDidChangeValues`: 3 tests.
- `webview-ui/src/components/code-index/__tests__/CodeIndexPopover.sections.spec.tsx`, block "host pushes while the
  form is open": the same config as a new object keeps the unsaved edit (fails on main), a real config change
  reseeds, the enable box stays unticked across a push in the popover (fails on main), an `indexingStatusUpdate`
  keeps the workspace switches (fails on main).
- Also run: `core/webview/__tests__/ClineProvider*` and `src/__tests__/extension.spec.ts` (19 files, 352 tests),
  Task / grace-retry / flushPending / Task.persistence, `webviewMessageHandler*`, `activate/__tests__` (20 files,
  351 tests), `code-index/__tests__` (5 files, 65 tests). Three ClineProvider specs and the allow-list spec hand-build
  a ContextProxy mock; they gained `onDidChangeValues`. `extension.spec.ts` mocks the new static.
- `tsc --noEmit` in webview-ui clean; in src one error in `api/providers/fetchers/openrouter.ts` only, because the
  worktree links the live tree's `@roo-code/types` (without #731's Sonnet 5.5); unrelated. ESLint clean on every
  touched file.

## Residuals

- The remote-control bridge drives only the sidebar provider's task (`bridge.ts:68-70`, `getCurrentTask`,
  `cancelTask`): a task running in an editor tab is invisible to the web cockpit. Architecture, not a toggle.
- `bridge.ts:59` reports the bridge status to the sidebar only; no webview control renders it today (the CLI does).
- Multi-root workspaces: `CodeIndexManager.getInstance` resolves the folder from `activeTextEditor`
  (`manager.ts:60`), which is undefined while the tab has focus, so a tab acts on the first folder.
- A provider builds its state asynchronously; two overlapping pushes of one panel can arrive out of order and an
  older settings snapshot can briefly win (only `clineMessages` is sequence-guarded). Pre-existing and not
  editor-specific.
- Mode and API profile are global in the ContextProxy: a mode switch in one panel now shows in the other at once
  (before, at its next push). Unchanged semantics, earlier visibility.
