# D3 — Remove "triple forwarding" on Task / TaskApiLoop

Roadmap item D3 from `ai_plans/2026-09-27_simplification-roadmap.md`.
Branch: `refactor/d3-remove-task-forwarders` (off `main` @ f900e7b6d).

## Problem

`Task` carries ~47 one-line forwarders to its delegate modules
(`lifecycle`, `history`, `askSay`, `contextManager`, `apiLoop`,
`tokenTracking`, `subtasks`). `TaskApiLoop` in turn wraps
`RetryHandler` / `ApiRequestBuilder` / `TaskContextManager` with more
one-line forwarders, so a call can traverse three hops
(`task.x()` → `apiLoop.x()` → `retryHandler.x()`). `getCurrentProfileId`
is defined **four times** (ApiRequestBuilder method, TaskApiLoop wrapper,
Task private forwarder, TaskContextManager private copy) with identical
bodies.

## Inventory (verified by grep, 2026-09-28)

### A. Dead or spec-only forwarders on Task — REMOVE

Used nowhere in production code (only their own delegation line, or spec
files reaching through `(task as any)`):

| Forwarder                                      | Delegates to                  | Non-spec callers                                                     | Action                                                       |
| ---------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `getSavedApiConversationHistory` (private)     | `history`                     | 0                                                                    | delete                                                       |
| `addToApiConversationHistory` (private)        | `history`                     | 0 prod; 5 calls + 3 spies in specs                                   | delete; specs use `task.history.addToApiConversationHistory` |
| `saveApiConversationHistory` (private)         | `history`                     | 0                                                                    | delete                                                       |
| `getSavedClineMessages` (private)              | `history`                     | 0                                                                    | delete                                                       |
| `addToClineMessages` (private)                 | `history`                     | 0 prod; 2 spec calls                                                 | delete; spec uses `task.history.addToClineMessages`          |
| `updateClineMessage` (private)                 | `history`                     | 0                                                                    | delete                                                       |
| `saveClineMessages` (private)                  | `history`                     | 0                                                                    | delete                                                       |
| `findMessageByTimestamp` (private)             | `history`                     | 0                                                                    | delete                                                       |
| `initializeTaskMode` (private)                 | `lifecycle`                   | 1 (constructor)                                                      | inline `this.lifecycle.initializeTaskMode(provider)`         |
| `initializeTaskApiConfigName` (private)        | `lifecycle`                   | 1 (constructor)                                                      | inline                                                       |
| `setupProviderProfileChangeListener` (private) | `lifecycle`                   | 1 (constructor)                                                      | inline                                                       |
| `startTask` (private)                          | `lifecycle`                   | 1 (constructor)                                                      | inline                                                       |
| `resumeTaskFromHistory` (private)              | `lifecycle`                   | 1 (constructor)                                                      | inline                                                       |
| `getFilesReadByRooSafely` (private)            | `contextManager`              | 0                                                                    | delete                                                       |
| `getEnabledMcpToolsCount` (private)            | `contextManager`              | 0                                                                    | delete                                                       |
| `handleContextWindowExceededError` (private)   | `apiLoop` → contextManager    | 0                                                                    | delete                                                       |
| `maybeWaitForProviderRateLimit` (private)      | `apiLoop` → retryHandler      | 0                                                                    | delete                                                       |
| `backoffAndAnnounce` (private)                 | `apiLoop` → retryHandler      | 0                                                                    | delete                                                       |
| `buildCleanConversationHistory` (private)      | `apiLoop` → apiRequestBuilder | 0                                                                    | delete                                                       |
| `getCurrentProfileId` (private)                | `apiLoop` → apiRequestBuilder | 0                                                                    | delete (dedupe, batch 1)                                     |
| `waitForModeInitialization` (public)           | `lifecycle`                   | 0 (repo-wide, incl. webview-ui/apps)                                 | delete                                                       |
| `waitForApiConfigInitialization` (public)      | `lifecycle`                   | 0 (verify repo-wide)                                                 | delete                                                       |
| `getTaskApiConfigName` (public)                | `lifecycle`                   | 0 (verify repo-wide; `taskApiConfigName` getter has its own callers) | delete                                                       |
| `recursivelyMakeClineRequests` (public)        | `apiLoop`                     | 0 external                                                           | delete                                                       |
| `attemptApiRequest` (public)                   | `apiLoop`                     | 0 prod; ~25 spec call sites                                          | delete; specs use `task.apiLoop.attemptApiRequest`           |
| `startSubtask` (public)                        | `subtasks`                    | 0 prod (verify repo-wide + `new-task-delegation.spec.ts`)            | delete; spec uses `task.subtasks.startSubtask`               |
| `static resetGlobalApiRequestTime`             | RetryHandler module fn        | 0 prod; 6 spec sites                                                 | delete; spec imports from `RetryHandler`                     |
| `static get lastGlobalApiRequestTime`          | RetryHandler module fn        | 0 prod; 1 spec site                                                  | delete; spec uses `getLastGlobalApiRequestTime()`            |

### B. Task forwarders that are LOAD-BEARING — KEEP (documented seams)

- `ask` / `say` / `sayAndCreateMissingParamError` / `handleWebviewAskResponse`
  / `cancelAutoApprovalTimeout` / `approveAsk` / `denyAsk` /
  `supersedePendingAsk` — the tool/integration surface (~115 call sites
  across 21 tool files). This is Task's public protocol, not forwarding.
- `approveAsk` / `denyAsk` / `abortTask` / `submitUserMessage` — required by
  `TaskLike` (`packages/types/src/task.ts`).
- `overwriteApiConversationHistory`, `overwriteClineMessages`,
  `flushPendingToolResultsToHistory`, `retrySaveApiConversationHistory`,
  `condenseContext`, `start`, `cancelCurrentRequest`, `resumeAfterDelegation`,
  `emitFinalTokenUsageUpdate`, `combineMessages`, `getTokenUsage`,
  `recordToolUsage`, `recordToolError`, `processQueuedMessages`,
  `checkpointSave/Restore/Diff`, `updateApiConfiguration`, `getTaskMode`,
  `taskMode` / `taskApiConfigName` getters, `setTaskMode`,
  `setTaskApiConfigName`, `tokenUsageSnapshot` / `toolUsageSnapshot` —
  each has real external callers (ClineProvider, DelegationService, tools,
  checkpoints, specs).
- `initiateTaskLoop`, `getSystemPrompt`, `debouncedEmitTokenUsage` —
  consumed by delegate modules through their Access interfaces
  (`TaskLifecycleAccess`, `TaskSubtasksAccess`, `TaskResumptionAccess`,
  `TaskContextManagerAccess`, `TaskHistoryAccess`). Rewiring those
  interfaces to `task.apiLoop` / module functions would churn ~40 spec
  fixtures for zero behavioral gain; the forwarder IS the seam.

### C. TaskApiLoop wrappers around RetryHandler / ApiRequestBuilder

| Wrapper                                             | Forwards to           | External consumers                       | Action                                                                                                                |
| --------------------------------------------------- | --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `getCurrentProfileId`                               | apiRequestBuilder     | 0 (Task forwarder is dead)               | delete → pure function (batch 1)                                                                                      |
| `handleContextWindowExceededError`                  | access.contextManager | 0                                        | delete; internal caller (handleApiRequestError) calls `this.access.contextManager.handleContextWindowExceededError()` |
| `maybeWaitForProviderRateLimit`                     | retryHandler          | 0                                        | delete; internal callers call `this.retryHandler.…`                                                                   |
| `backoffAndAnnounce`                                | retryHandler          | 0 (verify specs)                         | delete; internal callers direct                                                                                       |
| `buildCleanConversationHistory`                     | apiRequestBuilder     | 0 (verify specs)                         | delete; internal caller direct                                                                                        |
| `getSystemPrompt`                                   | apiRequestBuilder     | TaskContextManagerAccess + 18 spec spies | KEEP (module boundary)                                                                                                |
| `attemptApiRequest`                                 | — (real logic)        | specs                                    | KEEP                                                                                                                  |
| `initiateTaskLoop` / `recursivelyMakeClineRequests` | — (real logic)        | Task + lifecycle access                  | KEEP                                                                                                                  |

Also remove the `export { … } from "./RetryHandler"` re-export line in
TaskApiLoop (0 importers — knip finding waiting to happen).

### D. `getCurrentProfileId` ×4 → ×1

One canonical pure function in a new tiny module
`src/core/task/currentProfileId.ts`:

```ts
export function getCurrentProfileId(state: any): string {
	return (
		state?.listApiConfigMeta?.find((profile: any) => profile.name === state?.currentApiConfigName)?.id ?? "default"
	)
}
```

- `ApiRequestBuilder.getCurrentProfileId` method → delete (module never
  calls it itself; it was only a forwarding host).
- `TaskApiLoop.getCurrentProfileId` wrapper → delete; `handleContextManagement`
  calls the pure function.
- `Task.getCurrentProfileId` → delete.
- `TaskContextManager.getCurrentProfileId` (private) → delete;
  `handleContextWindowExceededError` calls the pure function.
- New unit spec `core/task/__tests__/currentProfileId.spec.ts` (found /
  fallback "default" / missing state).

### E. TaskApiLoopAccess slimming

`TaskApiLoopAccess` declares members TaskApiLoop never touches:
`recordToolUsage`, `recordToolError`, `cancelCurrentRequest`,
`emitFinalTokenUsageUpdate`, `pushToolResultToUserContent`,
`updateApiConfiguration` (grep of `this.access.<m>` in TaskApiLoop.ts: 0
uses for these; `getTokenUsage`/`combineMessages`/`emit`/`abortTask`/`getTaskMode`
are used). These declarations exist only so the old forwarders could be
reached through the interface — classic triple forwarding. Remove them;
fix the spec fixtures that now fail excess-property checks.

## Batches (small, test-per-batch)

1. **getCurrentProfileId dedupe** — new module + spec; rewire
   TaskApiLoop.handleContextManagement and
   TaskContextManager.handleContextWindowExceededError; delete the 4
   definitions. Tests: `currentProfileId.spec.ts`, TaskContextManager
   specs, ApiRequestBuilder specs, TaskApiLoop specs.
2. **Task history forwarders** (A rows 1–8) + spec rewires in
   `reasoning-preservation.test.ts`, `grounding-sources.test.ts`,
   `Task.throttle.test.ts`. Tests: those three.
3. **Task lifecycle/context/apiLoop dead privates** (A rows 9–19), inline
   the 5 constructor-time delegations. Tests: `Task.spec.ts`,
   `Task.sticky-profile-race.spec.ts`, `Task.condense-handler-invalidation.spec.ts`.
4. **Task public dead forwarders + statics** (A rows 20–28). Repo-wide grep
   (src, webview-ui, apps, packages) confirms each is caller-free before
   deletion. Rewire `Task.spec.ts` (`apiLoop.attemptApiRequest`, imported
   `resetGlobalApiRequestTime` / `getLastGlobalApiRequestTime`).
   Tests: `Task.spec.ts`.
5. **TaskApiLoop internal-only wrappers** (C rows 1–5) — internal callers
   go direct to `retryHandler` / `apiRequestBuilder` / `access.contextManager`;
   update any spec that spies the wrapper to spy the underlying object.
   Tests: TaskApiLoop spec family, `grace-retry-errors.spec.ts`.
6. **TaskApiLoopAccess slimming** (E) + fixture fixes. Tests: TaskApiLoop
   spec family + `tsc`.
7. **Verification & ship** — eslint on touched files, `pnpm typecheck`,
   broader vitest for `src` task/core areas, `pnpm knip` (baseline exit 1
   pre-existing; no NEW findings), architecture.md check, changeset,
   single squash commit, PR, immediate squash-merge.

## Behavior

None. Pure deletion of delegation hops; every kept call path executes the
same code. The only observable differences are for specs that spy/call the
removed names (updated in the same batch).

## Verification checklist

- [ ] `cd src && npx vitest run <affected spec>` per batch
- [ ] eslint on touched files clean
- [ ] typecheck green
- [ ] `pnpm knip` — no new findings vs. pre-existing exit-1 baseline
- [ ] forwarder count before/after reported in the PR
- [ ] changeset `.changeset/d3-remove-forwarders.md` (patch, `roo-code`)
- [ ] PR squash-merged immediately per owner policy
