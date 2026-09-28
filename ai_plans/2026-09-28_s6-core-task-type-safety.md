# S6: type safety in core/task (state types, `as any`, empty catches)

Item S6 of [the simplification roadmap](2026-09-27_simplification-roadmap.md)
(section 5), scoped to `src/core/task` non-spec files so it stays one
reviewable pull request. Main baseline: 395b59f5f (P9 merged).

## How the numbers were counted

With the TypeScript compiler API (not grep), over every `.ts` file in the
folder except `__tests__/`, `*.spec.ts` and `*.test.ts`:

- **state any**: a parameter or property named `state`/`cycleState` typed
  `any` (includes the `cycleState` return field of `prepareUserContent` and
  the `state` fields of `ManageContextParams` and `handleContextManagement`).
- **as any**: an `AsExpression` whose type is exactly `any` (so `as any[]`
  is not counted).
- **empty catch**: a `catch` clause with no statements (commented or bare),
  plus a `.catch(() => {})` callback with an empty body.

## Counts

| Category (src/core/task, non-spec) | Before | After |
| ---------------------------------- | -----: | ----: |
| `state: any` / `cycleState?: any`  |     11 |     0 |
| `as any`                           |     20 |     0 |
| empty catch bodies                 |      4 |     1 |

The roadmap's 11 `state: any` matches. Its 125 `as any` and 42 empty
catches were whole-`src` figures from an older main; the same counter on
main 395b59f5f gives 128 `as any` and 119 empty catches (the 119 counts
commented-only blocks and `.catch(() => {})` too) across `src`, of which 20
and 4 were in `core/task`. After this branch `src` has 108 and 116.

## What changed

### 1. Provider state typed (11 -> 0)

`ClineProvider.getState()` returns `ProviderState`
([`ProviderStateBuilder.ts`](../src/core/webview/ProviderStateBuilder.ts)),
already imported by `ApiRequestBuilder` and `TaskApiLoop` for P5's
`cycleState`. Every site is `ProviderState | undefined` (the provider
`WeakRef` may be gone), except:

- `getCurrentProfileId` takes
  `Pick<ProviderState, "listApiConfigMeta" | "currentApiConfigName"> | undefined`,
  the two fields it reads, so its callers and spec pass partial objects.
- `RetryHandler.calculateBackoffDelay` / `providerRateLimitDelaySeconds` take
  a local `BackoffState = Partial<Pick<ProviderState, "apiConfiguration" | "requestDelaySeconds">>`,
  the fields the backoff math reads (the D2 spec passes `{ requestDelaySeconds: 0 }`).

The typing exposed **no type error in product code** (tsc was clean the
moment the annotations changed), so no bug was found. It did break three
specs that passed partial fixtures where the full type is now required; they
got a typed fixture cast (`{} as never`, `{ mode: "code" } as ProviderState`),
no `as any` was added or removed in specs.

### 2. `as any` casts (20 -> 0)

| Where                                                 | Was                                                                                                       | Now                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiRequestBuilder.buildCleanConversationHistory` (7) | `msg as any` for `reasoning_details`; `first as any` for embedded reasoning                               | `ApiMessage` already declares `reasoning_details`; a small `asEmbeddedReasoningBlock` guard returns a typed `EmbeddedReasoningBlock` (stored reasoning blocks are not in Anthropic's `ContentBlockParam` union); the pushed OpenRouter message is a typed `MessageParam & Pick<ApiMessage, "reasoning_details">` variable |
| `StreamToolCallHandler` (5)                           | `(toolUse as any).id = ...`, `(block as any).id`                                                          | `ToolUse` and `McpToolUse` both declare `id?`; the initial partial is typed `ToolUse` with `id` in the literal; the orphan scan narrows out `text` blocks                                                                                                                                                                 |
| `TaskApiLoop` (3) and `TaskContextManager` (3)        | `this.access as any` handed to `getCheckpointService`, `getEnvironmentDetails`, `presentAssistantMessage` | one private `task` getter per class: `this.access as unknown as Task`, with a comment that the access object IS the owning Task (Task.ts constructs both with `this`) and those callees still take the whole Task. This is the one remaining cast shape, typed, in one place per class instead of six `as any`            |
| `TaskApiLoop.tryTextCompletionFallback` (1)           | `(task as any).todoList`                                                                                  | `Task.todoList` is declared (`TodoItem[]`)                                                                                                                                                                                                                                                                                |
| `TaskSubtasks.startSubtask` (1)                       | `(provider as any).delegateParentAndOpenChild`                                                            | public method on `ClineProvider`                                                                                                                                                                                                                                                                                          |

### 3. Empty catch bodies (4 -> 1)

The convention for low-value diagnostics is `logger.debug` from
`src/utils/logging` (already used in `TaskLifecycle`; below `info` it never
reaches the output channel, and it is a no-op under test).

- `RetryHandler.endBackgroundTaskOnApiError`: `getModel()` failure now logs at debug.
- `Task` condense background-profile capability read: now logs at debug.
- `Task` constructor: `postStateToWebview().catch(() => {})` after a failed
  resume now logs at debug (the resume failure itself is already a `console.error`).
- **Kept empty, deliberately**: `StreamToolCallHandler` eager checkpoint,
  `pending.catch(() => {})`. The rejection surfaces where the write tool
  awaits `pendingCheckpointSave`; this handler only stops an unhandled
  rejection when no write tool runs this turn. Logging here would report the
  same error twice. A comment inside the callback now says so.

## What remains (out of scope for this PR)

- `: any` annotations that are not `state` (e.g. `modelInfo: any`,
  `abortStream: any`, `diffViewProvider: any`, `_task: any` in
  `TaskStreamProcessor`, `summary?: any[]`) and the two `as any[]` in
  `TaskMessageLog*`; they are the next S6 slice.
- `getEnvironmentDetails(cline: Task, ..., cycleState?: Record<string, any>)`
  lives in `core/environment`; typing it as `ProviderState` is outside `core/task`.
- The remaining 108 `as any` and 115 empty catches elsewhere in `src`.

## Tests

- Commit 1: `ApiRequestBuilder.clean-history-shapes.spec.ts` (7 tests) pins
  every assistant-message shape `buildCleanConversationHistory` tells apart
  (reasoning_details with 0/1/several blocks, embedded encrypted reasoning
  with and without a round-tripping handler, missing summary, plain-text
  reasoning with preserve on/off, a reasoning block with neither field,
  plain messages). It passes on main unchanged.
- Commit 2: tsc clean (`check-types`); the 30 spec files of the touched
  classes (ApiRequestBuilder, RetryHandler, TaskStreamProcessor,
  TaskApiLoop, TaskContextManager, currentProfileId, Task,
  Task.condense-handler-invalidation, new-task-isolation,
  reasoning-preservation): 246 tests pass.
