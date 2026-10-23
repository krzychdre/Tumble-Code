# R4 E7 (part 2): six more ClineProvider specs on the shared harness

Status: done (part 2 of 3).

Related plans: `2026-10-23_17-20_maintenance-audit-round-4.md` (item E7),
`2026-10-23_19-45_r4-e7a-provider-harness.md` (part 1).

## Touched files

- `src/core/webview/__tests__/helpers/providerHarness.ts`
- `src/core/webview/__tests__/ClineProvider.modeProfileBinding.spec.ts`
- `src/core/webview/__tests__/ClineProvider.multipleTabs.spec.ts`
- `src/core/webview/__tests__/ClineProvider.sharedSettings.spec.ts`
- `src/core/webview/__tests__/ClineProvider.reacquire.spec.ts`
- `src/core/webview/__tests__/ClineProvider.storageError.spec.ts`
- `src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts`

## Problem

These six specs carried the same inline `vscode` mock as the four moved in part 1, plus their own copies of the
context, output channel, webview view or panel, MCP hub stub and `new ClineProvider(...)` call (taskHistory alone
built 15 providers by hand).

## Change

- The harness gains what these callers need: `mockWebviewFields(postMessage?)` for the specs that drive their own
  view listeners, `createMockWebviewView(postMessage?)`, `createMockWebviewPanel(postMessage?)`, and
  `createTestProvider(context, renderContext?, contextProxy?)` for editor tabs and panels that share one
  `ContextProxy`.
- The six specs drop their inline `vscode` mock and their setup copies. `modeProfileBinding` reads and writes the
  stores through `context.globalState` / `context.workspaceState` instead of the backing objects.
  `multipleTabs` spies on `vscode.commands.executeCommand` of the shared mock, the only vscode call these specs
  assert.

Line counts: modeProfileBinding 683 to 575, multipleTabs 518 to 403, sharedSettings 464 to 341, reacquire 491 to
388, storageError 445 to 329, taskHistory 1857 to 1681; harness 91 to 110. Files with the
`vscode-webview://test-csp-source` marker: 8 to 2.

## Tests

- The six specs: 112 passed. Whole `src/core/webview/__tests__`: 57 files, 817 tests passed (the routing spec
  retired in #971 accounts for the drop from part 1).
- Mutation: dropping `executeCommand(sideBarId.focus)` in `ClineProvider.revealView` turns two multipleTabs tests
  red through the spy on the shared mock.
