# Refactoring Plan — `webview-ui/` (React frontend) for Human Maintainability

> **Date:** 2026-07-14 · **Scope:** [`webview-ui/`](webview-ui/) only · **Mode:** architect (planning, no code changes)
> **Goal:** Make the React/TypeScript frontend readable and maintainable by a human working alone, without AI assistance. Priorities: (1) low cognitive complexity, (2) design patterns where sensible, (3) dead-code removal, (4) human readability.
> **Consistency note:** Mirrors the structure of the parallel [`ai_plans/2026-07-14_src-refactor-plan.md`](ai_plans/2026-07-14_src-refactor-plan.md) for the extension host. Cross-references `src/` only to verify host-side message production/consumption — does not plan host refactoring.

---

## 0. Status of prior analysis — read this first

A prior frontend analysis exists at [`ai_plans/refactor-webview-ui.md`](ai_plans/refactor-webview-ui.md). It is **partially stale**: several line counts drifted, and the single biggest growth (ChatRow) was not flagged. This plan re-derives everything from current code.

### Verified current line counts (re-derived 2026-07-14)

| File                                                                                                                                             | Prior plan claimed | **Actual today** | Delta    | Status                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------- | -------- | -------------------------------------------------------------------------------------- |
| [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx:1)                                                   | 1830               | **1848**         | +18      | God-component, grew slightly                                                           |
| [`webview-ui/src/components/modes/ModesView.tsx`](webview-ui/src/components/modes/ModesView.tsx:1)                                               | ~1790              | **1801**         | +11      | God-component                                                                          |
| [`webview-ui/src/components/chat/ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:1)                                                     | ~1300              | **1727**         | **+427** | ❌ **Biggest drift — grew +427 lines, now ~3rd largest. Prior plan understated this.** |
| [`webview-ui/src/components/settings/ApiOptions.tsx`](webview-ui/src/components/settings/ApiOptions.tsx:1)                                       | 850                | **850**          | 0        | 27-branch provider conditional                                                         |
| [`webview-ui/src/components/settings/SettingsView.tsx`](webview-ui/src/components/settings/SettingsView.tsx:1)                                   | 1009               | **1012**         | +3       | 70-field submit                                                                        |
| [`webview-ui/src/context/ExtensionStateContext.tsx`](webview-ui/src/context/ExtensionStateContext.tsx:1)                                         | 642                | **651**          | +9       | 70-setter monolith                                                                     |
| [`webview-ui/src/components/marketplace/MarketplaceViewStateManager.ts`](webview-ui/src/components/marketplace/MarketplaceViewStateManager.ts:1) | —                  | **487**          | new      | Class-based state machine (good pattern, noted below)                                  |

**Conclusion:** the prior plan's top-3 targets (ChatView, ModesView, SettingsView) are still valid, but **ChatRow.tsx grew +427 lines and is now a co-equal god-component** — it was under-prioritized before. The AGENTS.md dual-bind violation and the MermaidButton/ImageViewer duplication are new findings not in the prior plan.

---

## 1. Executive summary

- **The frontend has three god-components of roughly equal weight: [`ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx:1) (1848 lines), [`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:1) (1727 lines, grew +427 since last analysis), and [`ModesView.tsx`](webview-ui/src/components/modes/ModesView.tsx:1) (1801 lines).** ChatRow is the surprise — its 700-line nested `switch (message.say)` / `switch (message.ask)` renderer ([`ChatRow.tsx:1030`](webview-ui/src/components/chat/ChatRow.tsx:1030)) is a per-message-type dispatch that should be a registry, not a switch.
- **The single biggest structural debt is [`ExtensionStateContext.tsx`](webview-ui/src/context/ExtensionStateContext.tsx:1): one context, ~70 inline setter closures (L515-637), `(newState as any)` hydration casts (L324-342), and `as any` casts on setters (L573).** Every consumer re-renders on any state change (no slicing). This is the foundation every other refactor depends on.
- **There is a live AGENTS.md violation in [`AutoApproveSettings.tsx`](webview-ui/src/components/settings/AutoApproveSettings.tsx:86): `handleModeChange` (L86-94) and `handleAddCommand` (L100-109) write to live `useExtensionState()` setters AND fire `vscode.postMessage` immediately, bypassing the `cachedState` buffer that [`AGENTS.md`](AGENTS.md) mandates.** 10 settings children call `useExtensionState()` directly (grep-verified). The cache contract is unenforceable today.
- **Two clear, mechanical design-pattern wins with low risk:** (a) the 27-branch provider conditional in [`ApiOptions.tsx:482`](webview-ui/src/components/settings/ApiOptions.tsx:482) → a `PROVIDER_REGISTRY` map; (b) the 22 duplicated `handleInputChange = useCallback` blocks across [`providers/*.tsx`](webview-ui/src/components/settings/providers/) → one shared `useProviderFieldHandlers` hook. Both remove ~250 lines of duplication.
- **Dead code is best found by running `npx knip`, not hand-grep.** [`knip.json`](knip.json:31) is configured for the `webview-ui` workspace (entry `src/index.tsx`, project `src/**/*.{ts,tsx}`). The inventory below flags only suspects needing a human eyeball; the systematic recommendation is `npx knip --workspace webview-ui` as a CI gate.

---

## 2. Findings by theme

### Theme A — `ExtensionStateContext` 70-setter monolith with type-erased hydration (highest leverage, foundational)

**Evidence:**

- [`webview-ui/src/context/ExtensionStateContext.tsx`](webview-ui/src/context/ExtensionStateContext.tsx:1): **651 lines.**
    - The context type ([`ExtensionStateContextType`](webview-ui/src/context/ExtensionStateContext.tsx:35)) declares ~70 setter methods.
    - The `contextValue` object literal ([`ExtensionStateContext.tsx:515`](webview-ui/src/context/ExtensionStateContext.tsx:515)) rebuilds ~70 fresh inline arrow closures every render (`setAlwaysAllowReadOnly: (value) => setState(...)`, etc., through L637). None are `useCallback`-memoized.
    - State is **duplicated**: `alwaysAllowFollowupQuestions`, `followupAutoApproveTimeoutMs`, `includeTaskHistoryInEnhance`, `includeCurrentTime`, `includeCurrentCost`, `skills` exist as BOTH fields in the merged `state` object AND separate `useState` calls ([`ExtensionStateContext.tsx:287`](webview-ui/src/context/ExtensionStateContext.tsx:287)–L297).
    - Hydration uses `(newState as any)` casts ([`ExtensionStateContext.tsx:324`](webview-ui/src/context/ExtensionStateContext.tsx:324)–L342) because the `ExtensionState` type from `@roo-code/types` doesn't declare those fields. Setter [`setTaskSyncEnabled`](webview-ui/src/context/ExtensionStateContext.tsx:573) uses `as any` on the partial state.
    - The `handleMessage` switch ([`ExtensionStateContext.tsx:314`](webview-ui/src/context/ExtensionStateContext.tsx:314)–L493) dispatches ~14 message types (`state`, `action`, `theme`, `workspaceUpdated`, `commands`, `messageUpdated`, `subagentsUpdated`, `memoryActivity`, `skills`, `mcpServers`, `currentCheckpointUpdated`, `listApiConfig`, `routerModels`, `marketplaceData`, `taskHistoryUpdated`, `taskHistoryItemUpdated`).

**Why it hurts:** No human can hold 70 setters in working memory. Adding a state field requires touching the type interface, the `useState`/initial-state, the `contextValue` wiring, and possibly the `handleMessage` switch — 4 change-points. Every consumer of the context re-renders on _any_ state change because the value object identity changes every render (no memoization, no selector). The `as any` casts are a silent type-safety hole: a renamed host field will not produce a compile error. The duplicate `useState` fields are a workaround for fields that _should_ be in `ExtensionState` but aren't typed there.

**Proposed approach (reducer + typed hydration, optional slicing):**

1. Replace the single `useState<ExtensionState>` + 70 closures with a `useReducer` whose `Action` is a discriminated union (`SET_FIELD`, `MERGE_STATE`, `SET_TASK_HISTORY`, `UPSERT_TASK_HISTORY_ITEM`, etc.). The context value becomes `{ state, dispatch }` — one stable object, no 70-closure rebuild.
2. Promote the 5 "extra" `useState` fields (`alwaysAllowFollowupQuestions`, `followupAutoApproveTimeoutMs`, `includeTaskHistoryInEnhance`, `includeCurrentTime`, `includeCurrentCost`) into the `ExtensionState` type (in `packages/types`) so hydration is type-safe and the `(newState as any)` casts disappear. Coordinate with the host — these fields are already sent in `state` messages (the casts prove it).
3. Replace `setTaskSyncEnabled ... as any` with a properly typed partial-state action.
4. _(Optional, second pass)_ Split the context into 2–3 sliced providers (`ChatStateContext`, `SettingsStateContext`, `CloudStateContext`) so consumers subscribe only to their slice. Even without slicing, the reducer alone removes the closure-rebuild cost and centralizes field addition.

**Effort:** L · **Risk:** med (re-render behavior changes — the existing [`ExtensionStateContext.spec.tsx`](webview-ui/src/context/__tests__/ExtensionStateContext.spec.tsx:1) and the per-component specs must stay green). **Dependencies:** none, but do this _before_ Theme B/C/D since they all consume this context.

**Human-verifiable acceptance:** `cd webview-ui && npx vitest run src/context` green; `grep -c "as any" src/context/ExtensionStateContext.tsx` → 0; `grep -c "setState((prevState)" src/context/ExtensionStateContext.tsx` drops by ~60 (replaced by `dispatch`); the `contextValue` object literal is `{ state, dispatch }` (~3 lines, not ~120).

---

### Theme B — `ChatRow.tsx` 1727-line per-message-type renderer (grew +427, registry opportunity)

**Evidence:**

- [`webview-ui/src/components/chat/ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:1): **1727 lines.** Structure:
    - `getPreviousTodos` helper (L82–112).
    - [`ChatRow`](webview-ui/src/components/chat/ChatRow.tsx:136) memo wrapper (L136–168) — height-change tracking via `useSize`.
    - [`ChatRowContent`](webview-ui/src/components/chat/ChatRow.tsx:172) (L172–1727) — the real component.
    - The render body is a **700-line nested switch** ([`ChatRow.tsx:1030`](webview-ui/src/components/chat/ChatRow.tsx:1030)): `switch (message.type)` → `case "say"` → `switch (message.say)` (L1031–1603, ~20 cases: `task`, `subtask_result`, `reasoning`, `api_req_started`, `api_req_retry_delayed`, `api_req_rate_limit_wait`, `api_req_finished`, `text`, `completion_result`, `command`, `checkpoint_saved`, `condense_context`, `condense_context_error`, `sliding_window_truncation`, `codebase_search_result`, `tool`, `image`, `too_many_tools_warning`, `user_edit_todos`, …) → then `case "ask"` → `switch (message.ask)` (L1604–1727, ~8 cases: `mistake_limit_reached`, `command`, `use_mcp_server`, `tool`, `completion_result`, `followup`, …).
    - Pre-render memos for `tool`/`cost`/`apiReqCancelReason` (L250–340) contain their own nested `switch (message.ask)` (L289–410).
    - Imports 18 child components ([`ChatRow.tsx:26`](webview-ui/src/components/chat/ChatRow.tsx:26)–L78) plus 16 lucide icons.

**Why it hurts:** Adding a new `say`/`ask` message type means editing a 700-line switch buried at the bottom of a 1727-line file. The `case` bodies range from 1 line (`return <ReasoningBlock …>`) to 80+ lines (the `tool` case at L456–850 with its own nested batch-diff/batch-file/batch-list branching). Reviewers cannot see the diff in context. IDE "go to definition" on a message type lands in the type union, not the renderer.

**Proposed approach (Strategy/Registry — per-type renderer map):**

1. Extract each `case` body into a small renderer component or function: `SayTextRow`, `SayReasoningRow`, `SayApiReqStartedRow`, `AskToolRow`, `AskCommandRow`, `AskFollowupRow`, `AskUseMcpServerRow`, etc. (Many already exist as components — `ReasoningBlock`, `CommandExecution`, `CheckpointSaved`, `InProgressRow`, `CondensationResultRow`, `TruncationResultRow`, `CodebaseSearchResultsDisplay`, `FollowUpSuggest` — the switch just wraps them; the inline cases are the ones to extract.)
2. Build two registry maps:
    ```ts
    const SAY_RENDERERS: Partial<Record<ClineSay, (props: SayRowProps) => JSX.Element>> = { … }
    const ASK_RENDERERS: Partial<Record<ClineAsk, (props: AskRowProps) => JSX.Element>> = { … }
    ```
3. `ChatRowContent`'s render becomes ~15 lines: look up the renderer, fall back to `null`/default, handle the shared `ToolUseBlock` wrapper for tool cases.
4. The pre-render `useMemo` switch (L250–340) for `tool`/`cost`/`apiReqCancelReason` extracts into a `useMessageMetadata(message)` hook.

**Effort:** L · **Risk:** med (the `tool` case has batch-diff/batch-file/batch-list sub-branching that must be preserved exactly; existing [`ChatRow`-related specs](webview-ui/src/components/chat/__tests__/) and the per-message specs cover most cases). **Dependencies:** none — can start immediately; do the simple `say` cases first (text, reasoning, checkpoint_saved) as a proof, then the `ask` cases, then the `tool` case last.

**Human-verifiable acceptance:** `cd webview-ui && npx vitest run src/components/chat` green; `grep -c "case " src/components/chat/ChatRow.tsx` drops from ~30 to ≤5 (only the top-level type switch remains); `wc -l src/components/chat/ChatRow.tsx` < 400; each extracted renderer file < 120 lines.

---

### Theme C — `ChatView.tsx` 1848-line god component with ~59 hooks

**Evidence:**

- [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx:1): **1848 lines**, single `ChatViewComponent` (L75–1847).
    - Destructures 18+ fields from `useExtensionState()` ([`ChatView.tsx:86`](webview-ui/src/components/chat/ChatView.tsx:86)–L106).
    - The ask-response state machine ([`ChatView.tsx:279`](webview-ui/src/components/chat/ChatView.tsx:279)–L870, a `useDeepCompareEffect` on `lastMessage`): nested `switch (lastMessage.type)` → `switch (lastMessage.ask)` → `switch (tool.tool)` (L329–372) setting `clineAsk`/`enableButtons`/`primaryButtonText`/`secondaryButtonText`/`sendingDisabled`. ~590 lines.
    - Sound playback ([`ChatView.tsx:239`](webview-ui/src/components/chat/ChatView.tsx:239)–L277): 3 `useSound` hooks + `playSound` callback with debounce.
    - Follow-up auto-approval timer ([`ChatView.tsx:213`](webview-ui/src/components/chat/ChatView.tsx:213)–L225): `isFollowUpAutoApprovalPaused` memo + cancel effect.
    - Scroll lifecycle: delegated to [`useScrollLifecycle`](webview-ui/src/hooks/useScrollLifecycle.ts:1) (good — already extracted), wired at L1283.
    - Checkpoint cursor management, batch consolidation ([`ChatView.tsx:1236`](webview-ui/src/components/chat/ChatView.tsx:1236)–L1240), keyboard shortcuts (L1507–1520), retired-provider warning (L113–116), announcement modal, aggregated costs map (L183–192).
    - Imports [`useCloudUpsell`](webview-ui/src/hooks/useCloudUpsell.ts:1), [`useScrollLifecycle`](webview-ui/src/hooks/useScrollLifecycle.ts:1) — the hook-extraction pattern is _already established_ in `chat/hooks/usePromptHistory.ts` but under-applied.

**Why it hurts:** ~59 `useEffect`/`useCallback`/`useMemo`/`useState`/`useRef` calls in one component. Effect ordering is load-bearing (the `useScrollLifecycle` extraction already proved this is delicate). A bug in the ask state machine requires scrolling through 590 lines of nested switches. The file is the #1 maintenance cost in the frontend.

**Proposed approach (extract concern hooks — incremental, no big-bang):**

1. `useAskResponseMachine(messages, clineAsk, t)` — owns the ask-state + primary/secondary button text (L156–870). Returns `{ clineAsk, enableButtons, primaryButtonText, secondaryButtonText, sendingDisabled, setSendingDisabled }`. This is the largest extraction (~590 lines → ~400-line hook + ~200-line ChatView reduction).
2. `useChatSounds(soundEnabled, soundVolume, customSoundUris, audioBaseUri)` — owns the 3 `useSound` hooks + `playSound` (L239–277).
3. `useFollowUpAutoApproval(inputValue, clineAsk)` — owns the paused-memo + cancel effect (L213–225).
4. `useChatKeyboard(customModes, mode, setMode, …)` — owns the mode-switch shortcuts (L1507–1520).
5. `useAggregatedCosts(taskHistory)` — owns the costs map (L183–192) + the `getCostBreakdownIfNeeded` effect.
6. `useMessageBatching(messages)` — owns the `combineApiRequests`/`combineCommandSequences`/`batchConsecutive` pipeline (L145, L1236–1240).

Target: ChatView < 700 lines (coordinator + JSX layout).

**Effort:** L · **Risk:** high if done carelessly (effect ordering, scroll/ask timing). **Dependencies:** none, but do _after_ Theme A (reducer) so the hooks consume a stable context. Do incrementally — one hook per PR, each guarded by the existing per-behavior specs ([`ChatView.scroll-debug-repro.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.scroll-debug-repro.spec.tsx:1), [`ChatView.notification-sound.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.notification-sound.spec.tsx:1), [`ChatView.clear-approval-buttons.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.clear-approval-buttons.spec.tsx:1), [`ChatView.keyboard-fix.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.keyboard-fix.spec.tsx:1), [`ChatView.preserve-images.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.preserve-images.spec.tsx:1)).

**Human-verifiable acceptance:** after each hook extraction, the relevant `ChatView.*.spec.tsx` is green; `wc -l src/components/chat/ChatView.tsx` shrinks monotonically; `grep -c "useEffect\|useCallback\|useMemo\|useState\|useRef" src/components/chat/ChatView.tsx` drops by ~40.

---

### Theme D — `SettingsView` 70-field `handleSubmit` + AGENTS.md dual-bind violation

**Evidence:**

- [`webview-ui/src/components/settings/SettingsView.tsx`](webview-ui/src/components/settings/SettingsView.tsx:1): **1012 lines.**
    - Destructure of 66 fields from `cachedState` ([`SettingsView.tsx:155`](webview-ui/src/components/settings/SettingsView.tsx:155)–L221).
    - `handleSubmit` ([`SettingsView.tsx:376`](webview-ui/src/components/settings/SettingsView.tsx:376)–L460): a ~75-line object literal hand-mirroring the state shape with per-field `?? defaultValue` coercion (L380–449). Forgetting one field = silently lost setting.
    - 7 `setCachedStateField`/`setApiConfigurationField`/`setExperimentEnabled`/`setTelemetrySetting`/`setDebug`/`setImageGenerationProvider`/`setOpenRouterImageApiKey`/`setImageGenerationSelectedModel`/`setCustomSupportPromptsField` callback definitions (L245–372) — each duplicates the "if unchanged, return prev; else setChangeDetected(true)" pattern.
- **AGENTS.md violation** in [`AutoApproveSettings.tsx`](webview-ui/src/components/settings/AutoApproveSettings.tsx:1):
    - `handleModeChange` ([`AutoApproveSettings.tsx:86`](webview-ui/src/components/settings/AutoApproveSettings.tsx:86)–L94): calls `setAutoApprovalMode` (live context setter) AND `vscode.postMessage({type:"updateSettings"})` inline AND conditionally `setAutoApprovalEnabled` + another `postMessage`. Three state locations written per click; `cachedState` is bypassed.
    - `handleAddCommand` ([`AutoApproveSettings.tsx:100`](webview-ui/src/components/settings/AutoApproveSettings.tsx:100)–L109) and `handleAddDeniedCommand` (L111–120): same dual-write — `setCachedStateField` + immediate `vscode.postMessage`.
    - `handleAddCommand` checkbox at L135–139: `setAutoApprovalEnabled` (live) + `vscode.postMessage`.
- **10 settings children call `useExtensionState()` directly** (grep-verified): [`ApiOptions.tsx:134`](webview-ui/src/components/settings/ApiOptions.tsx:134), [`AutoApproveSettings.tsx:79`](webview-ui/src/components/settings/AutoApproveSettings.tsx:79), [`CreateSkillDialog.tsx:78`](webview-ui/src/components/settings/CreateSkillDialog.tsx:78), [`NotificationSettings.tsx:138`](webview-ui/src/components/settings/NotificationSettings.tsx:138), [`PromptsSettings.tsx:42`](webview-ui/src/components/settings/PromptsSettings.tsx:42), [`SkillsSettings.tsx:38`](webview-ui/src/components/settings/SkillsSettings.tsx:38), [`SlashCommandsSettings.tsx:29`](webview-ui/src/components/settings/SlashCommandsSettings.tsx:29), [`providers/Poe.tsx:42`](webview-ui/src/components/settings/providers/Poe.tsx:42), [`providers/LiteLLM.tsx:37`](webview-ui/src/components/settings/providers/LiteLLM.tsx:37).
    - `NotificationSettings` (L134–137) documents its live read as _intentional_ (custom-sound fields update via their own message round-trip, not the save buffer) — this is a legitimate "immediate" field, but the pattern is ad-hoc.

**Why it hurts:** Adding one setting requires touching 5 places: (1) the `ExtensionStateContextType` interface, (2) the destructure at L155–221, (3) the `handleSubmit` payload at L380–449, (4) the child input component, (5) the child's prop type. The `AutoApproveSettings` dual-bind is the exact race [`AGENTS.md`](AGENTS.md) exists to prevent: the cache becomes meaningless for those fields, and a save-click could overwrite the just-applied live value. The contract is unenforceable because children freely reach into the context.

**Proposed approach (declarative settings schema + applyMode flag + lint rule):**

1. Define a `SettingField` schema (one row per field): `{ key, default?, serialize?, section, applyMode: "onSave" | "immediate" }`. `handleSubmit` becomes `vscode.postMessage({ type:"updateSettings", updatedSettings: pickAndSerialize(cachedState, SETTINGS_SCHEMA.filter(f => f.applyMode === "onSave")) })`. The destructure becomes a generic `useCachedSettings(SETTINGS_SCHEMA)` hook. Adding a setting = one schema row + one input component.
2. For `applyMode: "immediate"` fields (custom sounds, auto-approval mode), route through a dedicated `postImmediateSetting(key, value)` helper that does NOT touch `cachedState`. No child ever calls both `setCachedStateField` and a live setter.
3. Add a scoped ESLint rule (or convention + review) making `useExtensionState()` inside `settings/**` children a lint error except for read-only display fields (like `NotificationSettings`'s custom-sound display). Immediate-write fields get an explicit `onImmediateChange` prop.
4. Fix `AutoApproveSettings.handleModeChange`/`handleAddCommand`/`handleAddDeniedCommand` to route through the schema: `autoApprovalMode` becomes `applyMode: "immediate"`; `allowedCommands`/`deniedCommands` become `applyMode: "onSave"` (remove the inline `postMessage`).

**Effort:** M (schema extraction is mechanical; the dual-bind fix is S after the schema exists) · **Risk:** med (behavioral — must verify each immediate field still fires; the existing [`SettingsView.unsaved-changes.spec.tsx`](webview-ui/src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx:1) and [`SettingsView.change-detection.spec.tsx`](webview-ui/src/components/settings/__tests__/SettingsView.change-detection.spec.tsx:1) guard the cache contract). **Dependencies:** Theme A (reducer) makes the schema-driven `useCachedSettings` cleaner but is not strictly required.

**Human-verifiable acceptance:** `cd webview-ui && npx vitest run src/components/settings` green; `grep -c "?? " src/components/settings/SettingsView.tsx` in `handleSubmit` drops to ~0 (replaced by schema defaults); `grep -rn "useExtensionState" src/components/settings/` shows only `SettingsView.tsx` + documented display-only reads; `AutoApproveSettings.tsx` contains no `vscode.postMessage` except via the schema helper.

---

### Theme E — `ApiOptions` 27-branch provider conditional (Registry pattern)

**Evidence:**

- [`webview-ui/src/components/settings/ApiOptions.tsx`](webview-ui/src/components/settings/ApiOptions.tsx:1): **850 lines.**
    - 27 consecutive `{selectedProvider === "x" && <X …/>}` blocks ([`ApiOptions.tsx:482`](webview-ui/src/components/settings/ApiOptions.tsx:482)–L698): `openrouter`, `requesty`, `unbound`, `anthropic`, `openai-codex`, `openai-native`, `mistral`, `baseten`, `bedrock`, `vertex`, `gemini`, `openai`, `lmstudio`, `deepseek`, `qwen-code`, `moonshot`, `minimax`, `vscode-lm`, `ollama`, `xai`, `litellm`, `sambanova`, `zai`, `vercel-ai-gateway`, `fireworks`, `poe`, plus a generic `ModelPicker` block (L700–720) for static-model providers.
    - Each block passes a slightly different prop subset from the shared pool: `apiConfiguration`, `setApiConfigurationField`, `routerModels`, `refetchRouterModels`, `organizationAllowList`, `modelValidationError`, `simplifySettings` (= `fromWelcomeView`), `selectedModelInfo`, `uriScheme`, `openAiCodexIsAuthenticated`. The prop-differencing is hand-maintained — some providers get `simplifySettings`, some don't, with no schema.

**Why it hurts:** Adding a provider = add one `{selectedProvider === "new" && <NewProvider …/>}` block here + one export in [`providers/index.ts`](webview-ui/src/components/settings/providers/index.ts:1). The 27 blocks are ~220 lines of near-duplicated prop-passing. Reviewers can't eyeball which providers get which props.

**Proposed approach (provider registry map):**

```ts
type ProviderRegistryEntry = {
  component: React.FC<ProviderComponentProps>
  needsRouterModels?: boolean
  needsRefetchRouterModels?: boolean
  needsOrgAllowList?: boolean
  needsModelValidationError?: boolean
  needsSelectedModelInfo?: boolean
  needsUriScheme?: boolean
  needsOpenAiCodexAuth?: boolean
}
const PROVIDER_REGISTRY: Partial<Record<ProviderName, ProviderRegistryEntry>> = {
  openrouter: { component: OpenRouter, needsRouterModels: true, needsOrgAllowList: true, … },
  anthropic: { component: Anthropic }, // minimal
  // …
}
```

Render becomes: `const entry = PROVIDER_REGISTRY[selectedProvider]; entry && <entry.component {...pickProps(sharedProps, entry)} />`.

**Effort:** S · **Risk:** low (mechanical; the existing [`ApiOptions.spec.tsx`](webview-ui/src/components/settings/__tests__/ApiOptions.spec.tsx:1) and per-provider specs cover dispatch). **Dependencies:** Theme F (shared `ProviderComponentProps`) makes this cleaner but is not required.

**Human-verifiable acceptance:** `cd webview-ui && npx vitest run src/components/settings/__tests__/ApiOptions` green; `grep -c 'selectedProvider ===' src/components/settings/ApiOptions.tsx` → 0 (replaced by registry lookup); `wc -l src/components/settings/ApiOptions.tsx` drops by ~200; adding a provider = one registry entry.

---

### Theme F — 22 duplicated `handleInputChange` hooks across provider components

**Evidence:**

- 22 files in [`webview-ui/src/components/settings/providers/`](webview-ui/src/components/settings/providers/) each declare an identical `handleInputChange = useCallback`:
    ```ts
    const handleInputChange = useCallback(
    	<K extends keyof ProviderSettings, E>(
    		field: K,
    		transform: (event: E) => ProviderSettings[K] = inputEventTransform,
    	) =>
    		(event: E | Event) => {
    			setApiConfigurationField(field, transform(event as E))
    		},
    	[setApiConfigurationField],
    )
    ```
    Verified present in: `Anthropic.tsx:32`, `Gemini.tsx:24`, `OpenAI.tsx:27`, `ZAi.tsx:20`, `LiteLLM.tsx:70`, `SambaNova.tsx:19`, `MiniMax.tsx:20`, `LMStudio.tsx:28`, `Mistral.tsx:21`, `Ollama.tsx:25`, `OpenRouter.tsx:45`, `Poe.tsx:75`, `Fireworks.tsx:19`, `Requesty.tsx:50`, `Vertex.tsx:28`, `Moonshot.tsx:21`, `Unbound.tsx:38`, `OpenAICompatible.tsx:101`, `Baseten.tsx:20`, `DeepSeek.tsx:20`, `XAI.tsx:19`, `VercelAiGateway.tsx:36`, `Bedrock.tsx:49`. (23 total — some like `OpenAICodex`, `QwenCode`, `VSCodeLM` use `ModelPicker` instead and don't declare it.)
- Each also declares the same 2-line prop type: `apiConfiguration: ProviderSettings; setApiConfigurationField: (field, value) => void`.
- [`webview-ui/src/components/settings/transforms.ts`](webview-ui/src/components/settings/transforms.ts:1) already exists with `inputEventTransform`/`noTransform` — the hook was never extracted to match.

**Why it hurts:** ~250 lines of pure duplication. A change to the hook signature (e.g., adding a third transform arg) requires editing 23 files.

**Proposed approach:** Extract `useProviderFieldHandlers(apiConfiguration, setApiConfigurationField)` into `settings/utils/useProviderFieldHandlers.ts` returning `{ handleInputChange }` (and optionally `handleCheckboxChange`, `handleSelectChange` if patterns emerge). Export a shared `ProviderComponentProps` type. Each provider file drops ~10 lines and imports the hook.

**Effort:** S · **Risk:** low (behavior identical; the per-provider specs mock `setApiConfigurationField` and assert calls, so they survive the rename). **Dependencies:** none.

**Human-verifiable acceptance:** `grep -c "handleInputChange = useCallback" src/components/settings/providers/` → 0; `cd webview-ui && npx vitest run src/components/settings/providers` green; each provider file shrinks by ~8 lines.

---

### Theme G — `MermaidButton` + `ImageViewer` near-duplicate zoom/pan/modal logic

**Evidence:**

- [`webview-ui/src/components/common/MermaidButton.tsx`](webview-ui/src/components/common/MermaidButton.tsx:1): **247 lines.**
- [`webview-ui/src/components/common/ImageViewer.tsx`](webview-ui/src/components/common/ImageViewer.tsx:1): **316 lines.**
- Both share **identical** structure:
    - Same imports ([`MermaidButton.tsx:1`](webview-ui/src/components/common/MermaidButton.tsx:1)–L10 vs [`ImageViewer.tsx:1`](webview-ui/src/components/common/ImageViewer.tsx:1)–L10): `useCopyToClipboard`, `MermaidActionButtons`, `Modal`, `TabButton`, `IconButton`, `ZoomControls`, `StandardTooltip`.
    - Same constants `MIN_ZOOM = 0.5`, `MAX_ZOOM = 20` (L12–13 in both).
    - Same state: `showModal`, `zoomLevel`, `copyFeedback`, `isHovering`, `isDragging`, `dragPosition`.
    - Same `handleZoom`/`handleCopy`/`handleSave`/`adjustZoom`/`handleWheel`/`handleMouseEnter`/`handleMouseLeave` callbacks (modulo the copy/save payload).
    - Same modal JSX: the zoom/pan `div` with `transform: scale(...) translate(...)`, `onMouseDown`/`onMouseMove`/`onMouseUp`/`onMouseLeave` drag handlers (MermaidButton L174–198 vs ImageViewer L258–278 — character-for-character identical drag logic).
    - Same `ZoomControls` footer block (MermaidButton L215–223 vs ImageViewer L294–302 — identical props).

**Why it hurts:** A fix to the zoom-clamp bounds or the drag math must be applied twice. The two files have already drifted slightly (ImageViewer has an `imageError` state and `formatDisplayPath` helper that MermaidButton lacks; MermaidButton has a `modalViewMode` diagram/code tab that ImageViewer doesn't), but the shared core is ~180 lines duplicated.

**Proposed approach (extract `useZoomableModal` hook + shared `ZoomableModalContent` component):**

1. Extract a `useZoomPanModal()` hook returning `{ showModal, zoomLevel, dragPosition, isDragging, isHovering, copyFeedback, handleZoom, adjustZoom, handleWheel, handleDragStart, handleDragMove, handleDragEnd, handleMouseEnter, handleMouseLeave, setCopyFeedback, setShowModal, resetZoom }`. This owns the zoom/pan/drag/hover state machine.
2. Extract a `ZoomableModalContent` component that renders the modal shell (header with close button, zoom/pan body with the transform div + drag handlers, footer with `ZoomControls` + action buttons). It accepts `children` (the diagram/image content), `title`, `actionButtons`.
3. `MermaidButton` and `ImageViewer` each become ~80-line wrappers that supply their content + action handlers.

**Effort:** M · **Risk:** low (behavior identical; [`ImageViewer.spec.tsx`](webview-ui/src/components/common/__tests__/ImageViewer.spec.tsx:1) and the MermaidBlock tests guard the UX). **Dependencies:** none.

**Human-verifiable acceptance:** `wc -l src/components/common/MermaidButton.tsx` < 100; `wc -l src/components/common/ImageViewer.tsx` < 130; the new hook file < 120 lines; `cd webview-ui && npx vitest run src/components/common` green.

---

### Theme H — `styled-components` used in 4 files, violating the Tailwind-first rule

**Evidence:**

- [`webview-ui/src/components/common/CodeBlock.tsx`](webview-ui/src/components/common/CodeBlock.tsx:1): `CodeBlockButton`, `CodeBlockButtonWrapper`, `CodeBlockContainer`, `StyledPre` (L42, L70, L98, L116).
- [`webview-ui/src/components/common/MarkdownBlock.tsx`](webview-ui/src/components/common/MarkdownBlock.tsx:1): `StyledMarkdown` (L37, used L398–422).
- [`webview-ui/src/components/common/MermaidBlock.tsx`](webview-ui/src/components/common/MermaidBlock.tsx:1): `MermaidBlockContainer`, `LoadingMessage`, `CopyButton`, `SvgContainer` (L283, L288, L295, L316).
- [`webview-ui/src/components/settings/styles.ts`](webview-ui/src/components/settings/styles.ts:1): `StyledMarkdown` (L4, used by [`ModelDescriptionMarkdown.tsx:39`](webview-ui/src/components/settings/ModelDescriptionMarkdown.tsx:39)).
- [`webview-ui/src/components/common/TabButton.tsx:22`](webview-ui/src/components/common/TabButton.tsx:22): inline `style={{ color: "var(--vscode-focusBorder)" }}` — the single inline-style violation flagged in the prior plan, still present.

**Why it hurts:** Inconsistent with [`.roo/rules/`](.roo/rules/) (Tailwind classes over inline styles; VSCode CSS vars must be registered in [`webview-ui/src/index.css`](webview-ui/src/index.css:1) before use in Tailwind). `styled-components` adds a runtime cost and a second styling paradigm alongside Tailwind. The `--vscode-focusBorder` variable is referenced inline because it isn't registered as a Tailwind theme color.

**Proposed approach:** Convert the 4 `styled-components` usages to Tailwind classes (registering any missing VSCode CSS vars in `index.css` first). Replace `TabButton` inline style with `text-vscode-focusBorder` after adding `--vscode-focusBorder` to the Tailwind theme. This is compliance polish, not a leverage point — do it last.

**Effort:** S · **Risk:** low (visual regression only; snapshot tests if they exist, else manual eyeball). **Dependencies:** none.

**Human-verifiable acceptance:** `grep -rn "styled\." src/components/` → 0; `grep -rn 'style={' src/components/common/TabButton.tsx` → 0; `cd webview-ui && npx vitest run` green.

---

### Theme I — `ModesView.tsx` 1801-line modes editor

**Evidence:**

- [`webview-ui/src/components/modes/ModesView.tsx`](webview-ui/src/components/modes/ModesView.tsx:1): **1801 lines.** One component owns: mode CRUD (create/edit/delete/import/export), per-mode prompt editing (system prompt get/copy), per-mode MCP server restrictions, per-mode API config assignment, custom-instructions editing, rules-directory checking. ~17 `vscode.postMessage` call sites (L145, L157, L176, L293, L591, L634, L647, L874, L897, L922, L1329, L1362, L1378, L1413, L1430, L1765, L1786). Partial extractions exist: [`McpServerChecklist.tsx`](webview-ui/src/components/modes/McpServerChecklist.tsx:1), [`McpServerRestriction.tsx`](webview-ui/src/components/modes/McpServerRestriction.tsx:1).

**Why it hurts:** Same god-component pattern as ChatView/ChatRow. Adding a mode feature means editing a 1801-line file.

**Proposed approach:** Split into `ModesListView` (CRUD + list + search) and `ModeEditorPanel` (single-mode editing: prompt, instructions, API config, MCP restrictions). Extract `useModeCrud()` and `useModePromptEditor()` hooks. Target: < 600 lines for the shell.

**Effort:** L · **Risk:** med (the import/export + rename UX is stateful; [`ModesView.spec.tsx`](webview-ui/src/components/modes/__tests__/ModesView.spec.tsx:1) and [`ModesView.import-switch.spec.tsx`](webview-ui/src/components/modes/__tests__/ModesView.import-switch.spec.tsx:1) guard it). **Dependencies:** none. Lower priority than Themes A–G (less frequently changed than ChatView/ChatRow).

**Human-verifiable acceptance:** `cd webview-ui && npx vitest run src/components/modes` green; `wc -l src/components/modes/ModesView.tsx` < 700; extracted hooks < 250 lines each.

---

## 3. Dead / unused code inventory

> **Systematic tool:** [`knip.json`](knip.json:31) is configured for the `webview-ui` workspace (`"entry": ["src/index.tsx"]`, `"project": ["src/**/*.{ts,tsx}", "../src/shared/*.ts"]`). Run `npx knip --workspace webview-ui` as the authoritative dead-code scanner. The table below lists only suspects I grep-verified by hand and that warrant a human eyeball — most are **alive** (listed for completeness so the human doesn't re-investigate).

| File                                                                                                                               | Symbol                                             | Kind             | Evidence of (no) usage                                                                                                                                                                                                                                                               | Recommendation                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`webview-ui/src/components/common/ImageViewer.tsx`](webview-ui/src/components/common/ImageViewer.tsx:1)                           | `ImageViewer`                                      | component        | Grep across `webview-ui/src` found the definition + [`ImageViewer.spec.tsx`](webview-ui/src/components/common/__tests__/ImageViewer.spec.tsx:1) only. **No production import found.** `MermaidButton` and `MermaidBlock` handle mermaid images; chat images go through `ImageBlock`. | **needs-human-verify** — may be consumed via dynamic import or in `apps/` outside this scan. Run `npx knip` to confirm. If truly unused, remove component + spec. |
| [`webview-ui/src/components/ui/hooks/useNonInteractiveClick.ts`](webview-ui/src/components/ui/hooks/useNonInteractiveClick.tsx:1)  | `useNonInteractiveClick` (filename implies export) | hook             | The file exports `useAddNonInteractiveClickListener` (used in [`App.tsx:23`](webview-ui/src/App.tsx:23)), **not** `useNonInteractiveClick`. The filename is misleading but no dead export exists.                                                                                    | **keep** — rename file to match export for readability (cosmetic).                                                                                                |
| [`webview-ui/src/components/common/MermaidButton.tsx`](webview-ui/src/components/common/MermaidButton.tsx:1)                       | `MermaidButton`                                    | component        | Used in [`MermaidBlock.tsx:218`](webview-ui/src/components/common/MermaidBlock.tsx:218).                                                                                                                                                                                             | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/common/DismissibleUpsell.tsx`](webview-ui/src/components/common/DismissibleUpsell.tsx:1)               | `DismissibleUpsell`                                | component        | Used in [`ChatView.tsx:50`](webview-ui/src/components/chat/ChatView.tsx:50), [`TaskHeader.tsx:5`](webview-ui/src/components/chat/TaskHeader.tsx:5).                                                                                                                                  | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/common/VersionIndicator.tsx`](webview-ui/src/components/common/VersionIndicator.tsx:1)                 | `VersionIndicator`                                 | component        | Used in [`ChatView.tsx:36`](webview-ui/src/components/chat/ChatView.tsx:36).                                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/common/FormattedTextField.tsx`](webview-ui/src/components/common/FormattedTextField.tsx:1)             | `FormattedTextField`                               | component        | Used in [`MaxCostInput.tsx:3`](webview-ui/src/components/settings/MaxCostInput.tsx:3), [`MaxRequestsInput.tsx:3`](webview-ui/src/components/settings/MaxRequestsInput.tsx:3).                                                                                                        | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/common/DecoratedVSCodeTextField.tsx`](webview-ui/src/components/common/DecoratedVSCodeTextField.tsx:1) | `DecoratedVSCodeTextField`                         | component        | Used by `FormattedTextField` (L2).                                                                                                                                                                                                                                                   | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/parseUnifiedDiff.ts`](webview-ui/src/utils/parseUnifiedDiff.ts:1)                                           | `parseUnifiedDiff`                                 | util             | Used in [`DiffView.tsx:2`](webview-ui/src/components/common/DiffView.tsx:2).                                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/formatPrice.ts`](webview-ui/src/utils/formatPrice.ts:1)                                                     | `formatPrice`                                      | util             | Used in [`ModelInfoView.tsx:5`](webview-ui/src/components/settings/ModelInfoView.tsx:5).                                                                                                                                                                                             | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/getLanguageFromPath.ts`](webview-ui/src/utils/getLanguageFromPath.ts:1)                                     | `getLanguageFromPath`                              | util             | Used in [`DiffView.tsx:4`](webview-ui/src/components/common/DiffView.tsx:4), [`CodeAccordion.tsx:4`](webview-ui/src/components/common/CodeAccordion.tsx:4).                                                                                                                          | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/batchConsecutive.ts`](webview-ui/src/utils/batchConsecutive.ts:1)                                           | `batchConsecutive`                                 | util             | Used in [`ChatView.tsx:12`](webview-ui/src/components/chat/ChatView.tsx:12).                                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/command-parser.ts`](webview-ui/src/utils/command-parser.ts:1)                                               | `extractPatternsFromCommand`                       | util             | Used in [`CommandExecution.tsx:13`](webview-ui/src/components/chat/CommandExecution.tsx:13).                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/context-mentions.ts`](webview-ui/src/utils/context-mentions.ts:1)                                           | `getContextMenuOptions`, etc.                      | util             | Used in [`ContextMenu.tsx:14`](webview-ui/src/components/chat/ContextMenu.tsx:14), [`ChatTextArea.tsx:19`](webview-ui/src/components/chat/ChatTextArea.tsx:19).                                                                                                                      | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/utils/path-mentions.ts`](webview-ui/src/utils/path-mentions.ts:1)                                                 | `escapeSpaces`, `convertToMentionPath`             | util             | Used in [`context-mentions.ts:7`](webview-ui/src/utils/context-mentions.ts:7), [`ChatTextArea.tsx:21`](webview-ui/src/components/chat/ChatTextArea.tsx:21).                                                                                                                          | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/settings/styles.ts`](webview-ui/src/components/settings/styles.ts:1)                                   | `StyledMarkdown`                                   | styled-component | Used in [`ModelDescriptionMarkdown.tsx:8`](webview-ui/src/components/settings/ModelDescriptionMarkdown.tsx:8).                                                                                                                                                                       | **keep** (alive) but convert to Tailwind (Theme H).                                                                                                               |
| [`webview-ui/src/components/common/TelemetryBanner.tsx`](webview-ui/src/components/common/TelemetryBanner.tsx:1)                   | `TelemetryBanner`                                  | component        | Used in [`ChatView.tsx:35`](webview-ui/src/components/chat/ChatView.tsx:35).                                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/chat/planReviewMessage.ts`](webview-ui/src/components/chat/planReviewMessage.ts:1)                     | `compilePlanReviewMessage`, `PlanAnnotation`       | util/type        | Used in [`PlanReviewOverlay.tsx:8`](webview-ui/src/components/chat/PlanReviewOverlay.tsx:8).                                                                                                                                                                                         | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/settings/ApiErrorMessage.tsx`](webview-ui/src/components/settings/ApiErrorMessage.tsx:1)               | `ApiErrorMessage`                                  | component        | Used in [`ApiOptions.tsx:101`](webview-ui/src/components/settings/ApiOptions.tsx:101), [`ModelPicker.tsx:27`](webview-ui/src/components/settings/ModelPicker.tsx:27).                                                                                                                | **keep** (alive).                                                                                                                                                 |
| [`webview-ui/src/components/marketplace/useStateManager.ts`](webview-ui/src/components/marketplace/useStateManager.ts:1)           | `useStateManager`                                  | hook             | Used in [`MarketplaceView.tsx:6`](webview-ui/src/components/marketplace/MarketplaceView.tsx:6), [`MarketplaceListView.tsx:11`](webview-ui/src/components/marketplace/MarketplaceListView.tsx:11).                                                                                    | **keep** (alive) — good adapter-hook pattern.                                                                                                                     |
| [`webview-ui/src/components/settings/ModelInfoView.tsx`](webview-ui/src/components/settings/ModelInfoView.tsx:1)                   | `ModelInfoView`                                    | component        | Used in [`ModelPicker.tsx:26`](webview-ui/src/components/settings/ModelPicker.tsx:26).                                                                                                                                                                                               | **keep** (alive).                                                                                                                                                 |

**Honest summary:** I grep-verified ~20 suspect exports and found **only `ImageViewer` as a candidate for removal** (no production import found within `webview-ui/src` — flagged needs-human-verify because it may be dynamically imported or consumed in `apps/`). The repo runs knip with `ignoreExportsUsedInFile: true` ([`knip.json:5`](knip.json:5)), so the authoritative answer is `npx knip --workspace webview-ui`. **Recommendation: add `npx knip --workspace webview-ui` as a CI gate** rather than relying on hand-grep — the frontend has enough exports that manual verification does not scale.

---

## 4. Design pattern / hook-extraction opportunities

### 4.1 Registry pattern — `ApiOptions` provider dispatch (Theme E)

**Before** ([`ApiOptions.tsx:482`](webview-ui/src/components/settings/ApiOptions.tsx:482)):

```tsx
{selectedProvider === "openrouter" && <OpenRouter apiConfiguration={…} setApiConfigurationField={…} routerModels={…} … />}
{selectedProvider === "requesty" && <Requesty … />}
// … 25 more blocks …
```

**After:**

```tsx
const entry = PROVIDER_REGISTRY[selectedProvider]
return entry ? <entry.component {...buildProviderProps(entry, sharedProps)} /> : null
```

Where `PROVIDER_REGISTRY: Partial<Record<ProviderName, ProviderRegistryEntry>>` and `buildProviderProps` picks only the props the entry declares (`needsRouterModels`, etc.). Adding a provider = one registry row.

### 4.2 Registry pattern — `ChatRow` per-message-type renderer (Theme B)

**Before** ([`ChatRow.tsx:1030`](webview-ui/src/components/chat/ChatRow.tsx:1030)):

```tsx
switch (message.type) {
  case "say": switch (message.say) {
    case "reasoning": return <ReasoningBlock …/>
    case "text": return (<MarkdownBlock>…</MarkdownBlock>)
    // … 18 more cases, some 80+ lines
  }
  case "ask": switch (message.ask) { … }
}
```

**After:**

```tsx
const renderer = message.type === "say" ? SAY_RENDERERS[message.say] : ASK_RENDERERS[message.ask]
return renderer ? renderer({ message, isLast, isExpanded, … }) : null
```

Where `SAY_RENDERERS: Partial<Record<ClineSay, RowRenderer>>` lives in a `chat/renderers/` directory, one file per non-trivial case. The trivial cases (`reasoning`, `checkpoint_saved`) stay as one-liner entries; the complex `tool` case becomes `AskToolRow.tsx` with its own batch-diff/batch-file/batch-list sub-renderers.

### 4.3 Custom hook extraction — `useProviderFieldHandlers` (Theme F)

**Before** (in 23 provider files):

```tsx
const handleInputChange = useCallback(
	<K extends keyof ProviderSettings, E>(field: K, transform = inputEventTransform) =>
		(event: E | Event) => {
			setApiConfigurationField(field, transform(event as E))
		},
	[setApiConfigurationField],
)
```

**After** (in `settings/utils/useProviderFieldHandlers.ts`):

```tsx
export function useProviderFieldHandlers(setApiConfigurationField: SetApiConfigurationField) {
  const handleInputChange = useCallback(/* same body */, [setApiConfigurationField])
  return { handleInputChange }
}
```

Each provider: `const { handleInputChange } = useProviderFieldHandlers(setApiConfigurationField)`.

### 4.4 Custom hook extraction — `useZoomPanModal` (Theme G)

**Before** (in `MermaidButton` + `ImageViewer`, ~80 lines each):

```tsx
const [showModal, setShowModal] = useState(false)
const [zoomLevel, setZoomLevel] = useState(1)
const [isDragging, setIsDragging] = useState(false)
const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 })
// … + handleZoom, adjustZoom, handleWheel, drag handlers
```

**After:**

```tsx
const modal = useZoomPanModal()
return <ZoomableModalContent {...modal} title={…} actionButtons={…}>{diagramOrImage}</ZoomableModalContent>
```

### 4.5 Reducer + typed hydration — `ExtensionStateContext` (Theme A)

**Before** ([`ExtensionStateContext.tsx:515`](webview-ui/src/context/ExtensionStateContext.tsx:515)):

```tsx
const contextValue: ExtensionStateContextType = {
	...state,
	setAlwaysAllowReadOnly: (value) => setState((p) => ({ ...p, alwaysAllowReadOnly: value })),
	setAlwaysAllowWrite: (value) => setState((p) => ({ ...p, alwaysAllowWrite: value })),
	// … ~70 inline closures
}
```

**After:**

```tsx
const [state, dispatch] = useReducer(extensionStateReducer, initialExtensionState)
const contextValue = useMemo(() => ({ state, dispatch }), [state])
// Consumers: const { state, dispatch } = useExtensionState()
// dispatch({ type: "SET_FIELD", key: "alwaysAllowReadOnly", value })
```

The ~70 setters collapse into one `SET_FIELD` action (or a small set of typed actions for the composite updates like `UPSERT_TASK_HISTORY_ITEM`).

### 4.6 Declarative schema — `SettingsView` field metadata (Theme D)

**Before** ([`SettingsView.tsx:376`](webview-ui/src/components/settings/SettingsView.tsx:376)):

```tsx
vscode.postMessage({
	type: "updateSettings",
	updatedSettings: {
		language,
		alwaysAllowReadOnly: alwaysAllowReadOnly ?? undefined /* …70 hand-mirrored fields… */,
	},
})
```

**After:**

```tsx
const onSaveFields = SETTINGS_SCHEMA.filter((f) => f.applyMode === "onSave")
vscode.postMessage({ type: "updateSettings", updatedSettings: serializeSettings(cachedState, onSaveFields) })
```

Where `SETTINGS_SCHEMA: SettingField[]` carries `{ key, default, serialize?, applyMode }`. Adding a setting = one schema row.

### 4.7 Adapter hook — `useStateManager` (existing, good pattern — keep as reference)

[`webview-ui/src/components/marketplace/useStateManager.ts`](webview-ui/src/components/marketplace/useStateManager.ts:1) adapts the class-based [`MarketplaceViewStateManager`](webview-ui/src/components/marketplace/MarketplaceViewStateManager.ts:1) (487-line finite-state machine with typed transitions) to React via `useState` + `useEffect` subscription. This is a **good** pattern for the marketplace's complex filter/fetch/tab state — it keeps the state machine testable in isolation ([`MarketplaceViewStateManager.spec.ts`](webview-ui/src/components/marketplace/__tests__/MarketplaceViewStateManager.spec.ts:1)) and the React binding thin (51 lines). **No change recommended** — noted as a positive example for any future complex-view state.

---

## 5. Prioritized roadmap

Ordered by dependency + leverage. Each step is independently shippable.

| #   | Step                                                                              | Scope                                                         | Depends on                        | Effort | Risk | Human-verifiable acceptance                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Run `npx knip --workspace webview-ui` and triage**                              | Dead-code baseline                                            | —                                 | S      | low  | knip output reviewed; confirmed-dead exports removed; `ImageViewer` resolved (remove or link to its consumer).                                                                                                                                          |
| 2   | **Extract `useProviderFieldHandlers` hook** (Theme F)                             | 23 provider files                                             | —                                 | S      | low  | `grep -c "handleInputChange = useCallback" src/components/settings/providers/` → 0; provider specs green.                                                                                                                                               |
| 3   | **`PROVIDER_REGISTRY` in `ApiOptions`** (Theme E)                                 | `ApiOptions.tsx`                                              | #2 (cleaner)                      | S      | low  | `grep -c 'selectedProvider ===' src/components/settings/ApiOptions.tsx` → 0; `ApiOptions.spec.tsx` green; file < 650 lines.                                                                                                                             |
| 4   | **Extract `useZoomPanModal` + `ZoomableModalContent`** (Theme G)                  | `MermaidButton`, `ImageViewer`                                | —                                 | M      | low  | `MermaidButton` < 100 lines; `ImageViewer` < 130 lines; common specs green.                                                                                                                                                                             |
| 5   | **`ExtensionStateContext` reducer + typed hydration** (Theme A)                   | `ExtensionStateContext.tsx`, `packages/types`                 | —                                 | L      | med  | `grep -c "as any" src/context/ExtensionStateContext.tsx` → 0; `contextValue` is `{ state, dispatch }`; context specs green.                                                                                                                             |
| 6   | **Declarative settings schema + fix AGENTS.md dual-bind** (Theme D)               | `SettingsView.tsx`, `AutoApproveSettings.tsx`, schema file    | #5 (cleaner)                      | M      | med  | `handleSubmit` uses `serializeSettings`; `AutoApproveSettings` has no direct `vscode.postMessage` except via schema helper; `grep -rn "useExtensionState" src/components/settings/` shows only `SettingsView` + documented reads; settings specs green. |
| 7   | **`ChatRow` per-message-type registry** (Theme B)                                 | `ChatRow.tsx` → `chat/renderers/*`                            | —                                 | L      | med  | `grep -c "case " src/components/chat/ChatRow.tsx` ≤ 5; file < 400 lines; chat specs green.                                                                                                                                                              |
| 8   | **`ChatView` concern-hook extraction** (Theme C)                                  | `ChatView.tsx` → `chat/hooks/*`                               | #5 (reducer), #7 (ChatRow shrink) | L      | high | One hook per PR; each `ChatView.*.spec.tsx` green after its hook; file < 700 lines.                                                                                                                                                                     |
| 9   | **`ModesView` split** (Theme I)                                                   | `ModesView.tsx` → `ModesListView` + `ModeEditorPanel` + hooks | —                                 | L      | med  | file < 700 lines; modes specs green.                                                                                                                                                                                                                    |
| 10  | **`styled-components` → Tailwind migration + `TabButton` inline style** (Theme H) | 4 files + `index.css`                                         | —                                 | S      | low  | `grep -rn "styled\." src/components/` → 0; `TabButton` uses `text-vscode-focusBorder`; `--vscode-focusBorder` registered in `index.css`.                                                                                                                |

**Suggested batching:** #1–4 are quick wins (S–M, low risk) — do first as a "cleanup pass." #5 is the foundation — do next. #6 depends on #5. #7–9 are the big extractions — do sequentially after #5, each with its own test guardrails. #10 is polish — last.

---

## 6. Explicit non-goals

This plan deliberately does **NOT** touch:

- **[`src/`](src/) (extension host)** — covered by [`ai_plans/2026-07-14_src-refactor-plan.md`](ai_plans/2026-07-14_src-refactor-plan.md). The host-side `webviewMessageHandler` 143-case switch and `ClineProvider` god-class are out of scope here. The only `src/` reads in this analysis were to confirm that frontend message types are produced/consumed by the host (e.g., the `state` message carries the fields that `(newState as any)` casts reveal).
- **[`packages/`](packages/), [`apps/`](apps/), [`self-hosted-cloudapi/`](self-hosted-cloudapi/)** — out of scope. Note: `packages/types` may need a one-line addition to promote the 5 "extra" `useState` fields into `ExtensionState` (Theme A step 2) — that is a type-only change, not a refactor of `packages/` logic.
- **i18n locale JSON completeness** — the 10-language locale files under [`webview-ui/src/i18n/locales/`](webview-ui/src/i18n/locales/) are the [`roo-translation`](.roo/skills/roo-translation/SKILL.md) skill's domain. The _wiring_ ([`i18n/setup.ts`](webview-ui/src/i18n/setup.ts:1), [`TranslationContext.tsx`](webview-ui/src/i18n/TranslationContext.tsx:1)) is clean (auto-glob namespaces, no duplication). The stringly-typed `t(key: string)` (Theme non-goal: typed i18n keys) is a known quality item but **lowest priority** — it's an ergonomics issue, not a maintainability blocker, and the prior plan already noted it. Not included in the roadmap.
- **The `MarketplaceViewStateManager` class-based state machine** — this is a _good_ pattern (testable in isolation, thin React adapter). No refactor recommended. Noted in §4.7 as a positive example.
- **Visual / UX changes** — every refactor is behavior-preserving. No layout, styling, or interaction changes are in scope (except the `styled-components` → Tailwind _conversion_, which must be pixel-identical).
- **Performance optimization for its own sake** — the reducer (Theme A) and registry (Themes B/E) will reduce re-renders and bundle-parse cost as side effects, but the goal is _human readability_, not perf. No memoization micro-tuning is planned.
- **Adding new tests** — the existing per-behavior spec coverage is treated as the guardrail. If a refactor exposes a test gap, add the minimal regression test at the lowest layer per [`AGENTS.md`](AGENTS.md) test-placement guidance — but test-authoring is not a planned deliverable.

---

_End of plan. Deliverable written to [`ai_plans/2026-07-14_webview-ui-refactor-plan.md`](ai_plans/2026-07-14_webview-ui-refactor-plan.md)._
