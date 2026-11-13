# P1: ExtensionStateContext selector hook (roadmap step ③)

Simplification roadmap item **P1** ("Priority 3: performance", verified):

> Every streamed token re-renders every context consumer. `ExtensionStateContext`
> builds a new value object each render; 37 components call `useExtensionState()`,
> including the 1,331-line `ChatTextArea` and `TaskHeader`, which scans all
> messages each render. Fix: `useExtensionSelector(selector)` over
> `useSyncExternalStore`, or split a `ChatMessagesContext`; stable action
> identities. Effort: M.

## Problem verified on main (02148dfd4)

- [`webview-ui/src/context/ExtensionStateContext.tsx:175-231`](../webview-ui/src/context/ExtensionStateContext.tsx):
  `contextValue` is rebuilt on **every** provider render — a plain object literal
  with ~25 inline arrow functions (`setCustomInstructions`, `setMode`,
  `togglePinnedApiConfig`, …) created fresh each time. Even when the reducer
  returns `prev` unchanged, any state change rebuilds the whole object; every
  consumer re-renders because the context value identity changed.
- `useExtensionState()` call sites: **45 non-test** consumers (50 matches incl.
  5 in specs) — consistent with the roadmap's "37 components" (the count grew
  since the roadmap was written).
- Hot path per streamed token (`messageUpdated` → new `clineMessages` array →
  provider re-render → new context value):
    - `App` (App.tsx:70) — renders the entire tab tree.
    - `TranslationProvider` (TranslationContext.tsx:58) — subscribes to the whole
      state for `language` + `didHydrateState`, re-renders the whole app below it.
    - `ChatView` (needs messages — re-renders by design), but also pulls ~18 more
      slices, several of which are defaults that are never undefined in practice
      (`soundEnabled`, `autoApprovalEnabled` …) — some of them churn identity per
      token via `??` fallbacks.
    - `ChatTextArea` (1,332 lines) — subscribes to the whole context for 14
      slices, several objects/arrays; re-renders on every token even though none of
      its slices change during streaming.
    - `TaskHeader` — already `memo`'d, but re-renders per token anyway: it reads
      `clineMessages` from the context to compute `isTaskComplete` (scans all
      messages, TaskHeader.tsx:71-82), and its `todos` prop is a fresh `[]` per
      token (`selectLatestTodos`), and `handleCondenseContext` from
      `useChatHostMessages` is not stable.
    - 6 row renderers (`CommandExecution`, `ErrorRow` (nested), `ReasoningBlock`,
      `TaskToolRows`, `AskRows`, `StatusRows/CheckpointSavedRow`, `MessageRows`,
      `UserFeedbackRow`) — legacy hook, re-render every token through ChatView's
      re-render + context change.

## Design decision

**Option 1 (selector hook) over option 2 (split context)** — smallest correct
thing, fully backwards-compatible:

1. **Versioned external store.** `ExtensionStateContextProvider` keeps the pure
   reducer but moves the store into a `useRef` + version counter and notifies a
   module-level subscription list on every commit (outside React). The provider
   component itself **stops re-rendering** on host messages: it renders once,
   and the context it provides is a stable actions+store object that never
   changes identity.
2. **`useExtensionSelector<T>(selector, isEqual?)`** built on
   `useSyncExternalStore`. `getSnapshot` returns a version number; the selected
   value is cached per (selector-instance, version) and only updates when the
   selector's own equality (`Object.is` default, optional `isEqual` override)
   says it changed. Components that select stable slices no longer re-render on
   token updates.
3. **`useExtensionState()` stays, backwards-compatible.** It becomes
   `useExtensionSelector((ctx) => ctx)` — the full value — but the value object
   is now **memoized per version** by the provider-side cache builder, so legacy
   consumers get the same object across re-renders (a token update produces a
   new value object once per commit, exactly as before; commits that don't
   change the store return the same object). The 40 unmigrated consumers keep
   working unchanged; they still re-render per token (unchanged behavior), but
   their re-renders no longer rebuild 25 closures and they stop being the
   identity-churn source for memoized children.

    The value-object builder (equivalent of today's lines 175-231) is a pure
    function `buildContextValue(store)`: same defaults (`??`/`?? false`), same
    action functions — but actions are **created once** per provider instance via
    `useRef` (they close over a ref to the latest store setter, not the store).
    So action identities are stable for the component's lifetime.

4. **Migration of the hot consumers** (the actual win):
    - `App`: select only its 14 slices.
    - `TranslationProvider`: select `language`, `didHydrateState`.
    - `ChatView`: select its slices in a few grouped selectors (messages-related,
      settings-related, actions).
    - `ChatTextArea`: select its 14 slices via grouped selectors; wrap the
      component in `memo` so its stable slices stop re-rendering it when the
      parent re-renders.
    - `TaskHeader`: select `apiConfiguration`, `currentTaskItem`, and a derived
      `isTaskComplete` selector (the "scans all messages" work now runs in the
      selector, cached per version — once per commit instead of per render);
      ChatView passes `todos` only when it changes (memoized derived selector on
      ChatView's side) and a stable `handleCondenseContext` (wrap in
      `useCallback` in `useChatHostMessages`).
    - Row renderers + `useAutoApprovalToggles`, `useCloudUpsell`, `useTooManyTools`,
      `Tab`, `StorageErrorBanner`, `IndexingStatusBadge`, `ShareButton`,
      `FollowUpSuggest`, `AutoApproveDropdown`, `ModeSelector`,
      `TaskActions`/`ErrorRow`(inner), `ApiConfigSelector` — narrow selectors.

### Why not split ChatMessagesContext (option 2)

The selector design achieves the same isolation (settings-only consumers stop
re-rendering per token) without touching 45 call sites or introducing a second
provider in `App.tsx`/`PlanReviewApp.tsx`. The roadmap explicitly allows either.

### Constraints honored

- **Behaviour unchanged** — a pure performance refactor. All existing specs must
  pass unmodified except where they mock the context module shape
  (`useExtensionState` remains exported from the same module).
- **Height contract / scroll lifecycle untouched** (`useScrollLifecycle`,
  ChatRow height logic) — no rendering-behavior change, only render counts.
- `docs/architecture.md` do-not-touch list: none of the listed items are
  modified (the webview state merge itself — `mergeExtensionState`,
  `applyExtensionMessage` — is untouched; only the React binding changes).
- **React Compiler**: new/changed functions must not add bailouts (checked by
  `scripts/check-react-compiler-bailouts.mjs` in `pnpm lint`).

## Measurement (roadmap requirement)

Deterministic React Profiler harness at
`webview-ui/src/context/__tests__/ExtensionStateContext.perf.spec.tsx`:

- Real `ExtensionStateContextProvider` mounted with probes:
    - `legacy-probe`: full-context consumer (`useExtensionState()`)
    - `settings-probe`: settings-only consumer
    - `messages-probe`: messages consumer
- Seed: `state` message (task with 30 messages, realistic fields), then **200
  `messageUpdated` events** updating the last message's `partial` text
  (simulated streamed tokens), deterministic (no fake timers, no network; the
  vscode module is mocked).
- `<Profiler onRender>` records per-commit actual duration and which phases
  (probes) committed. Results table below.

### BEFORE (main @ 02148dfd4, measured 2026-09-28)

Harness written and run against unmodified main (written before branching, per
the stash-free approach). Three runs:

| Metric                                 | run 1 | run 2 | run 3 |
| -------------------------------------- | ----- | ----- | ----- |
| Profiler commits (200 token updates)   | 202   | 202   | 202   |
| legacy-probe renders (full context)    | 202   | 202   | 202   |
| settings-probe renders (settings-only) | 202   | 202   | 202   |
| messages-probe renders                 | 202   | 202   | 202   |
| Total actualDuration (ms, jsdom)       | 35.72 | 37.24 | 49.40 |
| Mean per-commit duration (ms)          | 0.177 | 0.184 | 0.245 |

**The defect, measured: a settings-only consumer rendered 202 times for 200
streamed tokens — once per token, exactly as the roadmap claimed.**

### AFTER (branch feature/p1-extension-state-selector, 2026-09-28)

Five runs:

| Metric                                 | run 1 | run 2 | run 3 | run 4 | run 5 |
| -------------------------------------- | ----- | ----- | ----- | ----- | ----- |
| Profiler commits (200 token updates)   | 202   | 202   | 202   | 202   | 202   |
| legacy-probe renders (full context)    | 202   | 202   | 202   | 202   | 202   |
| settings-probe renders (settings-only) | **2** | **2** | **2** | **2** | **2** |
| messages-probe renders                 | 202   | 202   | 202   | 202   | 202   |
| Total actualDuration (ms, jsdom)       | 35.73 | 33.73 | 34.53 | 42.27 | 36.63 |
| Mean per-commit duration (ms)          | 0.177 | 0.167 | 0.171 | 0.209 | 0.181 |

**Settings-only consumers: 202 renders → 2 (mount + hydration), a 99%
reduction; they no longer render at all during streaming.** The jsdom
actualDuration numbers are noise-dominated (the probes are deliberately tiny);
the render counts are the deterministic signal. The real-world win is larger
than the harness shows because the harness probes are trivial while the real
migrated consumers (App, TranslationProvider, ChatTextArea at 1,332 lines,
TaskHeader with its message scan, AutoApproveDropdown, ModeSelector, ~20 more)
each carry real render cost.

(The harness also asserts the characterization invariant: settings-probe
renders must NOT increase per token after the change.)

## Test plan

- Existing specs pass: `ExtensionStateContext.spec.tsx`,
  `ExtensionStateContext.messages.spec.tsx`, `ExtensionStateContext.subagents.spec.tsx`
  (+ all ChatView/ChatTextArea/TaskHeader consumer specs).
- New: `ExtensionStateContext.selector.spec.tsx`
    - selector returns the correct slice;
    - consumer with a stable slice does not re-render when an unrelated slice
      changes (assert render counts);
    - `useExtensionState()` value identity stable across no-op commits;
    - action identities stable across commits (`setMode`, `setApiConfiguration`,
      `togglePinnedApiConfig`, …);
    - `useExtensionState` still throws outside a provider.
- Harness spec doubles as characterization test: settings-only consumer render
  count per 200 token updates must be ≤ the legacy count and (after) exactly the
  initial mount renders.

## Migration scope

Migrated to `useExtensionSelector` in this PR (hot path, always-mounted, or
both):

- `App.tsx`, `i18n/TranslationContext.tsx` (root, everything below benefits)
- `chat/ChatView.tsx`, `chat/ChatTextArea.tsx`, `chat/TaskHeader.tsx`
- `chat/` children reading context: `TaskActions`, `ErrorRow`, `ReasoningBlock`,
  `FollowUpSuggest`, `AutoApproveDropdown`, `ModeSelector`, `ShareButton`,
  `CommandExecution`, `IndexingStatusBadge`, `ApiConfigSelector` (via grouped
  slice)
- row renderers: `TaskToolRows`, `AskRows`, `StatusRows` (CheckpointSavedRow),
  `MessageRows`, `UserFeedbackRow`
- hooks: `useAutoApprovalToggles`, `useCloudUpsell`, `useTooManyTools`
- `common/Tab.tsx`, `common/StorageErrorBanner.tsx`
- `history/useTaskSearch` (HistoryView subtree)

Remaining ~25 consumers (settings views, cloud, marketplace, welcome, mcp —
all behind tabs that are unmounted while the chat streams) stay on
`useExtensionState()`; they inherit the stable-action + memoized-value fix and
can be migrated later without behavior change.

## Rollout / notes for consumers

- `useExtensionSelector` is additive; no consumer is forced to move.
- When migrating a consumer: select the smallest slice; for multiple values use
  one selector returning a tuple/object + a custom `isEqual` (shallow), or
  several `useExtensionSelector` calls.
- The context value now caches per store version: a legacy consumer that holds
  the value across commits sees the same object until the store actually
  changes.
