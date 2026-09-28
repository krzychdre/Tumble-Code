# D10 — Four things called "TaskHistory": rename + move

Roadmap item D10 from `ai_plans/2026-09-27_simplification-roadmap.md`.

## Problem

Four unrelated things carry the name "TaskHistory":

1. `TaskHistory` (src/core/task/TaskHistory.ts) — ONE task's API + UI message persistence.
2. `TaskHistoryStore` (src/core/task-persistence/TaskHistoryStore.ts) — the shared list/index of history items.
3. `TaskHistoryGateway` (src/core/webview/TaskHistoryGateway.ts) — the provider's handle on the store.
4. `searchTaskHistory` (src/core/task/searchTaskHistory.ts) — a pure helper used by `SearchTaskHistoryTool`.

## Fix (per roadmap, verbatim)

> Rename `TaskHistory` to `TaskMessageLog`; move `searchTaskHistory.ts` to `core/tools/helpers/`.

- `src/core/task/TaskHistory.ts` → `src/core/task/TaskMessageLog.ts`; class `TaskHistory` → `TaskMessageLog`.
- `src/core/task/searchTaskHistory.ts` → `src/core/tools/helpers/searchTaskHistory.ts`. Exported names (`searchTaskHistoryCorpus`, `searchHistorySources`, `readTaskArtifacts`, `HISTORY_SEARCH_DEFAULTS`, `TaskArtifactText`) stay — they describe actions and are not ambiguous.
- `TaskHistoryStore` and `TaskHistoryGateway` stay UNCHANGED (roadmap keeps their names; TaskHistoryStore internals recently had the F2 lock-count flake fix, PR #531 — untouched).
- Pure rename/move: no logic, signature, or behavior changes.

## Reference inventory (before)

### `TaskHistory` symbol (class + `TaskHistoryAccess` interface + `flushPendingClineMessageSaves`)

Importers of `./TaskHistory` / `../TaskHistory` (production code):

| File                                             | Kind                            |
| ------------------------------------------------ | ------------------------------- |
| `src/extension.ts` (line 35)                     | `flushPendingClineMessageSaves` |
| `src/core/task/Task.ts` (136, 785, 978)          | class + comments                |
| `src/core/task/TaskApiLoop.ts` (33, 188)         | `type TaskHistory`              |
| `src/core/task/TaskAskSay.ts` (19, 56)           | `type TaskHistory`              |
| `src/core/task/TaskLifecycle.ts` (23, 124)       | `type TaskHistory`              |
| `src/core/task/TaskSubtasks.ts` (7, 41)          | `type TaskHistory`              |
| `src/core/task/TaskResumption.ts` (24, 53)       | `type TaskHistory`              |
| `src/core/task/TaskContextManager.ts` (27, 170)  | `type TaskHistory`              |
| `src/core/task/TaskStreamProcessor.ts` (36, 103) | `type TaskHistory`              |

Related files that share the `TaskHistory.*` basename but are NOT the ambiguous name:

- `src/core/task/TaskHistory.helpers.ts` — pure content-block builders, imported only by `TaskHistory.ts`. Renamed alongside to `TaskMessageLog.helpers.ts` (it is the class's helper module; keeping the old basename would re-create the collision the roadmap complains about). No other importer.
- Specs: `src/core/task/__tests__/TaskHistory.background-guard.spec.ts`, `TaskHistory.turn-counts.spec.ts` (class + `TaskHistoryAccess`), `Task.throttle.test.ts` (`CLINE_MESSAGES_SAVE_IDLE_MS`), `Task.access-types.spec.ts` (`TaskHistoryAccess`), comment mentions in `ApiRequestBuilder.reasoning-items.spec.ts`, `Task.access-types.spec.ts`.

Comments mentioning the class (updated where they refer to the renamed class): `SubagentRegistry.ts:246`, `messageHandlers/subagents.ts:9`, `ApiRequestBuilder.ts:39,283`, `Task.ts:781,1594`, `apps/cli/src/agent/__tests__/transcript-reducer.test.ts:928`.

### `searchTaskHistory` module importers

| File                                                          | Change                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/tools/SearchTaskHistoryTool.ts` (line 10)           | import path `../task/searchTaskHistory` → `../helpers/searchTaskHistory`                                                                          |
| `src/core/task/__tests__/searchTaskHistory.spec.ts` (line 23) | spec moves to `src/core/tools/helpers/__tests__/searchTaskHistory.spec.ts` (helpers dir already hosts specs there), import `../searchTaskHistory` |

Import-path fixups inside the moved module: `../artifacts/ArtifactStore` → `../../artifacts/ArtifactStore`; `../task-persistence/apiMessages` → `../../task-persistence/apiMessages`.

### Deliberately NOT renamed (distinct concepts, stay as-is)

- `updateTaskHistory` / `getTaskHistoryStore` / `getTaskHistory` / `taskHistoryStore` / `TaskHistoryInclusion` / `includeTaskHistory` / `includeTaskHistoryInEnhance` / `persistTaskHistory` / `viewTaskHistoryRevision` / `hasLegacyTaskHistory` etc. — these operate on the task-history LIST (store/gateway domain), not the per-task message log. The roadmap names only the four items above.
- `searchTaskHistoryTool` / `SearchTaskHistoryTool` / `search_task_history` tool name — the tool keeps its name; only the helper module moves.

### String literals / serialized names — findings

- `"searchTaskHistory"` string in `SearchTaskHistoryTool.ts:102` and asserted in `SearchTaskHistoryTool.spec.ts:94`: this is the `tool` field of the tool's `say` payload — a wire/UI format consumed by the webview tool renderers, the CLI transcript reducer and `packages/core` toolPayload. NOT changed.
- `"search_task_history"` — the tool NAME in the protocol (native-tools index, toolHandlers dispatch table, approval matrix). NOT changed.
- `"setTaskHistory"` (CLI transcript-reducer test) — separate concept, NOT changed.
- `TaskHistory`/`TaskMessageLog` never appears in any serialized/on-disk format, i18n key, or protocol string — the class is internal; only file paths and TypeScript identifiers change.
- Log strings mentioning `TaskHistoryStore`/`TaskHistoryGateway` are untouched.

## Docs updates (only where the old name appears)

- `docs/architecture.md:117-118` — `TaskHistory.addToClineMessages` / `TaskHistory.updateClineMessage` → `TaskMessageLog.…`
- `docs/03-task-agent-loop.md:18,31` — mermaid node label + file-table row.
- `docs/06-persistence.md:22,32` — mermaid node + file-table row.
- `docs/02-extension-host.md:74` — `postStateToWebviewWithoutTaskHistory` is a REAL method name (ClineProvider) — NOT changed; method stays.

## Verification plan

1. `git mv` both files (+ `TaskHistory.helpers.ts` → `TaskMessageLog.helpers.ts`, + specs).
2. `sed` rename `TaskHistory` → `TaskMessageLog` (symbol + `TaskHistoryAccess` → `TaskMessageLogAccess`) only in the identified files; manual pass over comments.
3. Typecheck (`npx tsc --noEmit` in src? — repo uses workspace turbo; run `npx tsc -p src` style check or the lint-staged equivalent), eslint on touched files.
4. `cd src && npx vitest run` for: `core/task/__tests__/TaskMessageLog.*.spec.ts`, `core/task/__tests__/searchTaskHistory` (moved), `core/tools/__tests__/SearchTaskHistoryTool.spec.ts`, `core/task/__tests__/Task.throttle.test.ts`, `core/task/__tests__/Task.access-types.spec.ts`, `core/assistant-message/__tests__/presentAssistantMessage-search-task-history.spec.ts`.
5. `pnpm knip` — baseline exit 1 pre-existing; no NEW findings (old paths deleted entirely, no re-export shims).
6. Changeset `.changeset/d10-rename-taskhistory.md`, one commit, PR, immediate squash-merge.

## Residuals

- The say-payload string `"searchTaskHistory"` and tool name `"search_task_history"` intentionally keep the old vocabulary (wire format; changing them would touch webview + CLI renderers for zero clarity gain).
- `updateTaskHistory`/`getTaskHistoryStore` family still says "TaskHistory" — that vocabulary belongs to the store/gateway (the LIST of tasks), which keeps its name.
