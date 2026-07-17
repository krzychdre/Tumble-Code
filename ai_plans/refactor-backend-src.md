# Refactor Opportunities — `src/` Backend

> **Scope:** `src/` tree of the Roo Code VS Code extension.
> **Goal:** low cognitive complexity, human-maintainable, elegant, extensible, shrinking number of change-points (open-closed wins).
> **Method:** every claim grounded in live code (file:line). Built on — and explicitly correcting — the two pre-existing analysis docs at repo root.

> **✅ Verification stamp — 2026-07-15 (re-verified by orchestrator pass):** Fresh structural metrics re-derived independently; the ranked refactor points below are reconfirmed against live code. This doc and [`2026-07-14_src-refactor-plan.md`](ai_plans/2026-07-14_src-refactor-plan.md:1) are complementary — this one leads with **open-closed / change-point** leverage (the dimension the cognitive doc never covered), the other with **per-file complexity reduction**. Reconciled execution order: #3 → (#1 + #5) → #2 → #4 → (#6, #8, #7). Both docs agree on this. New §5 below adds cleanup-now deltas and a test-gap gate that were **not** in the original ranking.

---

## 0. Relationship to the existing analysis docs

### `COGNITIVE_COMPLEXITY_ANALYSIS.md` (dated 2026-05-03) — **partially stale**

It is a line-count / branch-density survey only. It **misses the dimension this task cares about most**: the _number of files you must touch to add a feature_ (open-closed / change-points), and it **never analyzes the tool registry/dispatch seam or the provider-addition seam** — the two highest-leverage areas.

Concrete staleness (verified against current checkout):

| Doc claim                                                            | Current reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/task/Task.ts` = 4,738-line god class, refactor priority #1 | **Already refactored.** Task.ts is now **1,542 lines** and delegates to 9+ composed modules: [`TaskLifecycle`](src/core/task/TaskLifecycle.ts:127), [`TaskApiLoop`](src/core/task/TaskApiLoop.ts:209), [`TaskContextManager`](src/core/task/TaskContextManager.ts:175), [`TaskHistory`](src/core/task/TaskHistory.ts:98), [`TaskResumption`](src/core/task/TaskResumption.ts:61), [`TaskSubtasks`](src/core/task/TaskSubtasks.ts:54), [`TaskTokenTracking`](src/core/task/TaskTokenTracking.ts:59), [`TaskStreamProcessor`](src/core/task/TaskStreamProcessor.ts:87), [`TaskAskSay`](src/core/task/TaskAskSay.ts:66). Task is a thin coordinator with one-line delegators (`return this.apiLoop.recursivelyMakeClineRequests(...)`). | [`Task.ts:1244`](src/core/task/Task.ts:1244), [`Task.ts:1319`](src/core/task/Task.ts:1319), [`Task.ts:1353`](src/core/task/Task.ts:1353)                                         |
| `webviewMessageHandler.ts` = 3,695 lines, 149-case switch            | **Still monolithic.** Now **3,765 lines**, still a single `switch (message.type)` at [`webviewMessageHandler.ts:545`](src/core/webview/webviewMessageHandler.ts:545). Accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | verified                                                                                                                                                                         |
| `ClineProvider.ts` = 3,599-line god class, refactor priority #3      | **Still a god class** (~4,250 lines by the method listing, 77+ methods spanning webview lifecycle, task stack, cloud sync, state serialization, profile CRUD, mode switching, marketplace, history, background tasks, delegation repair). The COGNITIVE doc's proposed extractions (`ProviderCloudSync`, `ProviderState`, `ProviderProfiles`, `ProviderTaskOps`, `ProviderWebview`) **have not been done**.                                                                                                                                                                                                                                                                                                                          | [`ClineProvider.ts:130`](src/core/webview/ClineProvider.ts:130)                                                                                                                  |
| `NativeToolCallParser.ts` = 1,077 lines                              | Now **1,151 lines**; still hosts two parallel per-tool switches. Accurate and slightly worse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [`NativeToolCallParser.ts:428`](src/core/assistant-message/NativeToolCallParser.ts:428), [`NativeToolCallParser.ts:778`](src/core/assistant-message/NativeToolCallParser.ts:778) |
| `presentAssistantMessage.ts` = 994 lines                             | Now **1,120 lines**; hosts the execution dispatch switch + a display switch. Accurate and slightly worse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [`presentAssistantMessage.ts:741`](src/core/assistant-message/presentAssistantMessage.ts:741)                                                                                    |
| `McpHub.ts` = 1,995 lines                                            | Not re-verified in this pass (out of the named hotspots). The doc's proposed split is still a reasonable plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                |

**Net:** the doc's #1 finding is obsolete (already shipped); #2 and #3 remain valid; the tool/provider seams — the highest open-closed leverage — were never covered.

### `MEMORY_SYSTEM_ANALYSIS.md` — **aspirational/stale as a _refactor_ doc**

It is a _porting plan_ for Claude Code's `memdir/` memory system. The port has **landed**: [`src/core/memory/`](src/core/memory) exists with `extractMemories.ts`, `autoDream.ts`, `consolidationLock.ts`, `memoryScan.ts`, `relevance.ts`, `surfacing.ts`, `prefetch.ts`, `memoryTaskIntegration.ts`, etc., plus full `__tests__/`. It is not a maintainability/complexity analysis and says nothing about refactor opportunities. Treat it as historical context only; do not duplicate it. The memory subsystem is notably **well-modularized** (one responsibility per file, small files, real tests) and is **not** a refactor hotspot — call this out as a positive exemplar.

---

## 1. Ranked refactor points

Points are ranked by **value / effort**, preferring reductions in the _number of change points_. The top 5 highest-leverage refactors are flagged ⭐.

---

### ⭐ #1 — Replace the tool-execution & tool-parsing switches with a `ToolRegistry` (open-closed for native tools)

**Location**

- Execution dispatch: [`src/core/assistant-message/presentAssistantMessage.ts:741-1043`](src/core/assistant-message/presentAssistantMessage.ts:741) — one `switch (block.name)` with ~22 cases, plus a parallel display switch at [`presentAssistantMessage.ts:351-420`](src/core/assistant-message/presentAssistantMessage.ts:351).
- Parsing dispatch: [`src/core/assistant-message/NativeToolCallParser.ts:428-692`](src/core/assistant-message/NativeToolCallParser.ts:428) (partial-args switch) **and** [`NativeToolCallParser.ts:778-1064`](src/core/assistant-message/NativeToolCallParser.ts:778) (complete-args switch) — **two parallel per-tool switches** with duplicated coercion logic.
- Schema catalog: [`src/core/prompts/tools/native-tools/index.ts:51-75`](src/core/prompts/tools/native-tools/index.ts:51) — hand-maintained array literal of 22 imports.
- Display names / groups / aliases / param names / native-args map: [`src/shared/tools.ts:273`](src/shared/tools.ts:273) (`TOOL_DISPLAY_NAMES`), [`src/shared/tools.ts:303`](src/shared/tools.ts:303) (`TOOL_GROUPS`), [`src/shared/tools.ts:346`](src/shared/tools.ts:346) (`TOOL_ALIASES`), [`src/shared/tools.ts:26`](src/shared/tools.ts:26) (`toolParamNames`), [`src/shared/tools.ts:92`](src/shared/tools.ts:92) (`NativeToolArgs`).
- Tool-name union + validation: `packages/types` `ToolName`, plus [`src/core/tools/validateToolUse.ts:20`](src/core/tools/validateToolUse.ts:20) (`customToolRegistry.has`) and [`src/core/assistant-message/NativeToolCallParser.ts:743`](src/core/assistant-message/NativeToolCallParser.ts:743).
- Test guard that forces you to touch the spec too: [`NativeToolCallParser.spec.ts:400`](src/core/assistant-message/__tests__/NativeToolCallParser.spec.ts:400).

**Symptom** — shotgun surgery. To add **one** native tool you must edit **≥8 places**:

1. `packages/types` `ToolName` union (+ `ToolGroup` if new group).
2. `src/shared/tools.ts`: `toolParamNames`, `NativeToolArgs`, `TOOL_DISPLAY_NAMES`, `TOOL_GROUPS`, and maybe `TOOL_ALIASES` / `ALWAYS_AVAILABLE_TOOLS`.
3. `src/core/prompts/tools/native-tools/<name>.ts` — a new schema module.
4. `src/core/prompts/tools/native-tools/index.ts` — import + add to the array literal.
5. `src/core/tools/<Name>Tool.ts` — the `BaseTool<TName>` subclass.
6. `src/core/assistant-message/presentAssistantMessage.ts` — import the instance, add an **execution switch case** (lines 741-1043) **and** a **display switch case** (lines 351-420).
7. `src/core/assistant-message/NativeToolCallParser.ts` — add a case to the **partial** switch (line 428) **and** the **complete** switch (line 778), with duplicated coercion.
8. `NativeToolCallParser.spec.ts` — add a fixture (the guard test fails otherwise).

Five of those eight are _stringly-keyed_ `case` arms with no compile-time link between them. The parser's two switches are a duplication smell: the partial and complete arg-construction for `read_file` (legacy `files` handling, indentation sub-object, `coerceOptionalNumber/Boolean`) is written twice ([`NativeToolCallParser.ts:429`](src/core/assistant-message/NativeToolCallParser.ts:429) vs [`:779`](src/core/assistant-message/NativeToolCallParser.ts:779)).

**Root cause** — **missing registry abstraction + closed-against-extension dispatch.** The codebase already has the _right_ pattern — `customToolRegistry` ([`packages/core/src/custom-tools/custom-tool-registry.ts:31`](packages/core/src/custom-tools/custom-tool-registry.ts:31)) — but it's reserved for `.roo/tools/` user tools. Native tools are dispatched by `switch` instead of by `Map<ToolName, ToolEntry>`. The `BaseTool` class ([`src/core/tools/BaseTool.ts:29`](src/core/tools/BaseTool.ts:29)) is a clean `abstract execute(...)`/`handle()` shape, so every tool already encapsulates its own execution — the switch in `presentAssistantMessage` just routes `block.name → tool.handle(...)` with identical callback plumbing in every case. The parsing logic has no per-tool home: it lives in the parser because there's no `parseArgs(raw): NativeArgsFor<TName>` method on the tool.

**Proposed refactor** — introduce a `NativeToolRegistry` mirroring `CustomToolRegistry`:

- Each `BaseTool<TName>` gains two optional members: `schema: OpenAI.Chat.ChatCompletionTool` (the existing native-tools modules become static data on the tool class) and `parseArgs(raw: unknown, { partial }): NativeArgsFor<TName> | undefined` (the two parser switches collapse into per-tool methods; the `partial` flag selects early-return vs strict).
- A single `nativeToolRegistry: Map<ToolName, BaseTool>` is populated once (each tool file registers itself, or a single `index.ts` does `registry.register(new ReadFileTool(), …)`).
- `getNativeTools()` ([`native-tools/index.ts:44`](src/core/prompts/tools/native-tools/index.ts:44)) becomes `registry.getAll().map(t => t.schema)`.
- The execution switch ([`presentAssistantMessage.ts:741`](src/core/assistant-message/presentAssistantMessage.ts:741)) collapses to:
  `const tool = nativeToolRegistry.get(block.name); if (tool) { maybeCheckpointSaveAndMark(block.name, cline); await tool.handle(cline, block, callbacks); } else { /* custom-tool / deferred / unknown fallback */ }`.
- The display switch ([`presentAssistantMessage.ts:351`](src/core/assistant-message/presentAssistantMessage.ts:351)) collapses to `tool.getDisplayName(block)` (or a `displayTemplate` field) with a default `[${block.name}]`.
- The two parser switches ([`NativeToolCallParser.ts:428`](src/core/assistant-message/NativeToolCallParser.ts:428), [`:778`](src/core/assistant-message/NativeToolCallParser.ts:778)) collapse to `const tool = nativeToolRegistry.get(resolvedName); nativeArgs = tool?.parseArgs(args, { partial })`.
- `TOOL_DISPLAY_NAMES`, `TOOL_GROUPS`, `TOOL_ALIASES`, `ALWAYS_AVAILABLE_TOOLS`, `NativeToolArgs`, `toolParamNames` become **derived** from registry metadata (each tool declares `name`, `displayName`, `group`, `alwaysAvailable`, `aliases`, `paramNames`, `nativeArgsShape`). The `ToolName` union can stay in `packages/types` as the source of truth and the registry is typed against it — or the union is generated from the registry keys.
- The spec guard ([`NativeToolCallParser.spec.ts:400`](src/core/assistant-message/__tests__/NativeToolCallParser.spec.ts:400)) becomes a registry-completeness test: "every registered tool has a `parseArgs` fixture".

After this, **adding a native tool = 1 file** (`src/core/tools/<Name>Tool.ts`, self-registering or added to one registry line), down from 8. The custom-tool path already proves this works.

**Impact** — **L** effort, **medium** risk (the parser's coercion/legacy-format edge cases for `read_file` are load-bearing and must move faithfully; the `checkpointSaveAndMark` side-effect is currently sprinkled across 7 cases and must become a per-tool `requiresCheckpoint` flag or a wrapper). Risk is bounded by the existing comprehensive tool tests (each tool has a spec; the parser spec has the completeness guard). **Future changes cheaper:** every native-tool addition, every change to per-tool arg coercion, every change to display formatting. This is the single biggest open-closed win in `src/`.

---

### ⭐ #2 — Replace `buildApiHandler` switch with a provider registry; kill the hardcoded `apiProvider === "gemini"` / `"lmstudio"` special-cases

**Location**

- Central dispatch: [`src/api/index.ts:128-187`](src/api/index.ts:128) — a 25-case `switch (apiProvider)`.
- Re-export barrel: [`src/api/providers/index.ts:1-30`](src/api/providers/index.ts:1) — 30 hand-maintained `export { XHandler }` lines.
- Provider-specific **hardcoded checks embedded in generic logic**:
    - [`src/core/task/ApiRequestBuilder.ts:197`](src/core/task/ApiRequestBuilder.ts:197) — `apiConfiguration?.apiProvider === "gemini"` gates `includeAllToolsWithRestrictions` (Gemini needs all tool defs but a callable allowlist).
    - [`src/core/webview/ClineProvider.ts:528`](src/core/webview/ClineProvider.ts:528) — `cline.apiConfiguration.apiProvider === "lmstudio"` forces model preload before reading context size.
- Per-provider switch in profile validation: [`src/shared/ProfileValidator.ts:54-56`](src/shared/ProfileValidator.ts:54) — `switch (apiProvider) { case "openai": return profile.openAiModelId; ... }`.
- Model-list fetchers: [`src/api/providers/fetchers/`](src/api/providers/fetchers) — one file per provider, no common registration.
- Provider-name validity: [`src/core/config/ContextProxy.ts:283`](src/core/config/ContextProxy.ts:283), [`ContextProxy.ts:512`](src/core/config/ContextProxy.ts:512) — `isProviderName(apiProvider) || isRetiredProvider(apiProvider)`.

**Symptom** — shotgun surgery + stringly-typed capability checks. Adding a provider = ~6 edit points (types union, `buildApiHandler` switch, providers barrel, fetcher file, `ProfileValidator` switch, retired-provider handling). Worse, the two hardcoded `=== "gemini"` / `=== "lmstudio"` checks are **open-closed violations inside the task loop and provider lifecycle**: a new provider with Gemini-like tool restrictions or LMStudio-like lazy loading would require editing `ApiRequestBuilder` / `ClineProvider` and adding another `===` arm. These are the most insidious change-points because they hide inside generic code.

**Root cause** — **stringly-typed dispatch + missing capability interface.** `ApiHandler` ([`src/api/index.ts:90`](src/api/index.ts:90)) defines `createMessage`/`getModel`/`countTokens`/`cancelRequest` but has **no capability metadata** (does this provider need `includeAllToolsWithRestrictions`? does it need model preloading? does it support `tool_choice`? parallel tool calls?). So callers that need provider-specific behavior reach into `apiProvider === "x"` string comparisons. `BaseProvider` ([`src/api/providers/base-provider.ts:14`](src/api/providers/base-provider.ts:14)) is a good shared base (token counting, OpenAI strict-mode schema conversion) but doesn't carry capabilities. There's no `ProviderRegistry`/`ProviderFactory`; the `switch` _is_ the registry.

**Proposed refactor** — introduce `ProviderDefinition`:

```ts
interface ProviderDefinition {
	name: ApiProviderName
	factory: (opts: ProviderSettings) => ApiHandler
	capabilities: {
		needsAllToolsWithCallableRestriction?: boolean // Gemini
		needsModelPreloadForContextSize?: boolean // LMStudio
		supportsToolChoice?: boolean
		supportsParallelToolCalls?: boolean
	}
	modelFetcher?: (config) => Promise<ModelInfo[]>
	profileModelIdField?: keyof ProviderSettings // replaces ProfileValidator switch
	retired?: boolean
}
```

- A `providerRegistry: Map<ApiProviderName, ProviderDefinition>` (each provider file registers its definition, or a single `providers/index.ts` builds the map). `buildApiHandler` becomes `return (providerRegistry.get(apiProvider) ?? anthropic).factory(options)`.
- `ApiRequestBuilder.ts:197` becomes `if (def.capabilities.needsAllToolsWithCallableRestriction)`.
- `ClineProvider.ts:528` becomes `if (def.capabilities.needsModelPreloadForContextSize)`.
- `ProfileValidator.ts` switch becomes `config[def.profileModelIdField]`.
- `ContextProxy` validity becomes `providerRegistry.has(apiProvider) || isRetiredProvider(apiProvider)`.

After this, **adding a provider = 1 file** (`src/api/providers/<name>.ts` exporting a `ProviderDefinition`), the barrel/switch/fetcher-wiring all disappear, and **new capability checks never touch generic code** — you set a flag on the definition.

**Impact** — **M** effort, **medium** risk (every provider must be touched once to produce its `ProviderDefinition`; the `vertex` model-id-prefix branch at [`api/index.ts:136`](src/api/index.ts:136) — `claude` → `AnthropicVertexHandler` else `VertexHandler` — becomes a `factory` that inspects `options.apiModelId`). Bounded by per-provider tests. **Future changes cheaper:** every provider addition, every provider-capability behavior change, retiring a provider. The two embedded `===` checks alone make this worth doing — they are the kind of latent branching that grows over time.

---

### #3 — Split `webviewMessageHandler.ts` (3,765 lines, single switch) into a message-type → handler map

**Location** — [`src/core/webview/webviewMessageHandler.ts:545`](src/core/webview/webviewMessageHandler.ts:545) — one `switch (message.type)` dispatching **every** webview→extension message (settings, task CRUD, MCP, model fetching, file ops, checkpoints, marketplace, exports, history, modes). 3,765 lines total; the switch body runs into the thousands.

**Symptom** — god function. The COGNITIVE doc counted 149 cases (still accurate in shape). Every new UI message type appends another case to the same function; there is no seam to add a handler in isolation. The file mixes pure routing with large inline async bodies (e.g. `editMessage` at [`:505`](src/core/webview/webviewMessageHandler.ts:505), message-modification operations at [`:532`](src/core/webview/webviewMessageHandler.ts:532)).

**Root cause** — **centralized switch dispatch instead of a handler registry.** Same pattern as #1/#2 but lower-stakes: each case is already independent (low coupling between cases), so the fix is mechanical.

**Proposed refactor** — replace the switch with a `Map<WebviewMessage["type"], (provider, message) => Promise<void>>` built from domain-grouped modules (`handleSettingsMessages`, `handleTaskMessages`, `handleModelMessages`, `handleMcpMessages`, `handleCheckpointMessages`, `handleMarketplaceMessages`, `handleHistoryMessages`, `handleModeMessages`, …) exactly as the COGNITIVE doc proposed. The dispatcher becomes `const handler = handlerMap.get(message.type); await handler?.(provider, message)`. This is the **lowest-risk** refactor in the list because cases are independent.

**Impact** — **M** effort, **low** risk (case independence), high readability win. **Future changes cheaper:** every new webview message type, every per-domain bugfix. Not a top-5 because it doesn't reduce _cross-file_ change-points as dramatically as #1/#2 (it's one file), but it's the highest-value _low-risk_ refactor and a good confidence-builder.

---

### #4 — Split `ClineProvider.ts` god class (~4,250 lines, 77+ methods) along its existing responsibility seams

**Location** — [`src/core/webview/ClineProvider.ts:130`](src/core/webview/ClineProvider.ts:130). Method listing confirms 8+ unrelated responsibilities co-located: webview lifecycle (`resolveWebviewView`, `getHtmlContent`, HMR at [`:1245`](src/core/webview/ClineProvider.ts:1245)), task stack management (`addClineToStack` [`:508`](src/core/webview/ClineProvider.ts:508), `removeClineFromStack` [`:545`](src/core/webview/ClineProvider.ts:545), background tasks at [`:147`](src/core/webview/ClineProvider.ts:147), delegation repair [`:3718`](src/core/webview/ClineProvider.ts:3718)/[`:3882`](src/core/webview/ClineProvider.ts:3882)/[`:4003`](src/core/webview/ClineProvider.ts:4003)), cloud sync (`initializeCloudProfileSync` [`:421`](src/core/webview/ClineProvider.ts:421), `syncCloudProfiles` [`:451`](src/core/webview/ClineProvider.ts:451), `handleCloudSettingsUpdate` [`:440`](src/core/webview/ClineProvider.ts:440)), state serialization (`getStateToPostToWebview` [`:2188`](src/core/webview/ClineProvider.ts:2188), `getState` [`:2472`](src/core/webview/ClineProvider.ts:2472), three `postStateToWebview*` variants [`:2031`](src/core/webview/ClineProvider.ts:2031)/[`:2052`](src/core/webview/ClineProvider.ts:2052)/[`:2076`](src/core/webview/ClineProvider.ts:2076)), provider profile CRUD (`upsertProviderProfile` [`:1583`](src/core/webview/ClineProvider.ts:1583), `deleteProviderProfile` [`:1638`](src/core/webview/ClineProvider.ts:1638), `activateProviderProfile` [`:1689`](src/core/webview/ClineProvider.ts:1689), sticky profiles [`:1661`](src/core/webview/ClineProvider.ts:1661)), mode switching (`handleModeSwitch` [`:1444`](src/core/webview/ClineProvider.ts:1444)), marketplace (`fetchMarketplaceData` [`:2090`](src/core/webview/ClineProvider.ts:2090)), task history CRUD (`deleteTaskWithId` [`:1940`](src/core/webview/ClineProvider.ts:1940), `exportTaskWithId` [`:1908`](src/core/webview/ClineProvider.ts:1908), `condenseTaskContext` [`:1923`](src/core/webview/ClineProvider.ts:1923)), task creation (`createTask` [`:3011`](src/core/webview/ClineProvider.ts:3011), `createBackgroundTask` [`:3125`](src/core/webview/ClineProvider.ts:3125), `createTaskWithHistoryItem` [`:1008`](src/core/webview/ClineProvider.ts:1008)), command-list merging ([`:2136`](src/core/webview/ClineProvider.ts:2136)/[`:2144`](src/core/webview/ClineProvider.ts:2144)/[`:2157`](src/core/webview/ClineProvider.ts:2157)), memory writer config ([`:3379`](src/core/webview/ClineProvider.ts:3379)/[`:3354`](src/core/webview/ClineProvider.ts:3354)).

**Symptom** — the classic god object: 77+ methods, 8+ responsibilities, no single method-of-methods a maintainer can hold. Touching any one concern risks merge conflicts with unrelated work. The COGNITIVE doc's #3 priority is still unaddressed.

**Root cause** — **`ClineProvider` is the extension's de-facto singleton**, so every feature that needs _some_ extension-scope state accreted onto it. There's no `ProviderCloudSync` / `ProviderState` / `ProviderProfiles` / `ProviderTaskOps` / `ProviderWebview` decomposition (the COGNITIVE doc proposed exactly this 6 years ago in doc-time and it wasn't done). Contrast with `Task`, which _was_ decomposed into the `Task*` module family — proving the pattern works in this codebase.

**Proposed refactor** — follow the proven `Task` decomposition: extract composed collaborator classes that receive a narrow `ClineProviderAccess` interface (the `Task*` modules use this exact "access" pattern — see [`TaskApiLoop.ts:215`](src/core/task/TaskApiLoop.ts:215) `constructor(private readonly access: TaskApiLoopAccess)`):

- `ProviderCloudSync` (cloud profile sync, settings update handling) — [`:421`](src/core/webview/ClineProvider.ts:421)–[`:487`](src/core/webview/ClineProvider.ts:487).
- `ProviderState` / `StateSerializer` (`getStateToPostToWebview`, `getState`, the three post variants, command-list merging) — [`:2031`](src/core/webview/ClineProvider.ts:2031)–[`:2186`](src/core/webview/ClineProvider.ts:2186) + [`:2472`](src/core/webview/ClineProvider.ts:2472).
- `ProviderProfiles` (profile CRUD + sticky + activation) — [`:1579`](src/core/webview/ClineProvider.ts:1579)–[`:1725`](src/core/webview/ClineProvider.ts:1725).
- `ProviderTaskOps` (task stack, background tasks, delegation repair, task CRUD) — [`:508`](src/core/webview/ClineProvider.ts:508)–[`:625`](src/core/webview/ClineProvider.ts:625), [`:3718`](src/core/webview/ClineProvider.ts:3718)–[`:4252`](src/core/webview/ClineProvider.ts:4252).
- `ProviderWebview` (HTML/HMR, webview message listener wiring) — [`:874`](src/core/webview/ClineProvider.ts:874)–[`:1431`](src/core/webview/ClineProvider.ts:1431).
  `ClineProvider` retains lifecycle wiring and composes these. Do **not** extract all at once — extract one collaborator per PR behind the existing test suite (there are many `ClineProvider.*.spec.ts` files: see `src/core/webview/__tests__/ClineProvider.*.spec.ts`).

**Impact** — **L** effort, **medium-high** risk (high method count, subtle state interactions, delegation-repair races have their own specs). Mitigated by the strong existing per-feature test files (the test names — `ClineProvider.cancelTask-abort-race`, `ClineProvider.delegation-cancel-races`, `ClineProvider.sticky-profile`, `ClineProvider.flicker-free-cancel` — show the seams are already testably isolated). **Future changes cheaper:** every cloud/state/profile/task/delegation change. Not top-5 because it's a large, careful extraction rather than a structural pattern change; but it's the largest _pure-complexity_ win available and removes the last standing god object from the COGNITIVE doc's top 3.

---

### #5 — Make `checkAutoApproval` and the `ClineSayTool.tool` discriminator a typed, extensible policy

**Location**

- 175-line branching function: [`src/core/auto-approval/index.ts:48-225`](src/core/auto-approval/index.ts:48) — long if/else on `ask` then on `tool.tool` string discriminators.
- Stringly-typed magic arrays with **no compile-time link to `ToolName`**: [`src/core/auto-approval/tools.ts:3`](src/core/auto-approval/tools.ts:3) (`isWriteToolAction` = `["editedExistingFile", "appliedDiff", "newFileCreated", "generateImage"]`), [`tools.ts:7`](src/core/auto-approval/tools.ts:7) (`isReadOnlyToolAction` = `["readFile", "listFiles", "listFilesTopLevel", "listFilesRecursive", "searchFiles", "codebaseSearch", "runSlashCommand"]`).
- Inline `tool.tool ===` checks: [`auto-approval/index.ts:187`](src/core/auto-approval/index.ts:187) (`updateTodoList`), [`:194`](src/core/auto-approval/index.ts:194) (`skill`), [`:198`](src/core/auto-approval/index.ts:198) (`switchMode`), [`:202`](src/core/auto-approval/index.ts:202) (`newTask`, `finishTask`).

**Symptom** — two disconnected string vocabularies. The tool-execution system uses `ToolName` (`read_file`, `write_to_file`, …); the auto-approval system uses a **different** set of `ClineSayTool["tool"]` strings (`readFile`, `editedExistingFile`, `appliedDiff`, `newFileCreated`, …). Adding a tool that needs auto-approval classification means editing the magic arrays in `tools.ts` **and** possibly adding an `===` branch in `checkAutoApproval` — and the compiler won't tell you if you forget, because the arrays are plain `string[]` checked against an untyped `tool.tool`. A new read-only tool silently falls through to `ask` if nobody remembers to add it to `isReadOnlyToolAction`.

**Root cause** — **stringly-typed policy without a capability declaration.** The auto-approval classification (read-only? write? needs-mode-switch-approval? always-approved?) is a _property of the tool_, but it's encoded as external arrays keyed by a separate discriminator vocabulary instead of on the tool itself. This is the same shape as provider capability flags (#2): behavior that belongs on the entity lives as external string-matching.

**Proposed refactor** — fold auto-approval classification into the `NativeToolRegistry` from #1: each `BaseTool` declares `approvalCategory: "readonly" | "write" | "modeSwitch" | "subtask" | "alwaysApproved" | "command"` (and `isOutsideWorkspaceAllowed?`, `isProtectedAllowed?`). `isWriteToolAction`/`isReadOnlyToolAction` become `registry.get(toolName).approvalCategory === "write"`. The `checkAutoApproval` if/else chain becomes a small policy table keyed by `approvalCategory` + state toggles. The `ClineSayTool.tool` discriminator either gets typed against the registry or — better — `ClineSayTool` carries the `toolName: ToolName` directly so the two vocabularies merge.

**Impact** — **S/M** effort (assuming #1 lands first; if standalone, **M**), **low** risk (auto-approval has dedicated specs: `checkAutoApproval.spec.ts`, `AutoApprovalHandler.spec.ts`). **Future changes cheaper:** every tool addition automatically gets correct approval classification; no more silent-fallthrough bugs. Not a top-5 standalone, but a **natural extension of #1** — if you do #1, this is nearly free and should be done together.

---

### #6 — Consolidate the `read_file` legacy-format + indentation coercion duplication in `NativeToolCallParser`

**Location** — [`src/core/assistant-message/NativeToolCallParser.ts:429-480`](src/core/assistant-message/NativeToolCallParser.ts:429) (partial) vs [`:779-828`](src/core/assistant-message/NativeToolCallParser.ts:779) (complete). The `read_file` case in both switches handles the legacy `{files: [...]}` format (array + double-stringified string + `convertFileEntries`) and the indentation sub-object (`anchor_line`/`max_levels`/`max_lines`/`include_siblings`/`include_header` with `coerceOptionalNumber`/`coerceOptionalBoolean`) — **near-verbatim duplicated**.

**Symptom** — two copies of non-trivial coercion logic; a bug fix in one must be mirrored in the other. The `usedLegacyFormat` telemetry flag is set in both.

**Root cause** — same as #1: parsing logic has no per-tool home, so partial and complete construction duplicate each other. The `partial` branch is just "return early if any key is present"; the complete branch is "validate required keys".

**Proposed refactor** — this is **subsumed by #1** (move `parseArgs` onto the tool, with a `partial` flag). If #1 is not done, the minimal fix is to extract a shared `buildReadFileNativeArgs(args, { partial })` helper called by both switches. Worth calling out separately because it's a concrete, low-risk standalone win if #1 is deferred.

**Impact** — **S** effort (standalone) / **0** (if #1 done), **low** risk (parser has the completeness-guard spec). **Future changes cheaper:** `read_file` format evolution (the legacy-format migration is actively monitored via `READ_FILE_LEGACY_FORMAT_USED` telemetry, so this code is still live).

---

### #7 — Extract `McpHub.ts` (1,995 lines) along the COGNITIVE doc's proposed seams

**Location** — `src/services/mcp/McpHub.ts` (not re-verified line-by-line this pass, but the COGNITIVE doc's structural analysis is still the reference). 6+ responsibilities: server lifecycle, config file management, tool/resource management, connection state, file watching, webview notifications.

**Symptom / root cause / refactor** — unchanged from the COGNITIVE doc: split into `McpConnectionManager` / `McpConfigManager` / `McpToolManager` / `McpFileWatcher`. Reiterated here only for completeness; it remains a valid medium-priority refactor but is **outside** the named "highest-value areas" of this task's scope and lower open-closed leverage than #1/#2.

**Impact** — **M** effort, **medium** risk. Lower priority than #1–#5.

---

### #8 — Split the three largest API provider files (bedrock 1,588 / openai-native 1,586 / openai-codex 1,260)

**Location** — `src/api/providers/bedrock.ts`, `openai-native.ts`, `openai-codex.ts` (line counts from COGNITIVE doc; structure unchanged in spirit).

**Symptom** — each provider mixes payload construction, stream parsing, error handling, and provider-specific logic in one class.

**Root cause** — no `StreamParser` / `PayloadBuilder` separation; the `createMessage` generator inlines parsing.

**Proposed refactor** — extract `BedrockStreamParser` / `BedrockPayloadBuilder`, etc. **However**: if #2's `ProviderDefinition` is adopted, the natural shape is that each provider file is _already_ one self-contained `ProviderDefinition` export — the size is tolerable because the file is the unit of provider addition. So this is **lower priority once #2 lands**: the open-closed concern is solved by the registry; the intra-file complexity is a readability-only issue. Keep as a Phase 3 cleanup.

**Impact** — **S/M** per provider, **low** risk (each provider has tests). Defer behind #2.

---

## 2. Top 5 highest-leverage refactors (explicit)

1. ⭐ **#1 — `NativeToolRegistry`** (tool execution + parsing + schema + metadata). Cuts a native-tool addition from **8 change-points to 1**. The biggest open-closed win in `src/`; the custom-tool registry already proves the pattern.
2. ⭐ **#2 — `ProviderDefinition` registry + capability flags**. Cuts a provider addition from **~6 change-points to 1** **and** eliminates the two hardcoded `=== "gemini"` / `=== "lmstudio"` checks embedded in the task loop / provider lifecycle — the most insidious change-points in the codebase.
3. **#3 — `webviewMessageHandler` handler map.** Lowest-risk high-readability win; cases are independent so it's mechanical. Best "confidence-builder" refactor.
4. **#4 — `ClineProvider` decomposition** (mirror the proven `Task` → `Task*` pattern). Removes the last standing god object from the COGNITIVE doc's top 3; large but well-tested seams.
5. **#5 — Auto-approval policy on the tool registry** (fold into #1). Removes a silent-fallthrough bug class and a second stringly-typed vocabulary; nearly free if done with #1.

---

## 3. What's already good (don't refactor these)

- **`Task` decomposition** — the former #1 god class is now a clean coordinator delegating to 9+ focused modules. This is the **proof that the registry/decomposition pattern works in this codebase** and should be the template for #4 (`ClineProvider`) and the model for #1/#2.
- **`src/core/memory/`** — one responsibility per file, small files, real `__tests__/` for every module. The memory port landed well. Not a hotspot.
- **`customToolRegistry`** (`packages/core/src/custom-tools/`) — the open-closed exemplar; a `Map<string, Tool>` with `register`/`get`/`has`/`getAllSerialized`, file-based discovery, validation. This is literally the target architecture for #1.
- **`BaseTool<TName>`** — clean abstract `execute`/`handle` with typed params; every tool already encapsulates its execution. The switch in `presentAssistantMessage` is redundant routing on top of an already-encapsulated class.
- **`BaseProvider`** — shared token counting + OpenAI strict-mode schema conversion. Good base; just missing capability metadata (the gap #2 fills).

---

## 4. Suggested execution order

1. **#3 first** (webview handler map) — low risk, builds confidence, unblocks concurrent work on the handler domains.
2. **#1 + #5 together** (tool registry + auto-approval policy) — the highest-leverage structural change; do them as one effort since #5 is nearly free on top of #1. Land incrementally: (a) introduce `NativeToolRegistry` and route the execution switch through it (parser switches untouched yet); (b) move `parseArgs` onto tools and collapse the two parser switches; (c) derive `TOOL_DISPLAY_NAMES`/`TOOL_GROUPS`/`ALWAYS_AVAILABLE_TOOLS`/`NativeToolArgs` from registry metadata; (d) add `approvalCategory` and collapse auto-approval arrays.
3. **#2** (provider registry + capability flags) — second-highest leverage; the capability flags specifically kill the embedded `===` checks.
4. **#4** (ClineProvider decomposition) — extract one collaborator per PR (`ProviderCloudSync` → `ProviderState` → `ProviderProfiles` → `ProviderTaskOps` → `ProviderWebview`), each behind the existing `ClineProvider.*.spec.ts` suites.
5. **#6, #8, #7** — cleanups; #6 is free after #1, #8 is lower priority after #2, #7 is independent and medium priority.

---

## 5. Cleanup-now deltas & test-gap gate — added 2026-07-15

These were **not** in the original ranking above. They are low-risk standalone PRs that shrink the surface **before** the structural refactors — do them first. Full detail lives in [`2026-07-14_src-refactor-plan.md`](ai_plans/2026-07-14_src-refactor-plan.md:1) §3.1; the verified items are:

1. **Overdue migration removal** — [`migrateSettings.ts:14`](src/utils/migrateSettings.ts:14) says "Remove in September 2025"; it is July 2026 (~10 months overdue). Delete the fn + call site; gate with `cd src && npx vitest run utils/migrateSettings`.
2. **6 `@deprecated` exports** with named replacements — [`minimax-format.ts:105`](src/api/transform/minimax-format.ts:105), [`openai-error-handler.ts:5`](src/api/providers/utils/openai-error-handler.ts:5), [`skills.ts:11`](src/shared/skills.ts:11) (`modeSlugs`), [`custom-instructions.ts:352`](src/core/prompts/sections/custom-instructions.ts:352) (`loadAllAgentRulesFiles`), [`ClineProvider.ts:2797`](src/core/webview/ClineProvider.ts:2797) & [`:2802`](src/core/webview/ClineProvider.ts:2802) (`ContextProxy#setValue`/`getValue`). Remove each + re-point callers to the named replacement.
3. **Unexport test-only types** (knip-confirmed; grep can false-positive on short names) — `ConnectedMcpConnection`/`DisableReason`/`DisconnectedMcpConnection`/`McpConnection`/`ServerConfigSchema` ([`McpHub.ts`](src/services/mcp/McpHub.ts:1)), `TaskOptions` ([`Task.ts`](src/core/task/Task.ts:1)), `StreamEvent`/`UsageType` ([`bedrock.ts`](src/api/providers/bedrock.ts:1)), [`raceNextChunkWithAbort`](src/core/task/TaskApiLoop.ts:1), `OpenAiNativeModel` ([`openai-native.ts`](src/api/providers/openai-native.ts:1)), `OpenAiCodexModel` ([`openai-codex.ts`](src/api/providers/openai-codex.ts:1)).
4. **`ClineProviderEvents`** — exported in [`ClineProvider.ts`](src/core/webview/ClineProvider.ts:1) with **zero external references** (whole-repo grep); strong delete candidate.

> **Test-gap gate (prerequisite for #4):** the delegation → parent-return path via [`reopenParentFromDelegation()`](src/core/assistant-message/presentAssistantMessage.ts:203) — the path #4's `ProviderDelegation` collaborator will rework — is **untested at any layer** (finding I-4 in [`2026-07-13_efficiency-stack-review-findings.md`](ai_plans/2026-07-13_efficiency-stack-review-findings.md:1); `TaskApiLoop.text-completion-fallback.spec.ts` mocks `attemptCompletionTool` entirely). **Add a subtask e2e/integration test before touching the delegation helper in #4** — it is the riskiest least-tested path in the codebase.

> **Systematic dead-code tool:** `npx knip` (configured via [`knip.json`](knip.json:1)) is the authoritative unused-export/types/files detector and resolves the dynamic-`import()` blind spot that hid [`PlanReviewPanel`](src/core/webview/PlanReviewPanel.ts:1) from static-grep. Run it before classifying any §5 item as removable; the table above is only for dynamic-consumption cases knip can't see.

---

_All file:line citations verified against the current checkout at the time of analysis. The two pre-existing docs were used as input and explicitly corrected where stale. The 2026-07-15 orchestrator pass re-verified the headline metrics and added §5._
