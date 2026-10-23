# R4 E7 (part 1): shared provider harness and the shared vscode mock

Status: done (part 1 of 3; parts 2 and 3 move the remaining specs onto the harness).

Related plans: `2026-10-23_17-20_maintenance-audit-round-4.md` (item E7).

## Touched files

- `src/core/webview/__tests__/helpers/providerHarness.ts` (new)
- `src/__mocks__/vscode.js`
- `src/core/webview/__tests__/ClineProvider.sticky-mode.spec.ts`
- `src/core/webview/__tests__/ClineProvider.sticky-profile.spec.ts`
- `src/core/webview/__tests__/ClineProvider.lockApiConfig.spec.ts`
- `src/core/webview/__tests__/ClineProvider.cliModeProviderSettings.spec.ts`

## Problem

Ten ClineProvider specs carried the same 46-line `vi.mock("vscode", ...)` block although `vitest.config.ts`
aliases `vscode` to `src/__mocks__/vscode.js`, and each built the same extension context, output channel,
webview view, provider and MCP hub stub by hand (about 80 lines per file).

## Change

- `providerHarness.ts`: `createMockContext()` (global state, workspace state and secrets that keep what is
  written), `createMockWebviewView()`, and `createTestProvider(context)`, which builds a sidebar provider on its
  own `ContextProxy` with an MCP hub that has no servers. The harness exports only what its callers use; parts 2
  and 3 add what the remaining specs need.
- `src/__mocks__/vscode.js` gains the exports the provider reads and the shared mock lacked: `ExtensionMode`
  (`ClineProvider`, `networkProxy`), `env.uriScheme` / `env.language` / `env.appName` (`ProviderStateBuilder`,
  `TelemetryPropertiesSource`, `PlanReviewPanel`), `version`, and `Uri.joinPath` (`getUri`).
- The four specs drop their inline `vscode` mock and their hand-built setup.

The sidebar view no longer calls its dispose listener the moment it is registered (the old inline copies did);
no test depended on that.

Line counts: sticky-mode 1145 to 1022, sticky-profile 1008 to 885, lockApiConfig 394 to 265,
cliModeProviderSettings 529 to 400; harness 91. Files with the `vscode-webview://test-csp-source` marker: 12 to 8.

## Tests

- The four specs: 45 passed. Whole `src/core/webview/__tests__`: 58 files, 963 tests passed.
- Specs on the alias mock that read the new exports (`TelemetryPropertiesSource`, `cache-manager`,
  `ErrorReporter`, `core/dataset`): 50 passed.
- Mutation: skipping `updateGlobalState("mode", newMode)` in `ModeProfileBinding.ts` turns four sticky-mode
  tests red through the harness.
