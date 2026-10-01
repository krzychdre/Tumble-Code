# Extraction Spec: `TaskHistory`

> **Phase:** 1 (lowest risk, no dependencies on other new modules)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskHistory.ts` > **Lines to extract:** ~300 (L859–L1260)

---

## 1. Purpose

Extract all API conversation history and Cline message persistence logic from `Task` into a dedicated `TaskHistory` class. This includes saving/loading messages to disk, updating messages, and managing the in-memory arrays.

---

## 2. Methods to Extract

| Method                               | Source Lines | Visibility       | Notes                                                                                                                     |
| ------------------------------------ | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `getSavedApiConversationHistory()`   | L859–L861    | private → public | Reads API messages from disk                                                                                              |
| `addToApiConversationHistory()`      | L863–L1026   | private → public | Adds message + saves + emits telemetry. **Large method** — handles encrypted content, reasoning, OpenAI reasoning_details |
| `overwriteApiConversationHistory()`  | L1028–L1046  | async public     | Overwrites in-memory + saves to disk                                                                                      |
| `flushPendingToolResultsToHistory()` | L1048–L1109  | public           | Flushes pending tool results to API history                                                                               |
| `saveApiConversationHistory()`       | L1112–L1128  | private → public | Saves with retry via `saveApiMessages`                                                                                    |
| `retrySaveApiConversationHistory()`  | L1131–L1148  | public           | Retries save with exponential backoff                                                                                     |
| `getSavedClineMessages()`            | L1152–L1154  | private → public | Reads Cline messages from disk                                                                                            |
| `addToClineMessages()`               | L1156–L1174  | private → public | Adds message + emits event + posts to webview                                                                             |
| `overwriteClineMessages()`           | L1177–L1189  | public           | Overwrites in-memory + saves + posts to webview                                                                           |
| `updateClineMessage()`               | L1192–L1208  | private → public | Updates single message + posts to webview                                                                                 |
| `saveClineMessages()`                | L1211–L1248  | private → public | Saves with retry                                                                                                          |
| `findMessageByTimestamp()`           | L1251–L1260  | private → public | Finds message by timestamp in clineMessages                                                                               |

---

## 3. Interface Contract

### 3.1 `TaskHistoryAccess` — What TaskHistory needs from Task

The actual implemented interface (expanded significantly from the original plan):

```typescript
export interface TaskHistoryAccess {
	// Core identifiers
	taskId: string
	globalStoragePath: string

	// Mutable state arrays
	apiConversationHistory: ApiMessage[]
	clineMessages: ClineMessage[]

	// API handler access (for addToApiConversationHistory)
	api: ApiHandler
	apiConfiguration: ProviderSettings

	// Pending tool results state (for flushPendingToolResultsToHistory)
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[]
	assistantMessageSavedToHistory: boolean
	abort: boolean

	// Provider reference
	providerRef: WeakRef<ClineProvider>

	// Cloud sync tracking
	cloudSyncedMessageTimestamps: Set<number>

	// Task metadata (for saveClineMessages)
	rootTaskId: string | undefined
	parentTaskId: string | undefined
	taskNumber: number
	cwd: string
	_taskMode: string | undefined
	_taskApiConfigName: string | undefined
	taskApiConfigReady: Promise<void>
	initialStatus: "active" | "delegated" | "completed" | undefined

	// Token usage (for saveClineMessages)
	toolUsage: ToolUsage
	debouncedEmitTokenUsage: (tokenUsage: TokenUsage, toolUsage: ToolUsage) => void

	// Event emission
	emit: EventEmitter["emit"]

	// Callback for operations needing full Task context
	restoreTodoListForTask: () => void
}
```

> **Note:** The original plan's interface was much narrower — it only included `taskId`, `globalStoragePath`, `apiConversationHistory`, `clineMessages`, `providerRef`, `lastMessageTs`, `assistantMessageSavedToHistory`, `userMessageContent`, and `emit`. See **Section 8 — Deviation 1** for details on what was missed.

### 3.2 `TaskHistory` — Public API

The actual implemented class (all methods are public):

```typescript
export class TaskHistory {
	constructor(private readonly access: TaskHistoryAccess) {}

	// API Conversation History
	async getSavedApiConversationHistory(): Promise<ApiMessage[]>
	async addToApiConversationHistory(message: Anthropic.MessageParam, reasoning?: string): Promise<void>
	async overwriteApiConversationHistory(newHistory: ApiMessage[]): Promise<void>
	async flushPendingToolResultsToHistory(): Promise<boolean>
	async saveApiConversationHistory(): Promise<boolean>
	async retrySaveApiConversationHistory(): Promise<boolean>

	// Cline Messages
	async getSavedClineMessages(): Promise<ClineMessage[]>
	async addToClineMessages(message: ClineMessage): Promise<void>
	async overwriteClineMessages(newMessages: ClineMessage[]): Promise<void>
	async updateClineMessage(message: ClineMessage): Promise<void>
	async saveClineMessages(): Promise<boolean>
	findMessageByTimestamp(ts: number): ClineMessage | undefined
}
```

---

## 4. Step-by-Step Implementation

### ✅ Step 1: Create `src/core/task/TaskHistory.ts`

1. Create the file with the `TaskHistoryAccess` interface and `TaskHistory` class
2. Copy each method from `Task.ts` verbatim, replacing `this.` references:
    - `this.taskId` → `this.access.taskId`
    - `this.globalStoragePath` → `this.access.globalStoragePath`
    - `this.apiConversationHistory` → `this.access.apiConversationHistory`
    - `this.clineMessages` → `this.access.clineMessages`
    - `this.providerRef` → `this.access.providerRef`
    - `this.lastMessageTs` → `this.access.lastMessageTs`
    - `this.assistantMessageSavedToHistory` → `this.access.assistantMessageSavedToHistory`
    - `this.userMessageContent` → `this.access.userMessageContent`
    - `this.emit(...)` → `this.access.emit(...)`
3. Add all necessary imports at the top of the file

### ✅ Step 2: Wire into Task.ts

1. Add `import { TaskHistory } from "./TaskHistory"` to Task.ts
2. Add a public property: `readonly history: TaskHistory`
3. In the constructor, initialize: `this.history = new TaskHistory(this)` (using `this as unknown as TaskHistoryAccess` cast)
4. For each extracted method in Task.ts, replace the body with a delegation call:

    ```typescript
    // Before:
    private async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
        return readApiMessages({ taskId: this.taskId, globalStoragePath: this.globalStoragePath })
    }

    // After:
    private async getSavedApiConversationHistory(): Promise<ApiMessage[]> {
        return this.history.getSavedApiConversationHistory()
    }
    ```

### ✅ Step 3: Update internal callers in Task.ts

Search for all internal calls to the extracted methods and update them to use `this.history.*`:

- `this.getSavedApiConversationHistory()` → `this.history.getSavedApiConversationHistory()`
- `this.addToApiConversationHistory(...)` → `this.history.addToApiConversationHistory(...)`
- `this.saveApiConversationHistory()` → `this.history.saveApiConversationHistory()`
- `this.overwriteApiConversationHistory(...)` → `this.history.overwriteApiConversationHistory(...)`
- `this.flushPendingToolResultsToHistory()` → `this.history.flushPendingToolResultsToHistory()`
- `this.getSavedClineMessages()` → `this.history.getSavedClineMessages()`
- `this.addToClineMessages(...)` → `this.history.addToClineMessages(...)`
- `this.overwriteClineMessages(...)` → `this.history.overwriteClineMessages(...)`
- `this.updateClineMessage(...)` → `this.history.updateClineMessage(...)`
- `this.saveClineMessages()` → `this.history.saveClineMessages()`
- `this.findMessageByTimestamp(...)` → `this.history.findMessageByTimestamp(...)`

### ✅ Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

All tests must pass with no behavioral changes.

---

## 5. Imports Needed in TaskHistory.ts

The plan originally listed:

```typescript
import { Anthropic } from "@anthropic-ai/sdk"
import {
	type ApiMessage,
	readApiMessages,
	saveApiMessages,
	readTaskMessages,
	saveTaskMessages,
} from "../task-persistence"
import { type ClineMessage, type ClineApiReqInfo, RooCodeEventName, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { type TaskHistoryAccess } from "./TaskHistory" // self-reference for interface
```

The actual implementation required these additional imports (see **Section 8 — Deviation 6**):

```typescript
import EventEmitter from "events" // for EventEmitter["emit"] type
import pWaitFor from "p-wait-for" // needed by flushPendingToolResultsToHistory
import { CloudService } from "@roo-code/cloud" // needed by addToClineMessages, updateClineMessage
import { type ApiHandler } from "../../api" // needed by addToApiConversationHistory
import { getEffectiveApiHistory } from "../condense" // needed by addToApiConversationHistory, flushPendingToolResultsToHistory
import { validateAndFixToolResultIds } from "./validateToolResultIds" // needed by addToApiConversationHistory, flushPendingToolResultsToHistory
import { defaultModeSlug } from "../../shared/modes" // needed by saveClineMessages
import {
	type ProviderSettings,
	type TokenUsage,
	type ToolUsage,
	getModelId,
	getApiProtocol,
	isRetiredProvider,
} from "@roo-code/types" // needed by various methods
import { type ClineProvider } from "../webview/ClineProvider" // needed for WeakRef<ClineProvider>
import { taskMetadata } from "../task-persistence" // needed by saveClineMessages (was not in original import list)
```

---

## 6. Gotchas & Edge Cases

1. **`addToApiConversationHistory`** is the largest method (~163 lines). It handles:

    - Encrypted content / reasoning signatures from OpenAI/Google
    - `reasoning_details` for OpenRouter format
    - Telemetry capture
    - Cloud sync message tracking
    - Token usage debounced emission
    - All of this must move as-is; do NOT refactor the method body during extraction

2. **`flushPendingToolResultsToHistory`** references `this.userMessageContent` and `this.assistantMessageSavedToHistory` — both must be in the access interface

3. **`addToClineMessages`** calls `this.emit(RooCodeEventName.TaskMessage)` and `this.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()` — the emit must go through the access interface

4. **`saveClineMessages`** has retry logic with `saveTaskMessages` — keep the retry loop intact

5. **Property mutability**: `apiConversationHistory` and `clineMessages` are arrays that get mutated (pushed to, spliced). The access interface exposes them as mutable references, so the module can modify them in-place. This is intentional and matches current behavior.

---

## 7. Verification Checklist

- [x] `TaskHistory` class created with all 12 methods
- [x] `TaskHistoryAccess` interface defined with minimal property set
- [x] Task.ts constructor initializes `this.history = new TaskHistory(this)` (via `this as unknown as TaskHistoryAccess`)
- [x] All internal callers in Task.ts updated to use `this.history.*`
- [x] All existing tests pass
- [x] No behavioral changes — only delegation
- [x] Task.ts line count reduced by ~250-300 lines

---

## 8. Implementation Deviations & Lessons Learned

This section documents deviations from the original plan that were discovered during implementation.

### Deviation 1: TaskHistoryAccess Interface Expanded Significantly

The plan's `TaskHistoryAccess` interface was too narrow. The actual implementation required many more properties because the extracted methods depend on more Task state than initially assumed.

**Properties the plan specified:**

- `taskId`, `globalStoragePath`, `apiConversationHistory`, `clineMessages`, `providerRef`, `lastMessageTs`, `assistantMessageSavedToHistory`, `userMessageContent`, `emit`

**Properties the plan MISSED that were actually needed:**

- `api` — needed by `addToApiConversationHistory` for provider-specific introspection (`getResponseId`, `getEncryptedContent`, `getThoughtSignature`, `getSummary`, `getReasoningDetails`)
- `apiConfiguration` — needed by `addToApiConversationHistory` for `getModelId`, `getApiProtocol`, `isRetiredProvider` calls
- `abort` — needed by `flushPendingToolResultsToHistory` for the `pWaitFor` abort check
- `cloudSyncedMessageTimestamps` — needed by `addToClineMessages`, `updateClineMessage`, `overwriteClineMessages` for cloud sync tracking
- `rootTaskId`, `parentTaskId`, `taskNumber` — needed by `saveClineMessages` via `taskMetadata`
- `cwd` — needed by `saveClineMessages` via `taskMetadata`
- `_taskMode` — needed by `saveClineMessages` via `taskMetadata`
- `_taskApiConfigName` — needed by `saveClineMessages` (awaited `taskApiConfigReady` if undefined)
- `taskApiConfigReady` — needed by `saveClineMessages` (awaited when `_taskApiConfigName` is undefined)
- `initialStatus` — needed by `saveClineMessages` via `taskMetadata`
- `toolUsage` — needed by `saveClineMessages` (passed to `debouncedEmitTokenUsage`)
- `debouncedEmitTokenUsage` — needed by `saveClineMessages` (called after metadata computation)
- `restoreTodoListForTask` — callback needed by `overwriteClineMessages` (originally called `restoreTodoListForTask(this)`)

### Deviation 2: restoreTodoListForTask Callback Pattern

The plan did not mention `restoreTodoListForTask`. In the original code, `overwriteClineMessages` called `restoreTodoListForTask(this)` passing the entire Task instance. Since TaskHistory doesn't have a Task reference, this was converted to a callback `() => restoreTodoListForTask(this)` stored as a property on Task and passed through the interface as `restoreTodoListForTask: () => void`.

### Deviation 3: emit Type

The plan specified `emit: Task['emit']` but the actual implementation uses `emit: EventEmitter['emit']` because Task extends EventEmitter and the emit method signature comes from there. Using `Task['emit']` would create a circular dependency.

### Deviation 4: Task does not explicitly implement TaskHistoryAccess

Rather than adding `implements TaskHistoryAccess` to the Task class declaration, the implementation uses `this as unknown as TaskHistoryAccess` cast in the constructor. This is because Task has private properties that don't match the interface's public requirements, and adding `restoreTodoListForTask` as a distinct property was cleaner than restructuring Task's visibility modifiers.

### Deviation 5: Test File Modification Required

The plan did not anticipate needing test file changes. However, `ask-queued-message-drain.spec.ts` creates Task-like objects using `Object.create(Task.prototype)` (bypassing the constructor), so it needed `history` stub objects with mocked `addToClineMessages`, `saveClineMessages`, and `updateClineMessage` methods to prevent runtime errors.

### Deviation 6: Additional Imports in TaskHistory.ts

The plan's Section 5 listed imports but missed several that were actually needed:

- `pWaitFor` — needed by `flushPendingToolResultsToHistory`
- `CloudService` — needed by `addToClineMessages`, `updateClineMessage`
- `ApiHandler` type — needed by `addToApiConversationHistory` for the handler cast
- `getEffectiveApiHistory` — needed by `addToApiConversationHistory`, `flushPendingToolResultsToHistory`
- `validateAndFixToolResultIds` — needed by `addToApiConversationHistory`, `flushPendingToolResultsToHistory`
- `defaultModeSlug` — needed by `saveClineMessages`
- `ProviderSettings`, `TokenUsage`, `ToolUsage`, `getModelId`, `getApiProtocol`, `isRetiredProvider` — needed by various methods
- `ClineProvider` type — needed for `WeakRef<ClineProvider>` in the interface

### Deviation 7: Delegation Stubs Retained in Task.ts

The plan said to replace method bodies with delegation calls, but didn't specify whether to keep the original method signatures on Task. The implementation kept all 12 method signatures on Task as thin delegation wrappers (calling `this.history.*`), preserving backward compatibility for any external callers. The methods retained their original visibility modifiers.

---

## Phase 1.1: Method Complexity Reduction — COMPLETED

> **Status:** ✅ Completed
> **Date:** 2026-05-04
> **Goal:** Reduce method complexity in `TaskHistory.ts` by extracting pure functions and splitting large methods into focused helpers.

### Extracted Pure Functions (in `src/core/task/TaskHistory.helpers.ts`)

These are pure data-transformation functions with no class dependencies:

| Function                             | Purpose                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `buildThinkingBlock()`               | Creates Anthropic thinking block (type: "thinking")                                                            |
| `buildReasoningBlock()`              | Creates generic reasoning block (type: "reasoning")                                                            |
| `buildEncryptedReasoningBlock()`     | Creates OpenAI encrypted reasoning block                                                                       |
| `buildThoughtSignatureBlock()`       | Creates thought signature block for non-Anthropic providers                                                    |
| `insertBlockBeforeContent()`         | Consolidates 5 nearly-identical prepend patterns (undefined → wrap, string → prepend+convert, array → prepend) |
| `insertBlockAfterContent()`          | Appends a block after content                                                                                  |
| `convertOrphanedToolResultsToText()` | Converts tool_result blocks to text blocks when previous message is not assistant                              |

### Extracted Private Class Methods (in `TaskHistory`)

These need `this.access` instance state:

| Method                              | Purpose                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `processAssistantMessage()`         | Builds assistant message with reasoning/thinking/encrypted blocks + thought signatures |
| `processUserMessage()`              | Validates tool_result IDs, converts orphaned tool_results for user messages            |
| `waitForAssistantMessage()`         | pWaitFor polling with timeout/abort                                                    |
| `buildUserMessageWithToolResults()` | Constructs user message from pending tool results                                      |
| `handleFlushFailure()`              | Logs warning on save failure during flush                                              |
| `emitTokenUsageUpdate()`            | Awaits config readiness, computes metadata, emits token usage                          |
| `updateProviderTaskHistory()`       | Updates provider task history via WeakRef                                              |

### Refactored Method Size Reductions

| Method                               | Before     | After                   | Reduction |
| ------------------------------------ | ---------- | ----------------------- | --------- |
| `addToApiConversationHistory()`      | ~160 lines | ~8 lines (orchestrator) | ~60%      |
| `flushPendingToolResultsToHistory()` | ~63 lines  | ~30 lines               | ~52%      |
| `saveClineMessages()`                | ~39 lines  | ~10 lines               | ~74%      |

### Test Results — All 5 Suites Pass

- `flushPendingToolResultsToHistory.spec.ts` — 8 passed
- `Task.persistence.spec.ts` — 9 passed
- `ask-queued-message-drain.spec.ts` — 2 passed
- `task-tool-history.spec.ts` — 6 passed
- `reasoning-preservation.test.ts` — 6 passed

### Key Decisions

- Pure functions placed in separate `TaskHistory.helpers.ts` file (7 functions, ~110 lines) since they are completely independent of class state
- Private methods that need `this.access` remain as class methods in `TaskHistory.ts`
- No behavioral changes — every code path produces identical results
- No new dependencies added
