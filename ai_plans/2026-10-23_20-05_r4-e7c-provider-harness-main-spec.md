# R4 E7 (part 3): ClineProvider.spec.ts and five race specs on the shared mock

Status: done (part 3 of 3).

Related plans: `2026-10-23_17-20_maintenance-audit-round-4.md` (item E7),
`2026-10-23_19-45_r4-e7a-provider-harness.md`, `2026-10-23_19-52_r4-e7b-provider-harness-specs.md`.

## Touched files

- `src/__mocks__/vscode.js`
- `src/core/webview/__tests__/helpers/providerHarness.ts`
- `src/core/webview/__tests__/ClineProvider.spec.ts`
- `src/core/webview/__tests__/ClineProvider.cancelTask-abort-race.spec.ts`
- `src/core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts`
- `src/core/webview/__tests__/ClineProvider.historyReopenAllowList.spec.ts`
- `src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts`
- `src/core/webview/__tests__/ClineProvider.apiHandlerRebuild.spec.ts`

## Problem

`ClineProvider.spec.ts` had its own 55-line `vscode` mock and four hand-built extension contexts, two webview
views and twelve `new ClineProvider(...)` calls. Five more ClineProvider specs carried smaller inline `vscode`
mocks that the shared mock already covers.

## Change

- `src/__mocks__/vscode.js`: `EventEmitter` is a class, so `new vscode.EventEmitter()` (code-index state manager
  and file watcher, reached from the provider) constructs.
- `createMockContext(globalState?)` takes the seed for the specs whose tests depend on the stored mode or profile
  name (`mode: "architect"`, `currentApiConfigName: "current-config"`, `apiProvider: "anthropic"`).
- `ClineProvider.spec.ts` builds every context, webview view and provider through the harness and spies on the four
  shared-mock members it asserts or stubs (`window.showErrorMessage`, `Uri.file`, `Uri.joinPath`,
  `workspace.getWorkspaceFolder`). The CSP assertion reads `webview.cspSource` instead of repeating the literal.
  The unused `updateGlobalStateSpy` left by E1 is gone.
- The five race specs drop their inline `vscode` mock; `historyReopenAllowList` spies on `showErrorMessage`.

Left as they are: `ClineProvider.stateBuilder.spec.ts` keeps its inline mock because its
`workspace.getConfiguration` (`get` and `inspect`) is driven by a per-test `workspaceConfig` table.
`PlanReviewPanel.html.spec.ts` keeps its `test-csp-source` literal: it is not a provider spec, and the literal is
part of its byte-exact HTML file snapshots.

Line counts: ClineProvider.spec 3361 to 3148, cancelTask-abort-race 478 to 442, delegation-cancel-races 496 to 460,
historyReopenAllowList 346 to 323, flicker-free-cancel 311 to 276, apiHandlerRebuild 618 to 579. Across E7,
inline `vscode` mocks in ClineProvider specs went from 17 to 1, and specs with the `vscode-webview://test-csp-source`
marker from 12 to 1.

## Tests

- Touched specs pass; whole `src/core/webview/__tests__`: 57 files, 817 tests passed.
- Specs on the alias mock that reach `EventEmitter` or the code-index manager: 23 files, 588 tests passed.
- Mutations, each red then restored: the edit catch maps to the delete key (`messageEdits.ts`) turns the
  `editMessageConfirm` row red through the `showErrorMessage` spy; dropping `showErrorMessage` in
  `ClineProvider.showAllowListViolation` turns three historyReopenAllowList tests red.
