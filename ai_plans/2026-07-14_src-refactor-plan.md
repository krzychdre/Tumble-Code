# Refactoring Plan — `src/` (VS Code extension host) for Human Maintainability

> **Date:** 2026-07-14 · **Scope:** [`src/`](src/) only · **Mode:** architect (planning, no code changes)
> **Goal:** Make the extension host code readable and maintainable by a human working alone, without AI assistance. Priorities: (1) low cognitive complexity, (2) design patterns where sensible, (3) dead-code removal, (4) human readability.

> **✅ Verification stamp — 2026-07-15 (re-verified by orchestrator pass):** Fresh structural metrics re-derived independently and cross-checked against this plan's claims; all headline numbers confirmed against live code:
>
> - [`ClineProvider.ts`](src/core/webview/ClineProvider.ts:1) = **4,417 lines** (largest file in `src/`, ~80 methods, ESLint complexity 24 violations; [`getStateToPostToWebview()`](src/core/webview/ClineProvider.ts:2203) c=115/284 lines).
> - [`webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:1) = **3,792 lines**, ESLint **complexity 669** on the 143-case switch — **worst in the repo**.
> - [`McpHub.ts`](src/services/mcp/McpHub.ts:1) = **1,995** ([`connectToServer()`](src/services/mcp/McpHub.ts:655) c=31/242 lines); [`bedrock.ts`](src/api/providers/bedrock.ts:1) = **1,647** ([`createMessage()`](src/api/providers/bedrock.ts:384) c=116/410 lines); [`Task.ts`](src/core/task/Task.ts:1) = **1,689** (decomposition confirmed).
> - The plan's ordering and findings hold. **New deltas added below — §3.1 (cleanup-now, verified actionable today) and §5.1 (open test gap on the delegation path) — these were NOT in the original plan.**
> - [`COGNITIVE_COMPLEXITY_ANALYSIS.md`](COGNITIVE_COMPLEXITY_ANALYSIS.md:1) reconfirmed **stale** (2026-05-03); its #1 finding (`Task.ts` 4,738 lines) is obsolete. Do not re-derive from it.

---

## 0. Status of prior analysis — read this first

Two analysis docs exist at the repo root. Their usefulness is uneven, and several of their recommendations are **already shipped**. This plan builds on what remains.

### [`COGNITIVE_COMPLEXITY_ANALYSIS.md`](COGNITIVE_COMPLEXITY_ANALYSIS.md) — partly stale, partly still valid

Generated 2026-05-03. Its top-3 "god-class triad" recommendation has been **partially executed**:

| File (analysis claim)                                                                    | Claimed lines | **Actual lines today**          | Status                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src/core/task/Task.ts`](src/core/task/Task.ts)                                         | 4,738         | **1,690**                       | ✅ Decomposed into 8 modules (see [`refactor-task-ts-overview.md`](ai_plans/refactor-task-ts-overview.md), marked COMPLETED May 2026). The 1,236-line [`recursivelyMakeClineRequests`](src/core/task/TaskApiLoop.ts:1) monster is now [`TaskApiLoop.ts`](src/core/task/TaskApiLoop.ts:1), [`TaskStreamProcessor.ts`](src/core/task/TaskStreamProcessor.ts:1), etc. |
| [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts) | 3,695         | **3,775** (143 `case` branches) | ❌ **Not done.** Grew slightly. Still a single function with a 143-case switch.                                                                                                                                                                                                                                                                                    |
| [`src/core/webview/ClineProvider.ts`](src/core/webview/ClineProvider.ts)                 | 3,599         | **4,415** (~80+ methods)        | ❌ **Not done — and grew +816 lines.** Now the single largest file in `src/`. Highest leverage.                                                                                                                                                                                                                                                                    |

Other items from that doc that are **already shipped** (verified by line count + the fix-stack logs):

- [`DiffViewProvider.ts`](src/integrations/editor/DiffViewProvider.ts): 1,046 → **672** (B27 split into [`DiffEditorLifecycleManager.ts`](src/integrations/editor/DiffEditorLifecycleManager.ts:1) + [`DiagnosticsCollector.ts`](src/integrations/editor/DiagnosticsCollector.ts:1)).
- `abortTask` 70-line method split into `prepareAbort()`/`drainAbort()`/`cleanupAbort()` (B28, see [`2026-07-12_tech-debt-refactor-stack.md`](ai_plans/2026-07-12_tech-debt-refactor-stack.md)).

**Conclusion:** the cognitive-complexity doc is a useful _historical_ map but its line counts and "priority" ordering are stale. This plan re-derives the current state and re-orders priorities around what is **actually unrefactored today**.

### [`MEMORY_SYSTEM_ANALYSIS.md`](MEMORY_SYSTEM_ANALYSIS.md) — out of scope

This is a 3,044-line spec for **porting Claude Code's file-based memory system** into Roo-Code. It is a feature-porting document, not a refactoring analysis. The memory system it describes has since been implemented under [`src/core/memory/`](src/core/memory/:1) (15 modules + tests). **Not used by this plan.** Memory-system bugs (MEM-1…MEM-7) were all fixed in the 2026-07-11 review stacks ([`2026-07-11_codebase-review-findings-register.md`](ai_plans/2026-07-11_codebase-review-findings-register.md)).

### Other `ai_plans/` docs consulted (to avoid re-recommending shipped work)

- [`2026-07-11_codebase-review-findings-register.md`](ai_plans/2026-07-11_codebase-review-findings-register.md) — 38 discrete findings, **all ✅ DONE** across fix stacks B1–B24.
- [`2026-07-12_tech-debt-refactor-stack.md`](ai_plans/2026-07-12_tech-debt-refactor-stack.md) — tech-debt refactors B25–B33, **all shipped** (B29 dropped after investigation).
- [`2026-07-13_efficiency-stack-review-findings.md`](ai_plans/2026-07-13_efficiency-stack-review-findings.md) — efficiency stack WS-0…WS-6 review; follow-ups I-2/I-4 are test gaps, not refactors.
- [`tool-registry-analysis.md`](ai_plans/tool-registry-analysis.md) — documents the tool registry; notes deferred-loading is **not** implemented in Roo. Relevant to the presentAssistantMessage Command pattern below.

---

## 1. Executive summary

- **The biggest remaining leverage is [`ClineProvider.ts`](src/core/webview/ClineProvider.ts:1) (4,415 lines, ~80 methods).** It grew _since_ the last analysis. It mixes webview lifecycle, task-stack management, cloud profile sync, state serialization, provider-profile CRUD, mode switching, task history, marketplace, and two large duplicated delegation flows ([`tryReattachDelegatedParent`](src/core/webview/ClineProvider.ts:4016) + [`reopenParentFromDelegation`](src/core/webview/ClineProvider.ts:4137)). This is the #1 target.
- **[`webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:545) (143-case switch) is the lowest-risk high-impact refactor.** Each `case` is already independent; splitting by domain into a `Map<WebviewMessageType, handler>` is mechanical and the existing per-domain test files ([`webviewMessageHandler.checkpoint.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.checkpoint.spec.ts:1), …`.edit`, …`.searchFiles`, …`.routerModels`) already partition the surface.
- **Two clear design-pattern wins with low over-engineering risk:** (a) the 29-case [`buildApiHandler`](src/api/index.ts:128) factory → a provider registry `Map`; (b) the tool-dispatch switch in [`presentAssistantMessage.ts`](src/core/assistant-message/presentAssistantMessage.ts:741) → a `Map<ToolName, Tool>` lookup with checkpoint-needing tools in a `Set`. Both replace long switches with a table.
- **Dead code is largely already harvested.** The repo runs [`knip.json`](knip.json:1) (configured for `src` + cross-workspace), and the 2026-06-27 knip pass ([`2026-06-27_zoo-225-knip-dead-code.md`](ai_plans/2026-06-27_zoo-225-knip-dead-code.md)) plus the review stacks removed the obvious dead exports (e.g. `quoteProblematicValue` — verified gone). Spot-checked candidates (`mergePromise`, `stripAllBOMs`, `indentation-reader`, `McpServerManager`) are all live. The honest recommendation is to **run `knip` as the systematic tool** rather than hand-grep; the inventory below flags only items needing a human eyeball (dynamic/message-passing consumers).
- **API provider files are large but lower priority for _structural_ refactoring** — the 2026-07-11/12 stacks already converged their robustness behavior (AP-1…AP-8). The remaining size is mostly payload/stream-serialization specifics per provider. Splitting `BedrockPayloadBuilder`/`BedrockStreamParser` out of [`bedrock.ts`](src/api/providers/bedrock.ts:1) (1,648 lines) is worthwhile but second-tier.

---

## 2. Findings by theme

### Theme A — God-class `ClineProvider` (highest leverage)

**Evidence:**

- [`src/core/webview/ClineProvider.ts`](src/core/webview/ClineProvider.ts:1): **4,415 lines**, ~80 methods. Responsibility clusters visible in the method list:
    - Cloud profile sync: [`initializeCloudProfileSync`](src/core/webview/ClineProvider.ts:423), [`syncCloudProfiles`](src/core/webview/ClineProvider.ts:453), [`initializeCloudProfileSyncWhenReady`](src/core/webview/ClineProvider.ts:491), `handleCloudSettingsUpdate` (~L423–508).
    - Task stack: [`addClineToStack`](src/core/webview/ClineProvider.ts:510), [`performPreparationTasks`](src/core/webview/ClineProvider.ts:527), [`removeClineFromStack`](src/core/webview/ClineProvider.ts:547), `getTaskStackSize`, `getCurrentTaskStack` (~L510–627).
    - Provider profiles: [`setProviderProfile`](src/core/webview/ClineProvider.ts:1547), `getProviderProfileEntries`, `getProviderProfileEntry`, `hasProviderProfileEntry`, `deleteProviderProfile`, [`activateProviderProfile`](src/core/webview/ClineProvider.ts:1693), `persistStickyProviderProfileToCurrentTask` (~L1575–1730).
    - Task history ops: [`getTaskWithId`](src/core/webview/ClineProvider.ts:1830), `getTaskWithAggregatedCosts`, `showTaskWithId`, `exportTaskWithId`, [`condenseTaskContext`](src/core/webview/ClineProvider.ts:1927), [`deleteTaskWithId`](src/core/webview/ClineProvider.ts:1955), `deleteTaskFromState` (~L1830–2045).
    - State serialization: [`getStateToPostToWebview`](src/core/webview/ClineProvider.ts:2203) (a single ~250-line method), `postStateToWebview` + 3 variants, `getState` (~L2046–2456).
    - Delegation flows: [`delegateParentAndOpenChild`](src/core/webview/ClineProvider.ts:3852), [`tryReattachDelegatedParent`](src/core/webview/ClineProvider.ts:4016), [`reopenParentFromDelegation`](src/core/webview/ClineProvider.ts:4137) (~L3852–4320). The latter two share near-identical parent-API-message scanning loops (both walk `parentApiMessages` backwards for a `new_task` `tool_use`, then forward for its `tool_result`).
    - Background-task management: `runOneSubtask`, `runWithConcurrency`, `awaitTaskCompletion` (~L3036–3450), plus `cleanupBackgroundTaskFiles`, `notifyBackgroundOutcome`, `resolveMemoryWriterApiConfiguration`.
    - Webview lifecycle: `resolveWebviewView`, `getHtmlContent`, `getHMRHtmlContent`, `setWebviewMessageListener` (~L878–1447).

**Why it hurts:** No human can hold 4,415 lines / 80 methods in working memory. Bug fixes land in the wrong cluster (the 2026-07-11 review found TE-4/TE-7 background-task leaks and cancel races precisely in this file). The duplicated delegation-scan logic in `tryReattachDelegatedParent` + `reopenParentFromDelegation` is a drift hazard — a fix to one must be remembered for the other.

**Proposed approach (composition, mirroring the proven Task.ts split):** Extract focused collaborator classes that receive a narrow interface (not the whole `ClineProvider`), exactly as [`refactor-task-ts-overview.md`](ai_plans/refactor-task-ts-overview.md:80) did for Task. `ClineProvider` keeps its public API and delegates.

| Extract into              | Methods to move                                                                                                                                                                                                            | Est. lines |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ProviderCloudSync`       | `initializeCloudProfileSync`, `syncCloudProfiles`, `initializeCloudProfileSyncWhenReady`, `handleCloudSettingsUpdate`                                                                                                      | ~120       |
| `ProviderTaskStack`       | `addClineToStack`, `performPreparationTasks`, `removeClineFromStack`, `getTaskStackSize`, `getCurrentTaskStack`, task-event-listener wiring                                                                                | ~200       |
| `ProviderProfiles`        | `setProviderProfile`, profile getters, `deleteProviderProfile`, `activateProviderProfile`, `persistStickyProviderProfileToCurrentTask`, `getApiConfigurationForMode`                                                       | ~250       |
| `ProviderTaskHistory`     | `getTaskWithId`, `getTaskWithAggregatedCosts`, `showTaskWithId`, `exportTaskWithId`, `condenseTaskContext`, `deleteTaskWithId`, `deleteTaskFromState`, `updateTaskHistory`, broadcast/flush write-through                  | ~300       |
| `ProviderState`           | `getStateToPostToWebview`, `getState`, the 3 `postStateToWebview*` variants, `getAppProperties`/`getCloudProperties`/`getTaskProperties`/`getGitProperties`/`getTelemetryProperties`                                       | ~450       |
| `ProviderDelegation`      | `delegateParentAndOpenChild`, `tryReattachDelegatedParent`, `reopenParentFromDelegation` — **with the duplicated parent-message scan extracted into one shared helper** (`findNewTaskToolUseAndResult(parentApiMessages)`) | ~350       |
| `ProviderBackgroundTasks` | `runOneSubtask`, `runWithConcurrency`, `awaitTaskCompletion`, `cleanupBackgroundTaskFiles`, `notifyBackgroundOutcome`, `resolveMemoryWriterApiConfiguration`, `runMemorySubTask`                                           | ~300       |
| `ProviderWebview`         | `resolveWebviewView`, `getHtmlContent`, `getHMRHtmlContent`, `setWebviewMessageListener`, `postMessageToWebview`, `convertToWebviewUri`                                                                                    | ~350       |

`ClineProvider` becomes a ~600-line coordinator: constructor wiring the collaborators, `dispose()`, the static instance getters, and the mode-switch entry point.

**Effort:** L · **Risk:** med-high (constructor changes; many cross-test mocks reference `McpServerManager` etc. — but the existing per-concern spec files like [`ClineProvider.cancelTask-abort-race.spec.ts`](src/core/webview/__tests__/ClineProvider.cancelTask-abort-race.spec.ts:1) already isolate behavior, so tests largely survive a delegation-only extraction). **Dependencies:** none — can start immediately; do `ProviderCloudSync` and `ProviderProfiles` first (fewest cross-deps), `ProviderState` and `ProviderDelegation` last (most entangled).

**Human-verifiable acceptance:** after each extraction, `cd src && npx vitest run core/webview/__tests__/` is green, `wc -l src/core/webview/ClineProvider.ts` shrinks, and `grep -n "this\." ClineProvider.ts` shows the coordinator only delegating, not implementing cluster logic.

---

### Theme B — 143-case `webviewMessageHandler` switch (lowest risk, high impact)

**Evidence:**

- [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:545): one [`switch (message.type)`](src/core/webview/webviewMessageHandler.ts:545) with **143 `case` branches** spanning ~3,200 lines. Domains already visible: settings (L666…), task CRUD (L626…), model fetching (L1004…L1226), file ops (L1227…L1310), MCP (L1452…L1600), checkpoints (L1311…L1339), marketplace (L2960…L3080), modes (L1645…L2393), skills (L3116…L3139), worktrees (L3503…L3717), cloud auth (L2427…L2586), code-index (L2587…L2954).
- The test suite is **already partitioned by domain**: [`webviewMessageHandler.checkpoint.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.checkpoint.spec.ts:1), [`…edit.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.edit.spec.ts:1), [`…searchFiles.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.searchFiles.spec.ts:1), [`…routerModels.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.routerModels.spec.ts:1), [`…readFileContent.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.readFileContent.spec.ts:1), [`…delete.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.delete.spec.ts:1), [`…lockApiConfig.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.lockApiConfig.spec.ts:1), [`…assignConfigToModes.spec.ts`](src/core/webview/__views/__tests__/webviewMessageHandler.assignConfigToModes.spec.ts:1). This is a free blueprint for the handler split.
- Some extraction already started: [`skillsMessageHandler.ts`](src/core/webview/skillsMessageHandler.ts:1), [`checkpointRestoreHandler.ts`](src/core/webview/checkpointRestoreHandler.ts:1), [`diagnosticsHandler.ts`](src/core/webview/diagnosticsHandler.ts:1), [`worktree/handlers.ts`](src/core/webview/worktree/handlers.ts:1), [`messageEnhancer.ts`](src/core/webview/messageEnhancer.ts:1). The pattern is established — extend it. (Note: in the test-file list above, the `assignConfigToModes` link had a typo `webviews/__views` — the correct path is [`src/core/webview/__tests__/webviewMessageHandler.assignConfigToModes.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.assignConfigToModes.spec.ts:1).)

**Why it hurts:** Adding any new webview message means editing a 3,200-line function and scrolling past 142 unrelated cases. Reviewers can't see the diff in context. The `switch` defeats IDE "go to handler" navigation.

**Proposed approach (Command/Registry, domain-split):**

1. Group the 143 cases into ~12 domain handlers, each a module exporting `(provider, message, ctx) => Promise<void>`:
   `settingsMessages`, `taskMessages`, `modelMessages`, `fileMessages`, `mcpMessages`, `checkpointMessages`, `marketplaceMessages`, `modeMessages`, `skillMessages`, `worktreeMessages`, `cloudAuthMessages`, `codeIndexMessages`, `historyMessages`, `commandMessages`.
2. Replace the switch with a `Map<WebviewMessageType, DomainHandler>` (or a `Record`). The top-level [`webviewMessageHandler`](src/core/webview/webviewMessageHandler.ts:100) becomes ~30 lines: build the lookup once, dispatch, handle the unknown-type default.
3. Move the shared closures (`getGlobalState`, `updateGlobalState`, `getCurrentCwd`, `getCurrentMode`) into a small `HandlerContext` object passed to each domain handler.

**Effort:** M (mechanical, but large surface) · **Risk:** low (each case is already independent; tests are pre-partitioned). **Dependencies:** none.

**Human-verifiable acceptance:** `cd src && npx vitest run core/webview/__tests__/webviewMessageHandler` green; `grep -c "case " webviewMessageHandler.ts` → 0; each new domain file < 400 lines; the dispatcher function < 50 lines.

---

### Theme C — Tool-dispatch switch in `presentAssistantMessage` (Command pattern)

**Evidence:**

- [`src/core/assistant-message/presentAssistantMessage.ts`](src/core/assistant-message/presentAssistantMessage.ts:741): a `switch (block.name)` where **every branch is near-identical** — it calls `<tool>.handle(cline, block, { askApproval, handleError, pushToolResult, toolCallId })`. The only variation is that write/edit tools are preceded by `await checkpointSaveAndMark(cline)`. See L742–824: `write_to_file`, `update_todo_list`, `apply_diff`, `edit`/`search_and_replace`, `search_replace`, `edit_file`, `apply_patch`, `read_file`, `list_files`, `codebase_search` — all the same shape.
- There is a second switch on `block.name` at [`presentAssistantMessage.ts:349`](src/core/assistant-message/presentAssistantMessage.ts:349) (`toolDescription`) that maps tool name → human-readable label — also a lookup table in disguise.

**Why it hurts:** The switch is long, repetitive, and the `as ToolUse<"name">` casts are scattered. Adding a tool means editing two switches and remembering which tools need checkpoint-save. The checkpoint-needing set is implicit (sprinkled `await checkpointSaveAndMark` calls), not declared.

**Proposed approach (Command + declarative checkpoint set):**

- Build a `Map<ToolName, BaseTool>` (the tools are already singletons imported at top of file). Dispatch becomes:
    ```ts
    const tool = TOOL_REGISTRY.get(block.name)
    if (!tool) {
    	/* unknown-tool fallback */
    }
    if (CHECKPOINT_TOOLS.has(block.name)) await checkpointSaveAndMark(cline)
    await tool.handle(cline, block, { askApproval, handleError, pushToolResult, toolCallId })
    ```
- `CHECKPOINT_TOOLS` is a `Set<ToolName>` declared once: `write_to_file`, `apply_diff`, `edit`, `search_and_replace`, `search_replace`, `edit_file`, `apply_patch`.
- Replace the `toolDescription` switch (L349) with a `Record<ToolName, string>` or a method on the tool.
- If the `as ToolUse<"name">` cast is unsafe, the tool's `handle` should accept `ToolUse` generically and narrow internally (some tools already coerce — TL-3 fix). This is optional polish.

**Effort:** S · **Risk:** low (behavior-preserving; the existing [`presentAssistantMessage-*.spec.ts`](src/core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts:1) cover the branches). **Dependencies:** none. Note: this overlaps conceptually with the deferred-loading idea in [`tool-registry-analysis.md`](ai_plans/tool-registry-analysis.md:253) but does **not** require it — it's a pure local cleanup.

**Human-verifiable acceptance:** tests green; `grep -c "case " presentAssistantMessage.ts` drops by ~15; the dispatch block is < 15 lines; `CHECKPOINT_TOOLS` is a single visible `Set`.

---

### Theme D — `buildApiHandler` 29-case factory (Registry pattern)

**Evidence:**

- [`src/api/index.ts`](src/api/index.ts:128): [`buildApiHandler`](src/api/index.ts:119) is a 29-case `switch (apiProvider)` returning `new <Provider>Handler(options)`. Each branch is one line. The `vertex` case has a small branch (`apiModelId?.startsWith("claude")` → `AnthropicVertexHandler` else `VertexHandler`).
- A parallel switch exists in [`src/api/providers/fetchers/modelCache.ts`](src/api/providers/fetchers/modelCache.ts:65) for model fetching — same provider list, different action.
- [`src/api/providers/index.ts`](src/api/providers/index.ts:1) already re-exports all 29 handler classes.

**Why it hurts:** Adding a provider means editing the switch + the model-fetch switch + keeping them in sync. The retired-provider guard ([`isRetiredProvider`](src/api/index.ts:122)) sits above the switch; the mapping from name→class is not declarative.

**Proposed approach (Registry map):**

```ts
const PROVIDER_REGISTRY: Record<string, (opts) => ApiHandler> = {
  anthropic: (o) => new AnthropicHandler(o),
  openrouter: (o) => new OpenRouterHandler(o),
  // …
  vertex: (o) => o.apiModelId?.startsWith("claude")
    ? new AnthropicVertexHandler(o) : new VertexHandler(o),
}
export function buildApiHandler(cfg: ProviderSettings): ApiHandler {
  if (cfg.apiProvider && isRetiredProvider(cfg.apiProvider)) throw new Error(...)
  const factory = PROVIDER_REGISTRY[cfg.apiProvider]
  if (!factory) throw new Error(`Unknown provider: ${cfg.apiProvider}`)
  return factory({ ...cfg })
}
```

- Optionally extract a parallel `MODEL_FETCHER_REGISTRY` for [`modelCache.ts`](src/api/providers/fetchers/modelCache.ts:65).

**Effort:** S · **Risk:** low (pure mechanical; [`api/__tests__`](src/api/providers/__tests__/) and the provider specs cover dispatch). **Dependencies:** none.

**Human-verifiable acceptance:** `npx vitest run api` green; `buildApiHandler` body < 10 lines; the registry is a single visible `Record`; `grep -c "case " src/api/index.ts` → 0.

---

### Theme E — `NativeToolCallParser` size + the deferred static-state race

**Evidence:**

- [`src/core/assistant-message/NativeToolCallParser.ts`](src/core/assistant-message/NativeToolCallParser.ts:1): **1,151 lines**, a streaming tool-call parser with partial-JSON accumulation. The 2026-07-11 review flagged **TL-1** (high): `streamingToolCalls` and `rawChunkTracker` are `static` Maps shared process-wide, so concurrent tasks (`run_parallel_tasks`) wipe each other's mid-stream state. TL-1 was the **single most structurally invasive deferred item** and is still open (the register marks it ⏳ in the body though the summary table says done — verify; the static Maps are still `static` per the import structure).
- TE-5 (first chunk without `id` dropped) and TE-8 (orphaned `tool_call_end`) are parser correctness items from the same register — TE-5/TE-8 are marked ✅ DONE, but the _structural_ fix (move Maps to per-task instance state) was deferred as too invasive for a one-session fix.

**Why it hurts:** Beyond size, the static state is a **correctness landmine for parallel subtasks**, which is now a shipped feature ([`2026-06-27_parallel-subagents-worktrees.md`](ai_plans/2026-06-27_parallel-subagents-worktrees.md:1), [`2026-07-12_parallel-subtask-minimum-two.md`](ai_plans/2026-07-12_parallel-subtask-minimum-two.md:1)). A weak model on one task can silently corrupt another task's tool-call assembly.

**Proposed approach:** Convert `NativeToolCallParser` from static Maps to **instance state**, threaded through [`TaskStreamProcessor`](src/core/task/TaskStreamProcessor.ts:1) (one parser per Task). Formalize the streaming state machine (the partial-JSON accumulation + `tracked`/`activeToolCallIds` lifecycle) as explicit states if it helps readability, but the **load-bearing change is instance-vs-static**. Add a regression test: two parser instances; start a tool call on A; call `clear()` (simulating B); send A's next chunk; assert not lost.

**Effort:** M (touches [`TaskStreamProcessor`](src/core/task/TaskStreamProcessor.ts:1), [`base-openai-compatible-provider`](src/api/providers/base-openai-compatible-provider.ts:1) and the raw-SDK family that call `processStreamingChunk`/`processRawChunk`/`finalizeStreamingToolCall`/`processFinishReason`) · **Risk:** med (wide call site surface; but each call site already passes a context). **Dependencies:** none, but do **before** relying further on parallel subagents.

**Human-verifiable acceptance:** `grep -n "static " NativeToolCallParser.ts` → only constants, no mutable Maps; new two-instance spec green; full `src` vitest sweep green.

---

### Theme F — `McpHub` 1,996-line service

**Evidence:**

- [`src/services/mcp/McpHub.ts`](src/services/mcp/McpHub.ts:1): **1,996 lines**, 50 methods. Mixes server lifecycle (connect/disconnect/restart/dispose), config-file management (read/write/watch), tool/resource fetching + toggling, connection-state tracking, file watching, and webview notifications. [`McpServerManager.ts`](src/services/mcp/McpServerManager.ts:1) already exists as a thin singleton wrapper — the split is half-done.

**Why it hurts:** Same god-object pattern as the others; MCP is a frequent source of bugs in the fork (local-server focus).

**Proposed approach:** Extract `McpConnectionManager` (connect/disconnect/restart/error-handling per connection), `McpConfigManager` (config file read/write/watch + project MCP file), `McpToolManager` (tool list fetch/toggle/always-allow). `McpHub` keeps its public API (ClineProvider depends on it) and delegates.

**Effort:** M · **Risk:** med (file-watching + debounce lifecycle is timing-sensitive; [`McpHub.spec.ts`](src/services/mcp/__tests__/McpHub.spec.ts:1) exists). **Dependencies:** none.

**Human-verifiable acceptance:** `McpHub.spec.ts` green; `McpHub.ts` < 700 lines; no extracted module > 600 lines.

---

### Theme G — Large API provider files (second tier)

**Evidence (current sizes):** [`bedrock.ts`](src/api/providers/bedrock.ts:1) 1,648 · [`openai-native.ts`](src/api/providers/openai-native.ts:1) 1,587 · [`openai-codex.ts`](src/api/providers/openai-codex.ts:1) 1,262. Each mixes payload construction, stream parsing, error handling, and model-specific logic.

**Why it hurts:** Lower priority than A–F because the 2026-07-11/12 stacks already converged the _robustness_ behavior (AP-1 abort propagation, AP-2/AP-6 finish-reason finalization, AP-4/AP-7 usage/condense, AP-8 O3 reasoning). What remains is _size-driven_ comprehension cost, not active bugs. The shared delta→ApiStream helper was already extracted in B31 ([`2026-07-12_tech-debt-refactor-stack.md`](ai_plans/2026-07-12_tech-debt-refactor-stack.md:61)).

**Proposed approach (only if capacity allows):** Extract `BedrockPayloadBuilder` + `BedrockStreamParser` from `bedrock.ts`; `ResponsesApiHandler` + `ChatCompletionsHandler` from `openai-native.ts`; `CodexPayloadBuilder` + `CodexStreamParser` from `openai-codex.ts`. **Do NOT attempt the full three-impl streaming unification** — explicitly deferred in B31 as high regression risk.

**Effort:** M per file · **Risk:** med (stream parsing is subtle; each has a spec). **Dependencies:** none, but lowest priority.

**Human-verifiable acceptance:** per-file spec green; each provider file < 900 lines; extracted parser is independently testable.

---

### Theme H — `presentAssistantMessage` + `CustomModesManager` + `ProviderSettingsManager` size (cleanup tier)

- [`presentAssistantMessage.ts`](src/core/assistant-message/presentAssistantMessage.ts:1): 1,124 lines — partly addressed by Theme C; the remaining size is the `say`/`ask` presentation switches which can split by message type.
- [`CustomModesManager.ts`](src/core/config/CustomModesManager.ts:1): 1,016 lines — separate file I/O from mode-management logic; the import/export block is large.
- [`ProviderSettingsManager.ts`](src/core/config/ProviderSettingsManager.ts:1): 914 lines — config CRUD + file I/O + secret handling; could split secret vs non-secret paths.

**Effort:** S–M each · **Risk:** low (each has a spec). **Dependencies:** Theme C first for `presentAssistantMessage`.

---

## 3. Dead / unused code inventory

**Methodology note:** The repo runs [`knip.json`](knip.json:1) (workspaces `src` + `webview-ui` + packages; `ignoreExportsUsedInFile: true`; rules `exports/types/nsExports: warn`). A knip pass was already run ([`2026-06-27_zoo-225-knip-dead-code.md`](ai_plans/2026-06-27_zoo-225-knip-dead-code.md:1)) and the review stacks removed confirmed dead code (e.g. `quoteProblematicValue` — grep-verified gone today). Hand-grepping for dead exports across a 1,690-file `src/` is unreliable versus just running knip, so the table below lists only items that need a **human eyeball** (dynamic/message-passing consumers that knip can't see), not a re-run of knip.

| File                                                                                       | Symbol                                                                                                                                                               | Kind                             | Evidence of no usage                                                                                                                                                                                                                                                                                                                           | Recommendation                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/api/providers/fake-ai.ts`](src/api/providers/fake-ai.ts:1)                           | [`FakeAIHandler`](src/api/providers/fake-ai.ts:43), `FakeAI`                                                                                                         | export (prod-wired)              | Used **only** in [`src/api/index.ts:165`](src/api/index.ts:165) dispatch + [`ProfileValidator`](src/shared/ProfileValidator.ts:82) + [`checkExistApiConfig`](src/shared/checkExistApiConfig.ts:9). No real user selects `fake-ai`; it's a test stub living in production provider code.                                                        | **needs-human-verify** — confirm whether `fake-ai` should move behind a test-only build gate or stay as an intentional in-prod fake. Not dead, but arguably misplaced. |
| [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:1) | `openDebugApiHistory` / `openDebugUiHistory` shared case (L3427)                                                                                                     | case branch                      | Both cases fall through to one body; verify both message types are still emitted by the webview.                                                                                                                                                                                                                                               | **needs-human-verify** — grep `webview-ui/` for `openDebugApiHistory`/`openDebugUiHistory` post message emission.                                                      |
| [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:1) | `clearCloudAuthSkipModel` (L2548)                                                                                                                                    | case branch                      | Cloud-auth flow; verify webview still sends it after the 2026-07-12 cloud-degradation work.                                                                                                                                                                                                                                                    | **needs-human-verify** — grep webview for the message type.                                                                                                            |
| [`src/core/webview/ClineProvider.ts`](src/core/webview/ClineProvider.ts:1)                 | [`getRecentTasks`](src/core/webview/ClineProvider.ts:2982)                                                                                                           | public method                    | Public API surface; verify webview or `extension/api.ts` consumer.                                                                                                                                                                                                                                                                             | **needs-human-verify** — grep `getRecentTasks` across webview-ui + apps.                                                                                               |
| [`src/core/webview/ClineProvider.ts`](src/core/webview/ClineProvider.ts:1)                 | [`postStateToWebviewWithoutClineMessages`](src/core/webview/ClineProvider.ts:2091), [`postStateToWebviewWithoutTaskHistory`](src/core/webview/ClineProvider.ts:2067) | public methods                   | Three near-identical `postStateToWebview*` variants — verify both "Without" variants still have callers (one may be superseded).                                                                                                                                                                                                               | **needs-human-verify** — grep callers; if one is unused, remove.                                                                                                       |
| [`src/core/memory/relevance.ts`](src/core/memory/relevance.ts:1)                           | dead branch noted in MEM tech-debt                                                                                                                                   | code branch                      | The register noted `if (signal.aborted) return []; return []` — identical branches. MEM-5's companion (ranker logging) shipped as B15; verify this specific dead branch was also cleaned.                                                                                                                                                      | **needs-human-verify** — read [`relevance.ts`](src/core/memory/relevance.ts:1) around the catch block.                                                                 |
| [`src/api/providers/router-provider.ts`](src/api/providers/router-provider.ts:1)           | [`RouterProvider`](src/api/providers/router-provider.ts:22)                                                                                                          | abstract class                   | Live — extended by `LiteLLMHandler`, `VercelAiGatewayHandler` (grep-confirmed). The 2026-05-26 plan [`2026-05-26_22-35_remove-roo-router-provider.md`](ai_plans/2026-05-26_22-35_remove-roo-router-provider.md:1) referenced a _different_ "Roo router" provider; this `RouterProvider` base is **not** that.                                  | **keep** — do not confuse with the removed Roo router.                                                                                                                 |
| `src/shared/getApiMetrics.ts` re-export                                                    | [`getApiMetrics`](src/shared/getApiMetrics.ts:1), [`hasTokenUsageChanged`](src/shared/getApiMetrics.ts:4), [`hasToolUsageChanged`](src/shared/getApiMetrics.ts:5)    | re-exports from `@roo-code/core` | Live in [`TaskTokenTracking`](src/core/task/TaskTokenTracking.ts:14), [`AutoApprovalHandler`](src/core/auto-approval/AutoApprovalHandler.ts:3), [`checkpoints`](src/core/checkpoints/index.ts:13), [`taskMetadata`](src/core/task-persistence/taskMetadata.ts:8), [`getEnvironmentDetails`](src/core/environment/getEnvironmentDetails.ts:12). | **keep** — but note the `src/shared/` shim duplicates the `@roo-code/core` export; consider importing from core directly in new code.                                  |

**Systematic recommendation:** before any manual removal, run `npx knip` from the repo root with the existing [`knip.json`](knip.json:1). It cross-checks all workspaces (src ↔ webview-ui ↔ packages) for unused exports, types, and files — far more reliable than hand-grep for a codebase this size. Treat its `exports`/`types` warnings as the authoritative dead-code list; use the table above only for the dynamic-consumption cases knip can't detect.

### 3.1 Cleanup-now deltas — verified actionable today (added 2026-07-15)

These were **not** in the original plan. Each was independently verified during the 2026-07-15 orchestrator re-verification pass. They are low-risk and can be done as small standalone PRs **before** the larger structural refactors — they shrink the surface and reduce noise.

| #   | Item                                                                                                                                                                | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                | Action                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Overdue migration removal**                                                                                                                                       | [`migrateSettings.ts:14`](src/utils/migrateSettings.ts:14)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Comment says "Remove this migration code in September 2025 (6 months after implementation)." It is July 2026 — **~10 months overdue.** Handles `cline_custom_modes.json`/`cline_mcp_settings.json` → yaml/json renames. | Delete the migration fn + its call site. ⚠️ run `cd src && npx vitest run utils/migrateSettings` after; confirm no user on pre-2025 settings remains a concern (the renames are old enough). |
| 2   | **6 `@deprecated` exports** (replacements already named in each annotation)                                                                                         | [`minimax-format.ts:105`](src/api/transform/minimax-format.ts:105) (`mergeEnvironmentDetailsForMiniMax`), [`openai-error-handler.ts:5`](src/api/providers/utils/openai-error-handler.ts:5) (`handleProviderError`), [`skills.ts:11`](src/shared/skills.ts:11) (`modeSlugs`), [`custom-instructions.ts:352`](src/core/prompts/sections/custom-instructions.ts:352) (`loadAllAgentRulesFiles`), [`ClineProvider.ts:2797`](src/core/webview/ClineProvider.ts:2797) & [`:2802`](src/core/webview/ClineProvider.ts:2802) (`ContextProxy#setValue`/`getValue`)                           | Each `@deprecated` names its replacement.                                                                                                                                                                               | Remove the deprecated symbol + re-point remaining callers to the named replacement. Verify with grep that no caller remains, then delete.                                                    |
| 3   | **Unexport test-only types** (referenced only in their own `__tests__`, safe to make non-exported — verify with knip first, grep can false-positive on short names) | `ConnectedMcpConnection`, `DisableReason`, `DisconnectedMcpConnection`, `McpConnection`, `ServerConfigSchema` in [`McpHub.ts`](src/services/mcp/McpHub.ts:1); `TaskOptions` in [`Task.ts`](src/core/task/Task.ts:1); `StreamEvent` in [`bedrock.ts`](src/api/providers/bedrock.ts:1); [`raceNextChunkWithAbort`](src/core/task/TaskApiLoop.ts:1); `UsageType` in [`bedrock.ts`](src/api/providers/bedrock.ts:1); `OpenAiNativeModel` in [`openai-native.ts`](src/api/providers/openai-native.ts:1); `OpenAiCodexModel` in [`openai-codex.ts`](src/api/providers/openai-codex.ts:1) | Each has only in-file/test references.                                                                                                                                                                                  | Drop the `export` keyword (or delete if truly unused). knip's `types`/`exports` warnings are the authoritative check before acting.                                                          |
| 4   | **`ClineProviderEvents` — strong delete candidate**                                                                                                                 | [`ClineProvider.ts`](src/core/webview/ClineProvider.ts:1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exported with **zero external references** (verified by whole-repo grep).                                                                                                                                               | Delete; if something dynamic consumes it, knip/the compiler will surface it.                                                                                                                 |

> **Order:** do #1 and #4 first (clear-cut deletes), then #2 (one annotation at a time), then #3 (knip-confirmed). Each is a one-file PR with a vitest run as the gate.

---

## 4. Design pattern opportunities

### 4.1 Command + declarative checkpoint set — `presentAssistantMessage` (Theme C)

**Where:** [`src/core/assistant-message/presentAssistantMessage.ts:741`](src/core/assistant-message/presentAssistantMessage.ts:741)

**Before:**

```ts
switch (block.name) {
	case "write_to_file":
		await checkpointSaveAndMark(cline)
		await writeToFileTool.handle(cline, block as ToolUse<"write_to_file">, {
			askApproval,
			handleError,
			pushToolResult,
			toolCallId,
		})
		break
	case "read_file":
		await readFileTool.handle(cline, block as ToolUse<"read_file">, {
			askApproval,
			handleError,
			pushToolResult,
			toolCallId,
		})
		break
	// … 13 more near-identical cases
}
```

**After:**

```ts
const CHECKPOINT_TOOLS = new Set<ToolName>([
	"write_to_file",
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
])

const tool = TOOL_REGISTRY.get(block.name)
if (!tool) {
	/* unknown-tool error result */ return
}
if (CHECKPOINT_TOOLS.has(block.name)) await checkpointSaveAndMark(cline)
await tool.handle(cline, block, { askApproval, handleError, pushToolResult, toolCallId })
```

**Why it's not over-engineering:** the tools already exist as singletons and already implement `.handle()` with the same signature. The switch is _already_ a dispatch table — this just makes it literal. The checkpoint set makes an implicit rule explicit.

### 4.2 Registry/Factory — `buildApiHandler` (Theme D)

**Where:** [`src/api/index.ts:128`](src/api/index.ts:128)

**Before:** 29-case `switch` returning `new XHandler(options)`.

**After:** a `Record<string, (o) => ApiHandler>` lookup (sketch in Theme D). The `vertex` branch's `startsWith("claude")` decision stays inline in its factory lambda.

**Why it's not over-engineering:** removes a 60-line switch with a 30-line declarative table; the retired-provider guard stays as a pre-check. Pair with a parallel `MODEL_FETCHER_REGISTRY` to kill the duplicated switch in [`modelCache.ts:65`](src/api/providers/fetchers/modelCache.ts:65).

### 4.3 Command/Registry — `webviewMessageHandler` (Theme B)

**Where:** [`src/core/webview/webviewMessageHandler.ts:545`](src/core/webview/webviewMessageHandler.ts:545)

**Before:** one 143-case switch.

**After:** `Map<WebviewMessageType, DomainHandler>` + ~12 domain-handler modules. Same shape as 4.2 but larger. The existing per-domain test files are the proof that the domains are already cleanly separable.

### 4.4 Strategy — streaming finalization (already partially in place)

**Where:** the `processFinishReason` / `finalizeStream` pattern referenced across [`base-openai-compatible-provider`](src/api/providers/base-openai-compatible-provider.ts:1), [`lm-studio`](src/api/providers/lm-studio.ts:1), [`deepseek`](src/api/providers/deepseek.ts:1). B31 extracted shared delta helpers. The remaining divergence (raw-SDK vs Vercel-AI-SDK vs `openai.ts` O3) is **explicitly deferred** (B31 note) — do not force-unify; it's high regression risk.

### 4.5 State — `NativeToolCallParser` streaming (Theme E)

**Where:** [`NativeToolCallParser.ts`](src/core/assistant-message/NativeToolCallParser.ts:1). The partial-JSON accumulation + `tracked`/`activeToolCallIds` lifecycle is an implicit state machine. Formalizing it as named states (`Idle → AwaitingId → AccumulatingArgs → Finalized`) would aid readability, but the **load-bearing change is instance-vs-static** (Theme E), not the state names. Only formalize states if it helps the instance conversion; don't add a state-machine framework for its own sake.

---

## 5. Prioritized roadmap

Ordered by (leverage × confidence) / risk. Each step is executable by a human with a code editor + grep + `npx vitest`. **No step depends on AI.**

> **⚠️ §5.1 — Open test gap to close first (added 2026-07-15, from [`2026-07-13_efficiency-stack-review-findings.md`](ai_plans/2026-07-13_efficiency-stack-review-findings.md:1) finding I-4):** the delegation → parent-return path via [`reopenParentFromDelegation()`](src/core/assistant-message/presentAssistantMessage.ts:203) (the path Step 4 / Theme A touches when collapsing the duplicated delegation scans) is **untested at any layer** — [`TaskApiLoop.text-completion-fallback.spec.ts`](src/core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts:1) mocks `attemptCompletionTool` entirely, so the delegation → parent-return integration is never exercised. **Add a subtask e2e or integration test before relying on the delegation path in production, and before the Step 4 delegation-helper extraction.** This is the riskiest least-tested path in the codebase. Not a refactor itself, but a prerequisite gate for Step 4's delegation work.

### Step 1 — `webviewMessageHandler` domain split (Theme B)

- **Scope:** split the 143-case switch into ~12 domain-handler modules behind a `Map` dispatcher.
- **Dependencies:** none.
- **Effort:** M · **Risk:** low.
- **Acceptance (human-verifiable):** `cd src && npx vitest run core/webview/__tests__/webviewMessageHandler` green; `grep -c "case " src/core/webview/webviewMessageHandler.ts` → 0; dispatcher function < 50 lines; each domain file < 400 lines; `wc -l` on the main file < 200.

### Step 2 — `buildApiHandler` registry (Theme D)

- **Scope:** replace the 29-case switch with a `Record` registry; optional parallel `MODEL_FETCHER_REGISTRY`.
- **Dependencies:** none.
- **Effort:** S · **Risk:** low.
- **Acceptance:** `cd src && npx vitest run api` green; `buildApiHandler` body < 10 lines; `grep -c "case " src/api/index.ts` → 0.

### Step 3 — `presentAssistantMessage` Command dispatch (Theme C)

- **Scope:** `Map<ToolName, Tool>` + `CHECKPOINT_TOOLS` set; collapse the `toolDescription` switch to a record.
- **Dependencies:** none (independent of Step 1).
- **Effort:** S · **Risk:** low.
- **Acceptance:** `cd src && npx vitest run core/assistant-message/__tests__/` green; dispatch block < 15 lines; `CHECKPOINT_TOOLS` is one visible `Set`; `grep -c "case " presentAssistantMessage.ts` drops by ≥ 15.

### Step 4 — `ClineProvider` decomposition (Theme A) — **the big one**

- **Scope:** extract 8 collaborator classes (`ProviderCloudSync`, `ProviderTaskStack`, `ProviderProfiles`, `ProviderTaskHistory`, `ProviderState`, `ProviderDelegation`, `ProviderBackgroundTasks`, `ProviderWebview`) using the narrow-interface composition pattern proven on Task.ts.
- **Sub-step order (safest first):**
    1. `ProviderCloudSync` (fewest deps)
    2. `ProviderProfiles`
    3. `ProviderTaskStack`
    4. `ProviderTaskHistory`
    5. `ProviderBackgroundTasks`
    6. `ProviderWebview`
    7. `ProviderState` (most entangled — `getStateToPostToWebview` reads everything)
    8. `ProviderDelegation` — **and extract the shared `findNewTaskToolUseAndResult(parentApiMessages)` helper** used by both `tryReattachDelegatedParent` and `reopenParentFromDelegation`.
- **Dependencies:** none, but do **after** Steps 1–3 so the codebase is calmer.
- **Effort:** L · **Risk:** med-high.
- **Acceptance:** after each sub-step `cd src && npx vitest run core/webview/__tests__/` green; `wc -l src/core/webview/ClineProvider.ts` monotonically decreasing; final < 800 lines; `ProviderDelegation` contains the shared helper and both methods call it; no duplicated parent-message scan loop remains (`grep -n "new_task" ClineProvider.ts` shows hits only in the helper).

### Step 5 — `NativeToolCallParser` instance state (Theme E)

- **Scope:** move `streamingToolCalls`/`rawChunkTracker` from `static` to instance state threaded through `TaskStreamProcessor`; add the two-instance regression test.
- **Dependencies:** none, but **gates further reliance on parallel subagents**.
- **Effort:** M · **Risk:** med.
- **Acceptance:** `grep -n "static " src/core/assistant-message/NativeToolCallParser.ts` shows no mutable Maps; new two-instance spec green; `cd src && npx vitest run` full sweep green.

### Step 6 — `McpHub` split (Theme F)

- **Scope:** extract `McpConnectionManager`/`McpConfigManager`/`McpToolManager`.
- **Dependencies:** none.
- **Effort:** M · **Risk:** med.
- **Acceptance:** `cd src && npx vitest run services/mcp` green; `McpHub.ts` < 700 lines.

### Step 7 — Dead-code harvest via knip + the inventory above

- **Scope:** run `npx knip`; triage its `exports`/`types` warnings; resolve the 6 "needs-human-verify" rows in §3.
- **Dependencies:** ideally **after** Steps 1–6 (refactors can expose newly-dead exports; doing knip first then again after is fine).
- **Effort:** S · **Risk:** low (knip is conservative; each removal is one grep away from confirming).
- **Acceptance:** `npx knip` exits clean (or every remaining warning has a documented reason); the §3 rows are each resolved to remove/keep with a one-line rationale in the PR.

### Step 8 (second tier, only if capacity allows) — API provider splits (Theme G) + Theme H cleanups

- **Scope:** `BedrockPayloadBuilder`/`BedrockStreamParser`, etc.; `CustomModesManager` I/O split; `ProviderSettingsManager` secret-path split.
- **Dependencies:** none.
- **Effort:** M per file · **Risk:** med.
- **Acceptance:** per-file spec green; each provider file < 900 lines.

---

## 6. Explicit non-goals

- **`webview-ui/`, `packages/`, `apps/`, `self-hosted-cloudapi/`** — out of scope; covered by separate plans ([`refactor-webview-ui.md`](ai_plans/refactor-webview-ui:1), [`refactor-packages.md`](ai_plans/refactor-packages.md:1), [`refactor-backend-src.md`](ai_plans/refactor-backend-src.md:1)). Cross-package grep is used only to verify `src/` symbol consumption.
- **The memory-system port** ([`MEMORY_SYSTEM_ANALYSIS.md`](MEMORY_SYSTEM_ANALYSIS.md:1)) — already implemented in [`src/core/memory/`](src/core/memory/:1); its bugs (MEM-1…7) are fixed. Not re-analyzed.
- **Already-shipped refactors** — Task.ts decomposition, DiffViewProvider split, abortTask split, B25–B33 tech-debt stack, and all 38 review-findings (TE/MEM/TL/AP/CB) are **not re-recommended**. This plan explicitly skips them.
- **Full streaming-impl unification** (raw-SDK vs Vercel-AI-SDK vs `openai.ts` O3) — explicitly deferred in B31 as high regression risk; only the shared delta helper (already shipped) is in scope. Do not force a single streaming impl.
- **Deferred tool-loading / ToolSearch port** ([`tool-registry-analysis.md`](ai_plans/tool-registry-analysis.md:253)) — a feature, not a readability refactor. The Command-pattern cleanup in Theme C is independent of it.
- **Behavior changes** — every step above is behavior-preserving unless explicitly noted (Theme E's instance-state change is the only one with a behavior implication: it _fixes_ a latent race; add a failing-test-first TDD per [`AGENTS.md`](AGENTS.md:1) for that one).
- **Level-of-effort time estimates** — per workspace rules, none given; effort is S/M/L only.
- **Renaming the `Cline`/`cline` legacy identifiers** — pervasive but cosmetic; out of scope for a maintainability-focused plan (it's a separate, mechanical sweep that would touch every test mock).

---

## 7. How a human executes this without AI

1. Pick a step from §5. Read its theme in §2 for the method list / line refs.
2. For extraction steps (1, 4, 6): create the new file, copy methods verbatim, replace `this.x` → `this.access.x` (or `ctx.x`), wire the collaborator in the constructor, leave delegation stubs on the original class. Run the cited vitest command after **each** method moved, not at the end.
3. For registry steps (2, 3): build the `Map`/`Record`/`Set`, replace the switch, delete the cases. Run tests.
4. For dead-code (7): run `npx knip`, grep each warning across `src/` + `webview-ui/` + `packages/` before removing; only remove with zero non-test references (or mark needs-human-verify if dynamic access is possible).
5. Every acceptance criterion in §5 is checkable with `wc -l`, `grep -c`, and `npx vitest run <path>` — no AI needed to confirm done.
6. Stack one branch per step (per [`2026-07-12_tech-debt-refactor-stack.md`](ai_plans/2026-07-12_tech-debt-refactor-stack.md:1) discipline); nothing merged without the user's say-so.
