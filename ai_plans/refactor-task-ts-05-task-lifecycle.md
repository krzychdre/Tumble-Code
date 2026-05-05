# Extraction Spec: `TaskLifecycle`

> **Phase:** 7 (high complexity, depends on TaskHistory, TaskAskSay, TaskApiLoop)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskLifecycle.ts` > **Lines to extract:** ~400 (L420–L578 constructor area + L1924–L2383 lifecycle methods)

---

## 1. Purpose

Extract the **task lifecycle management** — construction, initialization, starting, resuming from history, aborting, and disposing. This includes the complex `resumeTaskFromHistory()` method (232 lines) which handles reconstructing conversation state after a task is reopened.

---

## 2. Methods to Extract

| Method                                 | Source Lines | Visibility       | Notes                                                |
| -------------------------------------- | ------------ | ---------------- | ---------------------------------------------------- |
| **Constructor logic**                  | L420–L578    | —                | Not a method, but initialization logic to reorganize |
| `initializeTaskMode()`                 | L601–L632    | private → public | Async mode init from provider state                  |
| `initializeTaskApiConfigName()`        | L635–L660    | private → public | Async API config init from provider state            |
| `setupProviderProfileChangeListener()` | L661–L703    | private → public | Listens for provider profile changes                 |
| `waitForModeInitialization()`          | L707–L714    | public           | Awaitable mode init                                  |
| `getTaskMode()`                        | L736–L750    | public async     | Safe async mode access                               |
| `taskMode` getter                      | L766–L778    | public           | Sync mode access (after init)                        |
| `waitForApiConfigInitialization()`     | L787–L792    | public           | Awaitable API config init                            |
| `getTaskApiConfigName()`               | L804–L816    | public async     | Safe async API config access                         |
| `taskApiConfigName` getter             | L825–L833    | public           | Sync API config access                               |
| `setTaskApiConfigName()`               | L837–L839    | public           | Setter for API config name                           |
| `static create()`                      | L841–L856    | static           | Factory method                                       |
| `start()`                              | L924–L935    | public           | Manual start for delegation flow                     |
| `startTask()`                          | L937–L999    | private → public | New task initialization                              |
| `resumeTaskFromHistory()`              | L2001–L2232  | private → public | **Complex** — reconstructs conversation state        |
| `cancelCurrentRequest()`               | L2241–L2252  | public           | Aborts HTTP request                                  |
| `abortTask()`                          | L2265–L2297  | public async     | Full task abort                                      |
| `dispose()`                            | L2299–L2383  | public           | Cleanup: terminals, listeners, controllers           |

---

## 3. Interface Contract

### 3.1 `TaskLifecycleAccess` — What the module needs from Task

```typescript
export interface TaskLifecycleAccess {
	taskId: string
	rootTaskId?: string
	parentTaskId?: string
	instanceId: string
	metadata: TaskMetadata
	workspacePath: string
	providerRef: WeakRef<ClineProvider>
	globalStoragePath: string
	apiConfiguration: ProviderSettings
	api: ApiHandler
	autoApprovalHandler: AutoApprovalHandler
	diffViewProvider: DiffViewProvider
	diffStrategy?: DiffStrategy
	toolRepetitionDetector: ToolRepetitionDetector
	rooIgnoreController?: RooIgnoreController
	rooProtectedController?: RooProtectedController
	fileContextTracker: FileContextTracker
	enableCheckpoints: boolean
	checkpointTimeout: number
	parentTask: Task | undefined
	taskNumber: number
	initialStatus?: "active" | "delegated" | "completed"
	consecutiveMistakeLimit: number
	messageQueueService: MessageQueueService
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	abort: boolean
	abandoned: boolean
	abortReason?: ClineApiReqCancelReason
	didFinishAbortingStream: boolean
	isInitialized: boolean
	isPaused: boolean
	currentRequestAbortController?: AbortController
	providerProfileChangeListener?: (config: { name: string; provider?: string }) => void

	// Delegated modules
	history: TaskHistory
	askSay: TaskAskSay
	apiLoop: TaskApiLoop

	// Methods
	emit: Task["emit"]
	cancelCurrentRequest(): void
}
```

### 3.2 `TaskLifecycle` — Public API

```typescript
export class TaskLifecycle {
	constructor(private readonly access: TaskLifecycleAccess) {}

	// Initialization
	async initializeTaskMode(provider: ClineProvider): Promise<void>
	async initializeTaskApiConfigName(provider: ClineProvider): Promise<void>
	setupProviderProfileChangeListener(provider: ClineProvider): void

	// Mode/API Config access
	async waitForModeInitialization(): Promise<void>
	async getTaskMode(): Promise<string>
	async waitForApiConfigInitialization(): Promise<void>
	async getTaskApiConfigName(): Promise<string | undefined>

	// Lifecycle
	start(): void
	async startTask(task?: string, images?: string[]): Promise<void>
	async resumeTaskFromHistory(): Promise<void>
	async abortTask(isAbandoned?: boolean): Promise<void>
	dispose(): void
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskLifecycle.ts`

1. Copy the lifecycle methods from `Task.ts`
2. Replace `this.` references with `this.access.` for Task properties
3. For delegated module calls:
    - `this.ask(...)` → `this.access.askSay.ask(...)`
    - `this.say(...)` → `this.access.askSay.say(...)`
    - `this.getSavedClineMessages()` → `this.access.history.getSavedClineMessages()`
    - `this.initiateTaskLoop(...)` → `this.access.apiLoop.initiateTaskLoop(...)`

### Step 2: Handle the constructor

The constructor (L420–L578) is **159 lines** and initializes all Task properties. This is the hardest part to extract because:

1. It sets up all the property defaults
2. It creates instances of controllers, providers, and services
3. It calls `startTask()` or `resumeTaskFromHistory()`

**Strategy:** Do NOT extract the constructor itself. Instead:

- Extract the **initialization methods** (`initializeTaskMode`, `initializeTaskApiConfigName`, `setupProviderProfileChangeListener`)
- Extract the **lifecycle methods** (`start`, `startTask`, `resumeTaskFromHistory`, `abortTask`, `dispose`)
- Leave the constructor in `Task.ts` since it owns the object creation

### Step 3: Wire into Task.ts

1. Add `import { TaskLifecycle } from "./TaskLifecycle"`
2. Add public property: `readonly lifecycle: TaskLifecycle`
3. In constructor (after property initialization): `this.lifecycle = new TaskLifecycle(this)`
4. Replace method bodies with delegation calls for `start`, `startTask`, `resumeTaskFromHistory`, `abortTask`, `dispose`

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskLifecycle.ts

```typescript
import {
	type ProviderSettings,
	type TaskMetadata,
	type ClineApiReqCancelReason,
	RooCodeEventName,
	TelemetryEventName,
	defaultModeSlug,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { type ClineProvider } from "../webview/ClineProvider"
import { getWorkspacePath } from "../../utils/path"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { OutputInterceptor } from "../../integrations/terminal/OutputInterceptor"
import { getTaskDirectoryPath } from "../../utils/storage"
import { formatResponse } from "../prompts/responses"
import { findLastIndex } from "../../shared/array"
import { type ApiMessage } from "../task-persistence"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskApiLoop } from "./TaskApiLoop"
import Anthropic from "@anthropic-ai/sdk"
import { type ClineMessage } from "@roo-code/types"
```

---

## 6. Gotchas & Edge Cases

1. **`resumeTaskFromHistory` is 232 lines** and contains complex conversation reconstruction logic:

    - Removing stale `resume_task` / `resume_completed_task` messages
    - Removing trailing reasoning-only messages
    - Removing incomplete `api_req_started` messages
    - Reconstructing tool_result blocks for interrupted tool calls
    - Handling summary messages (isSummary flag)
    - Building `modifiedOldUserContent` and `modifiedApiConversationHistory`

    **Do NOT refactor this method during extraction** — move it verbatim.

2. **`dispose()` touches many subsystems**: terminals, message queue, event listeners, RooIgnoreController, FileContextTracker, DiffViewProvider. All of these must be accessible via the access interface.

3. **`abortTask()` calls `dispose()` and `saveClineMessages()`** — both must be accessible:

    - `dispose()` → stays on Task (or delegates to lifecycle)
    - `saveClineMessages()` → `this.access.history.saveClineMessages()`

4. **`startTask()` calls `this.initiateTaskLoop()`** which is on `TaskApiLoop`. The delegation chain is: `lifecycle.startTask()` → `apiLoop.initiateTaskLoop()`.

5. **Static `create()` method** (L841–L856) creates a Task with `startTask: false` and returns a promise. This should stay on `Task` since it's a factory method.

6. **`cancelCurrentRequest()`** is called by both `dispose()` and externally. It should be accessible from both `Task` and `TaskLifecycle`.

---

## 7. Verification Checklist

- [x] `TaskLifecycle` class created with all lifecycle methods
- [x] `TaskLifecycleAccess` interface defined
- [x] Task.ts constructor initializes `this.lifecycle = new TaskLifecycle(this)`
- [x] `start()`, `startTask()`, `resumeTaskFromHistory()`, `abortTask()`, `dispose()` delegate to lifecycle
- [x] `initializeTaskMode`, `initializeTaskApiConfigName`, `setupProviderProfileChangeListener` moved to lifecycle
- [x] All existing tests pass
- [x] No behavioral changes — only delegation
- [x] Task.ts reduced by lifecycle method lines

---

## 8. Implementation Notes (May 2026)

### Actual Results

- **Lines extracted:** 850 (planned: ~400)
- **File:** [`TaskLifecycle.ts`](../src/core/task/TaskLifecycle.ts)

### Deviations from Plan

1. **Much larger than estimated** - The module ended up at 850 lines instead of ~400 lines because:

    - The `resumeTaskFromHistory` method alone is ~232 lines with complex conversation reconstruction logic
    - Additional initialization methods were included (`initializeTaskMode`, `initializeTaskApiConfigName`, `setupProviderProfileChangeListener`)
    - Mode/API config accessors were included (`getTaskMode`, `taskMode`, `waitForModeInitialization`, etc.)
    - Interface definitions added ~70 lines

2. **Interface simplified** - Instead of a narrow `TaskLifecycleAccess` interface, the module receives the full `Task` instance. This was necessary because `resumeTaskFromHistory` accesses many Task properties and methods.

3. **Additional methods extracted**:

    - `initializeTaskMode()` - async mode initialization from provider state
    - `initializeTaskApiConfigName()` - async API config initialization
    - `setupProviderProfileChangeListener()` - listener for profile changes
    - `waitForModeInitialization()`, `getTaskMode()`, `taskMode` getter/setter
    - `waitForApiConfigInitialization()`, `getTaskApiConfigName()`, `taskApiConfigName` getter/setter
    - `cancelCurrentRequest()` - abort HTTP request
    - `static create()` factory method

4. **Complex state reconstruction** - The `resumeTaskFromHistory` method required careful extraction:
    - Removing stale `resume_task` / `resume_completed_task` messages
    - Removing trailing reasoning-only messages
    - Removing incomplete `api_req_started` messages
    - Reconstructing tool_result blocks for interrupted tool calls
    - Handling summary messages (isSummary flag)

### Test Results

All existing tests passed after extraction:

```
cd src && npx vitest run core/task/__tests__/
```

### Lessons Learned

- Lifecycle management is one of the most complex concerns in Task
- The `resumeTaskFromHistory` method is a 232-line beast that handles conversation reconstruction
- Initialization methods (`initializeTaskMode`, etc.) fit naturally in this module
- Pass-through getters on Task maintain backward compatibility for external callers
