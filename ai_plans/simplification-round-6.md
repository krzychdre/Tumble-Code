# Simplification round 6 — cleanup plan

Date: 2026-11-12. Base: main @ f6dcdfd05.
Method: five parallel read-only audits (src/core; src without core; webview-ui; apps/cli; packages + self-hosted-cloudapi + scripts + misc), rubric = the owner's engineering principles; past rounds 1-5 excluded via memory + ai_plans. Result: ~60 verified findings, estimated net −1400 production LOC (−250 in specs). One branch per item, file-disjoint across branches; PR per branch; squash-merge when green; knip gate last.

## Branches

| Branch | Scope | Key findings | ΔLOC | Risk |
|---|---|---|---|---|
| chore/cleanup-r6-plan | this doc | — | — | — |
| chore/cleanup-r6-core-task-loop | src/core/task + task-persistence | api_req_started double-write; dead Task members; silent catch; TaskAskSay setTimeout table; brand strings | −90 | low |
| chore/cleanup-r6-core-webview | src/core/webview + src/i18n | dead convertToWebviewUri; unreachable marketplace catch; TERMINAL_SETTERS table; DelegationService re-checks; i18n setup flatten + initializeI18n≡changeLanguage | −140 | low-med |
| chore/cleanup-r6-core-tools | assistant-message, auto-approval, mentions | try/catch around non-throwing spread; 5× parse helper; identical ternary; any-typed param | −43 | low |
| chore/cleanup-r6-api | src/api | ROO_LOG_RAW_USAGE spike blocks; DeepSeek redundant override; commented logs; shared responsesApiReasoning | −52 | low-med |
| chore/cleanup-r6-services | src/services mcp + code-index | requireConnection helper; mcpServers invariant in readForUpdate; scanner dispatchBatch extract; embedder usage helper | −70 | med |
| chore/cleanup-r6-utils-tests | src/utils + integrations + src/__tests__ | 49-line comment block; test-double guards in prod code; dead try/catch in git.ts; input re-validation; duplicated vscode mocks | −120 | low-med |
| chore/cleanup-r6-webview-state | webview state defaults | pin showWorktreesInHomeScreen (bug); delete 3-layer re-defaulting | −22 | low |
| chore/cleanup-r6-webview-marketplace | marketplace | no-op preserveTab; derived lists in store; identity memo | −121 | med |
| chore/cleanup-r6-webview-chat-models | chat components + model hooks | todos any-typing; McpExecution dual props; dead ceremony param; duplicate model hooks; caller-less options | −85 | low |
| chore/cleanup-r6-webview-codeblock-css | CodeBlock + index.css | scroller lookup helper; height-tier collapse; unlayered Tailwind re-definitions | −39 | med (visual) |
| chore/cleanup-r6-cli | apps/cli | dead PromptManager API; unreachable unknown-ask branch; envelope helper ×3; install.sh verify_install | −120 | low |
| chore/cleanup-r6-cli-risky | apps/cli | picker sync/async dedupe; spec-only host option; ChatHistoryItem re-parse (mutation-first); stream-Proxy dedupe | −70 | med |
| chore/cleanup-r6-packages | packages/core + cloud | CustomToolRegistry dead API; BaseTelemetryClient fold; RetryQueue events; CloudService dead delegators | −260 | low-med |
| chore/cleanup-r6-cloudapi | self-hosted-cloudapi | run_periodic helper for 4 loop skeletons | −45 | low |
| chore/cleanup-r6-knip-entry-exports | knip.jsonc | includeEntryExports for remaining package workspaces (after packages merges) | gate | low |

## Verified bugs found by the audits — NOT part of this round (owner decision)
1. apps/cli/src/agent/ask-dispatcher.ts:144-147 — handler error swallowed + ts dropped from handledAsks → deterministic failure replays the same ask forever (infinite silent retry).
2. packages/cloud/src/retry-queue/RetryQueue.ts:188-198 — ISO-date Retry-After parsed as ~2026 seconds (queue pauses ~33 min) instead of until-date.
3. packages/cloud/src/CloudAPI.ts:119 — User-Agent "Tumble-Code unknown" on share/bridge/recall (version never passed to getUserAgent()).
4. src/core/webview/ClineProvider.ts:1247 — MCP servers dir: ~/Documents/Cline/MCP (macOS) vs Roo-Code/MCP (win/linux) vs ~/.roo-code/mcp — three brand roots; needs a migration decision.
5. src/api/providers/fetchers/litellm.ts:66 + 70-82 — "Failed to fetch LiteLLM models: Failed to fetch LiteLLM models: …" double prefix.
6. src/services/mcp/McpHub.ts:557 — catch labeled "capabilities refresh" also swallows deleteConnection/connectToServer failures.
7. webview-ui/src/components/settings/PromptsSettings.tsx:46 vs schema.ts:155 — two sources of truth for the includeTaskHistoryInEnhance default.
8. src/i18n/setup.ts — missing dist/i18n/locales in a packaged VSIX silently degrades to English (hypothesis).
9. webview-ui/src/components/common/CodeBlock.tsx:153 — highlight effect deps miss theme changes → stale colors until next token (hypothesis).
10. webview-ui/src/components/chat/McpExecution.tsx:56 — responseText captured at mount; later response changes never render (hypothesis).
11. apps/cli/src/agent/extension-host.ts:607 — TUMBLE_CODE_API_URL/ROO_CODE_API_URL read by literal outside the CLI_RUNTIME_ENV table.
12. src/services/code-index/processors/scanner.ts — embeddingBatchSize read once at construction; mid-session settings change leaves stale threshold (hypothesis).

## Owner-decision / deferred
- Legacy ROO_CODE_* env fallbacks (5 sites + CLI): remove tree-wide in one deprecation release, or document them.
- WebAuthService pre-organization credential shims (3 sites): delete once no stored secret predates the org feature.
- scripts/bootstrap.mjs npm machinery (~70 LOC): corepack already enforces pnpm; taste call.
- webview-ui/src/utils/sourceMapInitializer.ts installs window.__testSourceMaps/__checkSourceMap in the production bundle — confirm the consumer.
- CLI version-skew armour (cast/Array.isArray on typed ExtensionMessage fields under --extension): owner call, kept.
- src/core/task/__tests__/RunParallelTasksTool.spec.ts (1730 lines, 2.2× its tool): needs a duplication-focused pass, not a purge — future item.

## Do-not-touch (respected from the audits)
CLI transcript-reducer merge/dedupe guards and the Ink render pipeline; NativeToolCallParser snapshot net; TaskHistoryStore/cancelTask ordering; commandWrappers/commands tables; ?? fallbacks on user-owned files (settings.modes/models, mcp.json, cli-settings.json); hand-written provider forms (S4 decision); row-height contract and memo-perf specs; immediate-settings design; catch-blocks on external data; TelemetryService client-array seam; schemas/roomodes.json generation; CI gate scripts; characterization snapshots with written review rules.

## Execution
Waves of ≤4 parallel worktree implementers; scoped test suites only (CPU rule); commit locally; a shipping task pushes from the live tree (push recipe) and opens PRs; squash-merge when green; changesets only for user-visible changes (brand string, home-screen flash, installer warning); knip-entry-exports last.
