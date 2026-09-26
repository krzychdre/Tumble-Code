# Full state pushes carry the task history only when it changed (CORE-R7 follow-up)

Branch `perf/state-push-task-history-when-changed`. Plan item: CORE-R7 in
`ai_plans/2026-09-24_refactor/04-extension-core.md` (branch
`docs/refactor-plan-2026-09-24`), the "task history in full state pushes"
follow-up left open after step 1 (#443) and the persistence half of step 4 (#463).

## Root cause (measured)

`ClineProvider.postStateToWebview()` builds the state with
`includeTaskHistory: true`, so every full push serializes the whole history
(`TaskHistoryStore.getAll()`, filtered and sorted). It runs after the webview
launches and after about 28 user-action handler sites (settings, modes,
profiles, deletes, imports), plus `ModeProfileBinding`, `TaskHistoryGateway`,
`importExport`, the extension API and the cloud bridge. The `updatePrompt`
handler posts its own full state with the history too.

The webview does not need it there: it keeps its list current through the
targeted `taskHistoryItemUpdated`, `taskHistoryItemDeleted` and
`taskHistoryUpdated` messages, and `mergeExtensionState` keeps the previous
value of any key a push leaves out (that is how `postStateToWebviewWithoutTaskHistory`
already works).

Owner's real data (`~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/_index.json`,
2026-09-26): 1,056 history items, all with `ts` and `task`; serialized as the
push sends them: 4,498,678 bytes (median item 1,961 bytes, largest 257,036).

Scripted cycle through the real provider and store, loaded with those 1,056
real items, counted by `perfCounters` (`statePostBytes`): webview launch,
three settings pushes, one history write (`updateTaskHistory`), three more
pushes (7 full pushes):

| | bytes posted in `state` messages | pushes carrying the history |
| --- | ---: | ---: |
| before | 31,533,271 | 7 |
| after | 9,039,811 | 2 (launch, after the write) |

A full push with an unchanged history shrinks from about 4,504,753 bytes to
about 6,075 bytes (the rest of the state).

## Design

A cheap, complete change signal instead of hashing:

- `TaskHistoryStore` keeps its cache in a `RevisionedMap`: a `Map` whose
  `set`, effective `delete` and non-empty `clear` take a new revision from one
  process-wide counter. Every mutation of the cached history (upsert,
  delete, deleteMany, atomicReadAndUpdate, reconcile, watcher refresh,
  migration, invalidateAll) goes through the map, so no writer can bypass it,
  including future ones. O(1) per mutation. The counter is process-wide, so
  two stores, or a store and its reacquired successor, never share a
  revision. Exposed as `store.revision`.
- `ProviderStateBuilder.getStateToPostToWebview({ includeTaskHistory: "whenChanged" })`:
  reads the revision synchronously with the rest of the view state; when it
  equals the revision this provider's view last received, the history is
  neither read nor sent and the `taskHistory` key is left out; otherwise the
  whole history is sent. The revision is remembered only after the state is
  fully built (the caller posts it next). An unavailable store sends the
  degraded empty history and remembers nothing, so the first push after the
  store recovers sends the whole history. A store without revisions (test
  doubles) is always sent in full.
- `postStateToWebview` and the `updatePrompt` handler use `"whenChanged"`.
- Per view: the remembered revision lives in the provider's own builder, one
  per provider (sidebar, tab panel). `resolveWebviewView` and the
  `webviewDidLaunch` handler (first statement, before any await) forget it,
  so a new or reloaded webview always receives the whole history.

Why this is safe with in-flight pushes: an omission never clears the
webview's list; it only relies on the view having received that revision.
A remembered revision was always followed by its post to the same view; if
the view changed meanwhile, the `webviewDidLaunch` reset (sent by the new
webview only once it listens) comes after and forces the next push to carry
the history again.

## What stays unchanged

- `postStateToWebviewWithoutTaskHistory` / `...WithoutClineMessages`: unchanged,
  and they do not count as having delivered the history.
- `getStateToPostToWebview()` with no option or a boolean: unchanged (default
  `true` still returns the whole history), so other readers see the same state.
- Targeted history messages: unchanged.
- Webview: no change needed. The reducer keeps its list for an absent key
  (new characterization case in `extensionMessageCases.ts`); an empty array
  still clears it.
- CLI: `transcript-reducer` emits `setTaskHistory` only when the push has the
  array (new characterization test); the `--session` / `--continue` lookup waits for
  the first push with a history, which is the push right after its
  `webviewDidLaunch`. The CLI ignores targeted history messages, so its list
  is exactly as fresh as before: it changes only on full pushes, and every
  full push after a change still carries the history. `MessageProcessor`,
  `JsonEventEmitter` and `session-events` never read `taskHistory`: the
  stream-json and print output are unchanged.
- Cloud bridge: calls `postStateToWebview`, never reads the posted message.

## Tests

- `TaskHistoryStore.spec.ts`: revision changes on every mutation, never on a
  read, not on a no-op reconcile, unique across instances.
- `ClineProvider.taskHistory.spec.ts`: first push carries it, an unchanged one
  omits the key and keeps the rest; every writer path (own broadcast, own
  silent write, another provider's write and delete, an external change)
  makes the next push carry the store's list; `deleteTaskFromState`;
  without-history pushes do not count; `webviewDidLaunch`; a new webview; a
  second provider; `updatePrompt`; an unavailable store; a scripted cycle
  (7 pushes, 2 carry the history).
- Routing snapshots (`webviewMessageHandler.routing`) updated deliberately:
  `webviewDidLaunch` now calls `forgetWebviewTaskHistory`, `updatePrompt`
  passes `includeTaskHistory: "whenChanged"`.

## Residual risks

- A cached `HistoryItem` mutated in place bypasses the revision.
  `ModeProfileBinding.restoreForHistoryItem` sets `historyItem.mode` to the
  default when the saved mode no longer exists, on an item that can come
  straight from the store's cache (pre-existing: the change is never
  persisted). Before, the next full push showed that mode in the history
  list; now it shows only after the next real history change. Cosmetic.
- A foreign-provider upsert whose targeted message is delivered late (after
  a full push that already carried a newer version of the same item, while
  a second write to that item came from this provider without broadcast)
  could leave that one item stale until its next change. Needs two
  providers writing the same task concurrently; before, the next full push
  corrected it.
- The saving applies to pushes where the history did not change. While a
  task runs, its history item is written on each coalesced save (every 1 to
  3 s), so a full push during streaming usually still carries the history.
