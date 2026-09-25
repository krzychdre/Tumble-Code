# Webview UI: `webview-ui`

Phase 7. Scale: 294 non-test source files with 46,425 lines; 143 test files with about 1,534 cases (1,570 counted
by vitest). `src/webview-ui` is the gitignored Vite build output, not duplicate source; leave it alone. Defects:
`02-defects.md` C24 and C25. Test-harness trap in this repo: mock `react-i18next` **and** render through
`@/utils/test-utils` (which adds `TooltipProvider`) in the same edit.

## Key fact: the React Compiler skips exactly the heaviest components

`vite.config.ts` runs `babel-plugin-react-compiler` (target 18). Running the same compiler version (1.0.0) offline
over all files shows 17 components are not compiled, including `ChatRowContent` (an optional chain inside a
logical test at `ChatRow.tsx:1763`, then a try/catch around a value block at `:1260`), `ChatView` (reads and writes
a ref inside `useMemo` at `ChatView.tsx:1036, 1110`), `App.tsx:106`, `CodeIndexPopover` (state mutation at
`:1446`), and every component with an `eslint-disable react-hooks` comment (`ChatTextArea`, `ModesView`,
`ModeSelector`, `UpdateTodoListToolBlock`, `McpServerRestriction`, `useDebounceEffect`). On the hot path the
hand-written memoization is the only memoization, so splitting these components pays twice: readability and
automatic memoization.

## Where the prior plans stand

| Prior item                                                                      | Status                                                                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Provider registry in ApiOptions                                                 | DONE (`settings/provider-ui-registry.tsx`, `satisfies` exhaustiveness; ApiOptions 850 to 588 lines)                                     |
| knip in CI                                                                      | DONE (`code-qa.yml:22-30`)                                                                                                              |
| Declarative settings schema; children writing to the Save buffer and live state | OPEN (WEB-3)                                                                                                                            |
| Context reducer and typed hydration                                             | OPEN (WEB-4); the "untyped fields" premise was wrong, the fields exist in `ExtensionState` since 2026-01-09, so the 11 casts can go now |
| Split ChatView into hooks                                                       | OPEN, 1,848 to 1,901 lines (WEB-8)                                                                                                      |
| ChatRow renderer registry                                                       | OPEN, 1,727 to 1,842 lines, 72 `case` labels (WEB-2)                                                                                    |
| Shared `handleInputChange` hook                                                 | OPEN, 16 copies (the drop from 23 came from deleted providers) (WEB-6)                                                                  |
| postMessage catalog                                                             | OPEN, grew to 249 call sites in 75 files (WEB-7)                                                                                        |
| ModesView split                                                                 | OPEN, 1,800 lines, 33 `useState` (WEB-9)                                                                                                |
| MermaidButton / ImageViewer duplication                                         | OPEN (WEB-10); `ImageViewer` is used (`ImageBlock.tsx:2, 58`)                                                                           |
| styled-components removal                                                       | OPEN, 4 files; convert only as renderers move                                                                                           |
| Typed i18n keys, TabButton inline style                                         | OPEN, small                                                                                                                             |

## WEB-Q Quick wins (each S, low risk, own test)

1. Delete the unused ChatRow props `editable` and `hasCheckpoint` (`ChatRow.tsx:136-137`) and their per-row work in
   ChatView (`:1485` runs `modifiedMessages.some(...)` per row, `:1512-1525` parses JSON per row).
2. Pass `lastModifiedMessage` only to the last row: it is read only when `isLast` (`ChatRow.tsx:275-282`) but
   passed to every row (`ChatView.tsx:1503`) and changes on every token, defeating the `deepEqual` memo on all rows.
3. Remove `useSelectedModel` from `ChatRowContent` (`:198`): each mounted row posts `requestProviderModels` to the
   host and adds a window listener, only to compute `shouldDisableImages` in edit mode, which ChatView already
   computes (`:911`). Pass `supportsImages` down.
4. Context dead code: 35 setters with zero production references (list in WEB-4), the unread `theme` state with
   its 156-line `utils/textMateToHljs.ts`, the no-op effect at `:563-567`, the 11 `as any` casts, the 5 shadow
   `useState`s at `:308-318` (one of them makes `setFollowupAutoApproveTimeoutMs` a no-op for readers).
5. DEF-C24 (`settingsImportedAt` wipe) with its regression test.
6. Remove the direct state mutation at `CodeIndexPopover.tsx:1446` (the `updateSetting` on the next line already
   sets the value).
7. Dead exports: `getRequestyAuthUrl` (`oauth/urls.ts:11`, provider removed), two dialog exports in
   `CheckpointRestoreDialog.tsx`, `scanDOMForSearchableSettings`. Dead dependencies are in DEP-2.
8. Prune unused i18n keys: a heuristic scan finds about 259 of 1,656 English keys unused (settings 106, chat 56,
   marketplace 49, common 21, others 27), about 4,600 entries across 18 locales [I; spot checks confirmed
   `chat:slashCommands.*`, `chat:tokenProgress.*`, `chat:announcement.cloudAgents.*`]. Whitelist dynamic key
   prefixes before deleting.
9. Make compiler bailouts visible in CI (the compiler rule in `eslint-plugin-react-hooks` 7, see DEP-7, or a small
   script), then remove the 7 `eslint-disable react-hooks` suppressions one at a time.
10. Give the synthetic condensing row a fixed key: it uses `ts: Date.now()` (`ChatView.tsx:1284`), so it remounts on
    every recompute [I].
11. Housekeeping: stale ESLint override for the nonexistent `BrowserSessionRow.tsx` (`eslint.config.mjs:31-36`),
    rename `useNonInteractiveClick.ts` to match its export, remove the production `console.log` in
    `i18n/setup.ts:30`, fold the `TabButton.tsx:22` inline style into the next settings PR.
12. Candidate (added 2026-09-24 with TEST-6): replace the few `react-use` hooks the webview uses (for example
    `useSize`, see "Do not touch", and `useEvent`) with local hooks or a smaller library, so `js-cookie` 2 and its
    high advisory GHSA-qjx8-664m-686j leave the lockfile; it is accepted until 2026-12-31 in
    `scripts/audit-allowlist.mjs`. Size and the full hook list are not measured yet.

## WEB-1 Move the chat-row pipeline out of ChatView into pure functions with a parse cache

**Evidence:** about 400 lines of data shaping live in the component: `modifiedMessages` (`ChatView.tsx:145`),
`apiMetrics` (`:148`), `isStreaming` with a `JSON.parse` (`:570-612`), `visibleMessages` which also mutates a ref
inside `useMemo` (`:1020-1113`), `groupedMessages` with 3 parsing predicates and 3 batch synthesizers
(`:1142-1289`), `checkpointIndices` (`:1291-1299`); `FileChangesPanel.tsx:34` adds another full parse pass. The
chain `messages -> modifiedMessages -> visibleMessages -> groupedMessages` has no stable step, so every streamed
partial re-parses every tool payload in the history. **Measured** (Node 22, replaying the parse work on real task
files): 95.6 ms per recompute for a 405-message task with 8.5 MB of tool JSON, 70.7 ms for 783 messages
(5.8 MB), 9.4 ms for 1,543 messages (0.8 MB). ChatView stays mounted while hidden, so this also runs while Settings
is open.

**Change:** `components/chat/rows/` with `filterVisible(messages, seenTs)`, `groupToolAsks(rows)`,
`computeRowMeta(rows)` (next ts, previous todos, `newTask` child index, followed-by-`subtask_result`, checkpoint
indices) and `parseToolCached(msg)` keyed by `ts` and `text`; move the `everVisibleMessagesTsRef` mutation out of
`useMemo` and keep its "ever visible" semantics. **Test first:** a row-pipeline characterization test with ChatRow
mocked (print ts, type, say/ask and a text hash) over sanitized fixtures (consecutive `read_file`/`list_files`/edit
asks, `checkpoint_saved` with `suppressMessage`, `api_req_retry_delayed` last and not last, condensing on,
`completion_result` with empty text); reuse the fixtures for the unit tests. **Existing:** `batchConsecutive.spec`
(11), `ChatView.spec` (25), `command-row-expansion` (3), `scroll-debug-repro` (12), `fileChangesFromMessages` (17).
**Size** M, low to medium risk.

## WEB-2 ChatRow: pure rows, then a renderer registry

**Evidence:** 1,842 lines; `ChatRowContent` is one function (`:180-1842`) with a pre-render icon switch, a tool
switch of 22 kinds (`:457-1115`), a `say` switch of 26 kinds (`:1118-1717`) and an `ask` switch (`:1719-1842`); 118
inline style blocks. It reads `clineMessages` from context (`:196`) and does history-sized work per render
(`findIndex` for the next ts at `:288-292`; `getPreviousTodos` makes two reversed copies and parses every earlier
tool ask, `:91-120`; the `newTask` case filters and parses all messages, `:917-937`). Because it consumes the
context, the `deepEqual` memo on its wrapper cannot stop a re-render per token. Drift: `runSlashCommand` is
rendered twice with different icon and layout (`:1004` and `:1527`).

**Change:**

- **WEB-2a** (S to M, after WEB-1): ChatView passes the precomputed row meta and `supportsImages`;
  `ChatRowContent` stops reading `clineMessages` and `apiConfiguration`.
- **WEB-2b** (L): renderers move to `chat/rows/renderers/{say,ask,tool}/*` behind `SAY_RENDERERS`,
  `ASK_RENDERERS`, `TOOL_RENDERERS` typed `Partial<Record<ClineSay, Renderer>>`; the two `runSlashCommand`
  renderers are unified. styled-components in the moved code is converted at the same time.

**Test first:** one golden render per say, ask and tool kind (about 72) using the `renderChatRowWithProviders`
harness from `ChatRow.run-slash-command.spec.tsx`, snapshotting `container.innerHTML` (the repo has no snapshot
tests yet; these are deleted once the extraction is done and replaced by per-renderer tests). **Existing:** about
20 ChatRow cases for 72 branches, plus child components (CommandExecution 42, McpExecution 21, FollowUpSuggest 22,
others). **Risk** medium (visual output); manual check of each moved row kind.

## WEB-4 ExtensionStateContext: dead surface, a pure reducer, then selective subscriptions

**Evidence:** `ExtensionState` has 84 picked setting keys plus about 60 own fields; the context type adds 113
members, 63 of them setters. **35 setters have no production reference:** `setAllowedMaxCost`,
`setAllowedMaxRequests`, `setAlwaysAllowReadOnlyOutsideWorkspace`, `setAlwaysAllowWriteOutsideWorkspace`,
`setAutoCondenseContext`, `setAutoCondenseContextPercent`, `setAwsUsePromptCache`, `setCheckpointTimeout`,
`setCurrentApiConfigName`, `setCustomModePrompts`, `setCustomModes`, `setEnableCheckpoints`,
`setEnableSubfolderRules`, `setEnterBehavior`, `setFollowupAutoApproveTimeoutMs`, `setHistoryPreviewCollapsed`,
`setIncludeCurrentCost`, `setIncludeCurrentTime`, `setIncludeDiagnosticMessages`, `setMaxDiagnosticMessages`,
`setMaxImageFileSize`, `setMaxOpenTabsContext`, `setMaxTotalImageSize`, `setMaxWorkspaceFiles`,
`setPinnedApiConfigs`, `setProfileThresholds`, `setReasoningBlockCollapsed`, `setShowRooIgnoredFiles`,
`setSoundEnabled`, `setSoundVolume`, `setTerminalOutputPreviewSize`, `setTerminalShellIntegrationDisabled`,
`setTerminalShellIntegrationTimeout`, `setTerminalZdotdir`, `setWriteDelayMs`. There is one context, so every
state change (every `messageUpdated` token and every full push) re-renders every one of the 39 consuming files,
including per-row components (`ChatRowContent`, `ReasoningBlock`, `ErrorRow`, `CommandExecution`,
`FollowUpSuggest`) and the uncompiled `ChatTextArea`, which also reads `clineMessages`.

**Change:** (1, S) WEB-Q4; (2, M) `handleMessage` becomes a pure `applyExtensionMessage(prev, msg)` in
`context/extensionStateReducer.ts` with `mergeExtensionState` moved verbatim (its `clineMessagesSeq` guard and
`sourceTaskId` routing are tested race protection); (3, L, optional) an external store read through
`useSyncExternalStore` with `useExtensionSelector(sel)`, keeping `useExtensionState()` as a compatibility hook and
moving the per-row consumers first (a lighter alternative is a separate context for chat messages). **Test first:**
one table test per handled message type; today no test covers `messageUpdated`, `taskHistoryItemUpdated`,
`taskHistoryItemDeleted`, `theme`, `action`/`toggleAutoApprove`, `marketplaceData` or `listApiConfig`.
**Existing:** `ExtensionStateContext.spec` (15), `.subagents.spec` (6); update the mocks that list setters
(`MarketplaceView.spec.tsx:65-67`).

## WEB-3 Settings: one schema for keys, defaults, serialization and apply mode

**Evidence:** `SettingsView.tsx` (1,054 lines) destructures 73 fields (`:160-236`) and re-lists the same 73 in the
Save payload (`:391-485`); 9 near-identical setter callbacks (`:260-389`); 7 immediate `updateSettings` posts from
children bypass the Save buffer (`AutoApproveSettings.tsx:91, 110, 121, 345, 404`, `PromptsSettings.tsx:213`,
`ContextManagementSettings.tsx:151`); `SetCachedStateField` is keyed on the whole context type (`types.ts:5`), so
setter names type-check as keys; the Save buffer is seeded with the whole context including `clineMessages`
(`:159`); defaults disagree with the host (DEF-C25).

**Change:** `settings/schema.ts` with one row per setting `{key, default, serialize?, apply: "onSave" |
"immediate"}`, checked with `satisfies` against a `SettingsKey` union derived from `GlobalSettings`; defaults come
from the CORE-R1 table in `packages/types`; `buildUpdatedSettings(cached)`, `useCachedSettings()`,
`postImmediateSetting()`. The legitimately immediate fields (ModesView, custom sounds in NotificationSettings) are
modeled as `immediate`, not "fixed". **Tests first:** Save with a fully populated state asserts the exact payload;
Save with every field undefined pins today's fallbacks; immediate-write tests for AutoApproveSettings and
PromptsSettings; the DEF-C24 regression test. **Existing:** SettingsView (20 in 3 specs), section specs (72).
**Size** M, medium risk.

## WEB-6 Provider forms: shared props, hook and `ApiKeyField`

**Evidence:** 16 files copy the 9-line `handleInputChange`; 20 declare their own props type with a looser setter
than `provider-ui-registry.tsx:27-31`; the "API key field + storage notice + get-key link" trio appears 12 times;
`DeepSeek.tsx:17-34` is identical to Mistral, XAI, MiniMax, Moonshot and ZAi. **Change:** `providers/shared.ts` with
`ProviderFormProps`, `useProviderField`, `<ApiKeyField field labelKey getKeyUrl />`. **Test first:** a table test
over every registry entry with status `"form"`: typing into the key field calls `setApiConfigurationField` with the
right key. **Existing:** provider specs (40), `provider-ui-registry.spec` (5), `ApiOptions` specs (26). **Size** S.

## WEB-5 CodeIndexPopover (1,749 lines, a settings form under `chat/`)

**Evidence:** 8 embedder-provider JSX branches (`:769, 834, 918, 1026, 1091, 1156, 1226, 1319`) and a per-provider
schema switch (`:86-~180`); the "API key plus model dropdown" block copied 6 times, 595 duplicated lines, about 45%
of all duplication in the webview; its discard dialog copies SettingsView's (`:1729-1747` /
`SettingsView.tsx:1032-1050`). **Change:** move to `components/code-index/`; an `EMBEDDER_FORMS` registry typed with
`satisfies Record<EmbedderProvider, ...>` mirroring `provider-ui-registry.tsx`; shared `<ApiKeyAndModelFields>`
and `<DiscardChangesDialog>`. **Test first:** per provider (8): render, fill required fields, assert validation
errors and the `saveCodeIndexSettingsAtomic` payload (`:560`). **Existing:** `auto-populate` (8),
`IndexingStatusBadge` (9). **Size** M.

## WEB-7 One message bus: typed subscriptions and request/response

**Evidence:** 32 separate `window` message listeners, several per instance (every `ChatRowContent`,
CommandExecution, McpExecution, MarketplaceItemCard, every `useProviderModels`); 65 inline `type === "..."` checks
plus switches in the context (17 types), ChatView (15) and App; `ExtensionMessage` (74 type literals, 80 optional
fields) and `WebviewMessage` (174 literals, 91 optional fields) are not discriminated unions (hence
`message.clineMessage!` at `:404`); about 18 `WebviewMessage` literals have no sender and no handler [I] (the
extension side list is in CORE-Q1). **Change:** `utils/extensionBus.ts` with one listener,
`onExtensionMessage(type, handler)` narrowing locally (additive, no change to `packages/types`), and `request()`
correlated by request id; `useProviderModels` on a shared cache (react-query is installed). **Test first:** bus unit
tests (subscribe, unsubscribe, narrowing, request timeout) and "two consumers produce one request". **Existing:**
`useProviderModels.spec` (4), `useSelectedModel.spec` (23). **Size** M.

## WEB-8 ChatView: hooks by concern (after WEB-1, WEB-2a, WEB-7)

**Evidence:** 1,901 lines, 16 `useState`, 18 effects, 26 `useCallback`, 12 `useMemo`, 14 `useRef`; 21 context
fields; props passed down: ChatTextArea 18, ChatRow 16, TaskHeader 14. Concern boundaries: sounds `:238-288`, ask
state machine `:290-508`, send/queue/buttons `:614-912`, host messages `:917-1016`, checkpoint navigation
`:1291-1480`, keyboard `:1557-1600`. **Change:** `useChatSounds`, `useAskButtons`, `useChatComposer`,
`useChatHostMessages` (on WEB-7), `useCheckpointNavigation`; `useScrollLifecycle` untouched. **Test first:** the ask
state machine table (for each last-message kind, tool kind and `partial`: expected `clineAsk`, `enableButtons`,
button texts, `sendingDisabled`, about 25 branches) and host `invoke` messages. **Existing:** 59 tests in 8 ChatView
specs. **Size** L, high risk (effect ordering).

## WEB-9 to WEB-12

| ID     | Item                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                | Test first                                                                                               | Size                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| WEB-9  | ModesView: extract `CreateModeDialog` and `useModeImportExport`                                                                                                                                                                                                                                                                                                                                                       | 16 of 33 `useState` are the create form (`:309-324`); 17 postMessage calls; uncompiled                                                                                                                                                                                                  | create-mode validation errors and the `updateCustomMode` payload                                         | M                              |
| WEB-10 | `useZoomPan` plus `ZoomableModal` for MermaidButton and ImageViewer                                                                                                                                                                                                                                                                                                                                                   | pure copies (same limits 0.5 to 20, wheel step 0.2)                                                                                                                                                                                                                                     | a MermaidButton spec (none today): zoom limits, wheel, drag, copy                                        | S-M                            |
| WEB-11 | Small duplications: `useOrganizationSwitch` (`CloudAccountSwitcher.tsx:25-51, 135-168` / `OrganizationSwitcher.tsx:55-81, 140-173`), `useModeSelection` (`CreateSkillDialog.tsx:118-148` / `SkillsSettings.tsx:107-138`), one markdown stack (drop `react-remark` in `ModelDescriptionMarkdown`), one translation hook (`useAppTranslation` in 108 files versus `useTranslation` in 26, the root of the mocking trap) | as listed                                                                                                                                                                                                                                                                               | a test per extracted hook; a markdown test for model descriptions                                        | S each, the translation hook M |
| WEB-12 | Bundle: load only the active locale, lazy-load Mermaid, KaTeX and the PlanReview app                                                                                                                                                                                                                                                                                                                                  | main `index.js` 5.70 MB with no `manualChunks`; all 18 locales eager (`i18n/setup.ts:8`), about 35% of the file; `vscode-material-icons` 251 KB for one component, KaTeX 241 KB, posthog 155 KB, Mermaid core ~100 KB eager; paid once per webview creation (`retainContextWhenHidden`) | `TranslationContext.spec` extended for lazy locales; `MarkdownBlock`, `CodeBlock`, `PlanReviewApp` specs | S-M                            |

## Do not touch

`clineMessagesSeq` and `sourceTaskId` routing in `mergeExtensionState` (move verbatim); `useScrollLifecycle` and the
ChatRow `useSize`/`onHeightChange` contract (react-use's `useSize` mounts a hidden iframe per row, but it feeds the
redesigned scroll-follow logic and jsdom cannot test it: replace it only as a dedicated, manually verified change);
the Save-buffer contract itself (`AGENTS.md:5`); the per-provider closures in `provider-ui-registry.tsx`;
hand-written memoization in the uncompiled components; `MarketplaceViewStateManager`; the lazy Shiki grammar chunks;
the message interfaces' public shape (narrow on the webview side, WEB-7); styled-components and inline styles
outside code being moved; the "ever visible" LRU semantics in `visibleMessages`.

## Suggested order

WEB-Q (1 to 8), WEB-1, WEB-2a, WEB-4 (1, 2), WEB-3, WEB-6, WEB-5, WEB-2b, WEB-7, WEB-8, WEB-9, WEB-10, WEB-11,
WEB-12, WEB-4 (3) if the profiling after WEB-2a still shows context fan-out cost.

## Status

- 2026-09-25 WEB-Q5 (DEF-C24): already done in #232 (`abdb67a19`).
- 2026-09-25 WEB-Q4 DONE #354 (`e012971b5`): 40 dead context setters removed (the 35 listed plus
  `setListApiConfigMeta` (kept local), `setShowAnnouncement`, `setExperimentEnabled`, `setTelemetrySetting`,
  `setCustomSupportPrompts`; grep hits were local `useState`s or props); `theme` state and `utils/textMateToHljs.ts`
  removed; the no-op `prevCloudIsAuthenticated` effect removed; the 5 shadow `useState`s and 11 `as any` casts gone
  (defaults moved into the initial state). The `setFollowupAutoApproveTimeoutMs` shadow bug was unreachable (no
  caller). 4 characterization tests added; 44 of 44 in the touched specs. Follow-ups: the host still posts `theme`
  (`ClineProvider.ts:961`, now ignored); `marketplaceInstalledMetadata` stays a separate state (WEB-4 step 2).
