# Extraction Spec: `TaskAskSay`

> **Phase:** 3 (depends on TaskHistory from Phase 1)
> **Source file:** `src/core/task/Task.ts` > **Target file:** `src/core/task/TaskAskSay.ts` > **Lines to extract:** ~350 (L1264–L1877)

---

## 1. Purpose

Extract the ask/say communication protocol — the mechanism by which Task communicates with the webview UI. This includes the complex `ask()` flow with auto-approval, message queue draining, and partial message handling, as well as the `say()` flow for non-interactive messages.

---

## 2. Methods to Extract

| Method                            | Source Lines | Visibility   | Notes                                                                                       |
| --------------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------- |
| `ask()`                           | L1264–L1499  | async public | **Most complex method** — partial messages, auto-approval, message queue draining, pWaitFor |
| `handleWebviewAskResponse()`      | L1501–L1548  | public       | Handles user responses from webview; marks follow-ups as answered                           |
| `cancelAutoApprovalTimeout()`     | L1554–L1559  | public       | Cancels pending auto-approval timeout                                                       |
| `approveAsk()`                    | L1561–L1563  | public       | Convenience: calls handleWebviewAskResponse("yesButtonClicked")                             |
| `denyAsk()`                       | L1565–L1567  | public       | Convenience: calls handleWebviewAskResponse("noButtonClicked")                              |
| `supersedePendingAsk()`           | L1569–L1571  | public       | Updates lastMessageTs to supersede current ask                                              |
| `say()`                           | L1755–L1867  | async public | Partial/complete message handling for non-interactive messages                              |
| `sayAndCreateMissingParamError()` | L1869–L1877  | async public | Convenience: says error + returns formatted tool error                                      |

---

## 3. Interface Contract

### 3.1 `TaskAskSayAccess` — What TaskAskSay needs from Task

```typescript
export interface TaskAskSayAccess {
	taskId: string
	instanceId: string
	abort: boolean
	clineMessages: ClineMessage[]
	askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	lastMessageTs?: number
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage
	autoApprovalTimeoutRef?: NodeJS.Timeout
	messageQueueService: MessageQueueService
	providerRef: WeakRef<ClineProvider>

	// Delegated methods (from TaskHistory)
	history: TaskHistory

	// Event emitter
	emit: Task["emit"]

	// Checkpoint
	checkpointSave: Task["checkpointSave"]
}
```

### 3.2 `TaskAskSay` — Public API

```typescript
export class TaskAskSay {
	constructor(private readonly access: TaskAskSayAccess) {}

	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus,
		isProtected?: boolean,
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }>

	handleWebviewAskResponse(askResponse: ClineAskResponse, text?: string, images?: string[]): void
	cancelAutoApprovalTimeout(): void
	approveAsk({ text, images }?: { text?: string; images?: string[] }): void
	denyAsk({ text, images }?: { text?: string; images?: string[] }): void
	supersedePendingAsk(): void

	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: ToolProgressStatus,
		options?: { isNonInteractive?: boolean },
		contextCondense?: ContextCondense,
		contextTruncation?: ContextTruncation,
	): Promise<void>

	async sayAndCreateMissingParamError(toolName: ToolName, paramName: string, relPath?: string): Promise<string>
}
```

---

## 4. Step-by-Step Implementation

### Step 1: Create `src/core/task/TaskAskSay.ts`

1. Create the file with `TaskAskSayAccess` interface and `TaskAskSay` class
2. Copy each method from `Task.ts`, replacing `this.` references with `this.access.`:
    - `this.askResponse` → `this.access.askResponse`
    - `this.clineMessages` → `this.access.clineMessages`
    - `this.lastMessageTs` → `this.access.lastMessageTs`
    - `this.idleAsk` → `this.access.idleAsk`
    - etc.
3. For delegated methods from TaskHistory:
    - `this.addToClineMessages(...)` → `this.access.history.addToClineMessages(...)`
    - `this.saveClineMessages()` → `this.access.history.saveClineMessages()`
    - `this.updateClineMessage(...)` → `this.access.history.updateClineMessage(...)`
    - `this.findMessageByTimestamp(...)` → `this.access.history.findMessageByTimestamp(...)`

### Step 2: Wire into Task.ts

1. Add `import { TaskAskSay } from "./TaskAskSay"`
2. Add public property: `readonly askSay: TaskAskSay`
3. In constructor: `this.askSay = new TaskAskSay(this)`
4. Replace method bodies with delegation calls

### Step 3: Update internal callers

All calls within Task.ts to `this.ask(...)`, `this.say(...)`, `this.handleWebviewAskResponse(...)`, etc. must be updated to `this.askSay.ask(...)`, `this.askSay.say(...)`, etc.

**Important:** `presentAssistantMessage(this)` calls `this.ask()` and `this.say()` internally. After extraction, `presentAssistantMessage` will need to call `task.askSay.ask()` and `task.askSay.say()`. This means `presentAssistantMessage.ts` must also be updated to use the new paths.

### Step 4: Run tests

```bash
cd src && npx vitest run core/task/__tests__/
```

---

## 5. Imports Needed in TaskAskSay.ts

```typescript
import {
	type ClineMessage,
	type ClineAsk,
	type ClineSay,
	type ClineAskResponse,
	type ToolProgressStatus,
	type ContextCondense,
	type ContextTruncation,
	RooCodeEventName,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
} from "@roo-code/types"
import { type TaskHistory } from "./TaskHistory"
import { checkAutoApproval } from "../auto-approval"
import { findLastIndex } from "../../shared/array"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import pWaitFor from "p-wait-for"
```

---

## 6. Gotchas & Edge Cases

1. **`ask()` is the most complex method in the entire class** (235 lines). It handles:

    - Partial message updates (streaming)
    - Auto-approval with timeout
    - Message queue draining (dequeuing queued messages during asks)
    - Status mutations (idle → resumable → interactive)
    - `pWaitFor` polling loop
    - `AskIgnoredError` throwing when superseded
    - **Do NOT refactor the method body during extraction** — move it verbatim

2. **Mutable state on access interface**: `askResponse`, `askResponseText`, `askResponseImages`, `lastMessageTs`, `idleAsk`, `resumableAsk`, `interactiveAsk`, `autoApprovalTimeoutRef` are all mutated by `ask()` and `handleWebviewAskResponse()`. Since these are reference types (or primitives set on the Task object), the module needs write access. Two approaches:

    - **Option A (recommended):** Keep these properties on Task and have TaskAskSay mutate them via `this.access.*`. This matches current behavior.
    - **Option B:** Move these properties into TaskAskSay and expose them via getters. This is cleaner but requires updating all readers.

3. **`say()` has a `contextCondense` and `contextTruncation` parameter** — these are passed through to `addToClineMessages` and must be forwarded correctly.

4. **`handleWebviewAskResponse` calls `this.checkpointSave()`** — this is a Task method that delegates to the checkpoint module. It must be in the access interface.

5. **`presentAssistantMessage`** (in `src/core/assistant-message/presentAssistantMessage.ts`) calls `task.ask()` and `task.say()`. After extraction, it needs to call `task.askSay.ask()` and `task.askSay.say()`. This is a cross-file change that must be coordinated.

---

## 7. Verification Checklist

- [ ] `TaskAskSay` class created with all 8 methods
- [ ] `TaskAskSayAccess` interface defined
- [ ] Task.ts constructor initializes `this.askSay = new TaskAskSay(this)`
- [ ] All internal callers in Task.ts updated to use `this.askSay.*`
- [ ] `presentAssistantMessage.ts` updated to use `task.askSay.*`
- [ ] All existing tests pass
- [ ] No behavioral changes — only delegation
- [ ] Task.ts line count reduced by ~300 lines
