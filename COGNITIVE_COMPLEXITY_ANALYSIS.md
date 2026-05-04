# Cognitive Complexity Analysis — Roo-Code Project

> **Generated:** 2026-05-03  
> **Scope:** `src/`, `webview-ui/src/`, `packages/` (non-test source files only)  
> **Methodology:** Line-count analysis, method/class counts, switch-case branching, and responsibility mapping across all TypeScript/TSX source files.

---

## Executive Summary

This analysis identifies source files whose size, branching density, and mixed responsibilities indicate **high cognitive complexity** — making them harder to understand, test, and maintain safely. The top 3 files alone account for **~12,000 lines** and form a tightly-coupled core that dominates the extension's behavior:

| Rank | File                                                                                     | Lines | Key Smell                                                                          |
| ---- | ---------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| 1    | [`src/core/task/Task.ts`](src/core/task/Task.ts)                                         | 4,738 | God class — task lifecycle, API loop, tool dispatch, history, condensing, subtasks |
| 2    | [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts) | 3,695 | 149-case switch — all UI→extension message routing in a single function            |
| 3    | [`src/core/webview/ClineProvider.ts`](src/core/webview/ClineProvider.ts)                 | 3,599 | God class — provider lifecycle, state, cloud sync, task management, settings       |

These three files represent the **highest refactoring priority** for reducing cognitive load. Below we detail each tier and provide concrete, incremental refactoring strategies.

---

## Severity Tiers

### 🔴 Critical — Files Over 1,000 Lines

These files are large enough that no single developer can hold the full logic in working memory. Each contains multiple distinct responsibilities that should be split into dedicated modules.

| #   | File                                                  | Lines | Functions/Methods | Switch Cases | Primary Responsibilities                                                                                                                                                            |
| --- | ----------------------------------------------------- | ----- | ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/task/Task.ts`                               | 4,738 | 66                | —            | Task lifecycle, API request loop, tool result handling, conversation history, context condensing, subtask delegation, checkpoint management, token tracking, streaming, abort/retry |
| 2   | `src/core/webview/webviewMessageHandler.ts`           | 3,695 | 17                | 149          | Single switch dispatching **all** webview→extension messages: settings, task CRUD, MCP, model fetching, file operations, checkpoints, marketplace, exports                          |
| 3   | `src/core/webview/ClineProvider.ts`                   | 3,599 | 77                | —            | Webview lifecycle, task stack management, cloud profile sync, state serialization, HTML serving, mode switching, provider profiles, HMR                                             |
| 4   | `src/services/mcp/McpHub.ts`                          | 1,995 | 50                | —            | MCP server lifecycle, connection management, config file watching, tool/resource fetching, tool toggling, server CRUD, webview notifications                                        |
| 5   | `src/api/providers/bedrock.ts`                        | 1,588 | 19                | —            | Bedrock handler, payload construction, stream parsing, ARN parsing, inference config, error handling                                                                                |
| 6   | `src/api/providers/openai-native.ts`                  | 1,586 | 24                | —            | Responses API + Chat Completions, stream parsing, tool call handling, usage tracking                                                                                                |
| 7   | `src/api/providers/openai-codex.ts`                   | 1,260 | 21                | —            | Codex-specific provider, OAuth, stream handling                                                                                                                                     |
| 8   | `src/core/assistant-message/NativeToolCallParser.ts`  | 1,077 | 17                | —            | Tool call parsing, partial JSON accumulation, streaming state machine                                                                                                               |
| 9   | `src/core/config/CustomModesManager.ts`               | 1,015 | 30                | —            | Custom mode CRUD, file watching, schema validation, import/export                                                                                                                   |
| 10  | `webview-ui/src/components/chat/ChatView.tsx`         | 1,835 | 2                 | 85           | Monolithic chat UI: rendering, state, keyboard shortcuts, TTS, image handling, model selection                                                                                      |
| 11  | `webview-ui/src/components/chat/CodeIndexPopover.tsx` | 1,749 | —                 | —            | Code index UI: settings, status, configuration, error handling                                                                                                                      |
| 12  | `webview-ui/src/components/modes/ModesView.tsx`       | 1,703 | 4                 | —            | Mode CRUD, tool groups, import/export, form handling                                                                                                                                |
| 13  | `webview-ui/src/components/chat/ChatRow.tsx`          | 1,701 | —                 | —            | Message rendering for every tool type, diff display, approvals, error rows                                                                                                          |

### 🟠 High — Files 500–999 Lines

These files are approaching the threshold where maintainability degrades. Many have a single clear responsibility but are still too large for comfortable comprehension.

| #   | File                                                                | Lines | Primary Concern                               |
| --- | ------------------------------------------------------------------- | ----- | --------------------------------------------- |
| 1   | `src/core/assistant-message/presentAssistantMessage.ts`             | 994   | Presentation logic for assistant messages     |
| 2   | `src/core/config/ProviderSettingsManager.ts`                        | 881   | Provider config CRUD + file I/O               |
| 3   | `src/core/tools/ReadFileTool.ts`                                    | 813   | File reading tool implementation              |
| 4   | `webview-ui/src/components/settings/SettingsView.tsx`               | 960   | Settings container — many sub-settings panels |
| 5   | `webview-ui/src/components/settings/ApiOptions.tsx`                 | 882   | API provider options UI                       |
| 6   | `webview-ui/src/components/common/CodeBlock.tsx`                    | 705   | Syntax-highlighted code block rendering       |
| 7   | `webview-ui/src/context/ExtensionStateContext.tsx`                  | 625   | Global state context — many state slices      |
| 8   | `webview-ui/src/components/settings/providers/OpenAICompatible.tsx` | 600   | OpenAI-compatible provider form               |
| 9   | `webview-ui/src/components/settings/ContextManagementSettings.tsx`  | 563   | Context management settings UI                |
| 10  | `webview-ui/src/components/mcp/McpView.tsx`                         | 544   | MCP server management UI                      |
| 11  | `src/integrations/openai-codex/oauth.ts`                            | 740   | OAuth flow for Codex                          |
| 12  | `src/services/glob/list-files.ts`                                   | 727   | File listing/glob logic                       |
| 13  | `src/integrations/editor/DiffViewProvider.ts`                       | 727   | Diff editor integration                       |
| 14  | `src/services/skills/SkillsManager.ts`                              | 719   | Skills CRUD + discovery                       |
| 15  | `src/api/providers/openai.ts`                                       | 718   | OpenAI base provider                          |
| 16  | `src/core/condense/index.ts`                                        | 701   | Context condensing                            |
| 17  | `src/services/code-index/vector-store/qdrant-client.ts`             | 684   | Qdrant vector store client                    |
| 18  | `src/api/providers/openrouter.ts`                                   | 683   | OpenRouter provider                           |
| 19  | `src/api/providers/vscode-lm.ts`                                    | 602   | VS Code LM provider                           |
| 20  | `src/core/tools/ExecuteCommandTool.ts`                              | 591   | Command execution tool                        |
| 21  | `src/core/config/ContextProxy.ts`                                   | 588   | Context proxy for webview state               |
| 22  | `src/core/task-persistence/TaskHistoryStore.ts`                     | 572   | Task history persistence                      |
| 23  | `src/core/prompts/sections/custom-instructions.ts`                  | 548   | Custom instructions prompt building           |
| 24  | `src/core/diff/strategies/multi-search-replace.ts`                  | 546   | Diff strategy implementation                  |
| 25  | `src/api/providers/gemini.ts`                                       | 529   | Gemini provider                               |
| 26  | `src/core/tools/EditFileTool.ts`                                    | 528   | File editing tool                             |
| 27  | `src/integrations/misc/extract-text.ts`                             | 525   | Text extraction from files                    |
| 28  | `src/services/checkpoints/ShadowCheckpointService.ts`               | 517   | Checkpoint service                            |
| 29  | `src/core/tools/ReadCommandOutputTool.ts`                           | 484   | Command output reading tool                   |
| 30  | `src/core/tools/ApplyPatchTool.ts`                                  | 479   | Patch application tool                        |
| 31  | `src/integrations/terminal/TerminalProcess.ts`                      | 486   | Terminal process management                   |
| 32  | `src/services/code-index/processors/file-watcher.ts`                | 603   | File watcher for code index                   |
| 33  | `src/services/code-index/processors/parser.ts`                      | 554   | Code parser for index                         |
| 34  | `src/services/code-index/config-manager.ts`                         | 544   | Code index configuration                      |
| 35  | `src/services/code-index/embedders/openai-compatible.ts`            | 496   | Embedder implementation                       |
| 36  | `src/integrations/terminal/OutputInterceptor.ts`                    | 430   | Terminal output interception                  |
| 37  | `src/core/mentions/index.ts`                                        | 461   | @-mention resolution                          |
| 38  | `src/core/prompts/tools/filter-tools-for-mode.ts`                   | 456   | Tool filtering per mode                       |
| 39  | `src/extension.ts`                                                  | 452   | Extension activation entry point              |
| 40  | `src/services/roo-config/index.ts`                                  | 444   | Roo configuration service                     |
| 41  | `src/api/providers/roo.ts`                                          | 436   | Roo provider                                  |
| 42  | `src/services/code-index/orchestrator.ts`                           | 428   | Code index orchestration                      |
| 43  | `src/api/providers/anthropic.ts`                                    | 410   | Anthropic provider                            |
| 44  | `packages/types/src/vscode-extension-host.ts`                       | 866   | Type definitions                              |
| 45  | `packages/cloud/src/WebAuthService.ts`                              | 744   | Web authentication service                    |
| 46  | `packages/types/src/provider-settings.ts`                           | 662   | Provider settings types                       |
| 47  | `packages/cloud/src/CloudService.ts`                                | 490   | Cloud service                                 |

---

## Detailed Analysis of Critical Files

### 1. `src/core/task/Task.ts` — 4,738 lines

**Responsibilities identified (10+):**

1. **Task lifecycle** — constructor, initialization, start, resume, abort, disposal
2. **API request loop** — `recursivelyMakeClineRequests()`, stream handling, chunk processing
3. **Tool dispatch** — routing to individual tool implementations
4. **Conversation history** — saving/loading API messages and Cline messages
5. **Context condensing** — triggering and handling condense operations
6. **Subtask delegation** — `startSubtask()`, `resumeAfterDelegation()`
7. **Checkpoint management** — checkpoint creation/restore during tool use
8. **Token/cost tracking** — usage metrics, cost calculation, telemetry
9. **Streaming state machine** — tool call parsing, partial results, abort handling
10. **User interaction** — `ask()`, `say()`, approval flows

**Refactoring strategy:**

| Extract Into        | Lines to Move | Description                                               |
| ------------------- | ------------- | --------------------------------------------------------- |
| `TaskLifecycle`     | ~400          | Constructor, init, start, resume, abort, disposal         |
| `TaskApiLoop`       | ~800          | `recursivelyMakeClineRequests`, stream drain, abort logic |
| `TaskHistory`       | ~300          | API conversation + Cline message persistence              |
| `TaskCheckpoints`   | ~200          | Checkpoint create/restore within task context             |
| `TaskSubtasks`      | ~150          | Subtask delegation and resumption                         |
| `TaskTokenTracking` | ~100          | Token usage, cost, telemetry                              |

The `Task` class would then compose these modules and retain only the coordination logic.

---

### 2. `src/core/webview/webviewMessageHandler.ts` — 3,695 lines, 149 switch cases

This is a **single function** handling every message type from the webview. The switch statement has **149 cases** covering: settings updates, task operations, model fetching, MCP operations, file operations, marketplace, exports, and more.

**Refactoring strategy:**

| Extract Into                  | Cases to Move | Description                                                               |
| ----------------------------- | ------------- | ------------------------------------------------------------------------- |
| `handleSettingsMessages()`    | ~15           | `updateSettings`, `customInstructions`, language/command settings         |
| `handleTaskMessages()`        | ~10           | `newTask`, `askResponse`, `clearTask`, `cancelTask`, `cancelAutoApproval` |
| `handleModelMessages()`       | ~10           | `requestRouterModels`, `requestOllamaModels`, `requestOpenAiModels`, etc. |
| `handleFileMessages()`        | ~5            | `openFile`, `openImage`, `saveImage`, `readFileContent`                   |
| `handleMcpMessages()`         | ~10           | MCP server CRUD, tool toggling, resource operations                       |
| `handleCheckpointMessages()`  | ~5            | `checkpointDiff`, `checkpointRestore`                                     |
| `handleMarketplaceMessages()` | ~15           | Install, uninstall, fetch marketplace data                                |
| `handleExportMessages()`      | ~10           | Export/import tasks and settings                                          |
| `handleHistoryMessages()`     | ~10           | Delete, show, condense task history                                       |
| `handleModeMessages()`        | ~10           | Mode switching, mode CRUD                                                 |

The main `webviewMessageHandler` would become a thin dispatcher that routes to these handlers.

---

### 3. `src/core/webview/ClineProvider.ts` — 3,599 lines, 77 methods

**Responsibilities identified (8+):**

1. **Webview lifecycle** — creation, disposal, HTML content serving, HMR
2. **Task stack management** — add/remove tasks, delegation repair
3. **Cloud profile sync** — initialization, settings updates, profile persistence
4. **State serialization** — `getStateToPostToWebview()`, state posting variants
5. **Provider profile CRUD** — upsert, delete, activate, sticky profiles
6. **Mode switching** — `handleModeSwitch()`
7. **Marketplace integration** — fetch marketplace data
8. **Task history operations** — delete, export, condense, show tasks

**Refactoring strategy:**

| Extract Into        | Lines to Move | Description                                          |
| ------------------- | ------------- | ---------------------------------------------------- |
| `ProviderCloudSync` | ~300          | Cloud profile sync, settings update handling         |
| `ProviderState`     | ~400          | State aggregation, serialization, posting to webview |
| `ProviderProfiles`  | ~200          | Provider profile CRUD operations                     |
| `ProviderTaskOps`   | ~200          | Task stack management and history operations         |
| `ProviderWebview`   | ~200          | HTML content generation, HMR support                 |

---

### 4. `src/services/mcp/McpHub.ts` — 1,995 lines

**Responsibilities identified (6+):**

1. **Server lifecycle** — connect, disconnect, restart, dispose
2. **Config file management** — watch, read, update MCP config files
3. **Tool/resource management** — fetch, toggle, update tool lists
4. **Connection state** — track connections, handle errors, notifications
5. **File watching** — workspace folder watchers, config change debounce
6. **Webview notifications** — push server state changes to UI

**Refactoring strategy:**

| Extract Into           | Lines to Move | Description                                                 |
| ---------------------- | ------------- | ----------------------------------------------------------- |
| `McpConnectionManager` | ~400          | Connect, disconnect, restart, error handling per connection |
| `McpConfigManager`     | ~300          | Config file read/write/watch, project MCP file handling     |
| `McpToolManager`       | ~200          | Tool list fetching, toggling, always-allow management       |
| `McpFileWatcher`       | ~150          | File watching setup, debouncing, cleanup                    |

---

### 5. `webview-ui/src/components/chat/ChatView.tsx` — 1,835 lines

This is a single React component handling: chat rendering, keyboard shortcuts, TTS, image handling, model selection, scroll management, and 85 switch/case branches for event handling.

**Refactoring strategy:**

| Extract Into                 | Lines to Move | Description                                               |
| ---------------------------- | ------------- | --------------------------------------------------------- |
| `useChatView` hook           | ~300          | Core state management, event handling, message processing |
| `useChatShortcuts` hook      | ~150          | Keyboard shortcut handling                                |
| `useChatTts` hook            | ~100          | TTS playback logic                                        |
| `ChatViewRenderer` component | ~400          | Pure rendering logic, JSX structure                       |
| `ChatMessageHandler`         | ~200          | Message sending, tool response handling                   |

---

### 6. API Provider Files (Bedrock, OpenAI Native, OpenAI Codex)

These three files share a common pattern: each provider mixes payload construction, stream parsing, error handling, and model-specific logic in a single class.

| File                                 | Lines | Refactoring                                                                   |
| ------------------------------------ | ----- | ----------------------------------------------------------------------------- |
| `src/api/providers/bedrock.ts`       | 1,588 | Extract `BedrockPayloadBuilder`, `BedrockStreamParser`                        |
| `src/api/providers/openai-native.ts` | 1,586 | Extract `ResponsesApiHandler`, `ChatCompletionsHandler`, `OpenAiStreamParser` |
| `src/api/providers/openai-codex.ts`  | 1,260 | Extract `CodexPayloadBuilder`, `CodexStreamParser`                            |

---

## Webview Component Analysis

The webview layer shows a pattern of monolithic components that combine state, event handling, and rendering:

| Component                   | Lines | Concern                                    |
| --------------------------- | ----- | ------------------------------------------ |
| `ChatView.tsx`              | 1,835 | Chat orchestration + rendering             |
| `CodeIndexPopover.tsx`      | 1,749 | Code index settings + status               |
| `ModesView.tsx`             | 1,703 | Mode CRUD + tool group management          |
| `ChatRow.tsx`               | 1,701 | Rendering for every message type           |
| `ChatTextArea.tsx`          | 1,357 | Input area + autocomplete + slash commands |
| `SettingsView.tsx`          | 960   | Settings container with many panels        |
| `ApiOptions.tsx`            | 882   | API configuration UI                       |
| `CodeBlock.tsx`             | 705   | Code rendering + copy + syntax highlight   |
| `ExtensionStateContext.tsx` | 625   | Global state context                       |

**Recommended pattern:** Extract custom hooks for state/event logic, and split large components into smaller, focused sub-components.

---

## Packages Analysis

The `packages/` directory is generally better structured, but a few files stand out:

| File                                          | Lines | Concern                                              |
| --------------------------------------------- | ----- | ---------------------------------------------------- |
| `packages/types/src/vscode-extension-host.ts` | 866   | Large type definition file — acceptable for types    |
| `packages/cloud/src/WebAuthService.ts`        | 744   | Authentication flow — could extract token management |
| `packages/types/src/provider-settings.ts`     | 662   | Provider settings types — acceptable for types       |
| `packages/cloud/src/CloudService.ts`          | 490   | Multiple cloud operations — could split by concern   |

Type definition files are inherently large but low-complexity; these are **lower priority** for refactoring.

---

## Recommended Refactoring Priority

### Phase 1 — Highest Impact (Reduce coupling in the core triad)

1. **`webviewMessageHandler.ts`** — Split the 149-case switch into domain-specific handlers. This is the lowest-risk refactoring because each case is already independent.
2. **`Task.ts`** — Extract lifecycle, history, and API loop into composed modules. High impact but requires careful interface design.
3. **`ClineProvider.ts`** — Extract cloud sync, state management, and profile operations.

### Phase 2 — Service Layer

4. **`McpHub.ts`** — Split connection management from config/tool management.
5. **API providers** (bedrock, openai-native, openai-codex) — Extract stream parsers and payload builders.

### Phase 3 — Webview Components

6. **`ChatView.tsx`** — Extract hooks and sub-components.
7. **`ChatRow.tsx`** — Split by message type (tool result, error, diff, etc.).
8. **`ModesView.tsx`** — Separate CRUD logic from rendering.
9. **`CodeIndexPopover.tsx`** — Extract settings form from status display.
10. **`ChatTextArea.tsx`** — Extract autocomplete and slash command logic.

### Phase 4 — Medium-complexity files

11. **`NativeToolCallParser.ts`** — The 1,077-line parser could benefit from a state-machine pattern with separate state handlers.
12. **`CustomModesManager.ts`** — Separate file I/O from mode management logic.
13. **`presentAssistantMessage.ts`** — Split by message type presentation.
14. **Large tool files** (`ReadFileTool.ts`, `ExecuteCommandTool.ts`, `EditFileTool.ts`) — Extract shared validation and result formatting.

---

## Metrics Summary

| Category                         | Count | Total Lines                                            |
| -------------------------------- | ----- | ------------------------------------------------------ |
| 🔴 Critical (1,000+ lines)       | 13    | ~24,800                                                |
| 🟠 High (500–999 lines)          | 47    | ~30,600                                                |
| Total analyzed source (non-test) | —     | ~84,500 (src) + 44,000 (webview-ui) + 7,800 (packages) |

**Top 10 files by line count (non-test source):**

```
 4,738  src/core/task/Task.ts
 3,695  src/core/webview/webviewMessageHandler.ts
 3,599  src/core/webview/ClineProvider.ts
 1,995  src/services/mcp/McpHub.ts
 1,835  webview-ui/src/components/chat/ChatView.tsx
 1,749  webview-ui/src/components/chat/CodeIndexPopover.tsx
 1,703  webview-ui/src/components/modes/ModesView.tsx
 1,701  webview-ui/src/components/chat/ChatRow.tsx
 1,588  src/api/providers/bedrock.ts
 1,586  src/api/providers/openai-native.ts
```

---

## Methodology

1. **Line counting:** `find <dir> -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | grep -v spec | grep -v mocks | xargs wc -l | sort -rn`
2. **Function/method counting:** `grep -c 'async \|function \|class '` and `grep -c 'case '`
3. **Responsibility identification:** Manual review of class/method structure, imports, and exported symbols
4. **Thresholds:** 1,000+ lines = Critical, 500–999 = High, 300–499 = Moderate (not detailed in this report)

---

## Appendix: Complete File Listing (500+ Lines, Non-Test)

### `src/` Directory

| Lines | File                                                     |
| ----- | -------------------------------------------------------- |
| 4,738 | `src/core/task/Task.ts`                                  |
| 3,695 | `src/core/webview/webviewMessageHandler.ts`              |
| 3,599 | `src/core/webview/ClineProvider.ts`                      |
| 1,995 | `src/services/mcp/McpHub.ts`                             |
| 1,588 | `src/api/providers/bedrock.ts`                           |
| 1,586 | `src/api/providers/openai-native.ts`                     |
| 1,260 | `src/api/providers/openai-codex.ts`                      |
| 1,077 | `src/core/assistant-message/NativeToolCallParser.ts`     |
| 1,015 | `src/core/config/CustomModesManager.ts`                  |
| 994   | `src/core/assistant-message/presentAssistantMessage.ts`  |
| 881   | `src/core/config/ProviderSettingsManager.ts`             |
| 813   | `src/core/tools/ReadFileTool.ts`                         |
| 740   | `src/integrations/openai-codex/oauth.ts`                 |
| 727   | `src/services/glob/list-files.ts`                        |
| 727   | `src/integrations/editor/DiffViewProvider.ts`            |
| 719   | `src/services/skills/SkillsManager.ts`                   |
| 718   | `src/api/providers/openai.ts`                            |
| 701   | `src/core/condense/index.ts`                             |
| 684   | `src/services/code-index/vector-store/qdrant-client.ts`  |
| 683   | `src/api/providers/openrouter.ts`                        |
| 602   | `src/api/providers/vscode-lm.ts`                         |
| 591   | `src/core/tools/ExecuteCommandTool.ts`                   |
| 588   | `src/core/config/ContextProxy.ts`                        |
| 572   | `src/core/task-persistence/TaskHistoryStore.ts`          |
| 569   | `src/extension/api.ts`                                   |
| 554   | `src/services/code-index/processors/parser.ts`           |
| 548   | `src/core/prompts/sections/custom-instructions.ts`       |
| 546   | `src/core/diff/strategies/multi-search-replace.ts`       |
| 544   | `src/services/code-index/config-manager.ts`              |
| 529   | `src/api/providers/gemini.ts`                            |
| 528   | `src/core/tools/EditFileTool.ts`                         |
| 525   | `src/integrations/misc/extract-text.ts`                  |
| 517   | `src/services/checkpoints/ShadowCheckpointService.ts`    |
| 516   | `src/services/code-index/processors/scanner.ts`          |
| 509   | `src/api/transform/openai-format.ts`                     |
| 496   | `src/services/code-index/embedders/openai-compatible.ts` |
| 486   | `src/integrations/terminal/TerminalProcess.ts`           |
| 484   | `src/core/tools/ReadCommandOutputTool.ts`                |
| 479   | `src/core/tools/ApplyPatchTool.ts`                       |
| 476   | `src/services/code-index/manager.ts`                     |
| 469   | `src/integrations/misc/indentation-reader.ts`            |
| 461   | `src/core/mentions/index.ts`                             |
| 456   | `src/core/prompts/tools/filter-tools-for-mode.ts`        |
| 452   | `src/extension.ts`                                       |
| 444   | `src/services/roo-config/index.ts`                       |
| 436   | `src/api/providers/roo.ts`                               |
| 432   | `src/services/code-index/embedders/openrouter.ts`        |
| 430   | `src/integrations/terminal/OutputInterceptor.ts`         |
| 428   | `src/services/code-index/orchestrator.ts`                |
| 410   | `src/api/providers/anthropic.ts`                         |
| 398   | `src/utils/git.ts`                                       |
| 392   | `src/core/checkpoints/index.ts`                          |
| 388   | `src/api/providers/native-ollama.ts`                     |
| 385   | `src/shared/tools.ts`                                    |
| 384   | `src/services/marketplace/SimpleInstaller.ts`            |
| 376   | `src/core/context-management/index.ts`                   |
| 370   | `src/utils/shell.ts`                                     |
| 368   | `src/core/auto-approval/commands.ts`                     |

### `webview-ui/src/` Directory

| Lines | File                                                                           |
| ----- | ------------------------------------------------------------------------------ |
| 1,835 | `webview-ui/src/components/chat/ChatView.tsx`                                  |
| 1,749 | `webview-ui/src/components/chat/CodeIndexPopover.tsx`                          |
| 1,703 | `webview-ui/src/components/modes/ModesView.tsx`                                |
| 1,701 | `webview-ui/src/components/chat/ChatRow.tsx`                                   |
| 1,357 | `webview-ui/src/components/chat/ChatTextArea.tsx`                              |
| 960   | `webview-ui/src/components/settings/SettingsView.tsx`                          |
| 882   | `webview-ui/src/components/settings/ApiOptions.tsx`                            |
| 705   | `webview-ui/src/components/common/CodeBlock.tsx`                               |
| 625   | `webview-ui/src/context/ExtensionStateContext.tsx`                             |
| 600   | `webview-ui/src/components/settings/providers/OpenAICompatible.tsx`            |
| 563   | `webview-ui/src/components/settings/ContextManagementSettings.tsx`             |
| 544   | `webview-ui/src/components/mcp/McpView.tsx`                                    |
| 498   | `webview-ui/src/components/chat/UpdateTodoListToolBlock.tsx`                   |
| 489   | `webview-ui/src/hooks/useScrollLifecycle.ts`                                   |
| 486   | `webview-ui/src/components/marketplace/MarketplaceViewStateManager.ts`         |
| 474   | `webview-ui/src/components/chat/TaskHeader.tsx`                                |
| 441   | `webview-ui/src/components/chat/ContextMenu.tsx`                               |
| 410   | `webview-ui/src/components/settings/TerminalSettings.tsx`                      |
| 407   | `webview-ui/src/components/welcome/WelcomeViewProvider.tsx`                    |
| 397   | `webview-ui/src/utils/context-mentions.ts`                                     |
| 397   | `webview-ui/src/components/settings/AutoApproveSettings.tsx`                   |
| 389   | `webview-ui/src/components/settings/SkillsSettings.tsx`                        |
| 386   | `webview-ui/src/components/marketplace/components/MarketplaceInstallModal.tsx` |
| 382   | `webview-ui/src/components/chat/McpExecution.tsx`                              |
| 362   | `webview-ui/src/components/history/HistoryView.tsx`                            |
| 359   | `webview-ui/src/components/chat/ModeSelector.tsx`                              |
| 358   | `webview-ui/src/components/settings/ApiConfigManager.tsx`                      |
| 338   | `webview-ui/src/components/worktrees/WorktreesView.tsx`                        |
| 336   | `webview-ui/src/components/chat/ErrorRow.tsx`                                  |
| 333   | `webview-ui/src/App.tsx`                                                       |
| 332   | `webview-ui/src/components/common/MarkdownBlock.tsx`                           |
| 331   | `webview-ui/src/components/common/MermaidBlock.tsx`                            |
| 323   | `webview-ui/src/components/settings/ModelPicker.tsx`                           |
| 315   | `webview-ui/src/components/common/ImageViewer.tsx`                             |
| 304   | `webview-ui/src/utils/validate.ts`                                             |

### `packages/` Directory (Non-generated)

| Lines | File                                                     |
| ----- | -------------------------------------------------------- |
| 866   | `packages/types/src/vscode-extension-host.ts`            |
| 744   | `packages/cloud/src/WebAuthService.ts`                   |
| 662   | `packages/types/src/provider-settings.ts`                |
| 633   | `packages/types/src/providers/vertex.ts`                 |
| 608   | `packages/types/src/providers/openai.ts`                 |
| 573   | `packages/types/src/providers/bedrock.ts`                |
| 572   | `packages/types/src/cloud.ts`                            |
| 535   | `packages/types/src/telemetry.ts`                        |
| 490   | `packages/cloud/src/CloudService.ts`                     |
| 432   | `packages/core/src/custom-tools/custom-tool-registry.ts` |
| 428   | `packages/core/src/worktree/worktree-include.ts`         |
| 399   | `packages/types/src/providers/zai.ts`                    |
| 383   | `packages/types/src/global-settings.ts`                  |
| 371   | `packages/cloud/src/retry-queue/RetryQueue.ts`           |
| 362   | `packages/vscode-shim/src/api/WindowAPI.ts`              |
| 344   | `packages/vscode-shim/src/types.ts`                      |
| 338   | `packages/build/src/esbuild.ts`                          |
| 327   | `packages/evals/src/cli/runTaskInVscode.ts`              |
| 315   | `packages/core/src/worktree/worktree-service.ts`         |
| 310   | `packages/evals/src/cli/runTaskInCli.ts`                 |
| 304   | `packages/types/src/message.ts`                          |
| 297   | `packages/cloud/src/CloudSettingsService.ts`             |
| 291   | `packages/telemetry/src/TelemetryService.ts`             |
| 290   | `packages/cloud/src/TelemetryClient.ts`                  |
| 286   | `packages/types/src/providers/gemini.ts`                 |
