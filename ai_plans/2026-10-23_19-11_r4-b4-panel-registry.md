# R4-B4: the window-wide panel registry in its own module

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item B4).

## Touched files

- New: `src/core/webview/panelRegistry.ts`
- `src/core/webview/ClineProvider.ts`, `src/core/webview/ProviderStateBuilder.ts` (comment)
- Callers: `src/activate/registerCommands.ts`, `src/activate/handleUri.ts`, `src/activate/runPromptAction.ts`,
  `src/extension.ts`, `src/extension/api.ts`, `src/extension/bridge.ts`, `src/core/webview/PlanReviewPanel.ts`,
  `src/core/agent-interchange/index.ts`
- `docs/architecture.md` (the layering paragraph and a new paragraph on the registry)
- Specs: the mocks and call sites in `registerCommands`, `runPromptAction`, `handleUri`, `extension`,
  `agentInterchange`, the five `extension/__tests__/api-*` specs, `layering`, `single-open-invariant` and the
  `ClineProvider` specs `cancelTask-abort-race`, `historyReopenAllowList`, `multipleTabs`, `sharedSettings`,
  `stateBuilder`, `ClineProvider.spec.ts`

## Problem

`ClineProvider` is one panel's backend, but it also held the window-wide state of all panels in statics:
the live instances, their observers, the activation counter, the merged working-tasks map and the lookups
(`getVisibleInstance`, `getEditorTab`, `getLastActiveInstance`, `getInstance`, `findTaskHost`,
`observeInstances`, `postStateToAllWebviewsWithoutClineMessages`). Static methods read private members of other
instances, and the state builder's `getRunningTasks` source had the hidden side effect of noting the map as the one
the view holds.

## Change

- `panelRegistry` (one `PanelRegistry` per extension host) owns the set of live providers, the observers, when the
  user was last in each panel, the lookups, the state push to every panel, and the merged working tasks
  (`runningTasks()`, `postRunningTasks()`). The name was used once before for a module that kept a single tab panel
  and was deleted in #888; this module keeps every panel, so the name fits it better than it fitted that one.
- `ClineProvider` registers itself in its constructor and leaves at the end of `dispose()`. It exposes what the
  registry reads: `isDisposed` (existing), `panelView`, `ownRunningTasks()`, `postRunningTasksIfChanged()`.
  Only `sideBarId` and `tabPanelId` stay static.
- The builder's `getRunningTasks` source is a plain read. The provider notes the map in the state pusher's
  `getStateToPostToWebview` callback, where every state that is posted is built. `WebviewStatePusher` is unchanged.
- `getInstance` loses its redundant `if (!x) return; return x` tail.
- `API` pushes the observer disposable into its context subscriptions without the `if (observer)` guard (the
  registry always returns one; the guard existed for automocked statics).

## Tests

- The pinning specs (`multipleTabs`, `sharedSettings`, `stateBuilder`) run against the real registry.
- `api-tab-provider-events.spec.ts` uses the real registry with provider stand-ins instead of a hand-written mock of
  `observeInstances`.
- `ClineProvider.spec.ts` lost the `getEditorTab` test that cleared the private static set; `multipleTabs`
  ("getEditorTab never returns the sidebar", "returns the tab the user focused last") covers the same behaviour
  with real providers.
- The `stateBuilder` case "a state push counts as sent" now sends a real state push instead of calling the builder.
- Mutation checks: dropping the note in the pusher callback, dropping the "awaiting_input wins" rule and dropping
  `other !== provider` in `sharesContextProxy` each turned a spec red. `>=` against `>` in `mostRecentlyActive`
  survives: every provider with a view has been activated, and counts only grow, so no two candidates tie.
