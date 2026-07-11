# Tumble Code — Full Codebase Review Findings Register (2026-07-11)

Companion to [`2026-07-11_codebase-review-fix-stack.md`](./2026-07-11_codebase-review-fix-stack.md).
That doc holds the 5 branches that were **implemented** (TDD, stacked on
`refactor/background-task-loose-ends`). **This** doc is the complete register of
every evidence-backed finding from the five read-only Sonnet reviewers, so nothing
is lost. Speculative/style observations were dropped by the reviewers themselves;
what remains is code-traced.

Reviewers (one per subsystem): task engine, memory system, tools/diff, api/providers,
cloud/bridge. Each finding below preserves file:line, why-it's-a-bug, suggested fix,
TDD approach, and the reviewer's confidence.

**Status legend:** ✅ DONE = shipped in the fix stack · ⏳ DEFERRED = specced, not yet
implemented · 📝 TECH-DEBT = refactor/quality note, no discrete bug.

Fork context that drives severity: the product's primary use case is **local / weak
OpenAI-compatible models** (GLM/Qwen/Llama via llama.cpp/Ollama/LM Studio), so
weak-model robustness and local-server resource behaviour are weighted heavily.

---

## Summary table

| ID    | Sev  | Status           | Area   | Finding                                                                    |
| ----- | ---- | ---------------- | ------ | -------------------------------------------------------------------------- |
| TE-1  | high | ✅ DONE (B3)     | task   | bg abort → recursive memory writers (missing `isBackground` guard)         |
| TE-2  | high | ✅ DONE (B3)     | task   | `maxAgentTurns` abort sets no `abortReason` → writers fire on bg           |
| TE-3  | med  | ✅ DONE (B4)     | task   | subagentApproval/memorySandbox approve unparseable tool-ask                |
| TE-4  | med  | ✅ DONE (B19)    | task   | `awaitTaskCompletion` leaks bg entry if no Completed/Aborted event         |
| TE-5  | med  | ✅ DONE (B16)    | task   | `NativeToolCallParser.processRawChunk` drops first chunk lacking `id`      |
| TE-6  | med  | ✅ DONE (B21)    | task   | `drainPendingExtraction` aborts but doesn't await settle                   |
| TE-7  | med  | ✅ DONE (B20)    | task   | `cancelTask` fire-and-forget abort vs 3s `pWaitFor(isStreaming)`           |
| TE-8  | med  | ✅ DONE (B17)    | task   | `TaskStreamProcessor` orphaned `tool_call_end` (null final + no index)     |
| MEM-1 | high | ✅ DONE (B9)     | memory | `MemoryCoordinator` caches stale `ApiHandler` after profile switch         |
| MEM-2 | high | ✅ DONE (B10)    | memory | autoDream sub-task never drained/aborted on shutdown                       |
| MEM-3 | high | ✅ DONE (B10)    | memory | double-fired autoDream: same-PID race both acquire consolidation lock      |
| MEM-4 | med  | ✅ DONE (B11)\*  | memory | `makeSideQuery` unhandled rejection when abort wins the race               |
| MEM-5 | high | ✅ DONE (B15)    | memory | `selectRelevantMemories` swallows all ranker errors, no logging            |
| MEM-6 | med  | ✅ DONE (B11)    | memory | extraction cursor advances past messages added during run                  |
| MEM-7 | low  | ✅ DONE (B11)    | memory | dead code `quoteProblematicValue` in frontmatter.ts                        |
| TL-1  | high | ✅ DONE (B6)     | tools  | `NativeToolCallParser` static state races across parallel tasks            |
| TL-2  | high | ✅ DONE (B18)    | tools  | `WriteToFileTool` trusts stale `editType` from handlePartial               |
| TL-3  | med  | ✅ DONE (B4)     | tools  | `WriteToFileTool` doesn't coerce non-string params                         |
| TL-4  | med  | ✅ DONE (B12)    | tools  | handlePartial error leaves diff editor open (no `reset()`)                 |
| TL-5  | med  | ✅ DONE (B4)     | tools  | `ApplyDiffTool` passes `NaN` startLine to strategy                         |
| TL-6  | med  | ✅ DONE (B12)    | tools  | handlePartial opens diff editor pre-validation → info disclosure           |
| AP-1  | crit | ✅ DONE (B2)     | api    | abort not propagated to HTTP for OAI-compat/local providers                |
| AP-2  | high | ✅ DONE (B7)     | api    | base provider only finalizes tool calls on `finish_reason==="tool_calls"`  |
| AP-3  | high | ✅ DONE (B1)     | api    | `lm-studio.ts` crashes on missing `choices[0]`                             |
| AP-4  | high | ✅ DONE (B8)     | api    | `OpenAICompatibleHandler` yields no usage chunk when server omits usage    |
| AP-5  | med  | ✅ DONE (B8)     | api    | abort-listener leak in `nextChunkWithAbort` (per-chunk `addEventListener`) |
| AP-6  | med  | ✅ DONE (B7)     | api    | `deepseek.ts`/base don't call `processFinishReason`                        |
| AP-7  | med  | ✅ DONE (B8)     | api    | zero-token entries → auto-condense never triggers                          |
| AP-8  | med  | ✅ DONE (B22)    | api    | `openai.ts` O3 path drops `reasoning_content`                              |
| CB-1  | high | ✅ DONE (B5)     | cloud  | `share_task` missing ownership check                                       |
| CB-2  | high | ✅ DONE (B5)     | cloud  | `/shared/{id}` org-visibility: no membership check                         |
| CB-3  | high | ✅ DONE (B13)    | cloud  | `StaticTokenAuthService` never checks JWT expiry                           |
| CB-4  | med  | ✅ DONE (B13)    | cloud  | `WebAuthService.refreshSession` `clearCredentials()` not awaited           |
| CB-5  | med  | ✅ DONE (B14)    | cloud  | settings/telemetry `fetch` calls have no timeout                           |
| CB-6  | med  | ✅ DONE (B14)    | cloud  | `RetryQueue` default `maxRetries:0` = infinite retries                     |
| CB-7  | med  | ✅ DONE (B14)    | cloud  | `web.py` `_num` counts booleans as numbers (drifts from metrics_service)   |
| CB-8  | med  | ✅ DONE (B5+B23) | cloud  | `share_task` doesn't enforce org `allowPublicTaskSharing` server-side      |

Implemented: 10 findings across 5 branches (some are the same bug seen by two
reviewers — TE-3≡MEM-5). Deferred: 24 discrete findings + the tech-debt notes below.
CB-8: the `visibility` `Literal` narrowing shipped in B5; the org-policy enforcement
half is still deferred (needs org-context plumbing into `share_task`).

**Update (2026-07-11 evening, fix stack 2):** 19 further findings shipped across
branches B6–B14 (see [`2026-07-11_deferred-findings-fix-stack-2.md`](./2026-07-11_deferred-findings-fix-stack-2.md)),
stacked linearly on `fix/cloud-share-authz`; new tip is `fix/cloud-client-resilience`.
Section-heading status emojis below reflect the original review — the summary table
above is authoritative. \*MEM-4's premise was disproven during TDD: `Promise.race`
already consumes the losing promise's rejection, so no `unhandledRejection` was
reachable; the explicit `.catch` was kept as intent-documenting hygiene. Still
deferred: TE-4…TE-8, TL-2, AP-8, CB-8's org half. MEM-5's ranker-logging companion
shipped as B15 (`fix/memory-ranker-error-logging`, the new tip).

**Update (2026-07-12, fix stack 3):** the final 8 deferred findings shipped across
B16–B23 (see [`2026-07-11_deferred-findings-fix-stack-3.md`](./2026-07-11_deferred-findings-fix-stack-3.md)),
plus B24 (`fix/autodream-trigger-unhandled-rejection`): the `void executeExtractMemories`
/ `void executeAutoDream` trigger sites now `.catch` + log — this was the source of the
"pre-existing" unhandled-rejection errors in `Task.spec.ts` runs, now zero. **Every
finding in this register is now ✅ DONE.** New tip: `fix/autodream-trigger-unhandled-rejection`.

---

# Task engine

## TE-1 ✅ [high] Background task abort → recursive memory writers

`src/core/task/TaskLifecycle.ts:557-564`. `abortTask` guarded writers on
`!isAbandoned && !isUserCancelled` but not `isBackground`. Background tasks have no
`parentTaskId`, so `triggerMemoryBackgroundWriters` treats them as a main agent and
spawns another writer — which can itself be aborted, spawning another: unbounded
recursion. `TaskCompleted` already guarded `if (this.isBackground) return`; abort did
not. **Shipped in Branch 3** (added `isBackground` to `TaskLifecycleAccess`; skip
writers + extraction drain for bg tasks). Confidence: high.

## TE-2 ✅ [high] `maxAgentTurns` abort sets no `abortReason`

`src/core/task/TaskApiLoop.ts:278-283`. On turn-budget exhaustion `abortTask()` was
called with no reason → `isUserCancelled` false → writers fired on a background task
(same recursion path as TE-1). **Shipped in Branch 3** (sets a non-`user_cancelled`
abort reason before the maxAgentTurns abort). Confidence: high.

## TE-3 ✅ [med] Approval fails _open_ on unparseable tool-ask JSON

`src/core/task/subagentApproval.ts:72-76`, `src/core/memory/memorySandbox.ts:53-57`.
`catch { return "approve" }` — a malformed write tool-ask bypasses the worktree /
memory-dir containment check entirely (early return before the path check). Weak
models can emit malformed payloads. **Shipped in Branch 4** (both flipped to
`"deny"`, fail-safe). Confidence: med. (Same bug as MEM-5.)

## TE-4 ⏳ [med] `awaitTaskCompletion` leaks a background-task entry

`src/core/webview/ClineProvider.ts:3135-3197`. The promise resolves only on
`TaskCompleted`/`TaskAborted`/signal-abort. If a Task is disposed
(`removeAllListeners()`) before either event fires, the promise never resolves, the
`backgroundTasks` Map entry is never deleted, and `runOneSubtask` hangs forever,
blocking `runWithConcurrency`'s `Promise.all`. **Fix:** timeout safety net inside
`awaitTaskCompletion` resolving `{completed:false}` after a generous deadline, or make
`dispose()` emit `TaskAborted` if not already emitted. **TDD:** register
`awaitTaskCompletion`, call `task.dispose()`, assert the promise resolves not hangs.
Confidence: med.

## TE-5 ⏳ [med] `processRawChunk` drops the first chunk when `id` is absent

`src/core/assistant-message/NativeToolCallParser.ts:111-123`. If a weak model emits
the first tool-call chunk with `name`+`arguments` but `id` only in a later chunk (or
empty), `tracked` is never initialized and the chunk (with its `arguments` delta) is
silently dropped → tool call never assembles → turn with no tool use →
`consecutiveNoToolUseCount` climbs. **Fix:** initialize `tracked` when any of
`id`/`name`/`arguments` present, using an `index`-based synthetic id when `id` is
missing. **TDD:** chunk without `id` then a second with `id`; assert arguments not
lost. Confidence: med.

## TE-6 ⏳ [med] `drainPendingExtraction` aborts controllers without awaiting settle

`src/core/memory/extractMemories.ts:230-244`. After the timeout it aborts remaining
controllers but returns immediately; the `finally` cleanup runs later, so the drain
doesn't guarantee extraction has stopped when it returns. **Fix:** after aborting,
`await Promise.allSettled([...inFlightExtractions])` with a short timeout. **TDD:**
slow extraction >timeout, call `drainPendingExtraction(100)`, assert
`inFlightExtractions.size === 0` after return. Confidence: med.

## TE-7 ⏳ [med] `cancelTask` fire-and-forget abort races 3s `pWaitFor`

`src/core/webview/ClineProvider.ts:3318-3337`. `task.abortTask()` is called
un-awaited, then `abandoned = true` is set while abort is still running; `isStreaming`
only clears after `processStream` returns, and a non-`user_cancelled` abort that hits
the 60s drain will blow the 3s `pWaitFor` timeout ("Failed to abort task"). The
`user_cancelled` path is already handled (drain skipped), so this is the residual
non-user-cancel race. **Fix:** await `abortTask()`, or lengthen/condition the
`pWaitFor`. Confidence: med.

## TE-8 ⏳ [med] Orphaned `tool_call_end` (null finalize + undefined index)

`src/core/task/TaskStreamProcessor.ts:284-327`. When `finalizeStreamingToolCall`
returns `null` **and** `toolUseIndex` is `undefined` (e.g. a deduped duplicate
`tool_call_start` whose id was never tracked), neither branch runs — the tool call is
silently dropped, leaving a `tool_use` with no matching `tool_result` → API 400 next
turn. **Fix:** `else` branch emitting a synthetic error tool_result. **TDD:** deduped
start then end for same id; assert an error tool_result is pushed. Confidence: med.

### Task-engine tech debt 📝

- `TaskLifecycleAccess` missing `isBackground` — _resolved_ by TE-1's fix.
- Module-level mutable state in `extractMemories.ts` (`inFlightExtractions`,
  `lastMemoryMessageCursors`, `inFlightControllers`) couples concurrent tasks; a
  per-provider/per-task container would be safer and testable.
- `abortTask` is a ~70-line method with 5 responsibilities; split into
  `prepareAbort()`/`cleanupAbort()`/`drainAbort()` to make ordering explicit.
- `NativeToolCallParser` static Maps shared across concurrent streams (see TL-1).
- `RunParallelTasksTool` hand-duplicates the abort-listener + `finally { off }`
  pattern; a helper tying an `AbortController` to a Task event would centralize it.

---

# Memory system

## MEM-1 ⏳ [high] `MemoryCoordinator` caches a stale `ApiHandler` after profile switch

`src/core/task/Task.ts:408-421` (lazy getter caches coordinator with `apiHandler:
this.api`) and `:1069-1073` (`updateApiConfiguration` rebuilds `this.api` but does not
invalidate `_memoryCoordinator`). After a profile switch (frontier → cheap local), the
recall side-query still runs on the old handler; if its credentials/connection are
dead, the ranker silently returns `[]` and recall never works on the new profile.
Directly hits the "design for mid-task mode switching" constraint. **Fix:** set
`this._memoryCoordinator = undefined` in `updateApiConfiguration`. **TDD:** access
coordinator (caches handler A), `updateApiConfiguration(B)`, access again, assert
side-query uses B's `completePrompt`. Nearest test: `memory/__tests__/prefetch.spec.ts`.
Confidence: high.

## MEM-2 ⏳ [high] autoDream sub-task never drained/aborted on shutdown

`src/core/memory/autoDream.ts:151-178`, `src/core/task/TaskLifecycle.ts:583-596`.
`executeAutoDream` uses a local `AbortController` nothing external can reach, and
`triggerMemoryBackgroundWriters` calls `void executeAutoDream(...)` **untracked**.
`drainPendingExtraction` only drains extraction, never dreams. On shutdown an in-flight
dream (a real headless Task, up to 10 turns) is orphaned against the API and may leave
the consolidation lock holding a dead PID and partial memory writes. **Fix:**
`inFlightDreams` set + `drainPendingDreams(timeoutMs)` mirroring extraction; call it in
`abortTask`. Nearest test: `memory/__tests__/autoDream.spec.ts`. Confidence: high.

## MEM-3 ⏳ [high] Double-fired autoDream: same-PID lock race

`src/core/memory/consolidationLock.ts:65-98`, `TaskLifecycle.ts:614-664`.
`triggerMemoryBackgroundWriters` can fire twice for one task (`TaskCompleted` +
non-abandoned `abortTask`). Both dream calls are `void`. If neither has written the
lock yet, both pass the live-PID guard, both `fs.writeFile(pid)`, both verify their own
pid, both proceed → two concurrent consolidation sub-tasks on the same memory dir →
last-writer-wins corruption. **Fix:** module-level `inFlightDream` guard (boolean or
Promise) preventing re-entry. **TDD:** mock lock to succeed for both; call
`executeAutoDream` twice rapidly; assert `subTaskRunner` called once. Confidence: med
(double-fire path is unusual but code comments acknowledge it).

## MEM-4 ⏳ [med] `makeSideQuery` unhandled rejection when abort wins

`src/core/memory/memoryTaskIntegration.ts:46-59`. The `completion` promise loses the
`Promise.race` to the abort rejection and is left with no `.catch`; if it later rejects
(network/rate-limit after abort) Node emits `unhandledRejection`, which in VS Code can
surface an error notification or crash the ext host. **Fix:** `completion.catch(()=>{})`
before the race. **TDD:** `completePrompt` that rejects after 100ms, abort immediately,
assert no `unhandledRejection`. Nearest test: `memory/__tests__/relevance.spec.ts`.
Confidence: med.

## MEM-5 ⏳→✅ [med] `memoryWriteSandbox` approves unparseable tool-ask

`src/core/memory/memorySandbox.ts:50-57`. Same bug as **TE-3**; the memory-sandbox
half shipped in Branch 4 (`catch` → `"deny"`, test assertion flipped). Listed here for
completeness under the memory reviewer. Confidence: med.

## MEM-6 ⏳ [med] Extraction cursor advances past messages added mid-run

`src/core/memory/extractMemories.ts:164-193`. `context.messages` is the live
`clineMessages` reference; `newMessageCount`/transcript are computed at T0 but the
cursor is set to `context.messages.length` at T1 (after the multi-second sub-task). Any
messages appended in that window are skipped forever. Narrow race (extraction fires at
Completed/abort) but trivial to fix. **Fix:** snapshot `lengthAtStart` at T0 and set the
cursor to it. **TDD:** stub runner pushes a message before resolving; assert cursor is
the pre-run length. Confidence: med.

## MEM-7 ⏳ [low] Dead code `quoteProblematicValue`

`src/core/memory/frontmatter.ts:109-113`. `void quoteProblematicValue(parsed.value)` —
pure function called only for a non-existent side effect. Remove the function + `if`,
or comment it as a placeholder. Confidence: high (it's dead code, not a bug).

### Memory tech debt 📝

- **Extraction has a drain/abort framework; autoDream has none** — unify (see MEM-2).
- `selectRelevantMemories` dead branch `relevance.ts:67-69`: `if (signal.aborted)
return []; return []` — identical branches, unused `e`; the missing log is MEM-5's
  sibling (reviewer filed the log gap as its own high finding — see next).
- **`selectRelevantMemories` swallows all ranker errors silently**
  (`relevance.ts:60-70`): non-abort failures (the most common weak-model mode: error /
  timeout / unparseable) return `[]` with no log/telemetry, making broken recall
  undebuggable. **Fix:** `logger.error(...)` on the non-abort branch. Confidence: high.
  _(Tracked as MEM-5's companion; implement alongside.)_
- Cursor map eviction is FIFO not LRU (`extractMemories.ts:148-153`); a long-lived
  task's cursor can be evicted by short-lived ids → re-extraction. Unlikely at 64 cap.
- `triggerMemoryBackgroundWriters` reads `taskHistory` via `getValue` (may be stale);
  `ts` is creation not last-modified, so the session gate undercounts long sessions →
  dream may never trigger for few-but-long-session users.
- `memoryWriteSandbox` only checks `parsed.path`, not other path-bearing fields
  (`searchPattern`/`filePattern`/`regex`); fine today (those are reads) but a future
  write-bearing field would be missed.

---

# Tools / diff

## TL-1 ⏳ [high] `NativeToolCallParser` static state races across parallel tasks

`src/core/assistant-message/NativeToolCallParser.ts:56-63`. `streamingToolCalls` and
`rawChunkTracker` are **static** (one per process). `run_parallel_tasks` runs subagent
Tasks concurrently; each task's `resetStreamingState()` calls
`clearAllStreamingToolCalls()`/`clearRawChunkState()`, wiping _all_ tasks' state. Task
B starting its next turn deletes Task A's mid-stream tool-call accumulation → A's later
chunks `get(id)` → `undefined` → dropped → hung/errored loop. Deterministic at
`maxConcurrency >= 2`. **Fix:** move both Maps to instance state on
`TaskStreamProcessor` (per-task parser); thread the instance through
`processStreamingChunk`/`processRawChunk`/`finalizeStreamingToolCall`. **TDD:** two
parser instances; start a tool call on A; call clear (simulating B); send next chunk to
A; assert not lost. Confidence: high. **This is the single most structurally invasive
fix and the highest-value deferred item for parallel-task correctness.**

## TL-2 ⏳ [high] `WriteToFileTool` trusts stale `editType` from handlePartial

`src/core/tools/WriteToFileTool.ts:63-64`. `execute()` reuses
`diffViewProvider.editType` (set by `handlePartial` for whatever path it last saw)
without verifying it matches the current `relPath`. If partial-json and final
`JSON.parse` disagree on `path` (documented partial-json behaviour on truncated
strings), `fileExists` is computed for the wrong file → skipped
`createDirectoriesForFile` / ENOENT, or empty original content. **Fix:** store `relPath`
alongside `editType`; in `execute()` fall through to re-check when it mismatches. **TDD:**
handlePartial path A (modify), execute path B; assert existence re-checked for B.
Confidence: med.

## TL-3 ✅ [med] `WriteToFileTool` doesn't coerce non-string params

`src/core/tools/WriteToFileTool.ts:31-32`. `params.path=123` passes `!relPath`
(truthy), then `path.resolve(cwd,123)` throws a raw TypeError, wasting a turn.
`EditFileTool` already coerces. **Shipped in Branch 4** (string coercion + clear
missing-param error). Confidence: high.

## TL-4 ⏳ [med] handlePartial error leaves diff editor open

`src/core/tools/BaseTool.ts:115-125`. If `handlePartial` throws after
`diffViewProvider.open()` but during `update()`, the central catch calls `handleError`
but never `diffViewProvider.reset()`; the editor stays open with `isEditing=true` until
the next turn's `resetStreamingState()`. **Fix:** `await task.diffViewProvider.reset()`
in the partial catch. **TDD:** `update` rejects; assert `reset` called. Confidence: med.

## TL-5 ✅ [med] `ApplyDiffTool` passes `NaN` startLine

`src/core/tools/ApplyDiffTool.ts:77`. `parseInt(match(/:start_line:(\d+)/)?.[1] ?? "")`
→ `NaN` when the marker is absent. Harmless for multi-search-replace (ignores it) but
latent for any line-based strategy. **Shipped in Branch 4** (`undefined` when absent;
new spec). Confidence: high.

## TL-6 ⏳ [med] handlePartial opens diff editor before path validation (info disclosure)

`src/core/tools/WriteToFileTool.ts:254-257`. `handlePartial` calls
`diffViewProvider.open(relPath!)` on a merely-_stabilized_ path with no
`rooIgnoreController.validateAccess` / `isPathOutsideWorkspace` check (those are only in
`execute()`). A streamed `"../../../etc/passwd"` opens the file and reads its content
into the diff view before any access control — the write is still gated by approval, but
the _content is disclosed_. **Fix:** add validateAccess + outside-workspace checks in
`handlePartial` before `open()`. **TDD:** `validateAccess` false; assert `open` not
called. Confidence: med.

### Tools/diff tech debt 📝

- `DiffViewProvider` is a ~1046-line god object (editor lifecycle + decorations +
  save/revert/diagnostics + recovery buffers + tab cleanup + BOM). Extract
  `DiffEditorLifecycleManager` / `DiagnosticsCollector`.
- `DecorationController` calls `createTextEditorDecorationType` at module scope →
  breaks incompletely-mocked `vscode` in tests; every transitive importer needs the
  mock.
- `NativeToolCallParser` uses `as NativeArgsFor<TName>` casts, not runtime validation;
  `EditFileTool` compensates with `typeof` checks but Write/ApplyDiff didn't (TL-3).
- `hasPathStabilized` keeps `lastSeenPartialPath` across calls; `WriteToFileTool` lacks
  a `finally` reset (unlike `EditFileTool`), so a throw before reset can falsely report
  stabilization for a later same-named path.
- `pendingSave` recovery-buffer lifecycle in `DiffViewProvider` has many explicit
  invariants across ~10 sites — heavily commented but fragile to edits.

---

# API / providers

## AP-1 ✅ [critical] Abort not propagated to the HTTP request for OAI-compat/local providers

`base-openai-compatible-provider.ts:107`, `deepseek.ts`, `lm-studio.ts:102`,
`native-ollama.ts:240`, `openai-compatible.ts:182`. None passed `signal` to the create
call nor implemented `cancelRequest`; only `openai.ts` did. On cancel the read loop
stopped but the local server kept generating — burning GPU and blocking the next
request on single-user servers. The fork's primary use case, worst-hit here. **Shipped
in Branch 2** (per-request `AbortController` + `{signal}` + `cancelRequest` on base,
lm-studio, ollama). Confidence: high.

## AP-2 ⏳ [high] Base provider only finalizes tool calls on `finish_reason==="tool_calls"`

`base-openai-compatible-provider.ts:171-178`. Local servers (llama.cpp, vLLM, older LM
Studio) often return `finish_reason:"stop"`/`null` even after emitting tool*calls
deltas; then `activeToolCallIds` is never flushed and no `tool_call_end` fires. The
`finalizeStream` fallback marks blocks non-partial, so a tool executes with possibly
\_truncated* JSON arguments. `lm-studio.ts:141-146` already uses the robust
`processFinishReason` pattern. **Fix:** call
`NativeToolCallParser.processFinishReason(finishReason)` + a finally-style flush of any
remaining `activeToolCallIds` regardless of reason. **TDD:** final chunk
`finish_reason:"stop"` after tool_calls deltas; assert `tool_call_end` for all started
calls. Confidence: high. (Overlaps AP-6.)

## AP-3 ✅ [high] `lm-studio.ts` crashes on missing `choices[0]`

`lm-studio.ts:117-118` and `:209`. `chunk.choices[0]?.delta` throws on choices-less
keepalive/usage-only SSE chunks. **Shipped in Branch 1** (`choices?.[0]?.…`).
Confidence: high.

## AP-4 ⏳ [high] `OpenAICompatibleHandler` yields no usage chunk when server omits usage

`openai-compatible.ts:88-104,192-196`. Many local servers return no usage block even
with `include_usage:true`; `if (usage)` then skips the yield entirely, so
`_inputTokens`/`_outputTokens` stay 0, the api-req message is written `tokensIn:0,
tokensOut:0, cost:0`, and (see AP-7) context management sees `contextTokens:0` forever →
**auto-condense never triggers** until the server hard-rejects on context overflow.
`lm-studio.ts` has a local `countTokens` fallback; this path has none. **Fix:** fall
back to a local token count when usage is absent/all-zero, or always yield a usage chunk.
**TDD:** `result.usage` resolves `undefined`; assert a usage chunk (or fallback count)
is still yielded. Confidence: high.

## AP-5 ⏳ [med] Abort-listener leak in `nextChunkWithAbort`

`src/core/task/TaskApiLoop.ts:547-565`. Called once per chunk; each call does
`signal.addEventListener("abort", …)` with no `{once:true}` and no removal → thousands
of listeners on one signal for long generations → `MaxListenersExceededWarning` spam and
GC pressure. **Fix:** `{ once: true }` + `removeEventListener` in a `finally` around the
`Promise.race`. **TDD:** process 100 chunks without abort; assert no max-listeners
warning; abort after; assert no pending listeners fire. Confidence: med.

## AP-6 ⏳ [med] `deepseek.ts` / base don't call `processFinishReason`

`deepseek.ts:145-178` has **no** finish-reason handling at all (relies entirely on the
`finalizeRawChunks` safety net → truncated args risk); base only handles the literal
`"tool_calls"`. **Fix:** both should call `processFinishReason(finishReason)` per chunk
and yield its events, matching `lm-studio.ts`. Confidence: high. (Same root as AP-2;
fix together.)

## AP-7 ⏳ [med] Zero-token entries make auto-condense never trigger

`TaskApiLoop.ts:919-931`, `TaskTokenTracking.ts:124-126`. `handleContextManagement`
guards `if (contextTokens)`; when AP-4 writes zeros, `getApiMetrics` sums 0 →
`contextTokens:0` (falsy) → context management skipped → history grows until the server
rejects it (forced truncation instead of graceful condense). Also a mode-switch hazard:
switching to a smaller-context model won't trigger condense. **Fix:** fall back to a
local `api.countTokens` of history when `getTokenUsage()` is 0 but history is non-empty,
or fix AP-4. Confidence: med (depends on AP-4).

## AP-8 ⏳ [med] `openai.ts` O3 path drops `reasoning_content`

`openai.ts:534-559` (`handleStreamResponse`, O3 family) never calls
`extractReasoningFromDelta`, unlike the main path at `:283-285`; reasoning output is
silently dropped for O3 models. Lower priority for this fork (OpenAI-native O3 isn't the
main use case) but a real correctness bug in a used path. **Fix:** add the reasoning
extraction/yield. Confidence: high.

### API tech debt 📝

- Inconsistent abort/cancel across providers — centralize in `BaseProvider`/mixin
  (AP-1 fixed the OAI-compat family; native-ollama/lm-studio done, others remain).
- Three parallel streaming impls (raw OpenAI SDK base, Vercel AI SDK
  `openai-compatible`, `openai.ts` with O3 branching) with divergent robustness for
  reasoning/tool-finalization/usage.
- `TaskStreamProcessor.processChunk` accumulates tokens by addition; providers that
  emit incremental usage per chunk double-count unless the final overwrite drain runs.
- `getApiMetrics` re-scans all `clineMessages` per call (O(n)); snapshot cache is
  invalidated on every new message.
- Condense `computeCondenseKeepBoundary` bounds its pull-back at `keepRecent*2`; long
  interleaved tool_use/tool_result chains can land the boundary on a split pair and
  `getEffectiveApiHistory` then drops the orphaned `tool_result` — silent context loss
  for complex multi-tool weak-model workflows.

---

# Cloud / bridge

## CB-1 ✅ [high] `share_task` missing ownership check

`self-hosted-cloudapi/src/services/share_service.py:14-68`. `user_id` is passed but
never compared to `task.user_id` → any authenticated user can share any task by id
(`delete_shared_task` already checks ownership — the pattern was intended, missed here).
**Shipped in Branch 5** (`task.user_id != user_id` → "Task not found", no existence
leak). Confidence: provable.

## CB-2 ✅ [high] `/shared/{id}` org-visibility: no membership check

`self-hosted-cloudapi/src/routers/web.py:387-437`. Non-public shares only checked
`user is None`; any logged-in user of any org could read an "organization"-visibility
task. **Shipped in Branch 5** (require owner or `Membership` row for
`task.organization_id`, else 404). Confidence: provable.

## CB-3 ⏳ [high] `StaticTokenAuthService` never checks JWT expiry

`packages/cloud/src/StaticTokenAuthService.ts:8-101`. Token decoded once
(`jwtDecode`, no `exp` verify); `isAuthenticated()`/`hasActiveSession()` hardcoded
`true`. After the JWT's ~1h expiry, every cloud call 401s but the service reports
authenticated forever and never emits `auth-state-changed`, so bridge/telemetry/settings
retry-fail silently. **Fix:** parse `exp` in ctor → `inactive-session` if past; timer
near `exp` to emit the transition; or transition on repeated 401s. **TDD:** construct
with past-`exp` JWT; assert `isAuthenticated()` false. Confidence: provable.

## CB-4 ⏳ [med] `refreshSession` calls `clearCredentials()` un-awaited

`packages/cloud/src/WebAuthService.ts:451-453`. `clearCredentials` is `async`; on
`InvalidClientTokenError` it's called without `await`, so a rejecting
`context.secrets.delete()` becomes an unhandled rejection. **Fix:** `await`. **TDD:**
mock `secrets.delete` reject; assert no unhandled rejection. Confidence: provable.

## CB-5 ⏳ [med] Settings/telemetry `fetch` have no timeout

`CloudSettingsService.ts:115-119`, `TelemetryClient.ts:124,256`. No
`AbortSignal.timeout` (unlike `CloudAPI.ts:52`, 30s). A hung backend makes
`fetchSettings` never resolve → `RefreshTimer` never reschedules → settings frozen until
restart. **Fix:** add `signal: AbortSignal.timeout(30000)` + handle `AbortError`. **TDD:**
`fetch` never resolves; assert `fetchSettings` returns false after timeout (fake timers).
Confidence: provable.

## CB-6 ⏳ [med] `RetryQueue` default `maxRetries:0` = infinite retries

`packages/cloud/src/retry-queue/RetryQueue.ts:32-40`, guard at `:172`
(`maxRetries > 0 && …` short-circuits when 0). API down → queue fills to 100 → retries
all every 60s forever → burst on recovery; queue persisted to `workspaceState` so it
survives restarts. **Fix:** finite default (e.g. 5) or treat 0 as "no retries"; add a
TTL to drop stale events. **TDD:** 3 requests, `fetch` always throws, run `retryAll` 10×,
assert eventual removal. Confidence: provable.

## CB-7 ⏳ [med] `web.py` `_num` counts booleans as numbers

`self-hosted-cloudapi/src/routers/web.py:126-128` vs `metrics_service.py:54-56`. Python
`bool` ⊂ `int`, so `isinstance(True,(int,float))` is true; `metrics_service` excludes
bools, `web.py` doesn't → a malformed `tokensIn: true` adds `1.0` in the task list but
`0` in the dashboard → divergent totals. **Fix:** add `and not isinstance(value, bool)`.
**TDD:** message with `{"tokensIn": true, "tokensOut": 100}`; assert `tokens_in=0`.
Confidence: provable.

## CB-8 🟡 [med] `share_task` doesn't enforce org `allowPublicTaskSharing` server-side

`share_service.py:14-68`, `schemas/share.py:8-13`. `canSharePublicly()` is a client-only
check; a direct `POST /api/extension/share {visibility:"public"}` bypasses org policy.
**Partially shipped in Branch 5:** `visibility` was narrowed to
`Literal["organization","public"]`. **Still deferred:** `share_task` must fetch org
settings and enforce `enable_task_sharing` / `allow_public_task_sharing` — deferred
honestly because `share_task` currently lacks org-context plumbing. **TDD:** org
`allow_public_task_sharing=false`, share `visibility="public"`, assert error.
Confidence: provable.

### Cloud/bridge tech debt 📝

- Extract a shared `fetchWithTimeout` (CB-5) so settings/telemetry match `CloudAPI`.
- `BridgeOrchestrator` has no `connect_error`/`reconnect_failed` listener
  (`bridge/BridgeOrchestrator.ts:91-98`); repeated auth-refresh failures reconnect-loop
  with no user-visible signal.
- `CloudService.createInstance` (`extension.ts:248`) isn't try/caught; a throwing
  `WebAuthService.initialize()` fails whole-extension activation instead of degrading to
  local-only.
- Duplicate `_num`/`_fmt_tokens`/`_fmt_duration` across `web.py` and `metrics_service.py`
  (root cause of CB-7 drift) — extract to a shared util.
- `visibility` unvalidated `str` — _resolved_ by CB-8's `Literal` narrowing.

---

## Recommended next-session order (by value × confidence for the fork)

1. **TL-1** (static-parser race) — corrupts parallel-task tool calls; structural but
   highest correctness payoff.
2. **AP-2 + AP-6** (finish-reason finalization) — truncated tool args on local models;
   fix together.
3. **AP-4 + AP-7** (usage-missing → no condense) — silent unbounded context growth on
   local servers; fix together.
4. **MEM-1** (stale coordinator on profile switch) — breaks recall after mode switch.
5. **MEM-2 + MEM-3** (dream drain/abort + double-fire lock) — orphaned tasks + memory
   corruption.
6. **CB-3** (JWT expiry) — silent cloud breakage after 1h.
7. Then the med/low remainder: TE-4..TE-8, MEM-4/6/7, TL-2/4/6, AP-5/8, CB-4/5/6/7/8.

All must follow the same discipline: failing test first, minimal fix, green; one branch
per functionality, stacked on the current tip; nothing pushed/merged without the user's
say-so.
