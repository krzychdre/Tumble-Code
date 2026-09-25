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

**Status (2026-09-25):** DONE in #298 (merge 52f3af2cb). `error-contract.spec` builds 17 real handlers with a
fake SDK client throwing 429, 400 and 401 through `createMessage` and `completePromptWithUsage`: 57 of 102 cases
failed on main (re-wraps dropping `status` in LM Studio, LiteLLM, Mistral, Anthropic Vertex, Gemini, OpenAI native,
Codex, Ollama; the double prefix in `openai.ts`, inherited by DeepSeek; the `fetch` fallbacks of OpenAI native and
Codex; SDKs naming the field `statusCode`, `status_code` or `$metadata.httpStatusCode`). `getApiErrorStatus` in
`apiErrors.ts` reads all four and feeds `isRetryableApiError` and `isFallbackTriggerError`; `handleProviderError`
always sets `.status`. `openai-error-handler.ts` deleted (10 importers re-pointed); `RetryHandler.shouldRetry`
deleted (wiring it would change behavior: with auto-approve, `TaskApiLoop.handleApiRequestError` retries every
failure including 400 and 401, a separate policy decision). Moonshot and the AI SDK path left to API-4. Text
changes: single prefix in OpenAI and DeepSeek `completePrompt`; non-Error throws wrapped; the invalid-API-key-
characters message now in every handler. Findings: see DEF-C43 to DEF-C45 in `02-defects.md`.


### API-3 One pure strict-schema converter

`transform/strict-json-schema.ts` exporting `toStrictSchema(schema, {stripNull, mcp})` that copies instead of
mutating and replaces the 3 copies (`base-provider.ts:66-109`, `openai-native.ts:244-277`,
`openai-codex.ts:236-265`). **Test first:** input deep-equal before and after; `execute_command` keeps
`["string","null"]` after an OpenAI-compatible request (this is DEF-C10's test). **Existing:** `base-provider.spec`
(15), `openai-native-tools` (9), `openai-codex-native-tool-calls` (8), `native-tools/__tests__/converters.spec`.
**Size** S.

**Status (2026-09-25):** DONE in #297. `transform/strict-json-schema.ts` exports a pure
`toStrictSchema(schema, {stripNull, mcp})` (never writes to its input, copies only changed objects, keeps key
order). The copies really differed and the options reproduce each: base-provider strips `null` from union types
and leaves MCP schemas alone; openai-native and openai-codex keep `null` and add `additionalProperties: false` to
MCP schemas. `BaseProvider.convertToolSchemaForOpenAI` stays as a delegator (xai and tests use it). Tests first:
`strict-schema-characterization.spec` (18 tests, 12 snapshots of every path for native tools with and without
images, real MCP tools and a nullable custom tool; bytes unchanged) plus `strict-json-schema.spec` (9); related
specs 173 to 200. One deliberate unification: a `null` value in `properties` no longer throws a TypeError in the
Responses paths. Findings: the Responses path does not recurse into `["object","null"]` (sent strict without
`additionalProperties`/`required`, may be rejected); xai converts twice (same result; API-13).


### API-2 One Anthropic-protocol stream adapter

**Evidence:** `anthropic.ts:225-350` and `minimax.ts:120-243` differ only in comments; `anthropic-vertex.ts:120-211`
is a third variant; the last-two-user-messages `cache_control` logic is copied (`anthropic.ts:150-175`,
`minimax.ts:244-273`); DEF-C9 lives in two copies. **Change:** `transform/anthropic-stream.ts` with
`processAnthropicStream(stream)` yielding tokens only (cost computed centrally, which fixes DEF-C9 by construction)
and one `addAnthropicCacheControl(messages)`. **Test first:** one scripted event sequence (message_start with cache,
2 thinking deltas, text, tool_use with input_json deltas, message_delta output) replayed through all 3 handlers,
pinning the exact chunk list. **Existing:** `anthropic.spec` (48), `minimax.spec` (30), `anthropic-vertex.spec`
(37). **Size** S to M, low risk.

**Status (2026-09-25):** DONE in #300. `transform/anthropic-stream.ts` has `processAnthropicStream(stream,
costInfo)` (cost computed once with the DEF-C9 rule) and a non-mutating `addAnthropicCacheControl(messages)`
replacing the Anthropic and MiniMax copies. Line counts: anthropic 455 to 292, minimax 325 to 166,
anthropic-vertex 350 to 261, adapter 166. Tests first: one scripted event sequence (cache usage, thinking with
signature delta, redacted thinking, text, tool_use with input_json deltas, message_delta) replayed through all
three handlers with pinned chunk lists and request snapshots (unchanged by the refactor); related specs 266 to 283.
Behavior change on purpose: Anthropic Vertex now ends its stream with the cost chunk like the others (before, the
task summed usage chunks and counted the `message_start` output token twice, 121 instead of 120). Kept: Vertex marks
only the last text block with `cache_control` (the others mark the last block of any type); `signature_delta`,
`redacted_thinking` and stop reason stay unhandled. Residual (DEF-C9 display only): `TaskStreamProcessor` still adds
the `message_start` output token to the cumulative `message_delta` value in the displayed `tokensOut`.


### API-4 Retire the Vercel AI SDK path

**Evidence:** `openai-compatible.ts` (270 lines) and `transform/ai-sdk.ts` (282) serve only `moonshot.ts`; that path
passes no abort signal, ignores `timeoutMs`, and drops `error` and incremental tool-call parts (DEF-C14).
**Change:** re-base Moonshot on `BaseOpenAiCompatibleProvider` as Z.ai is (override `processUsageMetrics` for the
top-level `cached_tokens`, send `max_tokens`), then delete `openai-compatible.ts`, `ai-sdk.ts`, and the `ai` and
`@ai-sdk/openai-compatible` packages. **Test first:** Moonshot request-body characterization (`max_tokens`,
temperature, tools) and usage mapping with top-level `cached_tokens`; check reasoning round-tripping [I].
**Existing:** `moonshot.spec` (22), `base-openai-compatible-provider.spec` (23), `zai.spec` (56); `ai-sdk.spec` (23)
is deleted with the code. **Size** M.

**Status (2026-09-25):** DONE in #299. MoonshotHandler extends `BaseOpenAiCompatibleProvider` like Z.ai (own
`getModel` keeping unknown ids, `createStream` with `max_tokens`, `stream_options` and no `parallel_tool_calls`,
messages through `convertToR1Format`, `processUsageMetrics` reading `prompt_tokens_details.cached_tokens` and
`cache_write_tokens` first and the legacy top-level `cached_tokens` as fallback). Deleted `openai-compatible.ts`,
`transform/ai-sdk.ts`, `ai-sdk.spec` and the `ai` and `@ai-sdk/openai-compatible` packages (lockfile -94 lines).
`moonshot-wire.spec` (29, stubbing global `fetch` so old and new clients run the same tests) failed 5 on the AI SDK
path, confirming DEF-C14: no abort signal and no `cancelRequest`, `apiRequestTimeout` ignored, no
`include_usage`, documented cache fields ignored, tool calls only when complete, no `reasoning_content`
round-trip for kimi-k2-thinking. Wire changes: tools now carry explicit `strict` (true, MCP false). Finding for a
model refresh item: kimi-k2.5 lacks `preserveReasoning`; kimi-k2.6, kimi-k2.7-code and kimi-k3 are missing;
`max_tokens` is deprecated in favor of `max_completion_tokens`.


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

**Status (2026-09-25):** part 1 DONE in #309 (merge 7a4838dca), no behavior change.
`packages/types/src/provider-models.ts` holds `providerModelDefinitions` (`modelIdField`, static models, default
id, `unknownModelPolicy`); `modelIdKeysByProvider`, `getProviderModelId`, `getProviderDefaultModelId` and the
webview maps derive from it (adds the missing openai-codex default). Each runtime registry entry has `{factory,
capabilities, modelIdField, models?, defaultModelId?, unknownModelPolicy, resolveModel, preloadModel?}`; every
handler's `getModel` uses the exported resolver, so `resolveProviderModel(settings)` equals `getModel()` without
building a handler (except Bedrock and fake-ai). `=== "gemini"` became `allowedFunctionNames`, `=== "lmstudio"`
became `needsModelPreload`/`preloadModel`. `ProviderSettingsManager.export` and the prompt preview no longer build
handlers. `ApiHandler.dispose()` (VsCodeLm unsubscribes its configuration listener) is called on handler
replacement, `Task.dispose` and one-shot completion. Tests: related src specs 1,350 to 1,468, types 116 to 191.
Left: PKG-7 is not mechanical (strict schemas without base fields, an import cycle via `zaiApiLineSchema`, the
openai `apiModelId` drift, `providerFieldOwnership` as a third copy); the CLI keeps a hand-written
`providerEnvMap[*].modelField`. Part 2 DONE in #311 (merge 37bfe484c), owner decision 5: an unknown model id is always sent as configured
with the default model's info (and prices: empty prices made the OpenAI-protocol cost paths report $0), never
silently substituted; an empty id still selects the default. `honor-custom`: Anthropic and Bedrock infer info
from the id; Gemini keeps the id and drops unverifiable prices. Behavior changed for xai, minimax, openai-native
(including retired ids like gpt-4o, which used to map to gpt-5.6-sol), openai-codex, zai, vertex (Gemini and
Claude ids; an unknown Gemini id gets the Claude default's info), gemini (ids without the `gemini-` prefix),
litellm (ids outside the fetched list), bedrock. Webview: `useSelectedModel` shows the configured id for
OpenRouter, LiteLLM and DeepSeek and returns `isUnknownModel`; `ApiOptions` shows
`settings:providers.unknownModelWarning` (English in all 18 locales). Coordinator-requested fixes: Bedrock
`custom-arn` without an ARN selects the default (never sent to AWS; an empty Bedrock id no longer throws);
`deepseek-chat`/`deepseek-reasoner` are known aliases of `deepseek-v4-flash` (`deepSeekModelAliases`,
`modelAliases` in the definitions; the wire id stays as configured). To check: the removed entries in `d4a7f4182`
said DeepSeek retires these aliases on 2026-07-24, a date already past.
**Follow-up for a model-refresh item (checked 2026-09-25 on api-docs.deepseek.com/quick_start/pricing):** the
docs no longer list `deepseek-chat`/`deepseek-reasoner` at all; the current name is `deepseek-flash`
(DeepSeek-V4.1-Flash), `deepseek-v4-flash` is a legacy name still accepted and served by V4.1-Flash, `deepseek-v4-pro`
is `DeepSeek-V4-Pro-0813`, context 1M, max output 384K, and prices have peak and off-peak rates (off-peak half;
peak 01:00-04:00 and 06:00-10:00 UTC on weekdays). Whether the old aliases still answer is unverified: the #311
alias entries may hide a warning that is now correct. Refresh the DeepSeek catalog (and decide the alias entries)
in a model-refresh branch, not in the refactor.


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

**Status (2026-09-25):** DONE in #304 (`092090dbf`), #305 (`77ac4c187`) and #307 (`45e4f6c64`), a stack merged in
order (coordinator retargeted the upper PRs to main first and rebased each with `--onto`; provider and transform
specs green after each rebase: 1,987 and 2,410 tests). `transform/chat-completions-stream.ts` exports
`streamChatCompletion(stream, {thinkTags, reasoning: "reasoning_content" | "openrouter" | "none", mapUsage,
onChunk, onReasoningDetails})` (always keeps the last usage block; `onChunk` carries the MiniMax-style
`base_resp` check, OpenRouter in-stream errors, LM Studio local token count); each of the 8 loops is one
`yield*` call (7 files 2,876 to 2,375 lines). `openAiUsageChunk` in `utils/completion-usage.ts` shares the
one-shot parser. Bugs confirmed on main by golden SSE tests and fixed on purpose: qwen-code leaked split `<think>`
blocks as text and dropped leading characters (a resend guard from the 2025 port); LiteLLM and both OpenAI paths
crashed on a non-array `tool_calls` and sent no finish reason; LM Studio dropped `reasoning_content`; OpenRouter
yielded tool calls before same-chunk text; usage chunks for OpenAI compatible, DeepSeek and Qwen Code lacked
`totalCost` (condensing reported $0), o-series and Qwen missed cache reads. Deviation: cost stays in the chunks
(condensing and BackgroundModelHandler read it from there), computed by one shared normalizer. Open: LM Studio
counts output tokens over `content` only; the Moonshot legacy `cached_tokens` wrapper remains.


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

**Status (2026-09-25):** DONE in #312. `ApiHandlerCreateMessageMetadata.signal` is filled by TaskApiLoop from
`currentRequestAbortController`; `utils/request-abort.ts` `createRequestAbortController(taskSignal)` gives each
request its own controller linked to the task signal (used by `ResponsesApiCore` too, whose SSE fallback now reads
its own request's signal). Newly forwarding: Anthropic, MiniMax, Anthropic Vertex, Gemini and Vertex Gemini
(`config.abortSignal`), Mistral (`fetchOptions.signal`), OpenRouter, LiteLLM, Qwen Code, xAI, Bedrock (linked to its
timeout controller), VS Code LM (cancels the token), Ollama (client takes no signal: the stream rejects at once and
the late answer is aborted on arrival). Per-request instead of the overwritten handler-wide controller: the
OpenAI-compatible family, DeepSeek, Z.ai, Moonshot, LM Studio, OpenAI native, Codex. `cancelRequest` kept for
client destroy. Tests: `cancellation-contract.spec` (63 over 21 handler paths: abort mid-stream and before the
response, overlapping requests independent; all failed first) and `TaskApiLoop.request-signal.spec`; related
specs 1,583 to 1,649. Open: condense requests and `completePrompt*` one-shots get no signal; `openai-native.ts`
`normalizeUsage` is unused (reported by check-unused-locals, which still exits 0).


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

**Status (2026-09-25):** DONE in #306 (`6da233a4c`) and #308 (`68cae5824`, xAI), rebased and merged in order.
`providers/responses-api/core.ts` (`ResponsesApiCore`, 769 lines) and `request.ts` (182) with hooks for error
texts (English in native, translated in codex), pricing (native service tiers, codex 0), the SDK call and the
fallback request (codex OAuth token and account header); codex keeps its 401 refresh retry via
`core.sawSdkEvent`. openai-native 1,563 to 416 lines, openai-codex 1,190 to 297; `transform/responses-api-stream.ts`
deleted (its cases moved to `responses-api/__tests__/core.spec.ts`). Tests first: 23 recorded event sequences
(including #11621 and #10719) through five paths and request-body snapshots; related specs 343 to 439. Drift
resolved: codex reads `cache_write_tokens` (GPT-5.6); `tool_call_partial` arguments always strings; codex SSE no
longer turns status events into answer text; native SSE no longer shows some text twice; native reads the error
`detail`. xAI now streams tool calls as partials, shows end-only text and refusals, counts cache writes; request
bytes unchanged. Finding: DEF-C46 in `02-defects.md`.


### API-18 Bedrock split (lowest priority)

`createMessage` spans 387-797; a readability-only win after API-1, API-3 and API-5. About 180 tests in 8 specs.

**Status (2026-09-25):** DONE in #313 (rebased by the coordinator onto #311 and #314; 378 Bedrock and contract
tests green). `providers/bedrock/request.ts` (request building incl. cache points, thinking and inference config,
now shared with `completePromptWithUsage`, beta headers, service tier, tools), `stream.ts` (same event order and
the prompt-router try/finally-continue; `useInvokedModelForCost` passed as a hook) and `errors.ts` (the error table
moved verbatim, checked line by line; `bedrockStreamFailure` is the old catch block). bedrock.ts 1,626 to 768 lines,
`createMessage` 404 to about 75. `bedrock-characterization.spec` (19) passed before and after unchanged; module
tests 29. Findings (pinned, not fixed): `VALIDATION_ERROR` and `ABORT` rows never fire because `getErrorType`'s
order list lacks them ("field required" and `AbortError` get "Unknown Error: ..."); the prompt-router
`finally { continue }` swallows a consumer `return()`.

**Also 2026-09-25, #314 (d8b9e711b):** main's `check-types` was red after API-13/API-5: `check-unused-locals`
flagged the private `OpenAiNativeHandler.normalizeUsage` delegator, used only by `openai-native-usage.spec`
through `as any`; removed, the spec calls `core.normalizeUsage(usage, model.info)`.


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

**Status (2026-09-24):** DONE in #265. `zai-format.ts` deleted (Z.ai uses `convertToR1Format`); dead files and symbols
deleted (plus the unconsumed `tool_call_end` in `openai.ts`, `semver-compare` dependency); 16 `*ToolUse` interfaces
removed; `scripts/find-test-only-exports.mjs` and `scripts/check-unused-locals.mjs` (noUnusedLocals enforced in
`src/api` via `check-types`; 282 left elsewhere in src). Candidates found for later: test-only exports
`generateImageWithImagesApi`, `convertToAnthropicRole`, `processBackspaces`, `processCarriageReturns`,
`findUnterminatedQuote`, `TOOL_DISPLAY_NAMES`; test-only webview files `SlashCommandItemSimple.tsx`,
`BatchListFilesPermission.tsx`, `ui/circular-progress.tsx`, `ui/select-dropdown.tsx`, `utils/provider-profile-draft.ts`,
`packages/types/src/context-management.ts`; unconsumed `tool_call_end` also in `native-ollama.ts` and `ai-sdk.ts`.

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

**Status (2026-09-25):** parts (1) and (2) DONE in #330 (merge 257b4640f); part (3) open. `mcpConfigSchema.ts`
(schemas, `validateServerConfig`, one `formatSchemaIssues` for three copies), `McpConfigStore` (path resolution for
seven copies, read/parse, `readForUpdate`, write with the 600 ms guard), `McpConfigWatcher` (per-file 500 ms
debounce, guard-aware) behind an injectable `watcherFactory` that replaced the three `NODE_ENV === "test"` branches.
McpHub 2,060 to 1,520 lines; MCP tests 65 to 119. Confirmed and fixed: `deleteServer` bypassed the write guard (a
second `updateServerConnections` 500 ms later). Already fixed on main by DEF-C13 (#219), now pinned: per-source
watcher keys, raw vs defaulted diff; the `EventSource` override was already gone. Open: one guard flag still covers
both files (a global write masks a user edit of the project file for 600 ms); dead
`McpServerManager.providers/notifyProviders`.

**Status part (3) (2026-09-25):** DONE in #337 (merge a40d26997). `McpConnectionManager.ts` (connections,
`isConnecting`, name registry, file watchers, connect/restart/delete, settings diff, `createTransport()` for stdio,
SSE and streamable HTTP with ONE error and close handler) and `McpToolCatalog.ts` (tools, resources, templates,
alwaysAllow/disabledTools, `callTool`, `readResource`); McpHub is a facade whose `connections`/`isConnecting` are
getters and setters over the manager (replace-not-mutate pinned). McpHub 1,520 to 705 lines (2,060 before part 1);
MCP tests 119 to 176. Found and fixed: `dispose` during an in-flight connect left a registered connection with a
running process, file watchers, a placeholder entry and late webview pushes; the connect now re-checks disposal
after every await. Dead `McpServerManager.providers/notifyProviders/unregisterProvider` removed.
`McpConfigStore` builds the project path with `getProjectRooDirectoryForCwd` (no `mcp` kind in the resolver: the
global MCP file is not under `~/.roo`). Visible timing difference: tools, resources and templates are assigned
together after the three fetches. Still open: one write-guard flag for both settings files.

### SVC-10 Code-index lifecycle ownership

**Evidence:** a new `RooIgnoreController` per scan, never disposed (`scanner.ts:88`), each with a FileSystemWatcher
and 3 listeners; `recoverFromError` drops the orchestrator without stopping its watcher (`manager.ts:303-327`), so
two watchers end up indexing; `FileWatcher.initialize` overwrites the watcher without disposing it (115); emitters
disposed but the watcher reused after Stop; managers never disposed and nothing listens to
`onDidChangeWorkspaceFolders`. **Change:** an explicit dispose chain (manager, orchestrator, watcher, ignore
controller); idempotent `startIndexing`. **Tests first:** Stop then Start event delivery; `recoverFromError` with a
live watcher asserts dispose. **Existing:** `orchestrator` (5), `file-watcher` (5), thin. **Size** S to M.

**Status (2026-09-25):** DONE in #328 (merge 715d1ccd7). Confirmed: Stop then Start silently lost progress events
(`FileWatcher.dispose()` killed the emitters of a reused watcher), `initialize()` leaked the previous watcher and
doubled listeners, `recoverFromError`/`_recreateServices` left the old orchestrator's watcher indexing, and both the
manager's and the scanner's `RooIgnoreController` were never disposed. Fix: `FileWatcher.stop()` (restartable) vs
`dispose()` (final), orchestrator `dispose()` that aborts its scan and no longer writes state afterwards, manager
owns and disposes the ignore controller, idempotent `dispose()`, `disposeAll()` on deactivate and dispose on
workspace-folder removal. New `lifecycle.spec.ts` plus cases in manager and scanner specs; 118 related tests green.
Follow-up: folders added later still get a manager lazily (no eager `initialize()`).

### SVC-9 Code-index embedder base class and contract suite

**Evidence:** the token-budget batching loop exists 4 times, retry 4 times with 3 behaviors, the rate-limit trio
twice as static per-class state, `validateConfiguration` 8 times; raw i18n keys returned to users
(`openai-compatible.ts:406`, `openrouter.ts:323`); double telemetry; the OpenAI embedder drops the parent's base URL,
timeout and headers; `OpenAiEmbedder` extends the 1,612-line chat handler. **Change:** `BaseHttpEmbedder` with an
abstract `embedBatch()` and shared batching, retry, rate limit, prefix and validation. **Test first:** an embedder
contract `describe.each` (output length and order, split under `MAX_BATCH_TOKENS`, retry count and delays with fake
timers, telemetry count per failure, dimension present or absent). **Existing:** about 486 code-index tests;
`deletePointsByMultipleFilePaths` has 0. **Size** M to L. After DEF-C17.

**Status (2026-09-25):** DONE in #333 (merge ebdc4ab95). `BaseHttpEmbedder` with shared batching, retry, per-URL
rate-limit gate (`rate-limit-gate.ts`), prefix and validation; Gemini, Mistral and Vercel are thin subclasses of the
OpenAI-compatible embedder; `OpenAiEmbedder` no longer extends the chat handler. Embedders dir 2,114 to 1,250 lines.
A request-bytes pin (real OpenAI SDK, fake `fetch`) proves the llama.cpp path is byte-identical. The contract suite
(`describe.each` over 9 paths) failed 46 of 83 cases on main: over-limit texts were dropped (shifting
`embeddings[index]` onto the wrong blocks; now truncated), three 429 policies (unified: 3 tries, 429 only,
max(500 ms * 2^n, shared per-URL pause 5 s doubling to 5 min)), the backoff counter reset so pauses never grew, up to 4
telemetry events per failure (now 1), raw i18n keys in validation, short responses accepted, Ollama's empty probe
accepted. 627 code-index tests green. Visible change: OpenAI and Bedrock wait 5 s/10 s after a 429 instead of
0.5 s/1 s. Open: `deletePointsByMultipleFilePaths` still untested; the query prefix is also applied to indexed code.

### SVC-11 One `.roo` directory resolver with explicit precedence

**Evidence:** 5 implementations with different precedence (skills, commands with two conflicting orders at
`commands.ts:151-170` and 332, rules, MCP, roo-config); with `enableSubfolderRules` on, each system-prompt build
runs 3 full-workspace `rg --files --hidden --follow` scans with no cache (`custom-instructions.ts:232, 391/512,
429` into `roo-config/index.ts:197-214`); discovery silently capped at 500 entries (`file-search.ts:15`).
**Change:** `RooDirectoryResolver.list(cwd, {kind, precedence})`, memoized per working directory, invalidated by a
`**/.roo/**` watcher. **Test first:** a precedence matrix (project, global, built-in, mode-specific) per kind,
pinning today's behavior (precedence is user-visible). **Existing:** commands (31), roo-config (43), skills (59).
**Size** M, medium risk.

**Status (2026-09-25):** DONE in #331 (merge d10f3c6c6). `RooDirectoryResolver.list(cwd, {kind, mode, modes,
includeSubfolders})` serves rules, AGENTS.md, commands and skills; `roo-config/cache.ts` keyed by (kind, cwd) holds
only the subfolder `.roo` list and the parsed command list, mode filters apply after the cache (mid-task mode switch
covered by a test); `roo-config/watcher.ts` (`**/.roo/**` and `~/.roo/commands`) invalidates, plus a 30 s expiry
because the CLI shim's watchers never fire. Measured: two prompt builds 6 ripgrep scans to 1; slash menu no longer
re-reads command files per keystroke. Discovery cap 500 to 10,000 with a warning (root `.roo/memory` files used to
crowd out nested `.roo` dirs). Deviation: commands had two orders (menu showed built-in `/init` over
`~/.roo/commands/init.md`, execution used the global file); unified on the documented project > global > built-in.
Open: MCP config paths not moved to the resolver (SVC-8 part 3); gitignored `.roo` dirs (the owner's `~/.gitignore`
ignores `.roo`) are never found by the subfolder scan.

### SVC-12 One ripgrep runner

**Evidence:** 3 runners (`ripgrep/index.ts:134-172`, `file-search.ts:12-87`, `list-files.ts:654-731`); only
`list-files` has a timeout; `execRipgrep` rejects on any stderr, turning a bad regex into "No results found"
(`ripgrep/index.ts:162-163, 201-204`); `@`-mention search spawns `rg` per query and runs `existsSync`/`lstatSync` on
the extension host (`file-search.ts:114-138, 176-177`). **Test first:** timeout, stderr tolerance, limit applied
across all three callers. **Existing:** ripgrep (34), search (3). **Size** S to M.

**Status (2026-09-25):** DONE in #329 (merge 02272c4ed). New `src/services/ripgrep/runner.ts` (`runRipgrep`: line
streaming, limit, timeout 30 s default, abort, exit code 1 = no matches, error only on non-zero exit with empty
stdout) used by `search_files`, `file-search` and `list-files`. Verified with real `rg`: a bad regex (exit 2) now
reaches the model as a short actionable error instead of "No results found"; a stderr warning no longer hides
matches. Found beyond the plan: the output limit dropped the whole cut file ("Found 0 results") and the 300 limit
counted files, not results; both fixed. `@`-mention search uses async `lstat`. Tests: 82 in 8 ripgrep/search/glob
files. Follow-ups: `executeRipgrep` callers (nested-repo check, `.roo` discovery) now have a 30 s limit; per-query
`rg` spawn for mentions remains; `handleError` sends the serialized error with stack to the model.

### SVC-15 Tree-sitter parser cache and memory release

**Evidence:** `loadRequiredLanguageParsers` (`languageParser.ts:78-229`) reloads WASM grammar, Query and Parser on
every call on the definitions path (called by condense per read file; typescript grammar 2.3 MB, cpp 4.7 MB); no
`.delete()` anywhere, so WASM memory grows. **Change:** cache per language, release on dispose. **Test first:**
real-WASM tests for `.erb`, `.ejs`, `.htm`, `.elm` (DEF-C21) and a spy on `Language.load` call counts. **Existing:**
about 277 tests, all with a mocked loader. **Size** S to M. Pairs with the `web-tree-sitter` upgrade in DEP-6.

**Status (2026-09-25):** DONE in #332 (merge 0d5c5ff7b). One cache entry per grammar (Language, one Parser, compiled
queries) keyed by the `.wasm` path, shared by the definitions path and the code-index `CodeParser`; concurrent loads
share one promise, failures are not cached; `disposeLanguageParsers()` on deactivate; trees are `delete()`d after
use (web-tree-sitter 0.25.6 has no finalizers). Measured on `Task.ts` (68 KB): `Language.load` per call 1 to 0,
54 to 98 ms to 17 to 32 ms per call, external memory after 50 calls +177 MB to -2.7 MB. 10 real-WASM tests
(`languageParser.cache.spec.ts`, grammars from `tree-sitter-wasms/out`).

### SVC-14 Terminal process contract

**Evidence:** `emitRemainingBufferIfListening`, `hasUnretrievedOutput` and the completion handler are duplicated in
`TerminalProcess` and `ExecaTerminalProcess` with drift (throttle 100, 500 and 150 ms; `continue()` flushes in one
only; Execa may report exit code 0 when an abort wins [I]; Execa terminals never pruned, `ExecaTerminal.ts:14-16`,
`TerminalRegistry.ts:302`); output compression reruns on the whole buffer at every line event
(`ExecuteCommandTool.ts:357`). **Change:** shared buffer, completion and abort semantics in
`BaseTerminalProcess`, driven by one contract test run against both implementations. **Existing:** about 189
terminal tests. **Size** M, medium risk. After DEF-C18.

**Status (2026-09-25):** DONE in #335 (merge 13793a39b). `BaseTerminalProcess` owns unretrieved output (with
`isOutputEnded`/`findOutputEnd`/`cleanOutput` hooks), `appendOutput` with one leading-and-trailing throttle
`TERMINAL_OUTPUT_THROTTLE_MS = 150` (the rate `ExecuteCommandTool` already published at; it imports the constant),
`continue()` and run completion; `TerminalCompletionContract.spec` runs against both implementations. Confirmed and
fixed: neither throttle emitted the tail of a window (a line before a pause waited for more output), Execa
`continue()` did not flush, Execa reported exit code 0 after an abort (`error.exitCode ?? 0` with
`signal: "SIGKILL"`, plus a hard-coded `{ exitCode: 0 }`; now 137 via `interpretExitCode`), Execa terminals never
pruned (`releaseTerminalsForTask` now drops idle ones). Terminal specs 179 to 190 passed. P5 not changed with
evidence: `compressTerminalOutput` on a 100 KB buffer is about 0.3 ms per call behind the 150 ms throttle.

### SVC-16 Layering in `src/shared`

`shared/modes.ts` imports `vscode` (line 1) and core (line 12) but 8 webview files import it; `cloud-urls.ts` and
`vsCodeSelectorUtils.ts` are also vscode-bound. Move the extension-only functions (`getAllModesWithPrompts` at 185,
`getFullModeDetails` at 200) to `src/core`. Shared with CORE-R10; prerequisite for PKG-6. Measured during TEST-8 (2026-09-24): the webview build graph reaches `src/core/prompts/sections/custom-instructions.ts` and `src/services/roo-config/index.ts` through `src/shared/modes.ts` (Vite stubs their `path`, `fs/promises`, `os` imports); both render 0 characters, and the bundle guard warns about them on every build until this item removes the edge. Done means that warning is gone. **Existing:** `modes`
(59). TEST-8 guards the bundle. **Size** S to M.

**Status (2026-09-25):** DONE in #334 (merge af355da70). The `modes.ts` edge was already removed by CORE-R10 (#269,
functions now in `src/core/prompts/modeDetails.ts`). This item moved `cloud-urls.ts` to `src/activate/` and
`vsCodeSelectorUtils.ts` to `src/api/providers/utils/`, extended the eslint boundary rule to reject imports from
`src/shared` into extension directories, made `layering.spec` check every `src/shared` file, and turned the webview
bundle guard warning into a build error. Verified with three worktree webview builds: old `modes.ts` + old guard
warned about 3 modules, this branch prints nothing, old `modes.ts` + new guard fails the build.

### SVC-17 DiffViewProvider remainder (low priority)

A `SaveRecovery` helper owning `pendingSave` and its 9 touch points; move `pushToolWriteResult` (452-503) into the
tool layer; remove the `editType` temporal coupling (15 external writes before `open()`); delete the dead `taskRef`
(68). **Test first:** `revertChanges` for new and existing files, the CRLF user-edit patch. **Existing:** 46 tests
in 4 specs. **Size** M.

**Status (2026-09-25):** DONE in #336 (merge efa599748). `open(relPath, editType)` replaces the `editType` field
(6 production writes before `open()`; the other 9 of the plan's 15 were in tests); `write_to_file` asks the open
session via `diffViewProvider.editTypeOf(relPath)` and `toolStreamState.editTypePath` is gone;
`pushToolWriteResult` moved to `src/core/tools/helpers/toolWriteResult.ts` (unused `cwd` dropped), its JSON text
pinned byte for byte; `SaveRecovery.ts` owns `pendingSave`; dead `taskRef` removed. DiffViewProvider 694 to 626
lines; 400 tests in 22 related specs. Found: the old `apply_diff` specs never reached the successful write path (a
missing import was swallowed by `handleError`); a success-path test now covers it. Open (pre-existing): when
streaming opened the diff for a truncated path and the final path differs, `execute()` does not reopen.

### Phase 6 verification (2026-09-25)

Full local run on main a40d26997 in a fresh worktree with its own `pnpm install`
(`pnpm turbo run check-types lint test --continue --concurrency=3`): 38 of 38 tasks green; src 9,675 passed
(37 skipped, 596 files), webview 1,692, cli 1,070, types 439, vscode-shim 408, cloud 304, core 178,
agent-interchange 114, telemetry 31, build 17; `pnpm knip` exit 0. GitHub on the same commit: CodeQL, Nightly
Publish, Cloud API (Python), Dependency audit (both dispatched) green; Code QA green except
`platform-unit-test (windows-latest)`; the manually dispatched `vscode-e2e.yml` failed only in `providers/zai.test`
(known since 2026-09-24). Follow-ups opened the same day:

- vscode-e2e Z.ai timeout: FIXED in #338 (merge 6f7030210), test harness only. Root cause from a traced run: the
  tool ran and the task posted the `completion_result` ask; since upstream e6ad7949d (#11817) a top-level task emits
  `TaskCompleted` only after a `yesButtonClicked` answer, which nothing in the e2e suite sends. `waitUntilCompleted`
  now also resolves on the task's final `completion_result` ask.
- Windows `src` vitest dies silently after about 11 minutes (no summary, no error): first seen on 82047c3d7 (#327,
  chokidar 5 and global-agent 4; its rerun passed), again on a40d26997. Under investigation.
- Memory writers after a normal completion in the VS Code chat: the writers hang on `TaskCompleted`, which the chat
  never triggers ("Start new task" clears the task as abandoned, and abandoned aborts skip the writers). Found while
  fixing #338, under investigation.

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
