# Extraction Spec: `TaskContextManager`

> **Phase:** 5 (medium complexity, depends on TaskAskSay and TaskHistory)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskContextManager.ts` > **Lines to extract:** ~250 (L1648–L1753 condense + L3836–L3958 handleContextWindowExceeded + context management in attemptApiRequest L4030–L4196)

---

## 1. Purpose

Extract all **context condensing and context window management** logic from `Task`. This includes the public `condenseContext()` method, the private `handleContextWindowExceededError()`, and the context management section of `attemptApiRequest()`. These three areas share significant duplicated logic (building tools for condensing metadata, calling `manageContext`, handling truncation results) that can be consolidated.

---

## 2. Methods to Extract

| Method                               | Source Lines | Visibility       | Notes                                        |
| ------------------------------------ | ------------ | ---------------- | -------------------------------------------- |
| `condenseContext()`                  | L1648–L1753  | public           | Manual condensing triggered by user          |
| `handleContextWindowExceededError()` | L3836–L3958  | private → public | Force-truncates on context window errors     |
| `getFilesReadByRooSafely()`          | L1639–L1646  | private → public | Helper for getting file context safely       |
| `getEnabledMcpToolsCount()`          | L1888–L1911  | private → public | Counts enabled MCP tools (used in startTask) |

### 2.1 Context Management in `attemptApiRequest` (L4030–L4196)

This 166-line block within `attemptApiRequest` handles:

- Checking if context management will run (`willManageContext`)
- Building tools for condensing metadata
- Calling `manageContext()`
- Handling truncation/condensation results
- Sending `condenseTaskContextStarted`/`condenseTaskContextResponse` webview messages

This should be extracted into a `manageContextIfNeeded()` method on `TaskContextManager`.

### 2.2 Duplicated Logic to Consolidate

Both `condenseContext()` and `handleContextWindowExceededError()` and the context block in `attemptApiRequest` all:

1. Build tools for condensing metadata via `buildNativeToolsArrayWithRestrictions`
2. Build `ApiHandlerCreateMessageMetadata` with tools
3. Call a context management function (`summarizeConversation` or `manageContext`)
4. Handle the result (overwrite history, emit condense/truncation messages)

This duplication should be consolidated into shared helper methods within `TaskContextManager`.

---

## 3. Interface Contract

### 3.1 `TaskContextManagerAccess` — What the module needs from Task

```typescript
export interface TaskContextManagerAccess {
	taskId: string
	apiConfiguration: ProviderSettings
	api: ApiHandler
	apiConversationHistory: ApiMessage[]
	cwd: string
	rooIgnoreController?: RooIgnoreController
	fileContextTracker: FileContextTracker
	providerRef: WeakRef<ClineProvider>

	// Delegated modules
	history: TaskHistory
	askSay: TaskAskSay

	// Methods
	getTokenUsage(): TokenUsage
	getSystemPrompt(): Promise<string>
	emit: Task["emit"]
}
```

### 3.2 `TaskContextManager` — Public API

```typescript
export class TaskContextManager {
	constructor(private readonly access: TaskContextManagerAccess) {}

	/** Manual context condensing triggered by user */
	async condenseContext(): Promise<void>

	/** Force-truncate context when context window is exceeded */
	async handleContextWindowExceededError(): Promise<void>

	/** Check and manage context if needed (called from attemptApiRequest) */
	async manageContextIfNeeded(params: ManageContextParams): Promise<ManageContextResult | undefined>

	/** Get files read by Roo, with error handling */
	async getFilesReadByRooSafely(context: string): Promise<string[] | undefined>

	/** Count enabled MCP tools */
	async getEnabledMcpToolsCount(): Promise<{ enabledToolCount: number; enabledServerCount: number }>
}

export interface ManageContextParams {
	state: any // Provider state
	systemPrompt: string
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, any>
	currentProfileId: string
	contextTokens: number
	maxTokens: number
	contextWindow: number
	lastMessageTokens: number
	customCondensingPrompt?: string
}

export interface ManageContextResult {
	messagesReplaced: boolean
	summary?: string
	cost?: number
	prevContextTokens?: number
	newContextTokens?: number
	error?: string
	truncationId?: string
	messagesRemoved?: number
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskContextManager.ts`

1. Copy `condenseContext()`, `handleContextWindowExceededError()`, `getFilesReadByRooSafely()`, and `getEnabledMcpToolsCount()` from `Task.ts`
2. Extract the context management block from `attemptApiRequest` into `manageContextIfNeeded()`
3. Consolidate the duplicated tool-building logic into a private helper:

```typescript
private async buildCondensingMetadata(
    mode?: string,
    customModes?: any,
    experiments?: Record<string, boolean>,
    apiConfiguration?: ProviderSettings,
    disabledTools?: string[],
    modelInfo?: ModelInfo,
): Promise<ApiHandlerCreateMessageMetadata> {
    const provider = this.access.providerRef.deref()
    let allTools: import("openai").default.Chat.ChatCompletionTool[] = []
    if (provider) {
        const toolsResult = await buildNativeToolsArrayWithRestrictions({
            provider,
            cwd: this.access.cwd,
            mode,
            customModes,
            experiments,
            apiConfiguration,
            disabledTools,
            modelInfo,
            includeAllToolsWithRestrictions: false,
        })
        allTools = toolsResult.tools
    }
    return {
        mode,
        taskId: this.access.taskId,
        ...(allTools.length > 0 ? { tools: allTools, tool_choice: "auto", parallelToolCalls: true } : {}),
    }
}
```

4. Consolidate the result-handling logic into a private helper:

```typescript
private async handleManageContextResult(truncateResult: ManageContextResultType): Promise<void> {
    if (truncateResult.messages !== this.access.apiConversationHistory) {
        await this.access.history.overwriteApiConversationHistory(truncateResult.messages)
    }
    if (truncateResult.error) {
        await this.access.askSay.say("condense_context_error", truncateResult.error)
    }
    if (truncateResult.summary) {
        // ... emit condense_context
    } else if (truncateResult.truncationId) {
        // ... emit sliding_window_truncation
    }
}
```

### Step 2: Wire into Task.ts

1. Add `import { TaskContextManager } from "./TaskContextManager"`
2. Add public property: `readonly contextManager: TaskContextManager`
3. In constructor: `this.contextManager = new TaskContextManager(this)`
4. Replace method bodies with delegation calls:
    - `this.condenseContext()` → `this.contextManager.condenseContext()`
    - `this.handleContextWindowExceededError()` → `this.contextManager.handleContextWindowExceededError()`
    - `this.getFilesReadByRooSafely()` → `this.contextManager.getFilesReadByRooSafely()`
    - `this.getEnabledMcpToolsCount()` → `this.contextManager.getEnabledMcpToolsCount()`

### Step 3: Update `attemptApiRequest` in TaskApiLoop

Replace the 166-line context management block (L4030–L4196) with:

```typescript
const contextResult = await this.access.contextManager.manageContextIfNeeded({
	state,
	systemPrompt,
	autoCondenseContext,
	autoCondenseContextPercent,
	profileThresholds,
	currentProfileId,
	contextTokens,
	maxTokens,
	contextWindow,
	lastMessageTokens,
	customCondensingPrompt,
})
```

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskContextManager.ts

```typescript
import {
	type ProviderSettings,
	type TokenUsage,
	type ContextCondense,
	type ContextTruncation,
	RooCodeEventName,
} from "@roo-code/types"
import { type ApiHandler, type ApiHandlerCreateMessageMetadata } from "../../api"
import { manageContext, willManageContext } from "../context-management"
import { summarizeConversation, getMessagesSinceLastSummary, getEffectiveApiHistory } from "../condense"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { buildNativeToolsArrayWithRestrictions } from "./build-tools"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { McpHub } from "../../services/mcp/McpHub"
import { countEnabledMcpTools } from "@roo-code/types"
import { getModelMaxOutputTokens } from "../../shared/api"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
```

---

## 6. Gotchas & Edge Cases

1. **`condenseContext()` calls `this.flushPendingToolResultsToHistory()`** at the start. After extraction, this becomes `this.access.history.flushPendingToolResultsToHistory()`.

2. **`handleContextWindowExceededError()` calls `this.getSystemPrompt()`** which is on `TaskApiLoop`. This creates a circular dependency: `TaskContextManager` → `TaskApiLoop` → `TaskContextManager`. Solution: Put `getSystemPrompt` on the access interface, or extract it as a standalone function that takes parameters instead of accessing Task state.

3. **The `FORCED_CONTEXT_REDUCTION_PERCENT` constant** (75%) and `MAX_CONTEXT_WINDOW_RETRIES` (3) are used in `handleContextWindowExceededError`. Move these to `TaskContextManager` as module-level constants.

4. **`getEnabledMcpToolsCount()`** is used in `startTask()` (to warn about too many MCP tools). It's a utility method that fits better in `TaskContextManager` than in `TaskLifecycle`.

5. **Webview message sending**: Both `condenseContext()` and the context block in `attemptApiRequest` send `condenseTaskContextStarted` / `condenseTaskContextResponse` messages to the webview. These must be preserved exactly.

6. **`manageContextIfNeeded` must be idempotent** — it should be safe to call even when context management won't run (the `willManageContext` check handles this).

---

## 7. Consolidation Opportunity

After extraction, the three duplicated patterns become:

| Pattern               | condenseContext         | handleContextWindowExceeded | attemptApiRequest block |
| --------------------- | ----------------------- | --------------------------- | ----------------------- |
| Build tools metadata  | ✅                      | ✅                          | ✅                      |
| Build metadata object | ✅                      | ✅                          | ✅                      |
| Call manage/summarize | `summarizeConversation` | `manageContext`             | `manageContext`         |
| Handle result         | overwrite + say         | overwrite + say             | overwrite + say         |
| Send webview messages | ❌                      | ✅ started/response         | ✅ started/response     |

The `buildCondensingMetadata()` and `handleManageContextResult()` helpers eliminate this duplication.

---

## 8. Verification Checklist

- [ ] `TaskContextManager` class created with all methods
- [ ] `TaskContextManagerAccess` interface defined
- [ ] Duplicated tool-building logic consolidated into `buildCondensingMetadata()`
- [ ] Duplicated result-handling logic consolidated into `handleManageContextResult()`
- [ ] Context management block in `attemptApiRequest` replaced with `manageContextIfNeeded()` call
- [ ] Task.ts constructor initializes `this.contextManager = new TaskContextManager(this)`
- [ ] All existing tests pass
- [ ] No behavioral changes — only delegation
- [ ] Task.ts reduced by ~250 lines (including the block removed from `attemptApiRequest`)
