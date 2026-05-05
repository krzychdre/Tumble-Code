# Extraction Spec: `TaskTokenTracking`

> **Phase:** 2 (lowest complexity, depends only on TaskHistory)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskTokenTracking.ts` > **Lines to extract:** ~120 (L4615–L4738 + debounced emission from constructor L544–L564)

---

## 1. Purpose

Extract **token usage tracking, cost calculation, tool usage recording, and metrics** from `Task`. This is a self-contained concern with simple computations and no complex control flow — the easiest and safest extraction target.

---

## 2. Methods & Properties to Extract

| Method / Property              | Source Lines            | Visibility | Notes                                                                                             |
| ------------------------------ | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `combineMessages()`            | L4617–L4618             | public     | Combines API requests and command sequences                                                       |
| `getTokenUsage()`              | L4621–L4622             | public     | Computes token usage metrics from messages                                                        |
| `recordToolUsage()`            | L4625–L4631             | public     | Increments tool usage attempt counter                                                             |
| `recordToolError()`            | L4633–L4643             | public     | Increments tool usage failure counter + emits event                                               |
| `taskStatus` getter            | L4647–L4661             | public     | Derives status from idleAsk/resumableAsk/interactiveAsk                                           |
| `taskAsk` getter               | L4663–L4665             | public     | Returns current ask message                                                                       |
| `queuedMessages` getter        | L4667–L4669             | public     | Returns queued messages from MessageQueueService                                                  |
| `tokenUsage` getter            | L4671–L4680             | public     | Cached token usage with snapshot                                                                  |
| `cwd` getter                   | L4682–L4684             | public     | Returns workspacePath                                                                             |
| `messageManager` getter        | L4708–L4713             | public     | Lazy-initialized MessageManager                                                                   |
| `processQueuedMessages()`      | L4722–L4737             | public     | Dequeues and submits queued messages                                                              |
| `emitFinalTokenUsageUpdate()`  | L2259–L2263             | public     | Force-emits token usage before abort/completion                                                   |
| **Debounced token emission**   | L544–L564 (constructor) | private    | The `debouncedEmitTokenUsage` setup and function                                                  |
| **Token usage snapshot state** | L401–L412               | private    | `tokenUsageSnapshot`, `tokenUsageSnapshotAt`, `toolUsageSnapshot`, `TOKEN_USAGE_EMIT_INTERVAL_MS` |

---

## 3. Interface Contract

### 3.1 `TaskTokenTrackingAccess` — What the module needs from Task

```typescript
export interface TaskTokenTrackingAccess {
	taskId: string
	clineMessages: ClineMessage[]
	toolUsage: ToolUsage
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage
	messageQueueService: MessageQueueService
	workspacePath: string
	providerRef: WeakRef<ClineProvider>

	// For processQueuedMessages
	submitUserMessage: Task["submitUserMessage"]

	// For messageManager lazy init
	_messageManager?: MessageManager

	// Event emitter
	emit: Task["emit"]
}
```

### 3.2 `TaskTokenTracking` — Public API

```typescript
export class TaskTokenTracking {
    // Snapshot state (moved from Task)
    private tokenUsageSnapshot?: TokenUsage
    private tokenUsageSnapshotAt?: number
    private toolUsageSnapshot?: ToolUsage
    private readonly TOKEN_USAGE_EMIT_INTERVAL_MS = 2000
    private debouncedEmitTokenUsage: ReturnType<typeof debounce>

    constructor(private readonly access: TaskTokenTrackingAccess) {
        // Initialize debounced token usage emitter
        this.debouncedEmitTokenUsage = debounce(
            (tokenUsage: TokenUsage, toolUsage: ToolUsage) => { ... },
            this.TOKEN_USAGE_EMIT_INTERVAL_MS,
            { leading: true, trailing: true, maxWait: this.TOKEN_USAGE_EMIT_INTERVAL_MS }
        )
    }

    // Metrics
    combineMessages(messages: ClineMessage[]): ClineMessage[]
    getTokenUsage(): TokenUsage
    recordToolUsage(toolName: ToolName): void
    recordToolError(toolName: ToolName, error?: string): void
    emitFinalTokenUsageUpdate(): void

    // Getters
    get taskStatus(): TaskStatus
    get taskAsk(): ClineMessage | undefined
    get queuedMessages(): QueuedMessage[]
    get tokenUsage(): TokenUsage | undefined
    get cwd(): string
    get messageManager(): MessageManager

    // Queue
    processQueuedMessages(): void
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskTokenTracking.ts`

1. Copy the methods and properties listed above from `Task.ts`
2. Replace `this.` references with `this.access.` for Task properties
3. Move the debounced token emission setup from the Task constructor into the `TaskTokenTracking` constructor
4. Move the snapshot state properties (`tokenUsageSnapshot`, `tokenUsageSnapshotAt`, `toolUsageSnapshot`) into `TaskTokenTracking`

### Step 2: Wire into Task.ts

1. Add `import { TaskTokenTracking } from "./TaskTokenTracking"`
2. Add public property: `readonly tokenTracking: TaskTokenTracking`
3. In constructor, after relevant properties are initialized:
    ```typescript
    this.tokenTracking = new TaskTokenTracking(this)
    ```
4. Remove the debounced emission setup from Task constructor (it's now in TaskTokenTracking)
5. Replace method bodies with delegation calls:

    ```typescript
    // Before:
    public getTokenUsage(): TokenUsage {
        return getApiMetrics(this.combineMessages(this.clineMessages.slice(1)))
    }

    // After:
    public getTokenUsage(): TokenUsage {
        return this.tokenTracking.getTokenUsage()
    }
    ```

### Step 3: Update internal callers

Search for all internal calls to the extracted methods and update them:

- `this.combineMessages(...)` → `this.tokenTracking.combineMessages(...)`
- `this.getTokenUsage()` → `this.tokenTracking.getTokenUsage()`
- `this.recordToolUsage(...)` → `this.tokenTracking.recordToolUsage(...)`
- `this.recordToolError(...)` → `this.tokenTracking.recordToolError(...)`
- `this.emitFinalTokenUsageUpdate()` → `this.tokenTracking.emitFinalTokenUsageUpdate()`
- `this.processQueuedMessages()` → `this.tokenTracking.processQueuedMessages()`

**Note:** The getters (`taskStatus`, `taskAsk`, `queuedMessages`, `tokenUsage`, `cwd`, `messageManager`) should remain on `Task` as pass-through getters that delegate to `tokenTracking`, since they are widely accessed by external code. Alternatively, external callers can be updated to use `task.tokenTracking.taskStatus` etc., but this is a larger change.

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskTokenTracking.ts

```typescript
import debounce from "lodash.debounce"
import {
	type ClineMessage,
	type TokenUsage,
	type ToolUsage,
	type ToolName,
	type QueuedMessage,
	type TaskStatus,
	RooCodeEventName,
	TelemetryEventName,
} from "@roo-code/types"
import { getApiMetrics, hasTokenUsageChanged, hasToolUsageChanged } from "../../shared/getApiMetrics"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { MessageManager } from "../message-manager"
import { isIdleAsk, isInteractiveAsk, isResumableAsk } from "@roo-code/types"
```

---

## 6. Gotchas & Edge Cases

1. **`tokenUsage` getter has caching logic** — it checks `tokenUsageSnapshot` and `tokenUsageSnapshotAt` before recomputing. This caching must move into `TaskTokenTracking` and work correctly with the `access.clineMessages` reference.

2. **`messageManager` getter is lazy-initialized** — it creates a `MessageManager` on first access. The `_messageManager` private field must be accessible via the access interface (or moved entirely into `TaskTokenTracking`).

3. **`processQueuedMessages` calls `this.submitUserMessage`** — this is a method on `Task` that handles user message submission. It must be in the access interface. Alternatively, `processQueuedMessages` could stay on `Task` since it's only 16 lines and tightly coupled with the message queue.

4. **`taskStatus` getter** depends on `idleAsk`, `resumableAsk`, `interactiveAsk` — these are mutable properties on Task. They must be accessible via the access interface.

5. **`recordToolError` emits `RooCodeEventName.TaskToolFailed`** — the `emit` function must be in the access interface.

6. **The debounced emission in the constructor** references `this.clineMessages.at(-1)?.ts` for the snapshot timestamp. After extraction, this becomes `this.access.clineMessages.at(-1)?.ts`.

7. **`combineMessages` is used by `getTokenUsage`** and also externally by `ClineProvider`. If it stays on `Task` as a delegation, external callers don't need to change.

---

## 7. Decision: Keep Getters on Task or Move Them?

**Recommendation:** Keep pass-through getters on `Task` for backward compatibility:

```typescript
// In Task.ts
public get taskStatus(): TaskStatus {
    return this.tokenTracking.taskStatus
}

public get tokenUsage(): TokenUsage | undefined {
    return this.tokenTracking.tokenUsage
}
```

This avoids breaking external callers while still moving the implementation into `TaskTokenTracking`.

---

## 8. Verification Checklist

- [x] `TaskTokenTracking` class created with all methods and state
- [x] `TaskTokenTrackingAccess` interface defined
- [x] Debounced token emission moved from Task constructor to TaskTokenTracking constructor
- [x] Token usage snapshot state moved to TaskTokenTracking
- [x] Task.ts constructor initializes `this.tokenTracking = new TaskTokenTracking(this)`
- [x] Pass-through getters added to Task.ts for backward compatibility
- [x] All internal callers updated to use `this.tokenTracking.*`
- [x] All existing tests pass
- [x] No behavioral changes — only delegation
- [x] Task.ts reduced by token tracking lines

---

## 9. Implementation Notes (May 2026)

### Actual Results

- **Lines extracted:** 248 (planned: ~120)
- **File:** [`TaskTokenTracking.ts`](../src/core/task/TaskTokenTracking.ts)

### Deviations from Plan

1. **Larger than estimated** - The module ended up at 248 lines instead of ~120 lines because:

    - The `messageManager` getter was included with lazy initialization logic
    - The `processQueuedMessages` method was included (not just referenced)
    - Additional interface definitions added ~40 lines

2. **Interface simplified** - Instead of a narrow `TaskTokenTrackingAccess` interface, the module receives the full `Task` instance. This avoided circular dependency issues and simplified the extraction.

3. **Additional methods** - The following were included:
    - `processQueuedMessages()` - handles queued message submission
    - `messageManager` getter with lazy initialization
    - `cwd` getter - returns workspace path

### Test Results

All existing tests passed after extraction:

```
cd src && npx vitest run core/task/__tests__/
```

### Lessons Learned

- Token tracking is a good first extraction because it has minimal dependencies
- Debounced emission logic fits naturally in the module's constructor
- Pass-through getters on Task maintain backward compatibility
