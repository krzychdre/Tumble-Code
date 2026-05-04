# Extraction Spec: `TaskStreamProcessor`

> **Phase:** 6 (high complexity, depends on TaskAskSay and TaskHistory)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskStreamProcessor.ts` > **Lines to extract:** ~400 (the stream processing core of `recursivelyMakeClineRequests`, L2766–L3380)

---

## 1. Purpose

Extract the **stream chunk processing state machine** from the 1,236-line `recursivelyMakeClineRequests` method. This is the code that processes individual chunks from the API stream (reasoning, usage, grounding, tool_call_partial, tool_call, text) and manages the streaming state machine (partial blocks, tool call indices, assistant message content assembly).

This is the single most complex piece of logic in the entire file and the highest-value extraction target.

---

## 2. Methods & Logic to Extract

### 2.1 Stream State Reset (L2766–L2793)

The block that resets streaming state at the start of each API request:

```typescript
this.currentStreamingContentIndex = 0
this.currentStreamingDidCheckpoint = false
this.assistantMessageContent = []
this.didCompleteReadingStream = false
this.userMessageContent = []
this.userMessageContentReady = false
this.didRejectTool = false
this.didAlreadyUseTool = false
this.assistantMessageSavedToHistory = false
this.didToolFailInCurrentTurn = false
this.presentAssistantMessageLocked = false
this.presentAssistantMessageHasPendingUpdates = false
this.streamingToolCallIndices.clear()
NativeToolCallParser.clearAllStreamingToolCalls()
NativeToolCallParser.clearRawChunkState()
```

### 2.2 Chunk Processing Switch (L2841–L3044)

The `switch (chunk.type)` block handling:

- `"reasoning"` — accumulate reasoning text, format, call `say()`
- `"usage"` — accumulate token counts
- `"grounding"` — accumulate grounding sources
- `"tool_call_partial"` — process through `NativeToolCallParser`, manage streaming tool call indices
- `"tool_call"` — legacy complete tool call handling
- `"text"` — accumulate text, create/update text content blocks

### 2.3 Stream Finalization (L3314–L3412)

After stream ends:

- Finalize remaining streaming tool calls via `NativeToolCallParser.finalizeRawChunks()`
- Mark partial blocks as complete
- Complete reasoning message
- Save cline messages

### 2.4 Assistant Message Assembly (L3422–L3564)

Build the assistant content array for API history:

- Add text content
- Add tool_use blocks with deduplication
- Handle `new_task` isolation (truncate tools after new_task)
- Save to API conversation history

### 2.5 Abort Stream Handler (L2742–L2764)

The `abortStream` closure that handles mid-stream cancellation.

### 2.6 Update API Request Message (L2698–L2740)

The `updateApiReqMsg` closure that updates the `api_req_started` message with cost/token data.

### 2.7 Background Usage Drain (L3087–L3251)

The `drainStreamInBackgroundToFindAllUsage` nested async function.

---

## 3. Interface Contract

### 3.1 `TaskStreamProcessorAccess` — What the module needs from Task

```typescript
export interface TaskStreamProcessorAccess {
	taskId: string
	instanceId: string
	abort: boolean
	abandoned: boolean
	apiConfiguration: ProviderSettings

	// Streaming state (mutable)
	currentStreamingContentIndex: number
	currentStreamingDidCheckpoint: boolean
	assistantMessageContent: AssistantMessageContent[]
	didCompleteReadingStream: boolean
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolResultBlockParam)[]
	userMessageContentReady: boolean
	didRejectTool: boolean
	didAlreadyUseTool: boolean
	didToolFailInCurrentTurn: boolean
	assistantMessageSavedToHistory: boolean
	presentAssistantMessageLocked: boolean
	presentAssistantMessageHasPendingUpdates: boolean
	streamingToolCallIndices: Map<string, number>
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	cachedStreamingModel?: { id: string; info: ModelInfo }

	// Cline messages (for updating api_req_started)
	clineMessages: ClineMessage[]

	// Delegated modules
	askSay: TaskAskSay
	history: TaskHistory

	// Methods
	emit: Task["emit"]
	pushToolResultToUserContent(toolResult: Anthropic.ToolResultBlockParam): boolean
	diffViewProvider: DiffViewProvider
}
```

### 3.2 `StreamProcessingResult` — What the processor returns

```typescript
export interface StreamProcessingResult {
	assistantMessage: string
	reasoningMessage: string
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number | undefined
	pendingGroundingSources: GroundingSource[]
}
```

### 3.3 `TaskStreamProcessor` — Public API

```typescript
export class TaskStreamProcessor {
	constructor(private readonly access: TaskStreamProcessorAccess) {}

	/** Reset all streaming state for a new API request */
	resetStreamingState(): void

	/** Process a single chunk from the API stream */
	processChunk(chunk: ApiStreamChunk, streamModelInfo: ModelInfo): void

	/** Finalize streaming after all chunks received */
	async finalizeStream(reasoningMessage: string): Promise<void>

	/** Build assistant content array and save to API history */
	async assembleAndSaveAssistantMessage(
		assistantMessage: string,
		reasoningMessage: string,
		pendingGroundingSources: GroundingSource[],
	): Promise<{ hasTextContent: boolean; hasToolUses: boolean }>

	/** Create the updateApiReqMsg closure */
	createUpdateApiReqMsgFn(lastApiReqIndex: number, streamModelInfo: ModelInfo): UpdateApiReqMsgFn

	/** Create the abortStream closure */
	createAbortStreamFn(lastApiReqIndex: number): AbortStreamFn

	/** Create the background usage drain function */
	createBackgroundUsageDrain(
		lastApiReqIndex: number,
		currentTokens: TokenSnapshot,
		streamModelInfo: ModelInfo,
		iterator: AsyncIterator<any>,
		updateApiReqMsg: UpdateApiReqMsgFn,
	): () => Promise<void>
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Define types

Create `src/core/task/StreamProcessorTypes.ts` with shared types:

```typescript
export type UpdateApiReqMsgFn = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => void

export type AbortStreamFn = (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => Promise<void>

export interface TokenSnapshot {
	input: number
	output: number
	cacheWrite: number
	cacheRead: number
	total?: number | undefined
}
```

### Step 2: Create `src/core/task/TaskStreamProcessor.ts`

1. Copy the stream processing logic from `recursivelyMakeClineRequests`
2. The key challenge is that the stream processing is deeply interleaved with the loop logic. The approach is:
    - Extract the **chunk processing switch** into `processChunk()`
    - Extract the **stream finalization** into `finalizeStream()`
    - Extract the **assistant message assembly** into `assembleAndSaveAssistantMessage()`
    - Extract the **closure factories** into `createUpdateApiReqMsgFn()`, `createAbortStreamFn()`, `createBackgroundUsageDrain()`
3. Replace `this.` references with `this.access.`

### Step 3: Wire into Task.ts

1. Add `import { TaskStreamProcessor } from "./TaskStreamProcessor"`
2. Add public property: `readonly streamProcessor: TaskStreamProcessor`
3. In constructor: `this.streamProcessor = new TaskStreamProcessor(this)`
4. In `recursivelyMakeClineRequests`, replace inline logic with calls to `this.streamProcessor.*`

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskStreamProcessor.ts

```typescript
import { Anthropic } from "@anthropic-ai/sdk"
import { type AssistantMessageContent, presentAssistantMessage } from "../assistant-message"
import { NativeToolCallParser } from "../assistant-message/NativeToolCallParser"
import {
	type ClineMessage,
	type ClineApiReqCancelReason,
	type ClineApiReqInfo,
	type ToolName,
	type ToolUse,
	type ModelInfo,
	RooCodeEventName,
	TelemetryEventName,
	getApiProtocol,
	getModelId,
	isRetiredProvider,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { type ApiStream, type GroundingSource } from "../../api/transform/stream"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { sanitizeToolUseId } from "../../utils/tool-id"
import { findLastIndex } from "../../shared/array"
import { t } from "../../i18n"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
import { type UpdateApiReqMsgFn, type AbortStreamFn, type TokenSnapshot } from "./StreamProcessorTypes"
```

---

## 6. Gotchas & Edge Cases

1. **`presentAssistantMessage(this)`** is called throughout stream processing. This external function takes a `Task` instance. After extraction, the stream processor must still pass the full `Task` reference to `presentAssistantMessage`. The access interface is NOT sufficient — `presentAssistantMessage` accesses many Task properties directly. Solution: keep a `task: Task` reference alongside the access interface, or refactor `presentAssistantMessage` later.

2. **`updateApiReqMsg` and `abortStream` are closures** that capture `lastApiReqIndex`, `streamModelInfo`, and local variables from the outer scope. They must be created as factory functions that receive these as parameters.

3. **`drainStreamInBackgroundToFindAllUsage`** captures the `iterator` from the outer scope and mutates `inputTokens`, `outputTokens`, etc. These must be passed by reference (e.g., via a mutable `TokenSnapshot` object).

4. **`this.streamingToolCallIndices`** is a `Map<string, number>` that's mutated during stream processing. It must be on the access interface since it's also read by `presentAssistantMessage`.

5. **The `new_task` isolation logic** (L3519–L3551) truncates `assistantMessageContent` and injects error tool_results into `userMessageContent`. This is tightly coupled with the task delegation flow and must be carefully tested.

6. **`this.diffViewProvider.reset()`** is called during stream state reset. The `diffViewProvider` must be accessible via the access interface.

---

## 7. Verification Checklist

- [ ] `TaskStreamProcessor` class created with all methods
- [ ] `StreamProcessorTypes.ts` created with shared types
- [ ] `TaskStreamProcessorAccess` interface defined
- [ ] Task.ts constructor initializes `this.streamProcessor = new TaskStreamProcessor(this)`
- [ ] `recursivelyMakeClineRequests` updated to use `this.streamProcessor.*`
- [ ] `presentAssistantMessage` still receives correct Task reference
- [ ] All existing tests pass
- [ ] No behavioral changes — only delegation
- [ ] `recursivelyMakeClineRequests` reduced by ~400 lines
