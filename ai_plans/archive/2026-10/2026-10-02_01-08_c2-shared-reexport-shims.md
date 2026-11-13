# C2: remove the re-export files left in `src/shared` by the package migration

Item C2 of `ai_plans/2026-10-01_simplification-round-2.md`. Same method as round 1 item D5
(`ai_plans/2026-09-28_d5-remove-reexport-shims.md`), which removed the array/todo/cost/context-mentions shims
and listed the files handled here as out of its scope.

## Status

Implemented on branch `refactor/c2-shared-reexport-shims` off `origin/main` @ 3f9a621f6 (2026-10-02). One commit
per shim file. No changeset: no behaviour change.

## Problem

After the package migration (PKG-6) moved the code to `@roo-code/core` and `@roo-code/types`, `src/shared` kept
files that only forwarded to the new home. Their own header said they existed "during the migration", which is
finished:

- `src/shared/api.ts:1-11`, `experiments.ts:1-3`, `language.ts:1-3`, `parse-command.ts:1-4`: pure re-exports.
- `src/shared/getApiMetrics.ts:1-7`, `combineApiRequests.ts:1-3`, `combineCommandSequences.ts:1-3`: re-exports
  under a DIFFERENT name (`consolidateTokenUsage as getApiMetrics` and so on), so one function had two names in
  the repo and a reader searching for the real name missed half the callers.
- `src/shared/WebviewMessage.ts:1` and `src/shared/tools.ts:5-17`: partial re-exports next to real content.

## Inventory

Importer counts are files that imported a forwarded name (static imports, `import()` type references, dynamic
`await import(...)` and `vi.mock` paths), counted on `origin/main` @ 3f9a621f6.

| Shim                                     | Real module              | Old name -> real name                                                                                                                                                                    | Importer files                                                  |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/shared/api.ts`                      | `@roo-code/core/browser` | same names (reasoning/max-token helpers, `ApiHandlerOptions`, `FetchableModelSourceId`, `GetModelsOptions`)                                                                              | 66 (all `src`)                                                  |
| `src/shared/experiments.ts`              | `@roo-code/types`        | same names (`EXPERIMENT_IDS`, `experiments`, `experimentDefault`)                                                                                                                        | 10 (all `src`)                                                  |
| `src/shared/language.ts`                 | `@roo-code/types`        | same names (`LANGUAGES`, `formatLanguage`)                                                                                                                                               | 7 (`src`, one of them a `vi.mock`)                              |
| `src/shared/parse-command.ts`            | `@roo-code/core/browser` | same names (`parseCommand`, `analyzeCommand`, `AnalyzedCommand`)                                                                                                                         | 2 (all `src`)                                                   |
| `src/shared/getApiMetrics.ts`            | `@roo-code/core/browser` | `getApiMetrics` -> `consolidateTokenUsage`; `hasTokenUsageChanged`, `hasToolUsageChanged` same                                                                                           | 11 (10 `src` incl. 2 `vi.mock`, 1 webview)                      |
| `src/shared/combineApiRequests.ts`       | `@roo-code/core/browser` | `combineApiRequests` -> `consolidateApiRequests`                                                                                                                                         | 7 (4 `src`, 3 webview)                                          |
| `src/shared/combineCommandSequences.ts`  | `@roo-code/core/browser` | `combineCommandSequences` -> `consolidateCommands`; `COMMAND_OUTPUT_STRING` same                                                                                                         | 9 (4 `src`, 5 webview)                                          |
| `src/shared/WebviewMessage.ts` (partial) | `@roo-code/types`        | `WebviewMessage` same; `ClineAskResponse` stays in the file                                                                                                                              | 5 of 8 (2 `src`, 3 webview); 3 import only `ClineAskResponse`   |
| `src/shared/tools.ts` (partial)          | `@roo-code/types`        | same names (`toolParamNames`, `ToolParamName`, `TOOL_DISPLAY_NAMES`, `TOOL_GROUPS`, `ALWAYS_AVAILABLE_TOOLS`, `PROTOCOL_TOOL_NAMES`, `TOOL_ALIASES`); the extension-side tool types stay | 16 of 73 (all `src`); the other 57 import only the real content |

`apps/cli` and `packages/*` imported none of them.

## Fix

A codemod (TypeScript compiler API, run once per shim, not committed) rewrote every import declaration whose
specifier resolved to the shim (relative paths and the webview's `@roo/<name>` alias): forwarded names move to the
real module, merged into an existing named import from that module when the file has one; names the file still
owns stay on the shim path. Renamed functions are renamed at every call site in the importing file. Then:

- the seven pure shims are deleted; `WebviewMessage.ts` keeps only `ClineAskResponse`; `tools.ts` loses its
  re-export block and keeps its own types;
- `vi.mock` of an old path moves to the real module as a partial mock (`importOriginal` spread plus the one mocked
  function), so the rest of `@roo-code/core/browser` or `@roo-code/types` stays real exactly as before:
  `src/__tests__/extension.spec.ts` (`formatLanguage`), `src/core/auto-approval/__tests__/AutoApprovalHandler.spec.ts`
  and `src/core/environment/__tests__/getEnvironmentDetails.spec.ts` (`consolidateTokenUsage`);
- `src/core/task/__tests__/native-tools-filtering.spec.ts` dynamic `await import(...)` points at `@roo-code/types`;
- the three specs in `src/shared/__tests__` that tested the renamed functions through the shims
  (`getApiMetrics.spec.ts`, `combineApiRequests.spec.ts`, `combineCommandSequences.spec.ts`) move next to the
  functions as `packages/core/src/message-utils/__tests__/<realName>.cases.spec.ts`. They are not duplicates of
  the existing core specs (different cases), so they are kept; `consolidateApiRequests.cases.spec.ts` needed `!`
  on indexed access because packages/core compiles with `noUncheckedIndexedAccess`;
- `src/core/task/Task.ts` imported `getApiMetrics`, `hasTokenUsageChanged`, `hasToolUsageChanged` without using
  them; those imports are dropped instead of renamed;
- comments and docs naming the old paths or names are updated (`docs/05-webview-ui.md` diagram,
  `webview-ui/src/components/chat/rows/filterVisible.ts`, `apps/cli/src/ui/store.ts`, the `PROTOCOL_TOOL_NAMES`
  references in `spillPolicy.ts`, `microcompact.ts`, `toolDescriptors.ts`, the "moved from src/shared" notes in
  `packages/types/src/{experiment,tool}.ts`).

Browser safety: every webview import now points at `@roo-code/core/browser` or `@roo-code/types` (29 imports of
`@roo-code/core` in `webview-ui/src`, all `/browser`), which are the entries the shims themselves forwarded to.
`docs/architecture.md` needs no change: no boundary moved.

## Tests

- `tsc --noEmit` in `src`, `webview-ui`, `apps/cli`, `packages/core`: exit 0.
- `eslint --max-warnings=0` on the 123 touched ts/tsx files: exit 0. `prettier --check`: clean.
- `pnpm knip`: exit 0.
- Specs (`--maxWorkers=2`): 89 `src` spec files (every touched spec plus the specs named after every touched
  production file outside `api/providers`): all pass except two cases in `core/task/__tests__/Task.spec.ts`
  ("tool-result spill policy"), which fail identically on `origin/main` @ 3f9a621f6 (pre-existing, not caused by
  this change). 17 `webview-ui` spec files (touched specs, ChatView, CommandExecution, AskRows, filterVisible,
  MarketplaceViewStateManager, useMentionMenu): pass. `packages/core` `message-utils/__tests__`: 154 pass.

## Notes

- The two `Task.spec.ts` spill-policy failures exist on main; reported to the coordinator, not touched here.
- Old plan docs under `ai_plans/` still name the removed paths; they describe past states and are left as they are.
