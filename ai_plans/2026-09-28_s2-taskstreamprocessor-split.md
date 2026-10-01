# S2: extract tool-call handling and assistant-message assembly from TaskStreamProcessor

Roadmap item S2 (`ai_plans/2026-09-27_simplification-roadmap.md`, Priority 4): "`TaskStreamProcessor` (1,144):
extract tool-call event handling and assistant-message assembly (old plan 2B)." Old plan 2B
(`ai_plans/archive/undated/refactor-task-ts-phase2-cleanup-plan.md`, item 5) wanted a `TaskStreamProcessor →
AssistantMessageBuilder` extraction of message-assembly concerns; the roadmap wording adds the tool-call event
loop and is authoritative. Base: main @ 49c7bc874 (S1 merged; D3/D7/D8/D10 before it).

Pure refactor: observable behavior must be identical. No assertion in any spec may change.

## 1. Responsibility map of TaskStreamProcessor.ts (1,143 lines at 49c7bc874)

| Responsibility                                                                                                                                                                                                                                        | Lines (approx)                        | Disposition                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `TaskStreamProcessorAccess` interface (Task satisfies it structurally)                                                                                                                                                                                | 64–112                                | stays; becomes `extends` of the two new access interfaces |
| Per-request state reset (`resetStreamingState`)                                                                                                                                                                                                       | 181–226                               | stays (coordinator owns the lifecycle)                    |
| Chunk dispatch (`processChunk`): reasoning / usage / grounding / tool_call_partial / finish_reason / tool_call (legacy) / text                                                                                                                        | 232–346                               | stays as the dispatcher                                   |
| Reasoning throttle (defer/flush/drop + `REASONING_PARTIAL_POST_INTERVAL_MS`)                                                                                                                                                                          | 354–414                               | stays                                                     |
| **Tool-call event handling**: per-task `NativeToolCallParser` instance, `handleToolCallEvents` (start/delta/end), duplicate-start guard, eager pre-edit checkpoint, `markToolUseNonPartial`, `handleOrphanedToolCallEnd`, `WORKSPACE_READ_ONLY_TOOLS` | 60–62, 121, 200–204, 275–295, 421–617 | **extracts** → `StreamToolCallHandler`                    |
| `finalizeStream` (partial-block completion, reasoning close, save)                                                                                                                                                                                    | 624–679                               | stays                                                     |
| **Assistant-message assembly**: `assembleAndSaveAssistantMessage` (text + tool_use blocks, `sanitizeToolUseId`, duplicate tool_use-id pre-flight dedup, new_task isolation truncation + injected error tool_results, save to API history, telemetry)  | 693–841                               | **extracts** → `AssistantMessageAssembler`                |
| Token/cost accumulation + `createUpdateApiReqMsgFn`, `createAbortStreamFn`, `createBackgroundUsageDrain`                                                                                                                                              | 847–1142                              | stays                                                     |

## 2. Seam design

New files live **alongside** `TaskStreamProcessor.ts` in `src/core/task/` — the existing convention
(`ApiRequestBuilder.ts`, `RetryHandler.ts` are flat siblings; there is no `stream/` directory).

### 2.1 `StreamToolCallHandler.ts`

Owns the per-task `NativeToolCallParser` and the whole tool-call event loop:

```ts
export interface StreamToolCallHandlerAccess {
	taskId: string
	currentStreamingDidCheckpoint: boolean
	assistantMessageContent: AssistantMessageContent[]
	userMessageContentReady: boolean
	streamingToolCallIndices: Map<string, number>
}

export class StreamToolCallHandler {
	constructor(access: StreamToolCallHandlerAccess, task: any)
	reset(): void // parser + tracking clear (from resetStreamingState)
	processRawChunk(chunk): void // from processChunk case "tool_call_partial"
	processFinishReason(reason): void // from processChunk case "finish_reason"
	finalizeRawChunks(): void // from finalizeStream
	private handleToolCallEvents(events) // verbatim move
	private markToolUseNonPartial(id, index) // verbatim move
	private handleOrphanedToolCallEnd(id) // verbatim move
}
```

- `WORKSPACE_READ_ONLY_TOOLS`, the duplicate-start guard, the eager pre-edit checkpoint (WS-3), the
  TE-8 orphaned-end repair and their comments move verbatim.
- The `task` reference stays `any`, exactly as today (`_task` on the coordinator): the eager checkpoint
  reads `task.checkpointSave` / `task.pendingCheckpointSave` and `presentAssistantMessage(task)` needs the
  raw task. Typing it is S6 ("replace the 11 `state: any`"), not S2.
- `handleToolCallEvents` drops the unused `_streamModelInfo` parameter (it was `_`-prefixed and never read;
  both call sites pass it today only to satisfy the signature). No behavior change.
- Shared mutable state (`assistantMessageContent`, `streamingToolCallIndices`,
  `userMessageContentReady`, `currentStreamingDidCheckpoint`) is NOT copied — it stays owned by
  `Task` via the access interface, the D3 TaskApiLoopAccess pattern: one owner, typed read/write view.

### 2.2 `AssistantMessageAssembler.ts`

Owns building and saving the assistant message for API history:

```ts
export interface AssistantMessageAssemblerAccess {
	taskId: string
	assistantMessageContent: AssistantMessageContent[]
	assistantMessageSavedToHistory: boolean
	consecutiveNoAssistantMessagesCount: number
	pushToolResultToUserContent: (toolResult: Anthropic.ToolResultBlockParam) => boolean
	askSay: TaskAskSay
	history: TaskMessageLog
}

export interface AssistantMessageDraft {
	text: string // the streamed assistant text
	reasoning: string // streamed reasoning, saved alongside
	groundingSources: GroundingSource[]
}

export class AssistantMessageAssembler {
	constructor(access: AssistantMessageAssemblerAccess)
	async assembleAndSave(draft: AssistantMessageDraft): Promise<void>
}
```

- The body of `assembleAndSaveAssistantMessage` moves verbatim; the coordinator's private accumulation
  fields (`_assistantMessage`, `_reasoningMessage`, `_pendingGroundingSources`) are passed in as a
  snapshot `draft` instead of being read from `this` — the coordinator keeps owning the accumulation
  (it is written by `processChunk`, `appendAssistantMessage` from TaskApiLoop).
- Side effects stay identical and go through the access interface: `consecutiveNoAssistantMessagesCount`
  reset, grounding `askSay.say(... { isNonInteractive: true })`, `assistantMessageSavedToHistory = true`,
  `pushToolResultToUserContent` for new_task-isolation error results, `history.addToApiConversationHistory`,
  `TelemetryService.capture(TASK_CONVERSATION_MESSAGE)`.
- `sanitizeToolUseId`, the `t("common:gemini.sources")` citation text, the McpToolUse/ToolUse branches and
  all comments move verbatim.

### 2.3 Coordinator after the split

- `TaskStreamProcessorAccess extends StreamToolCallHandlerAccess, AssistantMessageAssemblerAccess` — the
  two subsets are documented at the seam instead of duplicated; `Task` keeps satisfying it structurally.
- The two collaborators are created in the **constructor body** (not field initializers): with
  `useDefineForClassFields` semantics, field initializers run before parameter-property assignment, so a
  field initializer could not safely read `this.access`.
- Public surface unchanged: `TaskApiLoop` and the specs keep calling `resetStreamingState`, `processChunk`,
  `finalizeStream`, `assembleAndSaveAssistantMessage`, `createUpdateApiReqMsgFn`, `createAbortStreamFn`,
  `createBackgroundUsageDrain`, the token getters, `partialBlocks`, `assistantMessage`,
  `appendAssistantMessage`, `dispose`, and `REASONING_PARTIAL_POST_INTERVAL_MS`.
- No circular imports: both new files import only types/functions from `../assistant-message`,
  `../../api`, `../../i18n`, `../../utils`, `@roo-code/*` and the sibling `TaskAskSay`/`TaskMessageLog`
  types; neither imports `TaskStreamProcessor`.

## 3. Spec-impact inventory

Specs that construct or reference `TaskStreamProcessor` directly (all must pass **without edits**):

| Spec                                                                                                       | Why it is safe                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/TaskStreamProcessor.eager-checkpoint.spec.ts`                                                   | constructs `new TaskStreamProcessor(access, task)`; the handler is built inside the constructor from the same `(access, task)` pair, so `checkpointSave` assertions see the identical calls |
| `__tests__/TaskStreamProcessor.finish-reason.spec.ts`                                                      | `processChunk("finish_reason")` delegates to `toolCallHandler.processFinishReason` with the same parser instance semantics                                                                  |
| `__tests__/TaskStreamProcessor.orphaned-end.spec.ts`                                                       | TE-8 path moves verbatim incl. the `console.error` text and the duplicate-start `console.warn`                                                                                              |
| `__tests__/TaskStreamProcessor.reasoning-throttle.spec.ts`                                                 | reasoning throttle does not move; imports `REASONING_PARTIAL_POST_INTERVAL_MS` from the coordinator (still exported)                                                                        |
| `__tests__/TaskStreamProcessor.usage-drain.spec.ts`                                                        | usage drain / abort-stream factories do not move                                                                                                                                            |
| `__tests__/Task.access-types.spec.ts`                                                                      | imports `TaskStreamProcessorAccess`, which keeps every member via inheritance                                                                                                               |
| `__tests__/new-task-isolation.spec.ts`                                                                     | standalone re-simulation of the truncation logic, does not import the code; the production copy it mirrors moves verbatim                                                                   |
| `Task.spec.ts`, `TaskApiLoop.*.spec.ts`, `ask-finalized-dedup.spec.ts`, `presentAssistantMessage*.spec.ts` | public API of the processor unchanged                                                                                                                                                       |

No mock seam moves: the specs mock `../../assistant-message` and `@roo-code/telemetry` by module path,
which the new files import through the same paths.

## 4. Verification

1. `cd src && npx vitest run` the TaskStreamProcessor spec set + Task/TaskApiLoop suites + new-task
   isolation + presentAssistantMessage specs (no assertion edits allowed).
2. Typecheck + eslint on touched files.
3. `pnpm knip` — baseline exit 1 is pre-existing; no new findings (all four new exports are consumed).
4. Line-count report before/after.

## 5. Residuals / non-goals

- `_task: any` on the handler (and coordinator) stays; typing it is roadmap S6.
- `TaskStreamProcessor` keeps the chunk dispatcher, reasoning throttle, usage drain and abort-stream
  factories — the remaining bulk is S3's `TaskApiLoop`-adjacent work if ever desired, not S2.
- docs/architecture.md and docs/03-task-agent-loop.md get one-line updates naming the two new modules.
