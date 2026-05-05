# Extraction Spec: `TaskSubtasks`

> **Phase:** 4 (low complexity, small surface area)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskSubtasks.ts` > **Lines to extract:** ~100 (L2388–L2476)

---

## 1. Purpose

Extract **subtask delegation and resumption** logic from `Task`. This is a small, self-contained concern that handles spawning child tasks and resuming parent tasks after delegation completes.

---

## 2. Methods to Extract

| Method                    | Source Lines | Visibility | Notes                                       |
| ------------------------- | ------------ | ---------- | ------------------------------------------- |
| `startSubtask()`          | L2388–L2402  | public     | Spawns a child task via provider delegation |
| `resumeAfterDelegation()` | L2414–L2476  | public     | Resumes parent task after child completes   |

---

## 3. Interface Contract

### 3.1 `TaskSubtasksAccess` — What the module needs from Task

```typescript
export interface TaskSubtasksAccess {
	taskId: string
	instanceId: string
	abort: boolean
	abandoned: boolean
	abortReason?: ClineApiReqCancelReason
	didFinishAbortingStream: boolean
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	isInitialized: boolean
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage
	skipPrevResponseIdOnce: boolean
	apiConversationHistory: ApiMessage[]
	providerRef: WeakRef<ClineProvider>

	// Delegated modules
	history: TaskHistory
	apiLoop: TaskApiLoop

	// Methods
	emit: Task["emit"]
}
```

### 3.2 `TaskSubtasks` — Public API

```typescript
export class TaskSubtasks {
	constructor(private readonly access: TaskSubtasksAccess) {}

	async startSubtask(message: string, initialTodos: TodoItem[], mode: string): Promise<any>
	async resumeAfterDelegation(): Promise<void>
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskSubtasks.ts`

1. Copy `startSubtask()` and `resumeAfterDelegation()` from `Task.ts`
2. Replace `this.` references with `this.access.`:
    - `this.providerRef` → `this.access.providerRef`
    - `this.taskId` → `this.access.taskId`
    - `this.abort` → `this.access.abort`
    - etc.
3. For delegated module calls:
    - `this.getSavedApiConversationHistory()` → `this.access.history.getSavedApiConversationHistory()`
    - `this.saveApiConversationHistory()` → `this.access.history.saveApiConversationHistory()`
    - `this.initiateTaskLoop()` → `this.access.apiLoop.initiateTaskLoop()`

### Step 2: Wire into Task.ts

1. Add `import { TaskSubtasks } from "./TaskSubtasks"`
2. Add public property: `readonly subtasks: TaskSubtasks`
3. In constructor: `this.subtasks = new TaskSubtasks(this)`
4. Replace method bodies:

    ```typescript
    // Before:
    public async startSubtask(message: string, initialTodos: TodoItem[], mode: string) {
        // ... 15 lines
    }

    // After:
    public async startSubtask(message: string, initialTodos: TodoItem[], mode: string) {
        return this.subtasks.startSubtask(message, initialTodos, mode)
    }
    ```

### Step 3: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskSubtasks.ts

```typescript
import { type TodoItem, type ClineMessage, type ClineApiReqCancelReason, RooCodeEventName } from "@roo-code/types"
import { type ApiMessage } from "../task-persistence"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { type TaskHistory } from "./TaskHistory"
import { type TaskApiLoop } from "./TaskApiLoop"
import Anthropic from "@anthropic-ai/sdk"
```

---

## 6. Gotchas & Edge Cases

1. **`startSubtask` calls `(provider as any).delegateParentAndOpenChild()`** — this uses `any` cast because the delegation method is on `ClineProvider` but not exposed through a typed interface. This must be preserved as-is.

2. **`resumeAfterDelegation` resets multiple state flags** (`abort`, `abandoned`, `abortReason`, `didFinishAbortingStream`, `isStreaming`, `isWaitingForFirstChunk`, `skipPrevResponseIdOnce`, `isInitialized`). All of these must be accessible via the access interface as mutable properties.

3. **`resumeAfterDelegation` modifies `apiConversationHistory`** directly — it finds the last user message and replaces environment details. This is a direct mutation of the array, which works because the access interface exposes it as a mutable reference.

4. **`resumeAfterDelegation` calls `getEnvironmentDetails(this, true)`** — this external function takes a `Task` instance. After extraction, it needs the full Task reference. Solution: pass `this` (the Task) through the access interface, or restructure `getEnvironmentDetails` to take a narrower interface.

5. **The `idleAsk`, `resumableAsk`, `interactiveAsk` properties** are set to `undefined` in `resumeAfterDelegation`. These must be mutable on the access interface.

---

## 7. Verification Checklist

- [x] `TaskSubtasks` class created with `startSubtask` and `resumeAfterDelegation`
- [x] `TaskSubtasksAccess` interface defined
- [x] Task.ts constructor initializes `this.subtasks = new TaskSubtasks(this)`
- [x] Delegation calls added to Task.ts
- [x] All existing tests pass
- [x] No behavioral changes — only delegation
- [x] Task.ts reduced by subtask method lines

---

## 8. Implementation Notes (May 2026)

### Actual Results

- **Lines extracted:** 175 (planned: ~100)
- **File:** [`TaskSubtasks.ts`](../src/core/task/TaskSubtasks.ts)

### Deviations from Plan

1. **Larger than estimated** - The module ended up at 175 lines instead of ~100 lines because:

    - The `TaskSubtasksAccess` interface is more comprehensive than planned
    - Additional helper logic for environment details was included
    - The `resumeAfterDelegation` method was more complex than estimated

2. **Interface simplified** - Instead of a narrow `TaskSubtasksAccess` interface, the module receives the full `Task` instance. This avoided circular dependency issues and simplified the extraction.

3. **Integration with TaskApiLoop** - The `resumeAfterDelegation` method calls `initiateTaskLoop` via the access interface, which delegates to TaskApiLoop.

### Test Results

All existing tests passed after extraction:

```
cd src && npx vitest run core/task/__tests__/
```

### Lessons Learned

- Subtask delegation is a small, self-contained concern
- The `startSubtask` method uses `(provider as any).delegateParentAndOpenChild()` which must be preserved as-is
- State reset in `resumeAfterDelegation` requires access to multiple mutable Task properties
