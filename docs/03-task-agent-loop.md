# Level 3: Task and the agent loop

A `Task` (`src/core/task/Task.ts`) is one agent conversation: its messages, its mode and provider profile, its
tool state and its abort signal. `Task` itself is a facade. The work is done by modules it builds in its
constructor, each receiving the task through a narrow `*Access` interface that lists only what the module needs.

## The modules

```mermaid
graph TD
  T[Task.ts<br/>facade and shared state]
  T --> L[TaskLifecycle<br/>start, resume, abort order, dispose]
  T --> AL[TaskApiLoop<br/>the turn loop, request cycle, stream loop]
  AL --> RB[ApiRequestBuilder<br/>system prompt, tools, clean history]
  AL --> RH[RetryHandler<br/>backoff, countdown, rate limits]
  AL --> SP[TaskStreamProcessor<br/>chunk to say / tool block]
  T --> CM[TaskContextManager<br/>condense and truncate]
  T --> H[TaskHistory<br/>api and ui message persistence]
  T --> AS[TaskAskSay<br/>ask, say, approval]
  T --> R[TaskResumption<br/>resume from history]
  T --> S[TaskSubtasks<br/>delegation to a child task]
  T --> TT[TaskTokenTracking<br/>tokens, cost, tool usage]
```

| File                                                         | Responsibility                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `TaskApiLoop.ts`                                             | The turn loop, one request cycle, the stream loop, error dispatch             |
| `TaskStreamProcessor.ts`                                     | Turns stream chunks into `say` rows and partial tool blocks; saves the answer |
| `TaskContextManager.ts`                                      | Automatic and manual condensing, context-window-exceeded recovery             |
| `TaskLifecycle.ts`                                           | Mode and profile init, start, abort ordering, dispose, memory writers         |
| `TaskHistory.ts`                                             | Reads and writes `api_conversation_history.json` and `ui_messages.json`       |
| `TaskAskSay.ts`                                              | `ask` (with auto-approval), `say`, handling of the user's answer              |
| `TaskResumption.ts`                                          | Resuming a task from disk, cleaning stale partial rows                        |
| `ApiRequestBuilder.ts`                                       | System prompt, tool array, history cleaned for the provider                   |
| `RetryHandler.ts`                                            | Exponential backoff with countdown rows, provider and global rate limits      |
| `TaskSubtasks.ts`                                            | `startSubtask`, `resumeAfterDelegation`                                       |
| `TaskTokenTracking.ts`                                       | Token, cost and tool-usage counters, queued user messages                     |
| `build-tools.ts`, `deferred-tools*.ts`                       | Which tools the model sees; tools loaded on demand                            |
| `validateToolResultIds.ts`, `mergeConsecutiveApiMessages.ts` | History fixes the providers require                                           |

## One turn

`initiateTaskLoop` starts the checkpoint service and runs `recursivelyMakeClineRequests`. Despite its name it is
an explicit loop over a stack of pending user contents, not recursion: each finished turn pushes the tool results
as the next item.

```mermaid
sequenceDiagram
  autonumber
  participant L as TaskApiLoop
  participant B as ApiRequestBuilder
  participant C as TaskContextManager
  participant P as Provider (ApiHandler)
  participant S as TaskStreamProcessor
  participant X as presentAssistantMessage
  participant A as TaskAskSay

  L->>L: max turns and consecutive-mistake checks
  L->>L: wait for provider rate limit
  L->>A: say("api_req_started")
  L->>L: prepareUserContent (environment details, memory recall)
  L->>B: system prompt, tools, clean history
  L->>C: manageContextIfNeeded (condense or truncate)
  L->>P: createMessage(systemPrompt, history, tools)
  loop each chunk (raced against abort)
    P-->>L: text / reasoning / tool_call_* / usage
    L->>S: processChunk
    S->>A: say(...) partial rows
    S->>X: tool block ready (not awaited)
    X->>A: ask(approval) unless auto-approved
    X->>X: checkpoint save, then tool.handle()
  end
  L->>L: finalizeStreamAndProcessResults
  L->>L: wait until userMessageContentReady
  L->>L: push tool results as the next turn
```

### Errors and retry

`handleApiRequestError` in `TaskApiLoop` decides what a failed request becomes:

```mermaid
flowchart TD
  E[request failed] --> CW{context window exceeded?}
  CW -- yes --> TR[TaskContextManager truncates or condenses, retry]
  CW -- no --> BG{background task and auth error?}
  BG -- yes --> FF[fail fast, end the background task]
  BG -- no --> AR{auto-retry on and under the cap?}
  AR -- yes --> BO[RetryHandler.backoffAndAnnounce<br/>exponential, capped at 600 s,<br/>honours Retry-After on 429] --> RT[retry the request]
  AR -- no --> ASK[ask api_req_failed: user retries or cancels]
```

Two separate rate limits exist: the provider profile's `rateLimitSeconds`, and the process-wide
`lastGlobalApiRequestTime` in `RetryHandler.ts` that spaces requests across all tasks (do not touch).

### Abort

`cancelTask` on the provider calls `task.abortTask()`. `TaskLifecycle.abortTask` runs three phases whose order
tests pin:

1. `prepareAbort`: set the `abort` flag (every running promise checks it), emit `TaskAborted` while the task state
   is intact, start the memory writers.
2. `cleanupAbort`: `dispose()` (flush pending saves, cancel the current request, release terminals, remove
   listeners) and persist the final messages.
3. `drainAbort`: wait for in-flight memory extraction.

The stream loop races every `iterator.next()` against the abort signal (`raceNextChunkWithAbort`), so a stalled
provider does not block a cancel.

## Context management

`TaskContextManager.manageContextIfNeeded` runs before each request. It counts tokens and, above the configured
threshold (`autoCondenseContextPercent`), calls `summarizeConversation` (`src/core/condense/`) to replace older
messages with a summary. If condensing is off or fails, `src/core/context-management/` truncates the oldest turns
instead. A provider error that says the context is too long triggers the same path once, then a retry.

## Checkpoints

Before a tool that changes files (`requiresCheckpoint` in its descriptor), `presentAssistantMessage` calls
`checkpointSave`. `src/core/checkpoints/` keeps a shadow git repository per task, so the user can restore or diff
any earlier point from the chat.

## Subtasks

```mermaid
sequenceDiagram
  participant Parent as Parent Task
  participant NT as NewTaskTool
  participant CP as ClineProvider
  participant DS as DelegationService
  participant Child as Child Task
  participant AC as AttemptCompletionTool

  Parent->>NT: new_task(mode, message)
  NT->>CP: delegateParentAndOpenChild
  CP->>DS: save parent as delegated, remove it from the stack
  DS->>Child: create and start
  Child->>AC: attempt_completion(result)
  AC->>CP: reopenParentFromDelegation
  CP->>Parent: re-create from history
  Parent->>Parent: TaskSubtasks.resumeAfterDelegation(result)
```

`run_parallel_tasks` is different: `BackgroundTaskRunner` starts headless child tasks that run beside the parent,
and `SubagentRegistry` shows their progress in the panel.
