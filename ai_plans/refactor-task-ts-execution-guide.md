# Execution Guide: Task.ts Refactoring for Smaller Models

> **Purpose:** Step-by-step instructions for a smaller AI model to execute the refactoring of `src/core/task/Task.ts` (4,738 lines → ~800 lines coordinator + 8 focused modules).
>
> **Status:** ✅ **COMPLETED** (May 2026)

---

## Overview

This guide breaks the refactoring into **8 phases**, each producing a working system with all tests passing. A smaller model should execute phases **in order** — each phase depends on previous ones.

### Key Principles

1. **One phase at a time** — complete each phase fully before starting the next
2. **Run tests after every phase** — `cd src && npx vitest run core/task/__tests__/`
3. **No behavioral changes** — only move code, never refactor method bodies during extraction
4. **Delegation pattern** — extracted methods become forwarding calls on `Task`
5. **Narrow interfaces** — each module receives a typed interface, not the full `Task` object

---

## Pre-Flight Checklist

Before starting, verify:

```bash
# 1. All existing tests pass
cd src && npx vitest run core/task/__tests__/

# 2. Count current lines
wc -l src/core/task/Task.ts
# Expected: ~4738

# 3. List existing files in the task directory
ls src/core/task/
# Expected: AskIgnoredError.ts, build-tools.ts, mergeConsecutiveApiMessages.ts,
#           Task.ts, validateToolResultIds.ts, __tests__/
```

---

## Phase 1: TaskHistory (~250 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-01-task-history.md`

**Status:** ✅ **Already Complete** (pre-existing)

> TaskHistory.ts (494 lines) and TaskHistory.helpers.ts (141 lines) were already extracted prior to this refactoring session.

1. **Create** `src/core/task/TaskHistory.ts`:

    - Define `TaskHistoryAccess` interface
    - Define `TaskHistory` class with 12 methods
    - Copy methods verbatim from Task.ts, replacing `this.` → `this.access.`
    - Add all necessary imports

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskHistory } from "./TaskHistory"`
    - Add property: `readonly history: TaskHistory`
    - In constructor: `this.history = new TaskHistory(this)`
    - Replace each extracted method body with a delegation call:
        ```typescript
        private async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
            return this.history.getSavedApiConversationHistory()
        }
        ```
    - Update all internal callers: `this.saveClineMessages()` → `this.history.saveClineMessages()`

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~250 lines
- All tests pass
- `TaskHistory.ts` is ~250 lines

---

## Phase 2: TaskTokenTracking (~120 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-08-task-token-tracking.md`

**Status:** ✅ **Complete** (248 lines actual)

> Actual lines extracted: 248 (double the estimate due to additional getters and debounced token emission logic).

1. **Create** `src/core/task/TaskTokenTracking.ts`:

    - Define `TaskTokenTrackingAccess` interface
    - Define `TaskTokenTracking` class
    - Move debounced token emission setup from Task constructor
    - Move snapshot state properties (`tokenUsageSnapshot`, `tokenUsageSnapshotAt`, `toolUsageSnapshot`)
    - Copy methods: `combineMessages`, `getTokenUsage`, `recordToolUsage`, `recordToolError`, `emitFinalTokenUsageUpdate`, `processQueuedMessages`
    - Copy getters: `taskStatus`, `taskAsk`, `queuedMessages`, `tokenUsage`, `cwd`, `messageManager`

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskTokenTracking } from "./TaskTokenTracking"`
    - Add property: `readonly tokenTracking: TaskTokenTracking`
    - In constructor: `this.tokenTracking = new TaskTokenTracking(this)` (after clineMessages is initialized)
    - Remove debounced emission setup from constructor
    - Remove snapshot state properties
    - Add pass-through getters on Task for backward compatibility:
        ```typescript
        public get taskStatus(): TaskStatus {
            return this.tokenTracking.taskStatus
        }
        ```
    - Update internal callers: `this.getTokenUsage()` → `this.tokenTracking.getTokenUsage()`

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~120 more lines
- All tests pass
- `TaskTokenTracking.ts` is ~120 lines

---

## Phase 3: TaskAskSay (~350 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-02-task-ask-say.md`

**Status:** ✅ **Already Complete** (pre-existing)

> TaskAskSay.ts (502 lines) was already extracted prior to this refactoring session.

1. **Create** `src/core/task/TaskAskSay.ts`:

    - Define `TaskAskSayAccess` interface
    - Define `TaskAskSay` class with 8 methods
    - Copy `ask()`, `handleWebviewAskResponse()`, `cancelAutoApprovalTimeout()`, `approveAsk()`, `denyAsk()`, `supersedePendingAsk()`, `say()`, `sayAndCreateMissingParamError()`
    - Replace `this.addToClineMessages(...)` → `this.access.history.addToClineMessages(...)`
    - Replace `this.saveClineMessages()` → `this.access.history.saveClineMessages()`
    - Replace `this.updateClineMessage(...)` → `this.access.history.updateClineMessage(...)`
    - Replace `this.findMessageByTimestamp(...)` → `this.access.history.findMessageByTimestamp(...)`

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskAskSay } from "./TaskAskSay"`
    - Add property: `readonly askSay: TaskAskSay`
    - In constructor: `this.askSay = new TaskAskSay(this)`
    - Replace method bodies with delegation calls
    - Update ALL internal callers of `this.ask(...)` → `this.askSay.ask(...)` and `this.say(...)` → `this.askSay.say(...)`

3. **Modify** `src/core/assistant-message/presentAssistantMessage.ts`:

    - Update calls from `task.ask(...)` → `task.askSay.ask(...)`
    - Update calls from `task.say(...)` → `task.askSay.say(...)`

4. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    cd src && npx vitest run core/assistant-message/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~350 more lines
- `presentAssistantMessage.ts` updated for new paths
- All tests pass
- `TaskAskSay.ts` is ~350 lines

---

## Phase 4: TaskSubtasks (~100 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-07-task-subtasks.md`

**Status:** ✅ **Complete** (175 lines actual)

> Actual lines extracted: 175 (higher than estimate due to additional helper methods and interface definitions).

1. **Create** `src/core/task/TaskSubtasks.ts`:

    - Define `TaskSubtasksAccess` interface
    - Define `TaskSubtasks` class with 2 methods
    - Copy `startSubtask()` and `resumeAfterDelegation()`

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskSubtasks } from "./TaskSubtasks"`
    - Add property: `readonly subtasks: TaskSubtasks`
    - In constructor: `this.subtasks = new TaskSubtasks(this)`
    - Replace method bodies with delegation calls

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~60 more lines (delegation stubs remain)
- All tests pass
- `TaskSubtasks.ts` is ~100 lines

---

## Phase 5: TaskContextManager (~250 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-06-task-context-manager.md`

**Status:** ✅ **Complete** (560 lines actual)

> Actual lines extracted: 560 (more than double the estimate). The module includes `condenseContext()`, `handleContextWindowExceededError()`, `getFilesReadByRooSafely()`, `getEnabledMcpToolsCount()`, and additional helper methods for context management that were not in the original estimate.

1. **Create** `src/core/task/TaskContextManager.ts`:

    - Define `TaskContextManagerAccess` interface
    - Define `TaskContextManager` class
    - Copy `condenseContext()`, `handleContextWindowExceededError()`, `getFilesReadByRooSafely()`, `getEnabledMcpToolsCount()`
    - Extract the context management block from `attemptApiRequest` into `manageContextIfNeeded()`
    - **Consolidate** duplicated tool-building logic into `buildCondensingMetadata()` helper
    - **Consolidate** duplicated result-handling logic into `handleManageContextResult()` helper

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskContextManager } from "./TaskContextManager"`
    - Add property: `readonly contextManager: TaskContextManager`
    - In constructor: `this.contextManager = new TaskContextManager(this)`
    - Replace method bodies with delegation calls
    - Replace the 166-line context management block in `attemptApiRequest` with a call to `this.contextManager.manageContextIfNeeded(...)`

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~250 more lines (including the block removed from `attemptApiRequest`)
- Duplicated context management logic consolidated
- All tests pass
- `TaskContextManager.ts` is ~250 lines

---

## Phase 6: TaskStreamProcessor (~400 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-03-task-stream-processor.md`

**Status:** ✅ **Already Complete** (pre-existing)

> TaskStreamProcessor.ts (903 lines) was already extracted prior to this refactoring session. This was the most complex extraction, handling stream chunk processing with 6 switch cases.

1. **Create** `src/core/task/StreamProcessorTypes.ts`:

    - Define `UpdateApiReqMsgFn`, `AbortStreamFn`, `TokenSnapshot` types

2. **Create** `src/core/task/TaskStreamProcessor.ts`:

    - Define `TaskStreamProcessorAccess` interface
    - Define `TaskStreamProcessor` class
    - Extract stream state reset into `resetStreamingState()`
    - Extract chunk processing switch into `processChunk()`
    - Extract stream finalization into `finalizeStream()`
    - Extract assistant message assembly into `assembleAndSaveAssistantMessage()`
    - Extract closure factories into `createUpdateApiReqMsgFn()`, `createAbortStreamFn()`, `createBackgroundUsageDrain()`

3. **Modify** `src/core/task/Task.ts`:

    - Add imports for `TaskStreamProcessor` and `StreamProcessorTypes`
    - Add property: `readonly streamProcessor: TaskStreamProcessor`
    - In constructor: `this.streamProcessor = new TaskStreamProcessor(this)`
    - In `recursivelyMakeClineRequests`, replace inline stream processing with calls to `this.streamProcessor.*`

4. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- `recursivelyMakeClineRequests` reduced from ~1,236 lines to ~550 lines
- All tests pass
- `TaskStreamProcessor.ts` is ~400 lines
- `StreamProcessorTypes.ts` is ~30 lines

---

## Phase 7: TaskLifecycle (~400 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-05-task-lifecycle.md`

**Status:** ✅ **Complete** (850 lines actual)

> Actual lines extracted: 850 (double the estimate). The module includes initialization methods (`initializeTaskMode`, `initializeTaskApiConfigName`, `setupProviderProfileChangeListener`), mode/API config accessors, and lifecycle methods (`start`, `startTask`, `resumeTaskFromHistory`, `abortTask`, `dispose`).

1. **Create** `src/core/task/TaskLifecycle.ts`:

    - Define `TaskLifecycleAccess` interface
    - Define `TaskLifecycle` class
    - Copy `initializeTaskMode()`, `initializeTaskApiConfigName()`, `setupProviderProfileChangeListener()`
    - Copy `start()`, `startTask()`, `resumeTaskFromHistory()`
    - Copy `abortTask()`, `dispose()`
    - Do NOT extract the constructor — it stays in Task.ts

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskLifecycle } from "./TaskLifecycle"`
    - Add property: `readonly lifecycle: TaskLifecycle`
    - In constructor (after property initialization): `this.lifecycle = new TaskLifecycle(this)`
    - Replace method bodies with delegation calls
    - Keep mode/API config getters (`taskMode`, `taskApiConfigName`, etc.) on Task as pass-throughs

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced by ~350 more lines
- All tests pass
- `TaskLifecycle.ts` is ~400 lines

---

## Phase 8: TaskApiLoop (~600 lines extracted)

**Spec file:** `ai_plans/refactor-task-ts-04-task-api-loop.md`

**Status:** ✅ **Complete** (1,397 lines actual)

> Actual lines extracted: 1,397 (more than double the estimate). The module includes `initiateTaskLoop`, `recursivelyMakeClineRequests`, `attemptApiRequest`, `getSystemPrompt`, `getCurrentProfileId`, `maybeWaitForProviderRateLimit`, `backoffAndAnnounce`, `buildCleanConversationHistory`, and additional helper methods. The `recursivelyMakeClineRequests` method alone is the core orchestration loop.

1. **Create** `src/core/task/TaskApiLoop.ts`:

    - Define `TaskApiLoopAccess` interface
    - Define `TaskApiLoop` class
    - Copy `initiateTaskLoop()`, `recursivelyMakeClineRequests()` (after stream extraction), `attemptApiRequest()`, `getSystemPrompt()`, `getCurrentProfileId()`, `maybeWaitForProviderRateLimit()`, `backoffAndAnnounce()`, `buildCleanConversationHistory()`
    - Move `static lastGlobalApiRequestTime` to module-level variable or shared state

2. **Modify** `src/core/task/Task.ts`:

    - Add `import { TaskApiLoop } from "./TaskApiLoop"`
    - Add property: `readonly apiLoop: TaskApiLoop`
    - In constructor: `this.apiLoop = new TaskApiLoop(this)`
    - Replace method bodies with delegation calls
    - Update callers: `this.initiateTaskLoop(...)` → `this.apiLoop.initiateTaskLoop(...)`

3. **Test:**
    ```bash
    cd src && npx vitest run core/task/__tests__/
    ```

### Expected Result

- Task.ts reduced to ~800 lines (coordinator + constructor + property declarations + delegation stubs)
- All tests pass
- `TaskApiLoop.ts` is ~600 lines

---

## Post-Refactoring Verification

After all 8 phases are complete:

```bash
# 1. Run ALL tests, not just task tests
cd src && npx vitest run

# 2. Verify line counts
wc -l src/core/task/Task.ts src/core/task/Task*.ts

# Actual results (May 2026):
# Task.ts                  1,323
# TaskHistory.ts             494
# TaskHistory.helpers.ts     141
# TaskAskSay.ts              502
# TaskStreamProcessor.ts     903
# TaskTokenTracking.ts       248
# TaskContextManager.ts      560
# TaskLifecycle.ts           850
# TaskSubtasks.ts            175
# TaskApiLoop.ts           1,397

# 3. Check for circular imports
npx madge --circular src/core/task/Task*.ts

# 4. Verify TypeScript compilation
npx tsc --noEmit
```

> ✅ **All tests passed.** All modules compile without errors. No circular dependencies detected.

---

## Summary: File Structure After Refactoring (Actual Results)

```
src/core/task/
├── Task.ts                      1,323 lines  (coordinator + constructor + delegation)
├── TaskHistory.ts                 494 lines  (API + Cline message persistence)
├── TaskHistory.helpers.ts         141 lines  (helper functions for history)
├── TaskAskSay.ts                  502 lines  (ask/say communication protocol)
├── TaskStreamProcessor.ts         903 lines  (stream chunk processing)
├── TaskApiLoop.ts               1,397 lines  (API request loop orchestration)
├── TaskLifecycle.ts               850 lines  (start/resume/abort/dispose)
├── TaskContextManager.ts          560 lines  (context condensing & window management)
├── TaskSubtasks.ts                175 lines  (subtask delegation & resumption)
├── TaskTokenTracking.ts           248 lines  (token/cost tracking & metrics)
├── AskIgnoredError.ts             (existing, unchanged)
├── build-tools.ts                 (existing, unchanged)
├── mergeConsecutiveApiMessages.ts (existing, unchanged)
├── validateToolResultIds.ts       (existing, unchanged)
└── __tests__/                     (existing tests, updated imports)
```

**Primary goal achieved:** The 4,738-line monolith `Task.ts` is now 1,323 lines, and each module has a single clear responsibility. The coordinator `Task.ts` contains:

- Constructor (property initialization + module wiring)
- Public API delegation stubs
- Property declarations
- The `TaskOptions` interface

### Implementation Notes

1. **Execution order** was modified because TaskHistory, TaskAskSay, and TaskStreamProcessor were already extracted in prior sessions.

2. **Actual line counts** are higher than estimates due to:

    - Interface definitions adding 30-100 lines per module
    - Additional helper methods discovered during extraction
    - Pass-through delegation stubs retained on Task for backward compatibility

3. **All tests passed** after each extraction phase with no behavioral changes.

4. **TaskApiLoop.ts is the largest module** (1,397 lines) because it contains the core `recursivelyMakeClineRequests` orchestration loop - the heart of the task execution flow.
