# Providers and services: `src/api`, `src/services`, `src/integrations`, `src/utils`, `src/shared`

Phase 5 is the provider layer (`API-*`), Phase 6 the services (`SVC-*`). Defects found here are in
`02-defects.md` (C9 to C23) and are fixed first. SDK major upgrades (DEP-6) wait for Phase 5, because afterwards
each protocol has one stream loop instead of up to eight.

## The provider layer in numbers

- 20 runtime provider ids, 21 handler classes, 4 abstract bases (`BaseProvider`,
  `BaseOpenAiCompatibleProvider`, `RouterProvider`, `OpenAICompatibleHandler`).
- **9 wire-protocol families, not the "three streaming implementations" the July plan assumed:**
    - OpenAI Chat Completions: **8 separate stream loops in 7 files** (`openai.ts` main path 288-316 and O3 path
      575-612, `base-openai-compatible-provider.ts` 158-202, `deepseek.ts` 146-181, `lm-studio.ts` 151-185,
      `qwen-code.ts` 246-306, `openrouter.ts` ~400-520, `lite-llm.ts` 231-296).
    - OpenAI Responses API: 3 implementations (`openai-native` and `openai-codex` are near-forks with `processEvent`
      of 246 and 239 lines; `transform/responses-api-stream.ts` serves only xai).
    - Anthropic Messages: 3 copies (`anthropic`, `minimax` identical over 125 lines, `anthropic-vertex` a variant).
    - Vercel AI SDK: 1 implementation serving only Moonshot.
    - One each: Bedrock Converse, Google GenAI, Mistral, Ollama, VS Code LM.
- Duplicates: about 47 usage-chunk construction sites in 19 files; 3 strict tool-schema converters; 5
  cache-breakpoint helpers (`openai.ts:207-231` says "copied from openrouter"); 4 provider-to-model-id-field maps (two
  disagree, DEF-C15); 3 policies for an unknown model id across 14 `getModel` implementations; `r1-format.ts` and
  `zai-format.ts` have identical ~240-line bodies.
- Shared contracts most providers skip: only 4 handler classes implement `cancelRequest`; the status-preserving
  error helpers are used by 7 of 21 handlers.

### Drift already observed (the case for API-1 to API-13)

| #   | Drift                                                                                                   | Evidence                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Usage: upstream fixed "keep only the last usage" on the main path only                                  | `openai.ts:604-610`, `qwen-code.ts:301-307` (DEF-C12)                                                                                                   |
| D2  | Abort signal added to the base stream in #118, not to overrides                                         | `zai.ts:140-146`, `deepseek.ts:133-142`; native and codex never abort (DEF-C11)                                                                         |
| D3  | `Array.isArray(delta.tool_calls)` guard added for proxies, missing in LiteLLM (a proxy) and `openai.ts` | `lite-llm.ts:242-252`, `openai.ts:621-652`                                                                                                              |
| D4  | Responses API fixes applied to one of two forks                                                         | today's `7be31a426` added GPT-5.6 `cache_write_tokens` to openai-native only (`openai-codex.ts:115-152`); `ea7da97a4` and `f2b16d400` had to patch both |
| D5  | Null handling in strict schemas differs                                                                 | `base-provider.ts:90-93` strips `null`; native and codex keep it (and the base version mutates, DEF-C10)                                                |
| D6  | Max output tokens cap bypassed                                                                          | DEF-C22                                                                                                                                                 |
| D7  | Cache-write field name differs between one-shot and streaming                                           | DEF-C23                                                                                                                                                 |

## Where the prior plans stand

| Prior item                                                    | Status                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider registry (backend #2, Theme D)                       | PARTIAL: `runtime-provider-registry.ts:46-68` with a compile-time completeness check, the portable inventory in `packages/types/src/provider-registry.ts:48-104`, `buildApiHandler` is 12 lines. Open: 2 hard-coded provider checks, the drifted `ProfileValidator`, 4 model-id maps, no capability flags (API-6) |
| McpHub split (backend #7, Theme F)                            | OPEN, 1,995 to 2,012 lines (SVC-8)                                                                                                                                                                                                                                                                                |
| Big provider files (backend #8, Theme G)                      | OPEN: bedrock 1,661 (its `createMessage` alone 387-797), openai-native 1,612, openai-codex 1,221. The native/codex fork is the real problem, not file size (API-13)                                                                                                                                               |
| Lazy DecorationController (B26), DiffViewProvider split (B27) | DONE (686 + 328 + 89 lines); remainder in SVC-17                                                                                                                                                                                                                                                                  |
| Shared stream-delta helpers (B31)                             | DONE for the 5 named providers, PARTIAL overall (D3)                                                                                                                                                                                                                                                              |
| "Unify the three streaming implementations" (deferred)        | OPEN, premise outdated: see API-2, API-4, API-7, API-13                                                                                                                                                                                                                                                           |
| `@deprecated` exports (backend 5.2)                           | Mostly OPEN: `extractEnvironmentDetailsForMiniMax` has no callers; `openai-error-handler.ts` is deprecated but imported by 7 providers (API-1)                                                                                                                                                                    |

## Phase 5: provider layer

### API-1 One error-normalization contract

**Evidence:** re-wraps that drop `status`: `lm-studio.ts:222-226, 245-249`, `lite-llm.ts:293-297, 333-337`,
`mistral.ts:112, 228`, `native-ollama.ts:353-356, 425-428`, `anthropic-vertex.ts:319-322`; `openai.ts:454-457`
double-prefixes ("OpenAI completion error: OpenAI completion error: ..."). `BackgroundModelHandler.isFallbackTriggerError`
(22-48) and `apiErrors.isRetryableApiError` decide on `status`/`code` only, so a background compaction model on
LM Studio or LiteLLM cannot fall back on 400 or 429. `RetryHandler.shouldRetry` (`RetryHandler.ts:125`) has zero
callers although `apiErrors.ts:4` says it keeps both in sync.

**Change:** every `catch` goes through `handleProviderError(error, name, {messagePrefix})`; delete
`openai-error-handler.ts` (a deprecated duplicate of `error-handler.ts:111`) and re-point its 7 importers; delete or
wire `shouldRetry`. **Test first:** a `describe.each` over all handlers: a 429, 400 and 401 from the SDK surface
with `.status` intact from `createMessage` and `completePromptWithUsage`, and `isFallbackTriggerError` returns true.
**Existing:** `error-handler.spec` (25), `openai-error-handler.spec` (16), `BackgroundModelHandler.spec` (21).
**Size** S to M, low risk.

### API-3 One pure strict-schema converter

`transform/strict-json-schema.ts` exporting `toStrictSchema(schema, {stripNull, mcp})` that copies instead of
mutating and replaces the 3 copies (`base-provider.ts:66-109`, `openai-native.ts:244-277`,
`openai-codex.ts:236-265`). **Test first:** input deep-equal before and after; `execute_command` keeps
`["string","null"]` after an OpenAI-compatible request (this is DEF-C10's test). **Existing:** `base-provider.spec`
(15), `openai-native-tools` (9), `openai-codex-native-tool-calls` (8), `native-tools/__tests__/converters.spec`.
**Size** S.

### API-2 One Anthropic-protocol stream adapter

**Evidence:** `anthropic.ts:225-350` and `minimax.ts:120-243` differ only in comments; `anthropic-vertex.ts:120-211`
is a third variant; the last-two-user-messages `cache_control` logic is copied (`anthropic.ts:150-175`,
`minimax.ts:244-273`); DEF-C9 lives in two copies. **Change:** `transform/anthropic-stream.ts` with
`processAnthropicStream(stream)` yielding tokens only (cost computed centrally, which fixes DEF-C9 by construction)
and one `addAnthropicCacheControl(messages)`. **Test first:** one scripted event sequence (message_start with cache,
2 thinking deltas, text, tool_use with input_json deltas, message_delta output) replayed through all 3 handlers,
pinning the exact chunk list. **Existing:** `anthropic.spec` (48), `minimax.spec` (30), `anthropic-vertex.spec`
(37). **Size** S to M, low risk.

### API-4 Retire the Vercel AI SDK path

**Evidence:** `openai-compatible.ts` (270 lines) and `transform/ai-sdk.ts` (282) serve only `moonshot.ts`; that path
passes no abort signal, ignores `timeoutMs`, and drops `error` and incremental tool-call parts (DEF-C14).
**Change:** re-base Moonshot on `BaseOpenAiCompatibleProvider` as Z.ai is (override `processUsageMetrics` for the
top-level `cached_tokens`, send `max_tokens`), then delete `openai-compatible.ts`, `ai-sdk.ts`, and the `ai` and
`@ai-sdk/openai-compatible` packages. **Test first:** Moonshot request-body characterization (`max_tokens`,
temperature, tools) and usage mapping with top-level `cached_tokens`; check reasoning round-tripping [I].
**Existing:** `moonshot.spec` (22), `base-openai-compatible-provider.spec` (23), `zai.spec` (56); `ai-sdk.spec` (23)
is deleted with the code. **Size** M.

### API-6 Complete the provider definitions

**Evidence:** the 2 hard-coded provider checks; DEF-C15; 3 unknown-model-id policies (keep the id with default
info: mistral, qwen-code, deepseek, moonshot; silently substitute the default: xai, minimax, anthropic-vertex,
openai-native, codex, zai via `base-openai-compatible-provider.ts:290-296`; honor custom ids: anthropic, gemini);
`buildApiHandler` is used just to read model info (`ProviderSettingsManager.ts:719`, `generateSystemPrompt.ts:36`);
constructing `VsCodeLmHandler` subscribes `onDidChangeConfiguration` (`vscode-lm.ts:78-87`) and nothing disposes it
(`ApiHandler` has no `dispose`; 6 build sites). In `packages/types`, `provider-config/configs.ts` holds a second copy
of the 21 per-provider schemas (PKG-7).

**Change:** the runtime entry becomes `{factory, capabilities: {allowedFunctionNames, needsModelPreload},
modelIdField, models?, defaultModelId?, unknownModelPolicy, resolveModel(settings)}`; derive `ProfileValidator`,
`modelIdKeysByProvider` and the webview maps from it; add optional `dispose()` to `ApiHandler` and call it where
handlers are rebuilt. The unknown-id policy is owner decision 5. **Tests first:** every runtime provider has a
`modelIdField` and the validator resolves a model for it; one unknown-id test per provider pinning today's policy.
**Existing:** `runtime-provider-registry.spec` (7), `provider-registry.spec` (10), `ProfileValidator.spec` (19).
**Size** M.

### API-7 One Chat Completions stream adapter and shared usage normalizers

**Evidence:** the 8 loops above; D1, D3, D7; reasoning handled 3 ways (`reasoning_content`, OpenRouter
`reasoning_details`, none in LM Studio); `<think>` tags via TagMatcher in 3 loops, while `qwen-code.ts:266-289`
splits per chunk statelessly (leaks multi-chunk thoughts as text) and `:258-262` can drop characters;
`finish_reason` missing in `lite-llm` and `openai.ts`.

**Change:** `streamChatCompletion(stream, {thinkTags, reasoning: "reasoning_content" | "openrouter", usage:
"last"})` yielding text, reasoning, tool partials, finish reason and one usage chunk; usage mapping reuses
`utils/completion-usage.ts` so one-shot and streaming share one parser per wire shape; cost computed centrally
except OpenRouter (billed cost). Three PRs: adapter plus 3 providers, the other 5, then usage.

**Test first:** golden recorded SSE sequences (usage repeated every chunk, `tool_calls` not an array, a think block
split across chunks, `finish_reason: "stop"` after tool calls) replayed through each of the 8 loops, pinning today's
output including the bugs. **Existing:** `openai.spec` (77), `deepseek` (36), `lmstudio` (27), `openrouter` (24),
`lite-llm` (29), `base-openai-compatible` (28), `zai` (56), `tag-matcher` (18), `extract-reasoning` (9),
`TaskStreamProcessor.*` (16). **Size** L, medium risk. After API-1 and API-3.

### API-5 Cancellation contract in the request metadata

**Evidence:** `ApiHandlerCreateMessageMetadata` has no signal (`api/index.ts:57-102`); anthropic,
anthropic-vertex, gemini, mistral, openrouter, lite-llm, qwen-code, xai, zai (thinking), deepseek and minimax pass
none; native and codex never abort theirs; the task loop only stops reading (`TaskApiLoop.ts:191-215`), so the
server keeps generating (tokens billed, local GPUs busy); per-handler `abortController` fields are overwritten
when requests overlap. **Change:** `signal?: AbortSignal` in the metadata, passed from
`currentRequestAbortController.signal`, forwarded by every provider; `cancelRequest(destroyClient)` stays only for
the client-destroy behavior. **Test first:** per-handler contract "the SDK call receives a signal; aborting rejects
the stream". **Existing:** `openai.spec` cancel cases, `base-openai-compatible-provider.spec`, three `*-timeout`
specs, `TaskLifecycle` abort specs. **Size** M, mechanical. Easier after API-2, API-4, API-7.

### API-13 Shared Responses API core

**Evidence:** D4 plus near-identical pairs: `processEvent` (`openai-native.ts:1153-1398` /
`openai-codex.ts:897-1135`), `formatFullConversation` (465-558 / 433-513), hand-written SSE parsers in
`handleStreamResponse` (681-1152 / 621-896), `normalizeUsage`, `buildRequestBody`; xai uses a third converter.
**Change:** `ResponsesApiCore` (request body, SSE parse, event processing, usage) with hooks for auth (codex OAuth
retry) and pricing (native service tiers); xai moves onto it. **Test first:** replay the fixture events of #11621
and #10719 through both handlers and pin identical output; a codex test for GPT-5.6 `cache_write_tokens`.
**Existing:** `openai-native` (51), `openai-native-usage` (27), `openai-native-tools` (9), `openai-codex` (14),
`openai-codex-native-tool-calls` (8), `xai` (15), `responses-api-stream` (28), `responses-api-input` (14).
**Size** L, medium-high risk.

### API-18 Bedrock split (lowest priority)

`createMessage` spans 387-797; a readability-only win after API-1, API-3 and API-5. About 180 tests in 8 specs.

### API-Q Quick wins

1. Merge `r1-format.ts` and `zai-format.ts` into one function (`zai-format` has no spec and inherits
   `r1-format.spec`'s 20 cases).
2. Delete dead code knip cannot see because tests import it (vitest makes tests entry points):
   `api/provider-profile-runtime.ts` (19 lines, never wired), `api/providers/fetchers/versionedSettings.ts` (127
   lines plus a 23-case spec), `integrations/misc/read-lines.ts` (116), `integrations/misc/line-counter.ts` (167);
   `getLmStudioModels`, `readModels`, `flushModelProviders`, `extractEnvironmentDetailsForMiniMax`,
   `removeCachePoints` (`bedrock.ts:1263`), dead locals (`gemini.ts:355-359`, `openai-native.ts:686-687`), unused
   imports (`anthropic.ts:4, 22`, `mistral.ts:18`, `moonshot.ts:1`), the ignored `tool_call_end` emission in
   `openai.ts`; in `src/shared` `toFetchableModelSourceId`, `formatGitSuggestion`, `getModeConfig`, `isCustomMode`,
   the 15 unused `*ToolUse` interfaces (`tools.ts:188-279`).
3. Add `tsc --noUnusedLocals` and a "no non-test importer" scan to the dead-code routine; enabling
   `noUnusedLocals` repo-wide means 324 fixes (118 in `core/task`), so do it one folder at a time.

## Phase 6: services

### SVC-8 McpHub: pin, extract the pure parts, then split

**Evidence:** 2,012 lines, 50 methods; `connectToServer` spans 667-913 (about 39 decision points); config-path
resolution copied 7 times, schema-error formatting 3 times, transport error and close handlers 3 times, the write
guard twice (`deleteServer` at 1713 skips it); shared mutable state crosses every proposed seam (`connections`
replaced rather than mutated at 1112 and 1998, `isConnecting` with 3 writers, `fileWatchers` keyed by name only so
global and project servers collide, one `isProgrammaticUpdate` flag for both files); dead state (the global
`EventSource` override at 838, `McpServerManager.providers/notifyProviders`); `NODE_ENV === "test"` branches at 286,
364, 522. **Change:** (1) `mcpConfigSchema.ts` with the pure functions (66-148, 215-273); (2) `McpConfigStore`
(one read, parse, resolve, and the write guard) and `McpConfigWatcher` emitting events, with an injectable watcher
factory that replaces the test branches; (3) `McpConnectionManager` (`createTransport()` plus one handler) and
`McpToolCatalog`; McpHub stays as a facade. **Tests first:** the `updateServerConnections` diff (raw against
defaulted config), debounce (500 ms) and write-suppression (600 ms) windows, `deleteServer`, `restartConnection`
ordering with `isConnecting` reset on error, per-source watcher keys, `dispose` during an in-flight connect.
**Existing:** `McpHub.spec` (51), `McpHub.settingsCreation.spec` (2). **Size** M for (1) and (2), L overall,
medium to medium-high risk. After DEF-C13.

### SVC-10 Code-index lifecycle ownership

**Evidence:** a new `RooIgnoreController` per scan, never disposed (`scanner.ts:88`), each with a FileSystemWatcher
and 3 listeners; `recoverFromError` drops the orchestrator without stopping its watcher (`manager.ts:303-327`), so
two watchers end up indexing; `FileWatcher.initialize` overwrites the watcher without disposing it (115); emitters
disposed but the watcher reused after Stop; managers never disposed and nothing listens to
`onDidChangeWorkspaceFolders`. **Change:** an explicit dispose chain (manager, orchestrator, watcher, ignore
controller); idempotent `startIndexing`. **Tests first:** Stop then Start event delivery; `recoverFromError` with a
live watcher asserts dispose. **Existing:** `orchestrator` (5), `file-watcher` (5), thin. **Size** S to M.

### SVC-9 Code-index embedder base class and contract suite

**Evidence:** the token-budget batching loop exists 4 times, retry 4 times with 3 behaviors, the rate-limit trio
twice as static per-class state, `validateConfiguration` 8 times; raw i18n keys returned to users
(`openai-compatible.ts:406`, `openrouter.ts:323`); double telemetry; the OpenAI embedder drops the parent's base URL,
timeout and headers; `OpenAiEmbedder` extends the 1,612-line chat handler. **Change:** `BaseHttpEmbedder` with an
abstract `embedBatch()` and shared batching, retry, rate limit, prefix and validation. **Test first:** an embedder
contract `describe.each` (output length and order, split under `MAX_BATCH_TOKENS`, retry count and delays with fake
timers, telemetry count per failure, dimension present or absent). **Existing:** about 486 code-index tests;
`deletePointsByMultipleFilePaths` has 0. **Size** M to L. After DEF-C17.

### SVC-11 One `.roo` directory resolver with explicit precedence

**Evidence:** 5 implementations with different precedence (skills, commands with two conflicting orders at
`commands.ts:151-170` and 332, rules, MCP, roo-config); with `enableSubfolderRules` on, each system-prompt build
runs 3 full-workspace `rg --files --hidden --follow` scans with no cache (`custom-instructions.ts:232, 391/512,
429` into `roo-config/index.ts:197-214`); discovery silently capped at 500 entries (`file-search.ts:15`).
**Change:** `RooDirectoryResolver.list(cwd, {kind, precedence})`, memoized per working directory, invalidated by a
`**/.roo/**` watcher. **Test first:** a precedence matrix (project, global, built-in, mode-specific) per kind,
pinning today's behavior (precedence is user-visible). **Existing:** commands (31), roo-config (43), skills (59).
**Size** M, medium risk.

### SVC-12 One ripgrep runner

**Evidence:** 3 runners (`ripgrep/index.ts:134-172`, `file-search.ts:12-87`, `list-files.ts:654-731`); only
`list-files` has a timeout; `execRipgrep` rejects on any stderr, turning a bad regex into "No results found"
(`ripgrep/index.ts:162-163, 201-204`); `@`-mention search spawns `rg` per query and runs `existsSync`/`lstatSync` on
the extension host (`file-search.ts:114-138, 176-177`). **Test first:** timeout, stderr tolerance, limit applied
across all three callers. **Existing:** ripgrep (34), search (3). **Size** S to M.

### SVC-15 Tree-sitter parser cache and memory release

**Evidence:** `loadRequiredLanguageParsers` (`languageParser.ts:78-229`) reloads WASM grammar, Query and Parser on
every call on the definitions path (called by condense per read file; typescript grammar 2.3 MB, cpp 4.7 MB); no
`.delete()` anywhere, so WASM memory grows. **Change:** cache per language, release on dispose. **Test first:**
real-WASM tests for `.erb`, `.ejs`, `.htm`, `.elm` (DEF-C21) and a spy on `Language.load` call counts. **Existing:**
about 277 tests, all with a mocked loader. **Size** S to M. Pairs with the `web-tree-sitter` upgrade in DEP-6.

### SVC-14 Terminal process contract

**Evidence:** `emitRemainingBufferIfListening`, `hasUnretrievedOutput` and the completion handler are duplicated in
`TerminalProcess` and `ExecaTerminalProcess` with drift (throttle 100, 500 and 150 ms; `continue()` flushes in one
only; Execa may report exit code 0 when an abort wins [I]; Execa terminals never pruned, `ExecaTerminal.ts:14-16`,
`TerminalRegistry.ts:302`); output compression reruns on the whole buffer at every line event
(`ExecuteCommandTool.ts:357`). **Change:** shared buffer, completion and abort semantics in
`BaseTerminalProcess`, driven by one contract test run against both implementations. **Existing:** about 189
terminal tests. **Size** M, medium risk. After DEF-C18.

### SVC-16 Layering in `src/shared`

`shared/modes.ts` imports `vscode` (line 1) and core (line 12) but 8 webview files import it; `cloud-urls.ts` and
`vsCodeSelectorUtils.ts` are also vscode-bound. Move the extension-only functions (`getAllModesWithPrompts` at 185,
`getFullModeDetails` at 200) to `src/core`. Shared with CORE-R10; prerequisite for PKG-6. **Existing:** `modes`
(59). TEST-8 guards the bundle. **Size** S to M.

### SVC-17 DiffViewProvider remainder (low priority)

A `SaveRecovery` helper owning `pendingSave` and its 9 touch points; move `pushToolWriteResult` (452-503) into the
tool layer; remove the `editType` temporal coupling (15 external writes before `open()`); delete the dead `taskRef`
(68). **Test first:** `revertChanges` for new and existing files, the CRLF user-edit patch. **Existing:** 46 tests
in 4 specs. **Size** M.

## Performance (Phase 10; mechanism verified)

The per-chunk work inside providers is linear (TagMatcher walks characters, SSE parsers keep only the leftover
buffer). The hot spots are elsewhere:

| #   | Mechanism                                                                                                                                      | Evidence                                                                                       | Fix                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| P1  | 3 workspace ripgrep scans per system-prompt build with subfolder rules on                                                                      | SVC-11                                                                                         | memoize                                |
| P2  | Tool-call arguments re-parsed from the start on every chunk (quadratic; about 375 MB of parsing for a 50 KB `write_to_file` in 15k chunks [I]) | `NativeToolCallParser.ts:288-299`                                                              | throttle; it only feeds the UI preview |
| P3  | Regex over the whole accumulated reasoning text on every chunk, whole string re-posted                                                         | `TaskStreamProcessor.ts:230-239`                                                               | incremental                            |
| P4  | Last message counted twice per request; LM Studio counts the full history every request; worker pool disabled for the session after one error  | `TaskApiLoop.ts:1320-1325`, `context-management/index.ts:338-343`, `lm-studio.ts:104`, DEF-C20 | count once, cache per message          |
| P5  | Terminal output compression over the whole buffer per line                                                                                     | SVC-14                                                                                         | incremental                            |
| P6  | `realpathSync` per path with `.rooignore` present (up to 50k sync calls per scan); every file fully hashed every scan                          | `RooIgnoreController.ts:100, 179`, `scanner.ts:137-159`                                        | async, mtime shortcut                  |
| P7  | Both MCP config files re-read and parsed on about 20 call sites, including every stderr chunk of a crash-looping server                        | `McpHub.ts:784-786, 1385-1387`                                                                 | SVC-8 config store                     |
| P8  | Slash-command list re-read from disk on every keystroke                                                                                        | `ChatTextArea.tsx:598-606` into `commands.ts:127-145`                                          | SVC-11 cache                           |

## Do not touch

The two provider registries (portable versus runtime, intentional split with a compile-time check); the type
gymnastics in `provider-registry.ts:117-195` (preserve a public array shape); the exhaustive `modelCache.ts` fetch
switch; the synchronous disk read in `getModelsFromCache` (memory-cache miss only); DeepSeek mapping cache misses to
`cacheWriteTokens` (cost-neutral); the per-protocol message converters; `TaskStreamProcessor` summing usage chunks
(fix the producers, Anthropic legitimately sends two usage events); `extractReasoningFromDelta` keeping
whitespace-only text; `fake-ai` (hidden, used by end-to-end tests); checkpoint `git add .` with `allowEmpty` (restore
may rely on one commit per turn [I]); the all-static `TerminalRegistry`; NodeCache `useClones`.

## Suggested order

Phase 5: API-1, API-3, API-2, API-Q, API-4, API-6, API-7 (three PRs), API-5, API-13, API-18, then DEP-6.
Phase 6 (parallel lane): SVC-8 (1, 2), SVC-10, SVC-12, SVC-11, SVC-9, SVC-15, then SVC-14, SVC-16, SVC-17, SVC-8 (3).
