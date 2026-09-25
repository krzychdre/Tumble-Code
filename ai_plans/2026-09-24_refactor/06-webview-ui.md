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
- 2026-09-25 WEB-Q6 DONE #355 (`42f48bee2`): the mutation was a real bug, not cosmetics: `initialSettings` and
  `currentSettings` share one object after load, save and the secret-status reply, so the mutation also changed the
  baseline and `hasUnsavedChanges` stayed false: a defaulted empty Qdrant URL could not be saved (Save disabled).
  New spec `CodeIndexPopover.qdrant-default.spec.tsx` failed before the fix; changeset added.
- 2026-09-25 WEB-Q7 DONE #356 (`1708d8910`): `getRequestyAuthUrl`, `EditMessageWithCheckpointDialog`,
  `DeleteMessageWithCheckpointDialog`, `scanDOMForSearchableSettings` deleted (knip listed them only as a warning).
- 2026-09-25 WEB-Q11 DONE #357 (`e649a6a33`): `console.log` in `i18n/setup.ts` removed (test-first), stale
  BrowserSessionRow ESLint override removed, `useNonInteractiveClick.ts` renamed to
  `useAddNonInteractiveClickListener.ts`. TabButton inline style left for the next settings PR.
- 2026-09-25 WEB-Q1 DONE #358 (`87b6a1d38`): `editable` and `hasCheckpoint` were never read; the per-row
  `checkpoint_saved` scan and JSON parse are gone. New `ChatView.row-props.spec.tsx` (mock row under the same
  `memo(deepEqual)`, counts renders and mounts).
- 2026-09-25 WEB-Q2 DONE #359 (`7b9b5e393`): `lastModifiedMessage` only for the last row; that alone did not stop
  earlier rows re-rendering per token: `onSuggestionClick` and `onJumpToPreviousCheckpoint` changed identity per
  token, now wrapped by a new `hooks/useStableCallback.ts`. Rows still read `clineMessages` from the context, so they
  still re-render per token through the context (WEB-2a, WEB-4).
- 2026-09-25 WEB-Q3 DONE #360 (`c89c8b765`): ChatView passes `supportsImages`; rows no longer read `apiConfiguration`
  nor post `requestProviderModels`.
- 2026-09-25 WEB-Q10 DONE #361 (`3965cac27`): condensing row key `CONDENSING_ROW_TS = Number.MAX_SAFE_INTEGER`;
  test showed 2 mounts before, 1 after; changeset.
- 2026-09-25 WEB-Q8 DONE #362 (`8ed506d70`): 240 English keys (4,320 entries in 18 locales; 1,657 to 1,417) removed
  by `scripts/find-unused-i18n-keys.mjs` (`--check`, `--patterns`, `--write`; 9 node:test cases), dynamic-prefix
  whitelist in the PR body. Found and fixed a rebrand bug: `worktrees.json` in all 18 locales had
  `multiTumbletNotSupported`/`gitTumblet` (Roo to Tumble replace), so WorktreesView showed raw keys; new
  `worktreesKeys.spec.ts`. Open (pre-existing, own item): keys the code uses but no locale has:
  `chat:autoApprove.selectAll`/`selectNone`, `chat:codebaseSearch.didSearch`, `common:dismiss`,
  `common:dismissAndDontShowAgain`, `common:docsLink.label`, `settings:providers.refreshModels.missingConfig`.
- Not started yet: WEB-Q9 (compiler bailouts in CI), WEB-Q12 (react-use; blocked by "Do not touch" `useSize`).
- 2026-09-25 wave 1 verification: full local run on main b1b93ba15 (`pnpm turbo run check-types lint test
  --continue --concurrency=3`): 38 of 38 tasks green; src 9,855 passed (37 skipped), webview 1,730, cli 1,075,
  types 451, vscode-shim 408, cloud 304, core 178, agent-interchange 114, telemetry 31, build 17; knip exit 0.
- 2026-09-25 missing webview keys DONE #364 (`82bfe819c`): all upstream bugs, not the rebrand: `chat:autoApprove.selectAll`/
  `selectNone` (#7894), `common:dismiss`/`dismissAndDontShowAgain` (#7850, hidden by a hard-coded test mock),
  `settings:providers.refreshModels.missingConfig` (#3852), plus `openAiCodex.signInButton`/`signOutButton` (English
  `defaultValue` in every locale) added in 18 locales; `common:docsLink.label` was a dead `t()` child of `<Trans>`
  (removed); `didSearch` was a plural family (false alarm). New `find-unused-i18n-keys.mjs --missing` check with a
  repo-wide node:test run in CI.
- 2026-09-25 WEB-5 DONE #365 (`4f182c473`, 23 per-provider characterization tests for the 8 embedders) and #366
  (`f6033ecdb`): moved to `components/code-index/`, 1,748 to about 880 lines; `EMBEDDER_FORMS` registry
  (`satisfies Record<EmbedderProvider, ...>`) drives the provider list, validation schema, secret masks;
  `EmbedderFormFields.tsx` with `<ApiKeyAndModelFields>` replaces 5 copies; shared `common/DiscardChangesDialog.tsx`
  also used by SettingsView. No drift between copies. Found (pinned, not fixed): an empty URL field shows "invalid
  URL", never the `*Required` message (`.url()` overwrites `.min(1)`); an empty openai-compatible dimension shows
  zod's untranslated "Required".
- 2026-09-25 WEB-6 DONE #367 (`7ec9719b8`, 61-case table test over the 19 "form" registry entries, DOM pinned for the
  9 key trios), #368 (`b17bfd5a8`, the only drift: Mistral used a `<span>` key label, test-first, changeset), #369
  (`e3bd8b61f`): `settings/providers/shared.tsx` with `ProviderFormProps`, `useProviderField` (17 copies incl.
  ApiOptions), `<ApiKeyField grouped?>` for 9 forms (OpenRouter, LiteLLM, Bedrock differ structurally, left alone);
  +170/-514 lines; 57 innerHTML dumps identical before/after.
- 2026-09-25 code-index validation messages DONE #370: the zod-issue loop now keeps the first issue per field (empty
  Qdrant/Ollama/openai-compatible URL shows `*Required`, a malformed one still "invalid"); openai-compatible dimension
  uses `required_error`/`invalid_type_error` = `modelDimensionRequired`. Test-first (3 failed), changeset.
- 2026-09-25 WEB-10 DONE #371 (`92f5995d5`, 30 characterization tests; first MermaidButton spec), #372
  (`8b4721429`, drift: Mermaid reopened at 100% but kept the old pan offset, test-first, changeset), #374
  (`c0daf0fe1`): `hooks/useZoomPan.ts` + `common/ZoomableModal.tsx`; zoom state lives in a child mounted only while
  open, so every open starts fresh; about 155 lines less. Found: Mermaid code-tab copy button shows no check-mark
  feedback; `onWheel` `preventDefault` is a no-op (React wheel listeners are passive), so the page may scroll too.
- 2026-09-25 WEB-1 DONE #375 (`a1d319c99`, row-pipeline characterization, 10 cases over sanitized fixtures) and #376
  (`8a933deb4`): `components/chat/rows/` (`parseToolCached` keyed by ts+text, 5,000 entries; `filterVisible`,
  `markEverVisible`, `groupToolAsks` reusing unchanged batches, `withCondensingRow`, `computeRowMeta` with a `byTs`
  map ready for WEB-2a); ref mutation moved to an effect declared before the clearing effects; FileChangesPanel
  uses the cache. Measured per token on real tasks: 93.7 to 0.34 ms (405 messages, 9.4 MB), 65.6 to 0.33 ms (783);
  FileChangesPanel 32.8 to 0.05 ms; rows deep-equal on 12 real histories. Findings: ChatView is still not compiled
  (ref read in the `visibleMessages` memo, then `handleSendMessage` memoization); FileChangesPanel clears expanded rows
  on every token (comment says "on task change"); a row visible only on the task's first render is forgotten by
  the "ever visible" set (pinned, not fixed).
- 2026-09-25 zoom follow-ups DONE #377 (`3c74742f5`, Mermaid code-tab copy button now shows the check mark) and #378
  (`e2f539ce4`, `useZoomPan` returns `wheelAreaRef`, a native `{ passive: false }` wheel listener: React 18 makes
  `onWheel` passive, so `preventDefault` was ignored and the page behind scrolled). FileChangesPanel DONE #379: the
  reset effect depended on `clineMessages` (every token collapsed expanded rows); now on the first message ts, like
  ChatView. All test-first with changesets.
- 2026-09-25 WEB-3 DONE #381 (`70b22d14f`, exact Save payload + immediate-write characterization), #382 (`1df2ac6b4`,
  Save fallback `showRooIgnoredFiles` was `true` vs host `false`, latent), #383 (`1ceb649eb`, real bug: turning MCP
  off in the MCP tab and then saving any other setting turned MCP back on; `mcpEnabled` left the Save payload), #384
  (`70fd2c238`): `settings/schema.ts` (rows with `apply`, `default` from `SETTINGS_DEFAULTS`, `serialize`,
  `equals`; `IMMEDIATE_ONLY_SETTINGS`), `useCachedSettings.ts` (9 setters to 3), typed `postImmediateSetting.ts`,
  Save buffer no longer seeded with the whole context, `SetCachedStateField` keyed on `ExtensionState`, TabButton
  class; SettingsView 1,035 to 740 lines. Open: (1) the condense profile, memory writer profile and memory
  directory cannot be cleared (sent as `|| undefined`, dropped by JSON; `mergeExtensionState` keeps the old value):
  needs an owner decision on the cleared-value wire format; (2) memory defaults only literals in `ContextProxy`;
  (3) ModesView's `loadApiConfiguration` silently resets unsaved settings edits; (4) chat components still post
  `updateSettings` directly.
- 2026-09-25 WEB-2a DONE #385 (`01b83a1c8`, 4 characterization tests with the real ChatRow, each lookup broken
  locally to prove sensitivity) and #386 (`4c4ed9203`): rows get `meta` from `computeRowMeta(...).byTs`;
  `ChatRowContent` no longer reads `clineMessages`, `getPreviousTodos` deleted. Rows still consume the context
  (`mcpServers`, `alwaysAllowMcp`, `currentCheckpoint`, `mode`, `currentTaskItem`), so they still re-render per token:
  WEB-4 step 2/3.
- 2026-09-25 WEB-11 (a, b) DONE #380 (`useOrganizationSwitch`; drift fixed: the chat-area CloudAccountSwitcher ignored
  `organizationSwitchResult`, so after a failed switch it kept showing the organization the user did not get, and it
  unlocked after a fixed 1 s; test-first, 17 new tests, the components had no specs) and #387 (ModelDescriptionMarkdown
  on react-markdown + remark-gfm, `react-remark` and its `packageExtensions` entry removed; 5 characterization tests
  unchanged, bare URLs now link). Skipped: `useModeSelection` (after settings work), translation-hook unification.
- 2026-09-25 WEB-11 c DONE #395: `hooks/useModeSelection.ts` shared by CreateSkillDialog and SkillsSettings (no drift,
  about 95 lines less; 8 hook tests, 4 new SkillsSettings dialog tests). Found, same in both old copies: unchecking
  "Any mode" with nothing selected saves as "no restriction"; a deleted custom mode stays in a skill's selection.
- 2026-09-25 WEB-Q9 DONE #373 (`4e3d24498`): `scripts/check-react-compiler-bailouts.mjs` runs the build's compiler
  (target 18) over webview-ui/src and compares with `webview-ui/react-compiler-bailouts.json` (new bailout or stale
  entry fails; `--update`), at the end of the webview `lint` script (about 17 s), 3 node:test cases. DEP-7 not done
  (eslint-plugin-react-hooks still ^5.2). All 7 `eslint-disable react-hooks` removed: #389 useDebounceEffect
  (`e2f399801`), #390 ModeSelector (`2b477912d`), #391 UpdateTodoListToolBlock (`049d3a4a4`), #392
  McpServerRestriction (`79aa8569a`; naive deps would snap back a second checkbox edit, refs instead), #393 ModesView
  (`aa1677148`; still skipped: 19 "existing memoization could not be preserved", for WEB-9), #394 ChatTextArea
  (`bbe300dd8`; stale `setMode` in `handleMentionSelect`). Bailouts 17 to 12. #389 merged last (GitHub reported it
  unmergeable right after the force-push; rebased alone, check 12 known). Found: vitest never runs the compiler
  (a compiler-on test run could be an item); ModesView's create dialog prefill is wiped by `resetFormState()` in the
  open effect.
- 2026-09-25 WEB-4 step 2 DONE #398 (`5c5e63b39`, table test for all 15 handled message types, 13 had none; rows in
  `extensionMessageCases.ts`), #399 (`8d60b9718`, bug: a partial state push (`postStorageErrorState`, only
  `storageErrorMessage`) recomputed `showWelcome` from an undefined `apiConfiguration`, so a configured user saw the
  welcome screen; changeset), #400 (`f36245c97`): pure `applyExtensionMessage(prev, msg)` in
  `context/extensionStateReducer.ts` (returns `prev` on no-ops; `mergeExtensionState` moved verbatim; reducer spec on
  deep-frozen input); ExtensionStateContext 569 to 238 lines; the toggle echo no longer posts from inside a setState
  updater (StrictMode dev double post). Step 3 not started. Found: the state push carries `mcpServers` but the context
  only uses the `mcpServers` message.
- 2026-09-25 WEB-12 DONE #388 (`61cc45a11`, only English + the active locale eager, 17 lazy `locale-<lang>` chunks;
  index.js 5,443,483 to 3,517,885 B, -35%; also fixed a one-frame English flash before the user's language),
  #396 (`802417365`, KaTeX and Mermaid on first use: -439 KB; first formula shows raw TeX until KaTeX arrives),
  #397 (`cb6429413`, PlanReviewApp lazy, -16.8 KB). Open: KaTeX ships twice (0.16.22 via rehype-katex, 0.16.47 via
  Mermaid); lazy `App` in the plan-review panel is the bigger win; `vscode-material-icons` 251 KB and posthog about
  155 KB still eager.
- 2026-09-25 wave 2 verification on main cb6429413: 38 of 38 turbo tasks green (check-types, lint incl. the compiler
  bailout check, test); webview 2,102 tests (was 1,730 after wave 1), src 9,855, cli 1,075; knip 0; webview
  production build OK.
- 2026-09-25 WEB-9 DONE #401 (`4e25379b0`, create dialog prefill wiped by `resetFormState()` in the open effect),
  #402 (`a9aeca430`, real: ModesView is a SettingsView tab; its profile picker posted `loadApiConfiguration`
  directly, so edits in other tabs were silently lost; now goes through `checkUnsaveChanges` like the Providers tab),
  #403 (`77bf99210`, 12 create-dialog/import-export characterization tests), #404 (`9de2c269a`): `CreateModeDialog`,
  `ImportModeDialog`, `useModeImportExport`, `modeGroups`; ModesView 1,801 to 1,262 lines, 33 to 14 `useState`, and it
  now compiles (bailouts 12 to 11). Found: the create payload keeps `allowedMcpServers` after unchecking the mcp
  group; `hasRulesToExport` never shown; `groupsError` unreachable; the `acquireVsCodeApi` stub in
  `SettingsView.unsaved-changes.spec.tsx` is assigned after hoisted imports.
- 2026-09-25 WEB-7 DONE (except ChatRow/ChatView, pending WEB-2b) #405 (`c6839ee0e`): `utils/extensionBus.ts`, one
  window listener, `onExtensionMessage`/`useExtensionMessage`, `request()` correlated only where the host already
  echoes an id (`searchFiles`, `requestProviderModels`); context, App, useProviderModels moved (useProviderModels now
  compiles: bailouts 11 to 10). #406 (`e3df24144`): `useProviderModels` on one react-query cache (two consumers, one
  request; `staleTime: Infinity`, `gcTime: 0`, `networkMode: "always"` for offline Ollama). #407 (`c86c32db7`): 28
  listeners in 26 files moved; production window listeners 33 to 3 (bus, ChatRow, ChatView); a guard spec fails on any
  new direct listener. Behavior deltas: empty MarketplaceView visibility listener removed; MarketplaceViewStateManager
  no longer resets on foreign postMessages without a string `type`. `CommandExecution.spec` now dispatches real
  MessageEvents. Open: `ExtensionMessage` lacks `planReview`; ChatTextArea file search could use `request()`.
- 2026-09-25 WEB-2b DONE #408 (`9c7bf09ef`, 131 golden renders in `__golden__/ChatRow.golden.json`, `UPDATE_GOLDEN=1`;
  vitest snapshots fail in linked-node_modules worktrees; plus `ChatRow.edit-images.spec.tsx`), #409 (`87aec4823`):
  `chat/rows/renderers/{tool,say,ask}/` behind `TOOL_RENDERERS`, `SAY_RENDERERS` (fallback `DefaultSayRow`),
  `SAY_TOOL_RENDERERS`, `ASK_RENDERERS`; ChatRow.tsx 1,805 to 150 lines; ChatRowContent no longer reads the context and
  compiles (bailouts 10 to 9); UserFeedbackRow's image listener on the bus (ChatRow off the listener allowlist).
  #410 (`4db5f7434`): one runSlashCommand renderer (nothing emits the say form since #7473). Found (real, own fix
  item): the `user_edit_todos` row renders `UpdateTodoListToolBlock` without `todos`; its default `[]` is a new array
  per render and an effect keyed on it calls `setEditTodos`: endless re-render (hung the test worker), and the row
  shows none of the edited todos.
