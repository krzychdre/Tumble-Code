# S6 round 2: type safety in the rest of `src` (`as any`, empty catches, named `any`)

Continuation of [S6](2026-09-28_s6-core-task-type-safety.md), which covered
`src/core/task` state types and listed what remained. Branch
`refactor/s6-src-type-safety-round2`, from `origin/main` at `86ca2492b`.

Scope: `src/` non-spec files, excluding the settings-related files in
`src/core/webview/`, `webview-ui/` and `apps/cli/` (other helpers work
there). `ClineProvider.ts` was left alone for the same reason (it is the
file every webview branch touches).

## How the numbers were counted

The same TypeScript-compiler-API counter as S6 (not grep), over every `.ts`
file under `src/` except `__tests__/`, `*.spec.ts`, `*.test.ts` and `.d.ts`:

- **as any**: an `AsExpression` whose type is exactly `any`.
- **empty catch**: a `catch` clause with no statements, plus a
  `.catch(() => {})` callback with an empty body. This round also splits the
  `.catch` callbacks into "bare" (nothing in the body) and "commented" (only
  a comment explaining the swallow).

## Counts (whole `src`, non-spec)

| Category                                                                               | Before (`86ca2492b`) | After |
| -------------------------------------------------------------------------------------- | -------------------: | ----: |
| `as any`                                                                               |                  107 |    35 |
| empty catch, all kinds                                                                 |                  118 |    82 |
| of which `.catch(() => {})` with no comment                                            |                   44 |     2 |
| of which `.catch` with only a comment                                                  |                    3 |     9 |
| of which `catch {}` clauses (all commented)                                            |                   71 |    71 |
| named `any` annotations in `core/task` + `core/environment` (grep, excluding comments) |                   41 |    12 |

`as any` per area, before and after: `api` 61 -> 17, `core/*` (without
webview) 18 -> 0, `core/webview` 10 -> 6 (all in `ClineProvider.ts`, out of
scope), `services` 4 -> 0, `shared` 1 -> 0, `extension.ts` 1 -> 0,
`extension/` 8 -> 8 (see "Bug found"), `__mocks__` 4 -> 4 (test
infrastructure).

## What changed

### Named `any` in core/task and core/environment

- `TaskStreamProcessor`: `_task: any` -> `Task`; `processChunk(chunk: any)` ->
  `ApiStreamChunk`; the background-drain iterator is
  `AsyncGenerator<ApiStreamChunk>`.
- `TaskApiLoop`: `diffViewProvider` / `toolRepetitionDetector` get their
  classes (they were `any` with the class name in a comment);
  `cachedStreamingModel.info`, `streamModelInfo` and `modelInfo` are
  `ModelInfo`; every `abortStream: any` is the existing `AbortStreamFn`;
  `buildToolsArray` returns `ToolsArrayResult`.
- `ApiRequestBuilder.buildToolsArray(modelInfo: any)` -> `ModelInfo`.
- `summary?: any[]` (reasoning summary, `ApiMessage`, `ApiRequestBuilder`,
  `TaskMessageLog*`) -> `unknown[]`: it is opaque provider data that is only
  stored and sent back. No provider implements `getSummary` any more.
- `TaskMessageLog.processAssistantMessage`: `messageWithTs: any` is typed as
  `ApiMessage` with a widened `content` while reasoning blocks are inserted;
  the one cast on return is commented (stored reasoning blocks are not in
  Anthropic's union).
- `TaskContextManager.buildCondensingMetadata(customModes: any)` ->
  `ModeConfig[] | undefined`; `TaskResumption.providerRef` ->
  `WeakRef<ClineProvider>`.
- `getEnvironmentDetails(..., cycleState?: Record<string, any>)` ->
  `ProviderState`.

tsc found no product-code error from any of these. Three specs passed loose
fixtures and now pass typed ones (`TaskStreamProcessor.eager-checkpoint`,
`TaskStreamProcessor.reasoning-throttle`,
`ApiRequestBuilder.provider-capabilities`).

### `as any` removed (72)

- Casts that were simply unnecessary (the value already had the type):
  `DelegationService` (mode, parent task, `ApiMessage[]` history),
  `NewTaskTool` (`delegateParentAndOpenChild` is public),
  `MessageManager` (`globalStoragePath` / `taskId` are public readonly),
  `ReadFileTool`, `GenerateImageTool`, memory `signal`s, `prefetch`,
  `diff/stats`, `anthropic` stream, `native-ollama` stream, `extension.ts`
  handler, `openai-codex` reasoning effort, `responses-api-input` thinking
  part, `gemini-format`, `r1-format` `tool_calls`.
- `includes(x as any)` on typed constant arrays (Bedrock model id lists,
  `ALWAYS_AVAILABLE_TOOLS`, `GLOBAL_SECRET_KEYS`) ->
  `(LIST as readonly string[]).includes(x)`.
- Provider error fields: a new `ProviderErrorFields` type in `api/apiErrors.ts`
  (`status`, `statusCode`, `status_code`, `code`, `name`, `__type`,
  `$metadata`, `errorDetails`, OpenRouter's `error.metadata.raw`) replaces
  the `as any` reads/writes in `apiErrors`, `utils/error-handler` and
  `bedrock/errors`.
- Vendor extensions typed locally: `ThinkingParam` and `MiniMaxBaseResp` in
  `base-openai-compatible-provider`, `BedrockCachableModelInfo` in
  `bedrock/request`, `ChatCompletionFunctionTool` for Gemini function
  declarations (our tool arrays never hold OpenAI "custom" tools).
- Exhaustive `default` branches (`SimpleInstaller` x2, `McpConnectionManager`)
  assign to `never` first, then read `type` through a narrow shape.
- The context-proxy migration writes `stateCache[key]` through a generic
  `setCachedValue<K>` instead of `value as any`.
- `presentAssistantMessage`, missing tool id: `cline.recordToolError` is
  declared on `Task`, so the `typeof ... === "function"` guard went away
  (the call is still inside the same try/catch).

### `as any` kept, with a one-line justification (5 casts on 4 lines, in scope)

- `openai-native` x2 and `openai-codex` x1: `client.responses.create(body)`.
  The body is a plain record with fields the SDK overloads do not know;
  removing the cast gives TS2769 (no overload) and a response-type mismatch.
- `extension/bridge.ts` (key and value): the bridge protocol carries untyped key/value pairs
  into `ContextProxy.setValue`.

### Empty catches (44 bare `.catch` -> 2)

Convention: `logger.debug` from `src/utils/logging` (below `info` it never
reaches the output channel; no-op under test), a comment inside the callback
for a deliberate swallow.

- 25 tool sites `await task.ask(..., partial).catch(() => {})` now use one
  documented handler, `ignorePartialAskRejection` (in
  `core/task/AskIgnoredError.ts`): it stays silent for `AskIgnoredError` (a
  superseded partial, the normal path) and logs anything else at debug. Same
  swallow as before, so no behaviour change.
- Debug logging: `ArtifactStore` cleanup unlinks, `Task` orphaned spill
  artifact, `TaskHistoryStore` watcher arming (x4), `BackgroundTaskRunner`
  (memoryActivity post, abortTask x2), `subagents` cancel.
- Deliberate, now with a comment in the callback: `ArtifactStore` temp file
  after a failed write, `ProviderSettingsManager` lock chain,
  `getEnvironmentDetails` busy-terminal wait, `TaskHistoryStore`
  `initialized` guard and targeted-refresh batch, `anthropic-vertex`
  deferred auth error.
- Left bare: `memoryTaskIntegration.ts:57` (explained by the comment block
  right above it) and `ClineProvider.ts:147` (out of scope).

The 71 `catch {}` clauses all already carry a comment (the counter checks
that), so they count as documented swallows; whether each comment is a good
enough reason was not reviewed one by one in this round.

## Bug found (reported, NOT fixed here)

`src/extension/api.ts:253-263`: the public API subscribes to
`TaskDelegated`, `TaskDelegationCompleted` and `TaskDelegationResumed` on
each **Task** (`task.on(RooCodeEventName.TaskDelegated as any, ...)`), but
those events are emitted only on the **provider**
(`DelegationService` -> `host.emit`, i.e. `ClineProvider.emit`, lines 242,
636, 681). Nothing emits them on a Task (they are not in `TaskEvents`, which
is why the `as any` was needed), so the three listeners never fire and the
API / IPC consumers never receive the delegation events. The casts stay until
the fix (subscribe on the provider, or re-emit per task) lands on its own
branch with a test.

## Tests

- Commit 1 (characterization, passes on main unchanged, verified in a
  worktree at that commit): `presentAssistantMessage-unknown-tool.spec.ts`
  +2 (missing-id block with a non-string name records no tool error; a
  throwing `recordToolError` still reports the error),
  `SimpleInstaller.spec.ts` +2 (unsupported item type message for install
  and remove).
- Commit 2: `ignorePartialAskRejection.spec.ts` (3 tests); the three spec
  fixtures above typed.
- Run: every spec whose file name matches a touched module (plus
  `TaskStreamProcessor*`, `r1-format`, `responses-api*`, all
  `assistant-message` specs, `DelegationService*`): 140 files, 2231 tests,
  all green, `--maxWorkers=2`. tsc clean, eslint clean on touched files.

## Remaining (next slice)

- `as any` in `api/`: `lite-llm` (4, `cache_control` on content parts and
  `tool_calls` reads), `openrouter` (2, `tool_calls` / `reasoning_details` on
  assistant messages), `xai` (2, Responses API `tool_choice` and body),
  `openai-format` (6, reasoning_details round trip). All are vendor
  extensions to SDK message types; typing them needs one shared
  "OpenAI message with vendor fields" type across the four files.
- `ClineProvider.ts` (6 `as any`: typed `emit`/`on`/`off` forwarding and
  `.catch` at 147/363): out of scope while the webview branches are active.
- `extension/api.ts` (6): blocked on the bug above.
- core/task: `error: any` parameters of `RetryHandler` / `TaskApiLoop`
  (caught errors, need `unknown` plus narrowing), the two
  `emit: (event: any, ...args: any[])` access signatures,
  `profileThresholds: Record<string, any>`, `ContentBlock = Record<string, any>`.
- `CustomModesManager` reads an `alreadyHandled` flag that nothing sets
  (always false, so every load error is logged). Dead check, not a bug;
  typed as it is.
