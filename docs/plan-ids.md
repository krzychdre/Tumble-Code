# Plan item IDs used in the code

Code comments, test names and a few docs name the plan item that introduced a change, for example `CORE-R1`,
`DEF-S8` or `P9`. This page says what each ID meant, so a reader on `main` does not need the plan itself. It lists
only IDs that still appear outside `ai_plans/` and `CHANGELOG.md`. "PR" is the pull request in
`krzychdre/Tumble-Code` that did the work (several when the item was done in slices).

New code should not add plan IDs to comments: write the reason in a sentence instead.

## Where the plans are

| Family                                                                                        | Plan                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CORE-R*`, `API-*`, `SVC-*`, `WEB-*`, `PKG-*`, `CLI-*`, `DEP-*`, `TEST-*`, `CAPI-M*`, `DEF-*` | The 2026-09-24 refactor master plan, folder `ai_plans/2026-09-24_refactor/` on the intentionally unmerged branch `docs/refactor-plan-2026-09-24`. `API P2` and similar are rows of the performance table of one area of that plan (`05-providers-and-services.md`). What it achieved is summarised in the roadmap below. |
| `R1`-`R11`, `D1`-`D15`, `P1`-`P12`, `S1`-`S7`, `F1`-`F4` (no prefix)                          | [`ai_plans/2026-09-27_simplification-roadmap.md`](../ai_plans/2026-09-27_simplification-roadmap.md) on `main`.                                                                                                                                                                                                           |
| `CB-*`, `TL-*`                                                                                | [`ai_plans/2026-07-11_codebase-review-findings-register.md`](../ai_plans/2026-07-11_codebase-review-findings-register.md) (a July code review; `CB` = cloud, `TL` = tools).                                                                                                                                              |
| `WS-1` to `WS-8`                                                                              | Two July plans that both numbered their work streams from 1, see the `WS` section.                                                                                                                                                                                                                                       |
| `WS-B` to `WS-G`                                                                              | [`ai_plans/2026-08-24_dsh-adoption-implementation-plan.md`](../ai_plans/2026-08-24_dsh-adoption-implementation-plan.md).                                                                                                                                                                                                 |

## Short IDs that mean two things

A bare short ID usually means the roadmap item. These places use the same letters for something else:

- `D3` in `self-hosted-cloudapi/tests/browser/render_checks.html`: defect D3 of
  [`ai_plans/2026-07-30_cloud-web-gui-overhaul.md`](../ai_plans/2026-07-30_cloud-web-gui-overhaul.md), "not every
  conversation block on the web panel is collapsible" (#136).
- `D4` in `src/api/providers/__tests__/openai-codex.spec.ts`: row D4 of the duplication table of the refactor plan
  (`05-providers-and-services.md`), "Responses API fixes applied to only one of the two forks" (openai-native and
  openai-codex); folded into `API-13`.
- `P1` and `P8` in `src/services/roo-config/__tests__/roo-directory-precedence.spec.ts`: rows of the refactor plan's
  services performance table: three workspace ripgrep scans per system-prompt build (P1) and the slash-command
  list re-read from disk on every keystroke (P8). Both were fixed by `SVC-11` (#331).
- `API P2`, `API P3`, `API P4`, `API P6`: see the refactor plan section below, not the roadmap's P2 to P6.

## Refactor master plan (2026-09-24)

### Extension core (`CORE-R`)

| ID       | What it was                                                                                                                                                 | PR                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| CORE-R1  | One table of setting defaults (`SETTINGS_DEFAULTS`) and one builder for `getState()` and the webview state.                                                 | #276                               |
| CORE-R2  | The parent/child task delegation state machine moved out of `ClineProvider` into `DelegationService`.                                                       | #280                               |
| CORE-R3  | `webviewMessageHandler` split into domain modules (`messageHandlers/`) behind a lookup map.                                                                 | #274                               |
| CORE-R4  | A tool descriptor table: dispatch, per-tool policy lists, argument parsers and approval categories declared once per tool.                                  | #281, #287, #289                   |
| CORE-R5  | The `Task*Access` interfaces that helpers get instead of `Task` were made to type-check.                                                                    | #271                               |
| CORE-R6  | The rest of the `ClineProvider` split (mode-to-profile binding, background task runner, webview HTML and others).                                           | #286, #288, #292, #293, #294, #296 |
| CORE-R7  | Performance: debug perf counters, fewer full state pushes (`messageAdded`), coalesced `ui_messages.json` writes, settings read once per streamed tool call. | #443, #450, #463, #466, #468, #472 |
| CORE-R8  | One shared edit pipeline (`applyComputedEdit`) for the edit tools; `search_replace` became `edit`.                                                          | #283                               |
| CORE-R10 | Layering fixed: `src/shared` no longer imports extension code; guarded by `src/__tests__/layering.spec.ts`.                                                 | #269                               |
| CORE-R11 | One system-prompt input builder, so the "copy system prompt" preview and the real prompt cannot drift.                                                      | #284                               |
| CORE-R12 | Per-task tool state: the partial-stream state of a tool call lives on the `Task`, not on the tool singleton.                                                | #285, #295                         |

### Providers (`API`) and services (`SVC`)

| ID     | What it was                                                                                              | PR               |
| ------ | -------------------------------------------------------------------------------------------------------- | ---------------- |
| API-1  | One error-normalization contract for every provider handler (`error-contract.spec.ts`).                  | #298             |
| API-2  | One stream adapter for the Anthropic protocol.                                                           | #300             |
| API-3  | One pure strict-schema converter for tool definitions.                                                   | #297             |
| API-4  | The Vercel AI SDK request path retired.                                                                  | #299             |
| API-5  | A cancellation contract: the abort signal travels in the request metadata to every handler.              | #312             |
| API-6  | Complete provider definitions: hard-coded provider checks and unknown-model-id policies moved into them. | #309, #311       |
| API-7  | One Chat Completions stream adapter and shared usage normalizers.                                        | #304, #305, #307 |
| API-13 | A shared core for the three OpenAI Responses API handlers.                                               | #306, #308       |
| API-18 | `AwsBedrockHandler` split into request, stream and error modules (lowest priority item).                 | #313             |
| API P2 | Streamed tool arguments were re-parsed from the start on every chunk; now at most every 100 ms.          | #456             |
| API P3 | The whole accumulated reasoning text was scanned and re-posted on every chunk; now line by line.         | #461             |
| API P4 | The last message was counted twice per request; now counted once.                                        | #462             |
| API P6 | `.rooignore` filtering resolved symlinks with one `realpathSync` per path; now once per directory.       | #464             |
| SVC-8  | `McpHub`: tests pinned first, then the config store, watcher and pure parts extracted.                   | #330, #337, #342 |
| SVC-10 | The code-index lifecycle got one owner that disposes its watchers and controllers.                       | #328, #345       |
| SVC-16 | Layering inside `src/shared`: browser-safe code may not import `vscode` or extension code.               | #334             |
| SVC-17 | The remainder of the `DiffViewProvider` cleanup (low priority).                                          | #336, #347       |

### Webview (`WEB`), packages (`PKG`), CLI (`CLI`), dependencies (`DEP`), tests and repo (`TEST`)

| ID      | What it was                                                                                                                                | PR                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| WEB-1   | The chat-row pipeline moved out of `ChatView` into pure functions (`components/chat/rows/`) with a parse cache.                            | #375, #376                         |
| WEB-3   | Settings: one schema for keys, defaults, serialization and apply mode.                                                                     | #381, #384                         |
| WEB-7   | One webview message bus with typed subscriptions and request/response.                                                                     | #405, #406, #407                   |
| WEB-8   | `ChatView` split into hooks by concern.                                                                                                    | #412, #413, #414                   |
| WEB-9   | `ModesView`: `CreateModeDialog` and `useModeImportExport` extracted.                                                                       | #403, #404                         |
| PKG-2   | Lint rules that keep workspace boundaries intact (`packages/config-eslint/boundaries.js`).                                                 | #266                               |
| PKG-6   | The browser-safe part of `src/shared` moved into real packages (`@roo-code/types`, `@roo-code/core`); stubs remain.                        | #422                               |
| CLI-5   | The CLI's own re-implementations of extension logic removed, one bug per slice.                                                            | #419, #421, #424, #425, #428       |
| CLI-9   | One state machine and smaller functions in the CLI.                                                                                        | #427, #431, #432, #434, #435, #438 |
| CLI-F2  | A finding during the ink 7 upgrade: a blank row stayed under the CLI footer after a turn; the spinner now takes the input separator's row. | #513                               |
| DEP-5   | Python and container version floors for the cloud API.                                                                                     | #254                               |
| DEP-6   | Provider SDK and runtime library major upgrades, one PR per library.                                                                       | #315 to #327, #494 to #508         |
| DEP-8   | React 19 and zod 4.                                                                                                                        | #471, #511                         |
| DEP-9   | `@vscode/webview-ui-toolkit` replaced by local components.                                                                                 | #470 to #506 (11 PRs)              |
| TEST-7  | One dependency-update bot: Dependabot removed, Renovate kept.                                                                              | #209                               |
| TEST-8  | A webview bundle guard: a Vite plugin fails the build when extension-only code reaches the webview bundle.                                 | #206                               |
| TEST-11 | Found while testing: `@anthropic-ai/vertex-sdk` let an auth rejection escape as an unhandled rejection (a production bug).                 | #248                               |

### Cloud API (`CAPI-M`)

| ID       | What it was                                                                                       | PR         |
| -------- | ------------------------------------------------------------------------------------------------- | ---------- |
| CAPI-M3  | One telemetry vocabulary module shared by the services (also fixed a retention bug of `DEF-C31`). | #441       |
| CAPI-M5  | `routers/web.py` (967 lines) split by page.                                                       | #453       |
| CAPI-M6  | Route boilerplate (user lookup, ownership checks) moved into FastAPI dependencies.                | #442       |
| CAPI-M7  | Consistent configuration and bootstrap.                                                           | #445       |
| CAPI-M8  | Golden fixtures shared by TypeScript and Python for token and cost aggregation.                   | #444, #451 |
| CAPI-M9  | Metrics aggregated in SQL instead of in Python over unbounded rows.                               | #452       |
| CAPI-M10 | A test that fails when the ORM models and the migrations drift apart.                             | #449, #458 |
| CAPI-M11 | The bridge stopped running task-tree link queries on every streamed chunk.                        | #440       |
| CAPI-M12 | CPU-heavy work moved off the event loop (lowest priority).                                        | #459       |

### Defects (`DEF-S` security, `DEF-C` correctness)

| ID      | What it was                                                                                                                    | PR         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| DEF-S1  | Command auto-approval could be bypassed with escaped quotes (`echo \' && rm ...`); the command parser now splits like bash.    | #213       |
| DEF-S2  | Stored XSS through JSON embedded in `<script>` blocks of the cloud web pages, reachable on public share pages.                 | #210       |
| DEF-S3  | Cloud sign-in never validated `auth_redirect`, so the one-time ticket could be sent to any site (account takeover).            | #212       |
| DEF-S4  | The cloud backfill let one user overwrite another user's conversation (no ownership check).                                    | #215       |
| DEF-S5  | The cloud's OpenAI-compatible LLM proxy needed no login; the proxy was removed.                                                | #217       |
| DEF-S6  | Cloud logout could deactivate any session, not only the caller's.                                                              | #212       |
| DEF-S7  | The organization claim in the cloud JWT was taken from a client form field.                                                    | #212       |
| DEF-S8  | Cloud CORS allowed every origin with credentials and the bridge disabled its Origin check; now one trusted-origins list.       | #221       |
| DEF-S9  | No CSRF defence on cookie-authenticated cloud POSTs, and the cookie was never `Secure`.                                        | #221       |
| DEF-S10 | The bridge relayed events into the rooms of tasks the sender did not own.                                                      | #215       |
| DEF-S11 | Cloud deployment hygiene: secrets in the Docker build context, placeholder secrets accepted, idle client tokens never expired. | #212       |
| DEF-C1  | `.rooignore` instructions were missing from the live system prompt (the preview still had them).                               | #218       |
| DEF-C3  | The approved todo list was a module global shared by all tasks.                                                                | #247       |
| DEF-C4  | Tool singletons kept per-stream state that concurrent subagents shared.                                                        | #247       |
| DEF-C6  | Background tasks skipped the organization allow list and the profile's mistake limit.                                          | #227       |
| DEF-C7  | The hand-synced list of tools that take a checkpoint had drifted from the real one.                                            | #225       |
| DEF-C9  | Anthropic and MiniMax cost left out the output tokens.                                                                         | #211       |
| DEF-C10 | `convertToolSchemaForOpenAI` mutated the shared tool definitions for the whole process.                                        | #220       |
| DEF-C12 | Usage was counted many times when a server repeated cumulative usage in every chunk.                                           | #222       |
| DEF-C13 | MCP `isConnecting` could stay true forever, adding 10 s to every request.                                                      | #219       |
| DEF-C14 | Stream errors and incremental tool-call parts from the AI SDK path (Moonshot) were dropped.                                    | #239       |
| DEF-C15 | The organization allow list rejected five providers, and openai-native used the wrong model-id field.                          | #230       |
| DEF-C16 | LM Studio undercounted the context (text parts only), so auto-condense fired late.                                             | #238       |
| DEF-C17 | Code-index drifts: watcher and scanner used different point ids, and two embedders reported no dimension.                      | #242       |
| DEF-C22 | Max output tokens were not capped for zai, qwen-code and moonshot.                                                             | #233       |
| DEF-C23 | The cache-write usage field was read under different names in the one-shot and the streaming path.                             | #237       |
| DEF-C25 | Setting defaults disagreed between the webview context, the settings view and the host.                                        | #250       |
| DEF-C27 | The CLI fell back to a 200k context window and an OpenRouter model id for every provider.                                      | #226       |
| DEF-C28 | CLI: the follow-up countdown could send an empty answer, JSON `totalCost` was the last request only, `arePathsEqual` drifted.  | #226       |
| DEF-C29 | The CLI installer and README pointed at the upstream repository.                                                               | #226       |
| DEF-C30 | The nightly VSIX was built with a drifted copy of the esbuild config; both now share one.                                      | #245       |
| DEF-C31 | Small cloud API bugs: unencoded redirect parameters, a GET that wrote, unescaped LIKE wildcards, ignored `BRIDGE_PATH`.        | #223       |
| DEF-C33 | The forced condense path ignored the microcompaction result, so the retry resent the same oversized request.                   | #243       |
| DEF-C34 | Reopening a task from history skipped the organization allow list.                                                             | #244       |
| DEF-C36 | Wrong max output tokens in the Z.ai GLM model tables.                                                                          | #249       |
| DEF-C39 | Reported cache writes were free when the model had no cache-write price; now priced at the input price.                        | #246       |
| DEF-C40 | LiteLLM used `prompt_cache_miss_tokens` as cache writes.                                                                       | #246       |
| DEF-C41 | Auto-approval checked only the global command lists, not the workspace `deniedCommands` setting (security).                    | #278       |
| DEF-C42 | The webview pre-filled the embedder dimension with 1536 and saved it for models with another dimension.                        | #279       |
| DEF-C44 | OpenAI native retried every SDK failure, including 429 and 401, through a plain `fetch`.                                       | #302       |
| DEF-C45 | OpenRouter errors inside the stream carried no HTTP status, so retry classification missed them.                               | #303       |
| DEF-C46 | Stored OpenAI encrypted reasoning items were sent to every provider; some threw, others dropped them.                          | #310       |
| DEF-C47 | Cloud `record_relation` set a child's parent before the parent row existed (foreign-key error on PostgreSQL).                  | #454, #460 |
| DEF-C48 | Two concurrent first bridge chunks of one task raced on the task's primary key and lost a message.                             | #455       |
| DEF-C49 | Uploading a shared conversation failed when two messages had the same `ts`; the later one now wins.                            | #455       |
| DEF-C50 | The bridge never reconnected after the server refused the handshake.                                                           | #465       |

## Simplification roadmap (2026-09-27)

| ID  | What it was                                                                                                              | PR                             |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| R1  | A task history file that did not parse was read as empty and then overwritten; it is now moved aside as `.corrupt-<ts>`. | #523                           |
| R2  | `safeWriteJson` renamed the temp file without `fsync`, so a power loss could leave an empty file.                        | #524                           |
| R3  | A duplicated first-chunk abort race in `TaskApiLoop` left a listener on the request signal.                              | #525                           |
| R4  | A possible hang after abort while waiting for the tool results.                                                          | #526                           |
| R5  | Missing network timeouts on several `fetch` calls and on silent streams.                                                 | #527                           |
| R6  | The CLI TUI had no crash or signal handling; both CLI modes now share process guards and an error boundary.              | #539                           |
| R8  | Two cloud write races: duplicate task shares and the settings version check.                                             | #536                           |
| R10 | Cloud auth cleanup: single-use OAuth state, purge of expired rows, logout as POST.                                       | #538                           |
| R11 | Cloud client backoff with jitter: refresh timer, per-item retry queue, bridge reconnect re-arm.                          | #540                           |
| D1  | Eight exponential-backoff implementations reduced to one helper in `@roo-code/core`.                                     | #546                           |
| D2  | Literal defaults at call sites replaced by `SETTINGS_DEFAULTS`; `scripts/check-settings-defaults.mjs` guards it.         | #547                           |
| D3  | About 47 one-line forwarders on `Task` removed; the `Task*Access` interfaces are the seams.                              | #553                           |
| D4  | The MDM redirect block, copied four times in the state push methods, became one helper.                                  | #548                           |
| D6  | Dead code removed (old CLI tRPC client and `SDK_BASE_URL`, unused webview components).                                   | #541, #563                     |
| D7  | `clineStack` was a stack of at most one task; it became a single current-task slot.                                      | #554                           |
| D11 | Four readers of the same messages in the CLI reduced to one event stream (`TranscriptReducer` deliveries).               | #586, #589, #596               |
| D13 | Settings prop drilling replaced by `useSetting(key)` on a draft store (`SettingsDraftContext`).                          | #585                           |
| D14 | Leftover "Roo Code" text users could see.                                                                                | #542, #566                     |
| D15 | Config sprawl: one shared vitest preset, dead cloud URL variables removed.                                               | #582                           |
| F1  | A CLI integration flake that was a real race: a resumed session lost its first message command.                          | #530                           |
| F2  | A Windows flake in the `TaskHistoryStore` per-ID lock count.                                                             | #531                           |
| F3  | Each streamed chunk was shown one chunk late because the next one was read first.                                        | #532                           |
| P1  | Every streamed token re-rendered every `useExtensionState()` consumer; components now read narrow slices.                | #551                           |
| P2  | `ChatRow` deep-compared all visible rows per token; now a targeted comparator.                                           | #552                           |
| P3  | `webviewDidLaunch` was posted twice at startup.                                                                          | #543                           |
| P4  | Heavy webview code (KaTeX CSS, rarely used views) moved behind lazy loading.                                             | #544                           |
| P5  | `getState()` ran six to eight times per request cycle; now one snapshot per cycle.                                       | #561                           |
| P7  | One `fs.watch` per task folder in `TaskHistoryStore`; now only live and recent tasks are watched.                        | #562                           |
| P8  | Whole-file task saves were measured to see whether JSONL appends are needed; they are not yet.                           | #622                           |
| P9  | Commands waited for the cloud at activation; the cloud now starts in the background (`cloudStartup.ts`).                 | #564                           |
| P10 | Synchronous file I/O on hot paths (artifact store, model cache) made asynchronous.                                       | #576                           |
| P11 | The cloud backfill ran classification and inserts on the event loop; partial bridge rows are now coalesced.              | #565                           |
| S1  | `ClineProvider` split: `WebviewStatePusher` and `TaskSlot` extracted.                                                    | #557                           |
| S2  | `TaskStreamProcessor` split: `StreamToolCallHandler` and `AssistantMessageAssembler` extracted.                          | #558                           |
| S3  | Error dispatch moved from `TaskApiLoop` into `RetryHandler`.                                                             | #559                           |
| S4  | Provider descriptors in `packages/types` generate the settings form and model helpers.                                   | #572, #587, #595, #621 to #627 |
| S5  | `ChatTextArea`, `ModesView` and `CodeIndexPopover` split by concern.                                                     | #569, #571                     |
| S6  | Type safety in `core/task`: `state: any` replaced, `as any` casts and empty `catch {}` bodies reduced.                   | #567, #590, #598               |
| S7  | `ExtensionMessage` and `WebviewMessage` split by domain; the old group aliases removed.                                  | #568                           |

## July and August plans

### Code review register (2026-07-11)

| ID   | What it was                                                                                   |
| ---- | --------------------------------------------------------------------------------------------- |
| CB-3 | `StaticTokenAuthService` never checked JWT expiry, so the cloud broke silently after an hour. |
| CB-4 | `WebAuthService.refreshSession` did not await `clearCredentials()` (unhandled rejection).     |
| CB-7 | The cloud web page counted booleans as numbers, drifting from the metrics service.            |
| CB-8 | `share_task` did not enforce the organization's `allowPublicTaskSharing` on the server.       |
| TL-1 | Static state in `NativeToolCallParser` raced across parallel tasks.                           |
| TL-2 | `WriteToFileTool` trusted a stale `editType` from the partial stream.                         |
| TL-4 | An error in a write tool's partial handling left the diff editor open.                        |
| TL-6 | A write tool opened the diff editor before validating the path (information disclosure).      |

### Work streams (`WS`)

Two plans numbered their work streams from 1. The comment usually names the plan or the context makes it clear.

| ID   | Agent-loop efficiency plan, [`2026-07-12_glm-agent-loop-efficiency-implementation.md`](../ai_plans/2026-07-12_glm-agent-loop-efficiency-implementation.md) | Verbosity and turn economics plan, [`2026-07-27_verbosity-and-turn-economics.md`](../ai_plans/2026-07-27_verbosity-and-turn-economics.md) (used in `scripts/agent-bench/`) |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS-1 | Conciseness steering in the prompt.                                                                                                                        | Fix the microcompaction oscillation (reported input tokens must not jump back).                                                                                            |
| WS-2 | A smaller per-turn environment details payload.                                                                                                            | Remove the batching contradiction from the prompt.                                                                                                                         |
| WS-3 | Parallel reads and asynchronous checkpoints.                                                                                                               | Make whole-file reads the default.                                                                                                                                         |
| WS-5 | A text-only completion fallback (protocol robustness).                                                                                                     | Delete the dead reviewer rules directory.                                                                                                                                  |
| WS-6 | A probe: does the Z.ai coding endpoint cache prompts at all?                                                                                               | Cut the orchestrator's fixed overhead.                                                                                                                                     |
| WS-7 | Keep the Z.ai implicit cache warm with a stable prefix (only if WS-6 said it caches).                                                                      | User-side settings, no code.                                                                                                                                               |
| WS-8 | A short stub instead of the full text when an unchanged file is read again.                                                                                | A vLLM prefix-cache probe, needed to judge WS-1.                                                                                                                           |

### DSH adoption (`WS-B` to `WS-G`)

| ID   | What it was                                                                                  |
| ---- | -------------------------------------------------------------------------------------------- |
| WS-B | Oversized tool results spill into an artifact file; the model gets a preview and a handle.   |
| WS-C | Deterministic pruning of old tool results before an LLM condense.                            |
| WS-D | Short guidance next to each tool and error messages that teach the model what to do instead. |
| WS-F | A prefix-stable system prompt order (stable head first) so KV caches stay valid.             |
| WS-G | The `search_task_history` tool.                                                              |
