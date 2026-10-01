# Phase 2 Cleanup Plan: Further Complexity Reduction

> **Status:** ✅ **PHASE 2A COMPLETED** (May 2026)
>
> **Purpose:** Identify remaining complexity hotspots after Phase 1 refactoring and propose further decomposition.

---

## 1. Executive Summary

The Phase 1 refactoring successfully decomposed the 4,738-line `Task.ts` monolith into 8 focused modules. However, several modules still contain large functions with high cognitive complexity that could benefit from further decomposition.

### Current State (After Phase 2A)

| File                     | Lines  | Large Functions (>50 lines) | Notes                 |
| ------------------------ | ------ | --------------------------- | --------------------- |
| `Task.ts`                | ~1,200 | Constructor (~190 lines)    | Phase 2C target       |
| `TaskApiLoop.ts`         | ~1,100 | 2 functions (88-98 lines)   | ✅ Phase 2A complete  |
| `TaskStreamProcessor.ts` | 903    | 2 functions (98-145 lines)  | Phase 2B target       |
| `TaskLifecycle.ts`       | ~670   | 1 function (68 lines)       | ✅ Phase 2A complete  |
| `TaskAskSay.ts`          | 502    | 2 functions (112-252 lines) | Phase 2B target       |
| `TaskContextManager.ts`  | 593    | 0 (clean)                   | ✅ Clean              |
| `TaskSubtasks.ts`        | 171    | 0 (clean)                   | ✅ Clean              |
| `TaskTokenTracking.ts`   | 244    | 0 (clean)                   | ✅ Clean              |
| `TaskHistory.ts`         | 494    | 1 function (73 lines)       | ✅ Clean              |
| `ApiRequestBuilder.ts`   | ~290   | NEW                         | ✅ Phase 2A extracted |
| `TaskResumption.ts`      | ~320   | NEW                         | ✅ Phase 2A extracted |
| `RetryHandler.ts`        | ~180   | NEW                         | ✅ Phase 2A extracted |

---

## 2. Detailed Analysis

### 2.1 TaskApiLoop.ts - Critical Priority

**Total:** 1,398 lines | **Target:** ~900 lines

#### Large Functions

| Function                   | Lines | Complexity  | Recommendation                      |
| -------------------------- | ----- | ----------- | ----------------------------------- |
| `attemptApiRequest()`      | ~208  | 🔴 Critical | Extract to `ApiRequestBuilder.ts`   |
| `backoffAndAnnounce()`     | 72    | 🟡 Medium   | Extract to `RetryHandler.ts`        |
| `getSystemPrompt()`        | 73    | 🟡 Medium   | Extract to `SystemPromptBuilder.ts` |
| `executeApiRequestCycle()` | 88    | 🟡 Medium   | Keep, already well-structured       |

#### Proposed Extractions

##### 2.1.1 `ApiRequestBuilder.ts` (~150 lines)

Extract from `attemptApiRequest()`:

- Building API message arrays
- System prompt construction orchestration
- MCP tools integration
- Message truncation logic

```typescript
// New file: src/core/task/ApiRequestBuilder.ts
export class ApiRequestBuilder {
	constructor(private readonly access: ApiRequestBuilderAccess) {}

	buildApiMessages(): Promise<Anthropic.MessageParam[]>
	buildSystemPrompt(): Promise<string>
	buildToolsArray(): Promise<ToolUse[]>
	truncateMessagesIfNeeded(): Promise<void>
}
```

##### 2.1.2 `RetryHandler.ts` (~100 lines)

Extract from `backoffAndAnnounce()` and retry logic:

- Exponential backoff calculation
- Rate limit handling
- Retry countdown UX
- Error categorization for retry decisions

```typescript
// New file: src/core/task/RetryHandler.ts
export class RetryHandler {
	constructor(private readonly access: RetryHandlerAccess) {}

	calculateBackoffDelay(retryAttempt: number, error: any): number
	shouldRetry(error: any): boolean
	async showCountdownUX(seconds: number): Promise<void>
}
```

##### 2.1.3 `SystemPromptBuilder.ts` (~80 lines)

Extract from `getSystemPrompt()`:

- Mode-specific prompt sections
- MCP server instructions
- Custom instructions injection
- Tool restrictions

```typescript
// New file: src/core/task/SystemPromptBuilder.ts
export class SystemPromptBuilder {
	constructor(private readonly access: SystemPromptBuilderAccess) {}

	async buildSystemPrompt(mode: string): Promise<string>
	buildMcpInstructions(): Promise<string>
	buildCustomInstructions(): string
}
```

---

### 2.2 TaskLifecycle.ts - High Priority

**Total:** 868 lines | **Target:** ~600 lines

#### Large Functions

| Function                  | Lines | Complexity  | Recommendation                 |
| ------------------------- | ----- | ----------- | ------------------------------ |
| `resumeTaskFromHistory()` | 236   | 🔴 Critical | Extract to `TaskResumption.ts` |
| `startTask()`             | 68    | 🟢 Low      | Keep, acceptable size          |

#### Proposed Extractions

##### 2.2.1 `TaskResumption.ts` (~200 lines)

Extract from `resumeTaskFromHistory()`:

- Stale message removal
- Interrupted tool call handling
- Summary message preservation
- User content building for resumption

```typescript
// New file: src/core/task/TaskResumption.ts
export class TaskResumption {
	constructor(private readonly access: TaskResumptionAccess) {}

	async resumeFromHistory(): Promise<void>
	removeStaleResumeMessages(): Promise<ClineMessage[]>
	handleInterruptedToolCalls(): Promise<void>
	buildResumptionUserContent(): Promise<Anthropic.Messages.ContentBlockParam[]>
}
```

---

### 2.3 TaskAskSay.ts - Medium Priority

**Total:** 502 lines | **Target:** ~300 lines

#### Large Functions

| Function | Lines | Complexity  | Recommendation                           |
| -------- | ----- | ----------- | ---------------------------------------- |
| `ask()`  | 252   | 🔴 Critical | Extract auto-approval to separate module |
| `say()`  | 112   | 🟡 Medium   | Extract message formatting to helper     |

#### Proposed Extractions

##### 2.3.1 `AutoApprovalFlow.ts` (~120 lines)

Extract from `ask()`:

- Auto-approval timeout management
- Auto-approval eligibility checking
- Permission-based auto-approval
- Timeout cancellation

```typescript
// New file: src/core/task/AutoApprovalFlow.ts
export class AutoApprovalFlow {
	constructor(private readonly access: AutoApprovalFlowAccess) {}

	checkAutoApproval(type: ClineAsk, text?: string): boolean
	startAutoApprovalTimeout(type: ClineAsk): void
	cancelAutoApprovalTimeout(): void
	async waitForAutoApproval(): Promise<boolean>
}
```

##### 2.3.2 Message Formatting Helpers

Extract from `say()`:

- `formatApiRequestMessage()`
- `formatToolResultMessage()`
- `formatReasoningMessage()`

These could be static helpers in a new file or moved to existing utilities.

---

### 2.4 TaskStreamProcessor.ts - Medium Priority

**Total:** 903 lines | **Target:** ~700 lines

#### Large Functions

| Function                            | Lines | Complexity | Recommendation                  |
| ----------------------------------- | ----- | ---------- | ------------------------------- |
| `assembleAndSaveAssistantMessage()` | 145   | 🟡 Medium  | Extract tool_use assembly logic |
| `finalizeStream()`                  | 98    | 🟡 Medium  | Extract finalization substeps   |

#### Proposed Extractions

##### 2.4.1 `AssistantMessageBuilder.ts` (~100 lines)

Extract from `assembleAndSaveAssistantMessage()`:

- Tool use block assembly
- Deduplication logic
- New task isolation handling
- Reasoning message handling

```typescript
// New file: src/core/task/AssistantMessageBuilder.ts
export class AssistantMessageBuilder {
	constructor(private readonly access: AssistantMessageBuilderAccess) {}

	buildAssistantContent(): Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam>
	deduplicateToolUseIds(): void
	enforceNewTaskIsolation(): void
}
```

##### 2.4.2 Extract Finalization Substeps

From `finalizeStream()`:

- `finalizeToolCallChunks()` - Handle remaining tool call chunks
- `updateReasoningMessage()` - Complete reasoning message if present
- `saveClineMessagesState()` - Save and post state

These can be private methods within the same class.

---

### 2.5 Task.ts Constructor - Low Priority

**Total:** ~190 lines | **Target:** ~100 lines

The constructor in `Task.ts` is large but primarily initialization code. It could be refactored using an **Initialization Pattern**:

#### Proposed Pattern

```typescript
// Extract initialization into separate phases
private initializeCoreState(options: TaskOptions): void { ... }
private initializeControllers(): void { ... }
private initializeModules(): void { ... }
private initializeEventHandlers(): void { ... }
private async initializeAsyncState(provider: ClineProvider): Promise<void> { ... }
```

This would reduce constructor to ~50 lines of orchestration.

---

### 2.6 TaskHistory.ts - Low Priority

**Total:** 494 lines | **Target:** ~420 lines

#### Large Functions

| Function                    | Lines | Complexity | Recommendation              |
| --------------------------- | ----- | ---------- | --------------------------- |
| `processAssistantMessage()` | 73    | 🟢 Low     | Keep, acceptable complexity |

The single large function is within acceptable bounds. No extraction needed.

---

## 3. Implementation Priority

### Phase 2A: Critical Extractions ✅ **COMPLETED** (May 2026)

1. **TaskApiLoop → ApiRequestBuilder** ✅ **DONE** (Highest impact)

    - Reduces TaskApiLoop by ~200 lines
    - Separates API request building concerns
    - File: [`src/core/task/ApiRequestBuilder.ts`](src/core/task/ApiRequestBuilder.ts)

2. **TaskLifecycle → TaskResumption** ✅ **DONE** (High impact)

    - Reduces TaskLifecycle by ~200 lines
    - Isolates complex resumption logic
    - File: [`src/core/task/TaskResumption.ts`](src/core/task/TaskResumption.ts)

3. **TaskApiLoop → RetryHandler** ✅ **DONE** (Medium impact)
    - Reduces TaskApiLoop by ~80 lines
    - Centralizes retry/backoff logic
    - File: [`src/core/task/RetryHandler.ts`](src/core/task/RetryHandler.ts)

### Phase 2B: Medium Priority (Estimated: 1-2 sessions)

4. **TaskAskSay → AutoApprovalFlow** (Medium impact)

    - Reduces TaskAskSay by ~120 lines
    - Isolates auto-approval complexity

5. **TaskStreamProcessor → AssistantMessageBuilder** (Medium impact)
    - Reduces TaskStreamProcessor by ~100 lines
    - Separates message assembly concerns

### Phase 2C: Low Priority (Estimated: 1 session)

6. **TaskApiLoop → SystemPromptBuilder** (Lower impact)

    - Reduces TaskApiLoop by ~80 lines
    - Better separation of prompt building

7. **Task.ts Constructor Refactoring** (Optional)
    - Better organization but low impact on complexity

---

## 4. File Structure After Phase 2A

### Current File Structure (Phase 2A Complete)

```
src/core/task/
├── Task.ts                          (~1,200 lines — coordinator)
├── TaskHistory.ts                   (~494 lines — persistence)
├── TaskHistory.helpers.ts           (~140 lines — helpers)
├── TaskAskSay.ts                    (~502 lines — ask/say protocol) [Phase 2B target]
├── TaskStreamProcessor.ts           (~903 lines — streaming) [Phase 2B target]
├── TaskApiLoop.ts                   (~1,100 lines — API orchestration) ✅ Reduced
├── ApiRequestBuilder.ts             (~290 lines — request building) ✅ NEW
├── RetryHandler.ts                  (~180 lines — retry logic) ✅ NEW
├── TaskLifecycle.ts                 (~670 lines — lifecycle) ✅ Reduced
├── TaskResumption.ts                (~320 lines — resumption logic) ✅ NEW
├── TaskContextManager.ts            (~593 lines — context management)
├── TaskSubtasks.ts                  (~171 lines — subtask delegation)
├── TaskTokenTracking.ts             (~244 lines — token tracking)
├── build-tools.ts                   (existing)
├── mergeConsecutiveApiMessages.ts   (existing)
├── validateToolResultIds.ts         (existing)
├── AskIgnoredError.ts               (existing)
└── __tests__/                       (existing tests)
```

### Planned File Structure (After Full Phase 2)

```
src/core/task/
├── Task.ts                          (~1,200 lines — coordinator)
├── TaskHistory.ts                   (~420 lines — persistence)
├── TaskHistory.helpers.ts           (~140 lines — helpers)
├── TaskAskSay.ts                    (~300 lines — ask/say protocol)
├── AutoApprovalFlow.ts              (~120 lines — auto-approval) [Phase 2B]
├── TaskStreamProcessor.ts           (~700 lines — streaming)
├── AssistantMessageBuilder.ts       (~100 lines — message assembly) [Phase 2B]
├── TaskApiLoop.ts                   (~900 lines — API orchestration)
├── ApiRequestBuilder.ts             (~290 lines — request building) ✅
├── RetryHandler.ts                  (~180 lines — retry logic) ✅
├── SystemPromptBuilder.ts           (~80 lines — system prompt) [Phase 2C]
├── TaskLifecycle.ts                 (~600 lines — lifecycle)
├── TaskResumption.ts                (~320 lines — resumption logic) ✅
├── TaskContextManager.ts            (~590 lines — context management)
├── TaskSubtasks.ts                  (~170 lines — subtask delegation)
├── TaskTokenTracking.ts             (~240 lines — token tracking)
├── build-tools.ts                   (existing)
├── mergeConsecutiveApiMessages.ts   (existing)
├── validateToolResultIds.ts         (existing)
├── AskIgnoredError.ts               (existing)
└── __tests__/                       (existing tests)
```

**Current files:** 15 modules (up from 12)
**Largest file:** TaskStreamProcessor.ts at ~903 lines (TaskApiLoop reduced to ~1,100 lines)

---

## 5. Risk Assessment

| Risk                 | Mitigation                                                  |
| -------------------- | ----------------------------------------------------------- |
| Increased file count | Each file has single responsibility; easier to navigate     |
| More interfaces      | Use narrow interfaces to minimize coupling                  |
| Import complexity    | Barrel exports where appropriate                            |
| Test updates         | Tests should remain focused on behavior, not implementation |

---

## 6. Success Metrics

| Metric                | Current                   | Target     |
| --------------------- | ------------------------- | ---------- |
| Largest file          | 1,398 lines (TaskApiLoop) | ~900 lines |
| Functions > 100 lines | 7                         | 0          |
| Functions > 200 lines | 2                         | 0          |
| Avg function size     | ~45 lines                 | ~30 lines  |
| Files > 1,000 lines   | 2                         | 0          |

---

## 7. Next Steps

1. Review and approve this plan
2. Create detailed spec files for each extraction (similar to Phase 1)
3. Execute extractions in priority order
4. Run tests after each extraction
5. Update documentation

---

## Appendix A: Current Large Functions (>50 lines)

```
TaskApiLoop.ts:
  Line 794:  async getSystemPrompt() -> 73 lines
  Line 1189: async backoffAndAnnounce() -> 72 lines
  Line 316:  async executeApiRequestCycle() -> 88 lines
  Line 471:  async attemptApiRequest() -> ~208 lines (generator*)

TaskStreamProcessor.ts:
  Line 389:  async finalizeStream() -> 98 lines
  Line 501:  async assembleAndSaveAssistantMessage() -> 145 lines

TaskLifecycle.ts:
  Line 397:  async startTask() -> 68 lines
  Line 475:  async resumeTaskFromHistory() -> 236 lines

TaskAskSay.ts:
  Line 53:   async ask() -> 252 lines
  Line 379:  async say() -> 112 lines

TaskHistory.ts:
  Line 118:  processAssistantMessage() -> 73 lines
```

---

## Appendix B: Cognitive Complexity Hotspots

Functions with nested conditionals, loops, and try-catch blocks requiring extra attention:

1. **`TaskApiLoop.attemptApiRequest()`** - Multiple try-catch, generators, streaming
2. **`TaskLifecycle.resumeTaskFromHistory()`** - Complex message manipulation, multiple branches
3. **`TaskAskSay.ask()`** - Auto-approval timeout, multiple response types
4. **`TaskStreamProcessor.assembleAndSaveAssistantMessage()`** - Tool use deduplication, new_task isolation

---

_Document generated: May 2026_
_Based on Phase 1 refactoring completion_
