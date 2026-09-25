# Extension core: `src/core`, `src/activate`, `src/extension.ts`

Phase 3 takes the quick wins (CORE-Q), CORE-R10 and CORE-R5. Phase 4 takes the rest in the order at the bottom.
Defects found by this audit are listed in `02-defects.md` (C1 to C8) and are fixed before any item here moves
their code.

## Where the prior plans stand

| Prior item                                        | Status on `main @ 0c0b40b15`                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task.ts extraction into 8 modules (May)           | DONE, but the files grew back: Task.ts 1,323 to 1,803 lines, TaskApiLoop 1,100 to 1,424, TaskStreamProcessor 903 to 1,034, TaskContextManager 593 to 919. `TaskAskSay.ask` is 384 lines |
| Native tool registry (backend #1)                 | OPEN and worse: 2 switches of 29 cases in `presentAssistantMessage.ts` (`:454`, `:897`), 2 in `NativeToolCallParser.ts` (`:428`, `:809`), `checkpointSaveAndMark` called 8 times        |
| Provider registry (backend #2)                    | PARTIAL: factory map done (#126); hard-coded `=== "gemini"` (`ApiRequestBuilder.ts:204`) and `=== "lmstudio"` (`ClineProvider.ts:834`) remain; see API-6                                |
| webviewMessageHandler handler map (backend #3)    | OPEN: one 3,520-line arrow function (lines 94 to 3613), one switch with 149 cases                                                                                                       |
| ClineProvider decomposition (backend #4, Theme A) | OPEN and worse: 4,414 lines in July, 5,011 now, 128 methods, 174 members, 58 imports                                                                                                    |
| Auto-approval policy on the tool (backend #5)     | OPEN: 8 `tool.tool ===` checks in `auto-approval/index.ts:96-258`                                                                                                                       |
| read_file coercion duplicated (backend #6)        | OPEN: `NativeToolCallParser.ts:429-480` against the complete switch (clone at `440-455` / `821-835`)                                                                                    |
| Static parser state (Theme E)                     | DONE; the same class of bug now lives in tool singletons (DEF-C4)                                                                                                                       |
| migrateSettings removal (backend 5.1)             | OPEN, 12 months past its own "remove in September 2025" note; owner decision 7                                                                                                          |
| Tech-debt stack B26, B27, B28, B31, B33           | DONE                                                                                                                                                                                    |
| Phase 2A (ApiRequestBuilder)                      | DONE, but it dropped the `.rooignore` instructions (DEF-C1) and left two dead verbatim copies (`ApiRequestBuilder.ts:426-471`)                                                          |

**What ClineProvider gained since July (+597 net lines):** task-history store wiring and echo suppression (#125,
+234), store reacquire and the storage-error banner (#159, +205), the parallel-subagent panel (#129, +151), CLI
per-mode provider settings (#185, +34), 8 new settings each written in 3 places (#143, +28).

**Its 14 responsibilities today:** construction and task-event forwarding (260-470), task-history gateway and
storage-error banner (491-702), cloud profile sync (727-808), task stack, creation and rehydration
(`createTaskWithHistoryItem` 1329-1581, `cancelTask` 4032-4185), pending edit operations (945-1004), webview HTML
and CSP (1595-1774), mode switching and profile activation (1801-2106, 3766-3799), task-history operations
(2183-2442), state serialization (2444-3180, 737 lines), background tasks and the memory writer (3618-4030),
subagent panel (4200-4262), telemetry properties (4328-4429), delegation (4439-4974, 536 lines), and assorted
entry points (code actions, MDM, code index, marketplace, OAuth callbacks, MCP directory helpers).

## Change-point counts (the main maintainability metric)

| Change                | Today                                                                                            | Target                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Add a native tool     | 12 edits in 9 files, plus up to 7 policy lists (`search_task_history` touched 11 non-test files) | about 3 after CORE-R4                                                           |
| Add a setting         | 5 backend edits in 3 files (3 inside ClineProvider), 2 to 3 webview edits                        | 2 after CORE-R1 and WEB-3                                                       |
| Add a webview message | 3 edits (5 with a response), inside a 3,613-line file                                            | same count, in a domain file under 400 lines with a typed payload after CORE-R3 |

## Phase 3 items

### CORE-Q Quick wins (each under an hour, each with its test)

1. Delete 12 dead handler cases (about 156 lines; no producer anywhere): `allowedCommands` (1196-1211),
   `deniedCommands` (1212-1227), `saveApiConfiguration` (1755-1769), `getListApiConfiguration` (1891-1903),
   `cloudButtonClicked` (2248-2252), `cloudLandingPageSignIn` (2265-2275), `clearCloudAuthSkipModel` (2369-2374),
   `installMarketplaceItemWithParameters` (2883-2900), `moveSkill` (2949-2952), `insertTextIntoTextarea`
   (3121-3131), `checkBranchWorktreeInclude` (3499-3527), `checkoutBranch` (3545-3556). Also delete 10
   `WebviewMessage` literals with neither producer nor handler (`cancelMarketplaceInstall`, `codebaseIndexEnabled`,
   `currentApiConfigName`, `imageGenerationSettings`, `marketplaceButtonClicked`, `playSound`,
   `setApiConfigPassword`, `setopenAiCustomModelInfo`, `switchMode`, `updateCondensingPrompt`). Adapt
   `storageErrorToast.spec` and `skillsMessageHandler.spec`.
2. Delete dead members: `ApiRequestBuilder.prepareConversationHistory` and `buildRequestMetadata` (426-471, never
   called copies of `TaskApiLoop.ts:1195-1233`); `ClineProvider.isActiveTask` (1110-1123),
   `hasProviderProfileEntry` (1955-1957), `ClineProviderEvents` (125); `loadAgentRulesFile`
   (`custom-instructions.ts:366`); `NativeToolCallParser.hasActiveStreamingToolCalls` (272-274);
   `SearchAndReplaceTool.ts` and its alias at `EditTool.ts:287`; `getRecentTasks` (3442-3485) with its 6 cache
   invalidations and `TaskProviderLike.getRecentTasks` (adapt test UTH-04); the unreachable second race check in
   `cancelTask` (4117-4126, no `await` since the first check); the rest of the knip list.
3. Fix misleading comments: `ClineProvider.ts:223-230` (describes a different mechanism), 292-321 (orphaned),
   4671 (stale line reference).
4. Extract pure helpers `findLastNewTaskToolUse`, `hasToolResultFor`, `formatSubtaskResult` with table tests
   (first step of CORE-R2; removes the duplicated scans at 4674-4686 / 4814-4825 and the 3 copies of the result
   text at 4839, 4854, 4872).
5. `getHistoryItem(id)` for the 17 of 18 `getTaskWithId` callers that do not need the conversation (today each
   parses the whole `api_conversation_history.json`).
6. Merge `initializeCloudProfileSync` (727-741) into `initializeCloudProfileSyncWhenReady` (795-808).
7. One `sanitizeCommandList` for the 4 copies (`webviewMessageHandler.ts:674-693`, the dead cases above,
   `ClineProvider.ts:2583-2593`).
8. Cache the codex auth boolean read on every state push (`ClineProvider.ts:2928-2935` calls
   `isAuthenticated()`, which reads secret storage and can trigger a token refresh); invalidate on sign-in and
   sign-out. Read `telemetrySetting` directly in `webviewDidLaunch` instead of building the whole state
   (`webviewMessageHandler.ts:618-622`).
9. Remove `migrateSettings` (`extension.ts:157`, its util and 7 tests) if owner decision 7 is yes.

**Status (2026-09-24):** DONE in #267 (all 9 sub-items; `migrateSettings` removed per decision 7). New
`src/core/webview/delegationHistory.ts`; `getHistoryItem` used by 17 of 18 callers (only `exportTaskWithId` reads the
conversation); codex auth cache lives in the OAuth manager (invalidated on credential change, incl. other windows).
Left for later: `SkillsManager.moveSkill` and `skills:errors.missing_move_fields` are now unused; 11 more
`WebviewMessage` literals without a handler (listed in a comment at the handler `default` branch).

### CORE-R10 Fix the layering

**Evidence:**

- A real runtime cycle: `ClineProvider.ts:92` imports `setPanel` from `activate/registerCommands.ts`, which keeps
  module-level panels (`:32-33`) and itself constructs `new ClineProvider` (`:263`).
- `src/shared/modes.ts:1` imports `vscode` and `:12` imports `core/prompts`, yet the webview bundles the file via
  `@roo/modes` (for example `ChatTextArea.tsx:7`); it builds only because Vite externalizes `vscode`.
- Services import the concrete god classes: `McpHub.ts:33`, `McpServerManager.ts:3`, `WorkspaceTracker.ts:5`,
  `DiffViewProvider.ts:10`.
- The syntactic import graph has a 65-file strongly connected component, but the sampled cycles are type-only
  (elided under `isolatedModules`). Do not chase it; fix the two real problems above.

**Change:** a `panelRegistry` module in `core/webview`; move `getAllModesWithPrompts` and `getFullModeDetails` into
`core/prompts` (shared with SVC-16); narrow provider interfaces for services, following the local interface at
`AttemptCompletionTool.ts:28`. **Size** S to M, low risk. **Tests:** `extension.spec` (4), `McpHub.spec`, the
webview mode-selector tests; TEST-8 guards the bundle.

**Status (2026-09-24):** DONE in #269. `core/webview/panelRegistry.ts` breaks the ClineProvider/registerCommands cycle;
`getAllModesWithPrompts` and `getFullModeDetails` moved to `core/prompts/modeDetails.ts`, `shared/modes.ts` is pure and
its lint exemption is gone (webview build no longer warns about extension-only modules); narrow interfaces
`McpHubProvider`, `WorkspaceTrackerProvider`, `DiffViewTask`, `DiagnosticsTask`; `src/__tests__/layering.spec.ts`
pins the edges. Left: unused `taskRef` fields (SVC-17); a general "shared must not import core" rule (SVC-16/PKG-6).

### CORE-R5 Make the Task access interfaces type-check

**Evidence:** `Task.ts:941-993` has 8 casts `this as unknown as XAccess`; a probe compile shows they hide real
mismatches ("Property 'globalStoragePath' is private in type 'Task' but not in type 'TaskHistoryAccess'").
Task has 87 public fields (65 mutable). ClineProvider writes private state through `(task as any)._taskMode`
(1827) and `(task as any).apiConfiguration` (1943). `core/tools` contains `task.consecutiveMistakeCount++` 82
times. The "narrow" access interfaces are not narrow (TaskApiLoopAccess has 60 members).

**Change:** make the exposed fields explicitly public (or group them in a `TaskState` object) so `new
TaskHistory(this)` compiles without a cast; add setters for mode and API configuration; add
`BaseTool.recordFailure(task, ...)` for the mistake-count, `recordToolError`, `didToolFail` triplet.
**Test first:** a compile-time assertion file (`const _: TaskHistoryAccess = null as unknown as Task`), which
fails today and is the acceptance gate. **Size** M, low risk (types only).

**Status (2026-09-24):** DONE in #271. `Task.access-types.spec.ts` (checked by `tsc`) assigns Task to all 8 access
interfaces without a cast (7 of 8 failed before); 18 members made public with reasons; interface drift fixed
(`checkpointSave` parameter names, a phantom `dispose`); `Task.setTaskMode()` replaces `(task as any)._taskMode`;
`BaseTool.recordFailure` replaces 72 of 82 sites. Found, not fixed (behavior change, own item): 7 `EditFileTool` sites
and 1 `CodebaseSearchTool` site grow the mistake count without `recordToolError`. Access interfaces are still wide.

## Phase 4 items

### CORE-R1 One settings-defaults table and one state builder

**Evidence:** `getState` (2946-3180) and `getStateToPostToWebview` (2607-2938, destructuring 100 fields at
2627-2726) apply the same ~90 defaults twice, and have drifted: `soundVolume ?? 0.5` and
`codebaseIndexEmbedderModelDimension ?? 1536` exist only in the post builder (2842, 2899), `telemetrySetting ||
"unset"` only in `getState` (3129), `customSound*` are `?? null` in one and raw in the other. Default literals
are repeated elsewhere too (`maxDiagnosticMessages ?? 50` at `ClineProvider.ts:2917, 3167`, `TaskApiLoop.ts:555`,
`DiagnosticsCollector.ts:71`). `getState()` is the de-facto settings accessor for 33 files. The webview adds a
third copy (DEF-C25). Decided value for the conflicting terminal timeout: 30,000 ms (owner decision 4a).

**Change:** a typed `SETTINGS_DEFAULTS` table and a pure `resolveSettings(values)` in `packages/types` (so the
webview and the CLI use the same table); a `ProviderStateBuilder` with narrow dependencies where `getState =
resolveSettings + cloud facts` and `getStateToPostToWebview = getState + view-only fields`; the three
`postStateToWebview*` entry points stay as thin wrappers with unchanged semantics.

**Tests first:** golden snapshots of both methods for an empty `ContextProxy`, a fully populated one and a missing
CloudService; a parity test (every key present in both views has the same value). They pin today's drift so each
difference is resolved on purpose. **Existing:** `ClineProvider.spec.ts` (91, about 8 on `getState`),
`ClineProvider.taskHistory` (29), `storageError` (3), `reacquire` (5), `telemetrySettingsTracking` (6).
**Size** M, low to medium risk (the webview depends on null versus undefined).

**Status (2026-09-25):** DONE in #276 (merge bad00b8fb). `SETTINGS_DEFAULTS` and `resolveSettings` live in
`packages/types/src/settings-defaults.ts`; `ProviderStateBuilder.ts` (434 lines) builds both views; ClineProvider
went from 4,946 to 4,342 lines. The posted webview state is byte-identical (snapshots unchanged); only `getState`
changed: `soundVolume` 0.5 and `customSound*` null in both views, `telemetrySetting ?? "unset"`,
`lockApiConfigAcrossModes ?? false`. Kept on purpose: the view-only 1536 embedder dimension, the workspace-merged
command lists (view only), `taskHistory: []` in `getState`. Duplicate default literals replaced in 14 modules. New
`ClineProvider.stateBuilder.spec` (11 tests); the five named specs stay at 145. Findings: DEF-C41, DEF-C42 in
`02-defects.md`; `resolveWebviewView` keeps its own terminal defaults (only reached with a stubbed `getState`);
`logWebviewHiddenDiagnostics` tests depend on the microtask count (the spec's `fs/promises` mock lacks `default`).

### CORE-R3 Split `webviewMessageHandler` into domain modules behind a lookup map

**Evidence:** 3,613 lines, one function, 149 cases; `WebviewMessage` is one interface with 174 type literals and
72 optional fields; `message.text` is read 59 times with different meanings; 98 of the 149 message types are not
mentioned by any test; shared closures are rebuilt on every message (100-543); business logic sits inline
(profile rename and delete 1775-1866, `saveCodeIndexSettingsAtomic` 2408-2567, untested); 23 copies of
`JSON.stringify(error, Object.getOwnPropertyNames(error), 2)`; checkpoint preservation copied between delete and
edit confirm (282-305 / 408-431, 327-342 / 497-512).

**Change:** `Record<WebviewMessage["type"], Handler>` assembled from about 14 domain modules (task lifecycle ~450
lines, code index ~370, custom modes import/export ~290, worktrees ~270, commands and skills ~215, debug and misc
~210, cloud and codex auth ~190, enhance/system prompt/search ~165, provider profiles ~150, marketplace ~135, MCP
~120, prompts and modes ~115, files/images/checkpoints ~110, subagents ~50); a `HandlerContext` for state access;
a `logAndToast(error, i18nKey)` helper. A per-type discriminated union in `packages/types` comes later, additively
(see "do not touch" in the master plan).

**Tests first:** the routing snapshot (for each of the 149 types, which provider methods run and which messages
are posted, against the existing `mockClineProvider`); explicit tests for `saveCodeIndexSettingsAtomic` and
`importMode`/`exportMode` before moving them. **Existing:** 9 `webviewMessageHandler.*` specs (72 tests),
`skillsMessageHandler` (20), `checkpointRestoreHandler` (7), `messageEnhancer` (17). **Size** M to L, mechanical,
low risk. Do CORE-Q1 first.

**Status (2026-09-25):** DONE in #274 (merge dd1748a6d). `webviewMessageHandler.ts` is now 25 lines that look up
a handler in the table built by `messageHandlers/index.ts` from 16 domain modules (the largest, `messageEdits`, has
418 lines). The switch had 137 cases, not 149. About 40 message types have no handler, so the table type is a
partial record. There were 21 copies of the error serialization, not 23: 9 became `logAndToast`, 12 became
`serializeError`. The checkpoint-preservation code is now `rewindKeepingCheckpoints` plus `findNextCheckpoint`.
Tests first: a routing snapshot (148 tests, unchanged after the split), `saveCodeIndexSettingsAtomic` (10),
`importMode`/`exportMode` (12), and a registry guard (3). Related specs went from 116 to 289 tests, all green.

### CORE-R2 A delegation service

**Evidence:** the most race-sensitive state machine in the extension is spread over `delegateParentAndOpenChild`
(4439-4590), `tryReattachDelegatedParent` (4613-4729), `reopenParentFromDelegation` (4734-4974), repair code in
`removeClineFromStack` (906-928) and `cancelTask` (4132-4181) that duplicate the same transition (910-915 /
4138-4143), plus writers in `AttemptCompletionTool.ts:96-114` and `RunParallelTasksTool.ts:340`.

**Change:** after CORE-Q4, a `DelegationService` over `TaskHistoryStore` with explicit transitions (`delegate`,
`detach`, `reattach`, `complete`); ClineProvider keeps one-line delegators.

**Tests first:** a transition-table test on an in-memory `TaskHistoryStore`. **Existing:** 8 delegation specs
under `src/__tests__` (34 tests), `ClineProvider.delegation-cancel-races` (14), `attemptCompletionTool` (20).
**Caveat:** 57 test call sites use `ClineProvider.prototype.X.call(fakeThis)`; adapt each in the PR that moves its
method, never ahead of time. **Size** M, medium risk.

**Status (2026-09-25):** DONE in #280 (merge 8d4d074b7). `DelegationService.ts` (689 lines) owns the transitions
`delegate`, `detach` (the one copy of the repair that `removeClineFromStack` and `cancelTask` duplicated),
`detachOnCancel`, `reattach`, `complete`, plus `parentAwaitsChild` (shared with AttemptCompletionTool) and the
blocked-children set; it reaches the provider through a narrow `DelegationHost`. ClineProvider went from 4,342 to
3,815 lines and keeps one-line delegators. Deviation: the `parallelChildIds` write in `RunParallelTasksTool` stays,
it records the parallel relation, not delegation. New `DelegationService.spec` transition table (36 tests); the
related specs went from 259 to 295 tests. Finding (pinned, not fixed): `detach` requires parent status
`"delegated"`, while the completion guard (since 2026-06-08) also accepts an `"active"` parent still awaiting the
child, so cancelling such a child leaves the parent waiting and the child linked.

### CORE-R9 One tool-callback factory in `presentAssistantMessage`

**Evidence:** the function is 1,163 lines (133-1295); callbacks are built twice, for `mcp_tool_use` (211-332) and
`tool_use` (635-760), about 120 lines in 3 clones, drifted (only the MCP copy has the `feedbackImages` parameter
and the `if (toolCallId)` guard). **Change:** `createToolCallbacks(task, {block, toolCallId, toolName})`.
**Test first:** feedback-image merge for both block kinds. **Existing:** 42 `presentAssistantMessage-*` tests.
**Size** S to M.

**Status (2026-09-25):** DONE in #277 (merge e110d685b). `toolCallbacks.ts` holds `createToolCallbacks(task, {block,
toolCallId, toolName})` (askApproval, handleError, pushToolResult, askFinishSubTaskApproval, hasToolResult) and
`recordToolFailureAsMistake`; presentAssistantMessage went from 1,315 to 1,016 lines. Drift resolved without
behavior change: `feedbackImages` was a dead parameter (removed); the `if (toolCallId)` guard is kept for both kinds;
the two duplicate-result warning texts stay per block type. Tests: 15 characterization tests for both block kinds
plus 5 factory tests; `src/core/assistant-message` went from 102 to 122 tests. For CORE-R4: the dispatch switch
passes `toolCallId` only to some tools (not execute_command, read_artifact, use_mcp_tool, access_mcp_resource,
ask_followup_question, generate_image, attempt_completion); decide deliberately when the switch becomes a table.

### CORE-R4 Tool descriptor table (in slices)

**Evidence:** tool names are hand-listed in about 15 places: `packages/types` `tool.ts`; four lists in
`shared/tools.ts` (`toolParamNames`, `NativeToolArgs`, `TOOL_DISPLAY_NAMES`, `TOOL_GROUPS`);
`native-tools/index.ts` and `examples.ts`; 2 switches and 8 checkpoint calls in `presentAssistantMessage`; 2
switches in `NativeToolCallParser`; 2 sets in `TaskStreamProcessor`; `microcompact.ts:145-156`;
`spillPolicy.ts:60-68`; `filter-tools-for-mode.ts:80`; `auto-approval/tools.ts`; `ledger/classify.ts`. Drift
already happened (DEF-C7, and the partial-parse switch lacks `access_mcp_resource`, `read_artifact`,
`read_command_output`).

**Change:** (a) a `TOOL_DESCRIPTORS` table (`name`, `instance`, `requiresCheckpoint`, `workspaceReadOnly`,
`compactable`, `spillExempt`, `slimAllowed`, `describe(block)`) with every set derived from it; (b) the execution
switch becomes a lookup; (c) `parseArgs(raw, {partial})` per tool, which absorbs the duplicated read_file
coercion; (d) an `approvalCategory` field that absorbs the auto-approval checks. **Tests first:** table-driven
dispatch test (handler, checkpoint, description per tool), a partial-parse snapshot per tool, set-equality tests
pinning today's lists. **Existing:** `presentAssistantMessage-*` (42), `NativeToolCallParser.spec` (32, with a
completeness guard at `:471`), `eager-checkpoint` (6), `spillPolicy` (21), `microcompact` (30),
`checkAutoApproval` (35). **Size** L overall, (a) plus (b) is M. Do CORE-R9 first.

**Status (2026-09-25):** (a) and (b) DONE in #281 (merge d4286d1c1). `src/core/tools/toolDescriptors.ts` holds
`TOOL_DESCRIPTORS` keyed by `Exclude<ToolName, "custom_tool">` (a missing row fails to compile); the dispatch is a
lookup in `src/core/assistant-message/toolHandlers.ts` (instances kept in a separate table with the same key type,
because importing every tool pulls `vscode` and Task into microcompact, spillPolicy and the tool filter; own-property
lookup only). presentAssistantMessage went from 1,016 to 693 lines. Derived now: checkpointed tools (dispatch and
eager start), the TaskStreamProcessor read-only set, `COMPACTABLE_TOOL_NAMES`, the tool part of
`SPILL_BYPASS_TOOLS`, `SLIM_TOOLSET_ALLOWLIST`, `FILE_MUTATION_TOOLS`/`FILE_READ_TOOLS` in ledger/classify, and the
call descriptions. Still hand-kept: `PROTOCOL_TOOL_NAMES` (`src/shared` must not import `core`), the legacy
`insert_content`, parser switches (c), approval lists (d), prompt/schema lists. Every tool now receives
`toolCallId` (the seven that did not never read it). Every list kept today's content. Tests: related specs went
from 381 to 580. Finding for a defect item: `getToolMinimalExample` (`native-tools/examples.ts`) looks names up
through the prototype chain (`__proto__` yields `{}`, `constructor` yields a `failed_tool`), harmless today.

### CORE-R8 Merge the edit-tool pipelines

**Evidence:** `EditTool.ts:147-233` and `SearchReplaceTool.ts:142-228` are an 87-line clone that drifted
(DEF-C2); `ApplyPatchTool.ts:185-222`, `EditTool.ts:180-219`, `EditFileTool.ts:410-450` share 37 lines of
approval, diff view and save; three different `$` strategies exist (`EditFileTool.ts:62-68` escapes, EditTool uses
a replacer, SearchReplaceTool none). **Change:** one `applyComputedEdit(task, relPath, newContent, callbacks,
{toolName})`; `search_replace` becomes `edit` with `replace_all = false` (keep the tool name, weak models and
xAI use it). **Tests first:** `$` patterns and the plan-review gate for every edit tool. **Existing:** `editTool`
(16), `searchReplaceTool` (18), `editFileTool` (39), `writeToFileTool` (26), `applyPatchTool`, `applyDiffTool`.
**Size** M, medium risk.

**Status (2026-09-25):** DONE in #283. `helpers/applyComputedEdit.ts` holds the shared sequence (diff view,
approval, save, plan-review pause) with per-tool options (card type, result suffix, review path, a save hook for
the `apply_patch` move); `helpers/replaceLiteral.ts` is the one literal replacement (replacer function, so `$&`,
`$1`, `$$` stay literal) for all tools. `search_replace` calls the shared `runStringReplace()` of EditTool with
`replace_all` forced to false; its name, schema and model-facing texts are unchanged. A function, not a base class,
because the tool modules form an import cycle ("Class extends value undefined"). ApplyDiffTool and WriteToFileTool
untouched. Drift fixed (each pinned by a test that failed first): `task.silentWrites` now keeps every edit tool
off-screen (a background memory writer using edit, search_replace or apply_patch opened a diff tab); `edit`
relativizes an absolute path like the others (the file-context tracker kept two entries). Edit tools went from
1,590 to 1,303 lines; related specs from 367 to 411 tests (new `editPipeline.spec`, 44). Findings kept as is:
`apply_patch` with several files continues after one is rejected or fails; for a move, the destination checks
(ignore rules, write protection, outside workspace) run only after the approval (still before writing).

### CORE-R12 Per-task tool state

Fixes DEF-C3 and DEF-C4 structurally: `approvedTodoList` moves onto the Task; tool partial-stream state moves into
`task.toolStreamState` (or stateful tools are instantiated per task). **Tests first:** two-task interleaving tests
shaped like the parser's TL-1 test (`NativeToolCallParser.spec.ts:639`). **Existing:** `updateTodoListTool` (21),
`writeToFileTool` (26), `editFileTool` (39), `RunParallelTasksTool` (35). **Size** S to M.

### CORE-R11 A system-prompt options object and one prompt-input builder

**Evidence:** `system.ts:298-316` takes 17 positional parameters; `supportsComputerUse` is always `false` and
unused; both production callers pass `undefined` placeholders; the preview (`generateSystemPrompt.ts`) and the
live path build the inputs separately and have drifted (DEF-C1; the preview also passes `modelId: undefined` and no
deferred tools). **Change:** an options object and `buildSystemPromptInput(source)` shared by both paths.
**Test first:** preview-equals-live parity. **Existing:** `system-prompt` (16) and `prefix-stability` (25, protects
the prompt-cache prefix bytes, which must not change). **Size** S to M.

### CORE-R6 The rest of the ClineProvider split

After CORE-R1 and CORE-R2. Target: ClineProvider under about 1,500 lines, acting as a facade.

| Order | Extraction                                                                     | Size | Risk   | Tests to add first                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------ | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a     | `TaskHistoryGateway` (491-702, 2183-2442, 3196-3250)                           | M    | low    | existing reacquire (5), storageError (3), taskHistory (29) construct a real provider                                                                                                                                              |
| b     | `CloudProfileSync` (727-808)                                                   | S    | low    |                                                                                                                                                                                                                                   |
| c     | Profile and mode binding (1801-2106, 3766-3799)                                | M    | medium | matrix for `createTaskWithHistoryItem` and `handleModeSwitch` over (mode exists, config name set, lock, CLI settings, empty profile); the mode-to-profile resolution exists in 3 drifted copies (1378-1416, 1862-1890, 3766-3799) |
| d     | `BackgroundTaskRunner` (3618-4030)                                             | M    | medium | `memorySubTaskRunner` retry classification                                                                                                                                                                                        |
| e     | `WebviewHtml` (1595-1774), shared with `PlanReviewPanel.ts:116-137` (a clone)  | S    | low    |                                                                                                                                                                                                                                   |
| f     | Task-event forwarding table (357-459, 14 events attached and detached by hand) | S    | low    |                                                                                                                                                                                                                                   |

### CORE-R7 Performance (Phase 10; mechanism verified, magnitude to be measured)

| #   | Mechanism                                                                                                                                                                                              | Evidence                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Full state push, including the whole `clineMessages` array, for every new message; no throttle                                                                                                         | `TaskHistory.ts:374-406` calls `postStateToWebviewWithoutTaskHistory` (`ClineProvider.ts:2807`); extra full pushes at `TaskApiLoop.ts:501`, `TaskStreamProcessor.ts:584` |
| P2  | Full persistence on every message: `structuredClone`, locked streamed write, `getApiMetrics` over all messages, store upsert, webview post; 17 call sites, no debounce, O(n) per save, O(n^2) per task | `TaskHistory.ts:460-492`, `taskMetadata.ts:85`                                                                                                                           |
| P3  | `getState()` (two `getValues()` plus a zod parse) runs for every streamed tool-argument delta, before any partial check                                                                                | `TaskStreamProcessor.ts:419`, `presentAssistantMessage.ts:443`, `TaskAskSay.ts:103`, `ContextProxy.ts:520-530`                                                           |
| P4  | Secret-storage read or token refresh inside the state serializer                                                                                                                                       | CORE-Q8                                                                                                                                                                  |
| P5  | `getTaskWithId` parses the whole conversation file for callers that only need the history item                                                                                                         | CORE-Q5                                                                                                                                                                  |
| P6  | 31 handler cases post the full state, which sorts the whole history                                                                                                                                    | `TaskHistoryStore.ts:494-496`                                                                                                                                            |

**Order:** (1) counters behind a debug flag (`getState` calls, bytes posted, saves per turn) and one agent-bench
run for a baseline; (2) CORE-Q5 and CORE-Q8; (3) skip or memoize `getState` for partial blocks; (4) only then a
trailing-debounced `saveClineMessages` that flushes on abort, completion and dispose, and incremental
`messageAdded` pushes instead of full state. Step 4 is medium-high risk because it touches the webview's
`clineMessagesSeq` ordering. **Test first:** a spy-count test ("N messages cause N pushes and N saves") that pins
today's numbers and is updated deliberately. **Existing:** `Task.persistence` (9), `Task.throttle` (19),
`ask-finalized-dedup` (21), `flicker-free-cancel` (4).

## Suggested order

CORE-Q (Phase 3), CORE-R10, CORE-R5, then CORE-R1, CORE-R3, CORE-R2, CORE-R9, CORE-R4 (a, b), CORE-R8, CORE-R12,
CORE-R11, CORE-R6 (a to f), CORE-R4 (c, d), CORE-R7 in Phase 10.
