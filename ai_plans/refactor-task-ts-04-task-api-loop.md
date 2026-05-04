# Extraction Spec: `TaskApiLoop`

> **Phase:** 8 (highest complexity, depends on ALL other modules)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskApiLoop.ts` > **Lines to extract:** ~600 (L2480–L3750 + L3752–L4384)

---

## 1. Purpose

Extract the **API request loop orchestration** — the core `recursivelyMakeClineRequests` method (after stream processing is extracted to `TaskStreamProcessor`), plus `attemptApiRequest`, `getSystemPrompt`, `handleContextWindowExceededError`, `maybeWaitForProviderRateLimit`, `backoffAndAnnounce`, `initiateTaskLoop`, and `buildCleanConversationHistory`.

This is the central nervous system of the task execution flow. After extracting stream processing, history, ask/say, and other concerns, this module becomes the coordination layer that orchestrates the remaining logic.

---

## 2. Methods to Extract

| Method                               | Source Lines | Visibility             | Notes                                                          |
| ------------------------------------ | ------------ | ---------------------- | -------------------------------------------------------------- |
| `initiateTaskLoop()`                 | L2480–L2513  | private → public       | The while-loop that drives recursive requests                  |
| `recursivelyMakeClineRequests()`     | L2514–L3750  | public                 | **The main loop** — after stream extraction, ~800 lines remain |
| `getSystemPrompt()`                  | L3752–L3827  | private → public       | Builds system prompt with MCP, mode, custom instructions       |
| `getCurrentProfileId()`              | L3829–L3834  | private → public       | Helper for profile ID lookup                                   |
| `handleContextWindowExceededError()` | L3836–L3958  | private → public       | Force-truncates context on context window errors               |
| `maybeWaitForProviderRateLimit()`    | L3967–L3993  | private → public       | Enforces user-configured rate limits                           |
| `attemptApiRequest()`                | L3995–L4384  | public async generator | Creates the API stream with retry logic                        |
| `backoffAndAnnounce()`               | L4387–L4458  | private → public       | Exponential backoff with countdown UX                          |
| `buildCleanConversationHistory()`    | L4466–L4606  | private → public       | Strips reasoning blocks, builds clean API messages             |

---

## 3. Interface Contract

### 3.1 `TaskApiLoopAccess` — What the module needs from Task

```typescript
export interface TaskApiLoopAccess {
	taskId: string
	instanceId: string
	abort: boolean
	abandoned: boolean
	abortReason?: ClineApiReqCancelReason
	apiConfiguration: ProviderSettings
	api: ApiHandler
	apiConversationHistory: ApiMessage[]
	clineMessages: ClineMessage[]
	consecutiveMistakeCount: number
	consecutiveMistakeLimit: number
	consecutiveNoToolUseCount: number
	consecutiveNoAssistantMessagesCount: number
	skipPrevResponseIdOnce: boolean
	isInitialized: boolean
	isPaused: boolean
	currentRequestAbortController?: AbortController
	didFinishAbortingStream: boolean
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	workspacePath: string
	fileContextTracker: FileContextTracker
	rooIgnoreController?: RooIgnoreController
	diffViewProvider: DiffViewProvider
	diffStrategy?: DiffStrategy
	toolRepetitionDetector: ToolRepetitionDetector
	autoApprovalHandler: AutoApprovalHandler
	providerRef: WeakRef<ClineProvider>

	// Delegated modules
	history: TaskHistory
	askSay: TaskAskSay
	streamProcessor: TaskStreamProcessor
	contextManager: TaskContextManager

	// Methods needed
	emit: Task["emit"]
	updateApiConfiguration(newApiConfiguration: ProviderSettings): void
	getTokenUsage(): TokenUsage
	recordToolUsage(toolName: ToolName): void
	recordToolError(toolName: ToolName, error?: string): void
	emitFinalTokenUsageUpdate(): void
	abortTask(isAbandoned?: boolean): Promise<void>
	cancelCurrentRequest(destroyClient?: boolean): void
	pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean
}
```

### 3.2 `TaskApiLoop` — Public API

```typescript
export class TaskApiLoop {
	constructor(private readonly access: TaskApiLoopAccess) {}

	async initiateTaskLoop(userContent: Anthropic.Messages.ContentBlockParam[]): Promise<void>
	async recursivelyMakeClineRequests(
		userContent: Anthropic.Messages.ContentBlockParam[],
		includeFileDetails?: boolean,
	): Promise<boolean>
	async *attemptApiRequest(retryAttempt?: number, options?: { skipProviderRateLimit?: boolean }): ApiStream
	async getSystemPrompt(): Promise<string>
	buildCleanConversationHistory(
		messages: ApiMessage[],
	): Array<
		Anthropic.Messages.MessageParam | { type: "reasoning"; encrypted_content: string; id?: string; summary?: any[] }
	>
	handleContextWindowExceededError(): Promise<void>
	maybeWaitForProviderRateLimit(retryAttempt: number): Promise<void>
	backoffAndAnnounce(retryAttempt: number, error: any): Promise<void>
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskApiLoop.ts`

This is the most complex extraction because `recursivelyMakeClineRequests` is deeply intertwined with Task state. After extracting `TaskStreamProcessor`, the remaining logic in `recursivelyMakeClineRequests` includes:

1. **Pre-request logic** (L2514–L2682): Consecutive mistake check, rate limiting, environment details, user content processing
2. **API request setup** (L2684–L2793): `api_req_started` message, stream creation, state reset
3. **Stream consumption loop** (L2805–L3076): Iterator, `nextChunkWithAbort`, chunk processing (delegated to `TaskStreamProcessor`)
4. **Post-stream processing** (L3078–L3750): Usage drain, error handling, assistant message assembly (delegated to `TaskStreamProcessor`), tool result handling, retry logic

**Strategy:** Extract the method as-is, replacing `this.` with `this.access.` for Task properties and `this.access.moduleName.*` for delegated module methods.

### Step 2: Wire into Task.ts

1. Add `import { TaskApiLoop } from "./TaskApiLoop"`
2. Add public property: `readonly apiLoop: TaskApiLoop`
3. In constructor: `this.apiLoop = new TaskApiLoop(this)`
4. Replace method bodies with delegation calls

### Step 3: Update callers

- `startTask()` calls `this.initiateTaskLoop()` → `this.apiLoop.initiateTaskLoop()`
- `resumeTaskFromHistory()` calls `this.initiateTaskLoop()` → `this.apiLoop.initiateTaskLoop()`
- `resumeAfterDelegation()` calls `this.initiateTaskLoop()` → `this.apiLoop.initiateTaskLoop()`
- External callers of `recursivelyMakeClineRequests` (if any) → `task.apiLoop.recursivelyMakeClineRequests()`

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskApiLoop.ts

```typescript
import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import pWaitFor from "p-wait-for"
import { serializeError } from "serialize-error"
import {
	type ApiMessage,
	type ProviderSettings,
	type TokenUsage,
	type ToolName,
	type ClineApiReqCancelReason,
	type ClineApiReqInfo,
	type ContextCondense,
	type ContextTruncation,
	RooCodeEventName,
	TelemetryEventName,
	ConsecutiveMistakeError,
	getApiProtocol,
	getModelId,
	isRetiredProvider,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { type ApiHandler, type ApiHandlerCreateMessageMetadata, buildApiHandler } from "../../api"
import { type ApiStream, type GroundingSource } from "../../api/transform/stream"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"
import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { SYSTEM_PROMPT } from "../prompts/system"
import { formatResponse } from "../prompts/responses"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { checkContextWindowExceededError } from "../context/context-management/context-error-handling"
import { manageContext, willManageContext } from "../context-management"
import { getMessagesSinceLastSummary, getEffectiveApiHistory, summarizeConversation } from "../condense"
import { processUserContentMentions } from "../mentions/processUserContentMentions"
import { buildNativeToolsArrayWithRestrictions } from "./build-tools"
import { mergeConsecutiveApiMessages } from "./mergeConsecutiveApiMessages"
import { validateAndFixToolResultIds } from "./validateToolResultIds"
import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser"
import { presentAssistantMessage } from "../assistant-message"
import { getModelMaxOutputTokens } from "../../shared/api"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { findLastIndex } from "../../shared/array"
import { t } from "../../i18n"
import { getModeBySlug, defaultModeSlug } from "../../shared/modes"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskStreamProcessor } from "./TaskStreamProcessor"
import { type TaskContextManager } from "./TaskContextManager"
```

---

## 6. Gotchas & Edge Cases

1. **`recursivelyMakeClineRequests` uses a stack-based iteration** (not actual recursion). The `StackItem` interface and `while` loop must be preserved exactly.

2. **`attemptApiRequest` is an async generator** (`async *attemptApiRequest`). This is unusual and must be preserved — it yields chunks from the API stream. The generator pattern is critical for the first-chunk error handling.

3. **`buildCleanConversationHistory`** is a pure function that transforms API messages. It could be a standalone utility function, but it accesses `this.api.getModel().info.preserveReasoning` for one branch. Consider passing this as a parameter instead.

4. **`handleContextWindowExceededError`** duplicates some logic from `attemptApiRequest`'s context management section. After extraction, both methods are in the same module, making deduplication easier in a future cleanup.

5. **Static property `Task.lastGlobalApiRequestTime`** is used by both `maybeWaitForProviderRateLimit` and `recursivelyMakeClineRequests`. This must be moved to a shared static or module-level variable.

6. **`presentAssistantMessage(this)`** is called after stream processing to execute tools. This function takes the full `Task` instance and accesses many properties. It must continue to receive the Task reference.

7. **The `userMessageContent` manipulation** after tool execution (checking `didRejectTool`, `didAlreadyUseTool`, pushing text responses) happens after `presentAssistantMessage` returns. This logic stays in `recursivelyMakeClineRequests` and uses `this.access.*` properties.

---

## 7. What Remains in `recursivelyMakeClineRequests` After Extraction

After extracting stream processing to `TaskStreamProcessor`, the remaining logic in `recursivelyMakeClineRequests` is:

1. **Pre-request** (~170 lines): Mistake limit check, rate limiting, environment details, user content processing
2. **Request setup** (~30 lines): Create stream, reset state
3. **Stream consumption** (~50 lines): Iterator loop, delegating chunks to `streamProcessor.processChunk()`
4. **Post-stream** (~200 lines): Finalize stream, assemble message, wait for tool execution, handle no-tool-use, push to stack
5. **Error handling** (~100 lines): Context window errors, retry logic, empty assistant handling

Total remaining: ~550 lines (down from 1,236). This is still large but manageable as orchestration code.

---

## 8. Verification Checklist

- [ ] `TaskApiLoop` class created with all 8 methods
- [ ] `TaskApiLoopAccess` interface defined
- [ ] Task.ts constructor initializes `this.apiLoop = new TaskApiLoop(this)`
- [ ] `startTask`, `resumeTaskFromHistory`, `resumeAfterDelegation` updated to use `this.apiLoop.initiateTaskLoop()`
- [ ] `Task.lastGlobalApiRequestTime` moved to module-level or shared static
- [ ] All existing tests pass
- [ ] No behavioral changes — only delegation
- [ ] `recursivelyMakeClineRequests` reduced to orchestration logic only
