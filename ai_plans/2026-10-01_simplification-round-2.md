# Simplification round 2 (2026-10-01)

**Status:** done 2026-10-02 except B11 (paused, see below). Each item was one branch and one pull request, squash-merged right after opening (#664-#724).
**Source:** a read-only review of the whole repository at `65fdaba16` (five reviewers, one per area; the strongest
claims re-checked by hand). Round 1 is `ai_plans/2026-09-27_simplification-roadmap.md`.

Goal as in round 1: code a person can read and change with an editor and `grep`. This round has three kinds of work:
real defects found during the review, deletions of code nobody uses, and one place per fact. The look of the
webview outside the chat and of the cloud web panel gets its own items.

## Owner decisions (2026-10-01)

| Question                                                           | Decision                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| CLI `--stdin-prompt-stream` mode (no caller outside its own tests) | Remove                                                                    |
| `MdmService` (enterprise policy that forces a cloud login)         | Remove                                                                    |
| VS Code shell-integration terminal path (off by default)           | Remove, keep the execa path                                               |
| Number of UI languages                                             | Keep all 18                                                               |
| `BRIDGE_ENABLED` default                                           | `true`, as in `config/settings.py`; compose stops overriding defaults     |
| Vercel AI Gateway embedder (its chat provider is retired)          | Remove                                                                    |
| OCaml and TLA+ tree-sitter grammars                                | Keep                                                                      |
| 555 nightly pre-releases on GitHub                                 | Keep the newest 10; the workflow prunes older ones from now on            |
| Changeset release PR #522                                          | Fix the workflow race only; the owner merges #522                         |
| Cloud web look                                                     | Polish the current style (dark, technical, mono accents), do not redesign |
| Rebuild at the end                                                 | VSIX, local CLI, cloud api image                                          |

Facts checked for the model items (Anthropic model list, cached 2026-09-25): every Claude 3.x model is retired
(Sonnet 3.7 and Haiku 3.5 on 2026-02-19, Opus 3 on 2026-01-05, Sonnet 3.5 on 2025-10-28, Haiku 3 on 2026-04-19);
Opus 4.1 retired on 2026-08-05. Claude Opus 5.5 has 128K max output on every platform.

## A. Defects

| ID  | Item                                                                                                                                               | Evidence                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A1  | Scala files are parsed with the Lua query                                                                                                          | `src/services/tree-sitter/languageGrammars.ts:77`                        |
| A2  | Legacy `read_file` (`files` list) drops images and reads whole files for line ranges                                                               | `src/core/tools/ReadFileTool.ts:666-812`, image at 758-760               |
| A3  | Mermaid diagrams are always dark (and PNG export)                                                                                                  | `webview-ui/src/components/common/MermaidBlock.tsx:14,55,308`            |
| A4  | CLI: `reasoning_effort` never reaches the `openai` provider                                                                                        | `apps/cli/src/lib/utils/provider-config.ts:165-181`                      |
| A5  | CLI: Mistral `--base-url` only applies to Codestral models                                                                                         | `provider-types.ts` + `src/api/providers/mistral.ts:71-72`               |
| A6  | Hidden `gemini-cli` provider silently falls back to Anthropic                                                                                      | `src/api/runtime-provider-registry.ts:53-62`, `src/api/index.ts:155-165` |
| A7  | Marketplace writes `mcp.json` / `.roomodes` with plain `fs.writeFile`, bypassing their owners; parse errors swallowed                              | `SimpleInstaller.ts:139,268,357`, `MarketplaceManager.ts:262-340`        |
| A8  | Compose duplicates 24 defaults of `settings.py` and contradicts `BRIDGE_ENABLED`; placeholder secrets                                              | `self-hosted-cloudapi/docker-compose.yml:22-47`                          |
| A9  | `changeset-release` races itself (no `concurrency`); 555 nightly releases; `marketplace-publish.yml` without a token; unused `slack-notify` action | `.github/workflows/*`                                                    |
| A10 | Claude Opus 5.5 `maxTokens` 8192 on Vertex and Bedrock (128K on Anthropic); 1M list hand-copied in `anthropic.ts:68-72`                            | `packages/types/src/providers/{vertex,bedrock,anthropic}.ts`             |
| A11 | Qwen token refresh throws without `.status`, so the retry loop cannot see a 401; Qwen credentials written non-atomically                           | `src/api/providers/qwen-code.ts:139,158`                                 |
| A12 | Mode rules folder path built by hand in 5 places; with no workspace the handler falls back to a relative path                                      | `CustomModesManager.ts:630-920`, `messageHandlers/customModes.ts:91-102` |

## B. Deletions

| ID  | Item                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `silentWrites` flag (nothing sets it since #423)                                                                                                                                                                               |
| B2  | Copy only registered tree-sitter grammars into dist (7 unused, about 10 MB)                                                                                                                                                    |
| B3  | Dead webview primitives (`AutosizeTextarea`, `CircularProgress`, `Progress`, `RadioGroup`, `Table`, `Separator`, `DropdownMenu`) and their Radix deps; named exports in `ui/index.ts`; dead CSS selectors                      |
| B4  | CLI: `auth login/logout/status` + credentials store, empty `list models`, one-choice onboarding screen, dead UI store state, duplicate `runListAction`/`runUpgradeAction`                                                      |
| B5  | CLI `--stdin-prompt-stream` mode (owner decision)                                                                                                                                                                              |
| B6  | Cloud endpoints nothing calls (marketplace, credit-balance, provider-sign-up, `/l/{slug}`) and the client code that builds them (`CloudAPI.creditBalance`, landing slug, `useProviderSignup`, `providerModel` callback branch) |
| B7  | Eight hard-skipped e2e suites (5,045 lines)                                                                                                                                                                                    |
| B8  | About 42 dead exports in `packages/types`, three never-emitted telemetry events; telemetry error helpers move to `packages/telemetry`; knip `includeEntryExports` for types                                                    |
| B9  | Repo leftovers: `scripts/find-missing-i18n-key.js`, `scripts/bench-task-persistence.ts`, `.roo/roomotes.yml`, root `locales/` READMEs and their links                                                                          |
| B10 | `MdmService` (owner decision)                                                                                                                                                                                                  |
| B11 | VS Code shell-integration terminal path and its workaround settings (owner decision)                                                                                                                                           |
| B12 | Vercel AI Gateway embedder (owner decision)                                                                                                                                                                                    |
| B13 | Retired Claude models (3.x, Opus 4.1) in the Anthropic, Vertex, Bedrock tables; LiteLLM default model; `:thinking` suffix if only 3.7 used it                                                                                  |
| B14 | `ToolBlock` adoption makes the per-row expandable styles dead (see D1)                                                                                                                                                         |

## C. One place per fact

| ID  | Item                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `write_to_file` and `apply_diff` use `applyComputedEdit` like the other edit tools                                                                                                                               |
| C2  | Re-export files in `src/shared` (api, experiments, language, parse-command, getApiMetrics, combineApiRequests, combineCommandSequences, partial WebviewMessage/tools): codemod to the real module and real names |
| C3  | One logger: `console.*`, `provider.log`, `appendLine` go through `logger`; delete `CompactTransport`                                                                                                             |
| C4  | One cost function with tier pricing in `packages/core/src/api/cost.ts`; delete the copies                                                                                                                        |
| C5  | Claude model data shared by Anthropic, Vertex, Bedrock                                                                                                                                                           |
| C6  | Z.ai mainland table derived from the international one plus price overrides                                                                                                                                      |
| C7  | `EMBEDDER_DESCRIPTORS` table for code-index embedders (after B12)                                                                                                                                                |
| C8  | `BaseOpenAiCompatibleProvider` extension points; DeepSeek on it; drop MiniMax `base_resp`                                                                                                                        |
| C9  | One atomic write (`writeFileAtomic` in `@roo-code/core/fs`) for safeWriteJson, ArtifactStore, handoffs                                                                                                           |
| C10 | `escapeRegExp` once                                                                                                                                                                                              |
| C11 | `presentAssistantMessage` split into steps; parameter `cline` renamed `task`                                                                                                                                     |
| C12 | Small core cleanups: condense threshold helper, dead branch in `custom-instructions.ts:486`, `DiffStrategy` required, status/queue out of `TaskTokenTracking`, merged code/terminal action handlers              |
| C13 | File splits: `condense/index.ts`, `searchTaskHistory.ts`, `CustomModesManager.ts` (mode export)                                                                                                                  |
| C14 | Provider small dedupes: OAuth refresh in Codex, Qdrant URL normalisation and marker write, stale `apiRequestTimeout` description, HTTP-Referer strings                                                           |
| C15 | Cloud: `dialect_insert(db)` helper, top-level imports, dead `tumble:theme` event                                                                                                                                 |

## D. Look

| ID  | Item                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Tool rows use `ToolBlock` (keyboard-reachable expand, chevron visible on focus)                                                            |
| D2  | Density tokens outside the chat: Settings, MCP (`McpView` restyle, `ServerRow` split), Modes                                               |
| D3  | One control family: `ThemedDropdown` to `Select` first                                                                                     |
| D4  | Status colours from `--status-*` tokens instead of Tailwind palette                                                                        |
| D5  | Hand-made dialogs in Modes use `Dialog`                                                                                                    |
| D6  | Section headers, font-size scale, no-op `rounded*` classes, one `Spinner`                                                                  |
| D7  | Hard-coded English strings to i18n; decorative icons `aria-hidden`; `outline-none` with `focus-visible`                                    |
| D8  | Cloud web polish: auth pages on `base.html`, `light-dark()` palette, one button family, consistent tables, cards, empty and loading states |

## E. Maintainability

| ID  | Item                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `docs/plan-ids.md`: one sentence per plan ID used in code comments (CORE-R*, DEF-*, API-_, WS-_, WEB-_, PKG-_, CB-\*)            |
| E2  | `ai_plans/` index (`ai_plans/README.md`) and archive rule; finished plans move to `ai_plans/archive/YYYY-MM/`                    |
| E3  | Stale docs: `architecture.md` (missing files, cloud to core edge), `07-cli.md` diagram, cloud README architecture link and title |

## Order

Waves of at most three helpers with disjoint files. Defects first, then deletions, then the structural and visual
items. C2 and C3 touch many files and run alone at the end.

## Status

| ID  | PR  | Notes |
| --- | --- | ----- |
