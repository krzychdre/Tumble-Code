# P7 — one fs.watch per task folder → watch live and recent tasks only

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, **P7**.

> Problem: "One `fs.watch` per task folder in `TaskHistoryStore`; thousands of
> tasks mean thousands of watchers (inotify limit)."
> Fix: "Watch live and recent tasks only; the five-minute reconcile covers the
> rest."

Branch: `perf/p7-watch-live-recent-tasks` (off main @ 83461fa35).

## 1. Watcher lifecycle inventory (verified on main @ 83461fa35)

All in `src/core/task-persistence/TaskHistoryStore.ts`:

| Mechanism                      | Where                                                                                                             | Lifecycle                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Global watcher on `tasks/` dir | `startWatcher()` :1176 (`fsSync.watch(tasksDir)`)                                                                 | created in `initialize()` step 3 (:473), closed in `dispose()` (:515)                                                                    |
| Per-task dir watchers          | `taskDirWatchers` map :248, armed by `ensureTaskDirWatcher()` :1304 (`fsSync.watch(taskDir)`)                     | armed for **every** task dir on disk                                                                                                     |
| Arm-all sweep                  | `refreshTaskDirWatchers()` :1267                                                                                  | called at init (:1209), after every global-watcher dir event (:1193 arms the single new dir), and after every periodic reconcile (:1392) |
| Five-minute reconcile          | `RECONCILE_INTERVAL_MS` :302 = 5·60·1000, `startPeriodicReconciliation()` :1379                                   | confirmed to exist exactly as the roadmap describes                                                                                      |
| Watcher→cache path             | dir event → `scheduleTargetedRefresh()` :1220 → debounced `runTargetedRefreshPass()` :1243 → `refreshTask()` :762 | targeted per-ID refresh under per-ID locks; coalesced into `watcherRefreshTail`                                                          |
| F2 drain helper                | `waitForWatcherRefreshesForTests` :289                                                                            | fires armed debounce + awaits `watcherRefreshTail`; used before counting `perIdLocks` (spec `TaskHistoryStore.spec.ts` :736)             |

**Root-cause evidence (before)** — synthetic scenario, measured on pristine main
with a temp spec (mocked `fs.watch` counting calls, 200 task dirs on disk, store
`initialize()` + 500 ms settle):

```
[evidence] total fs.watch calls: 201; per-task-dir watchers: 200 (task dirs on disk: 200)
```

Watcher count = task count + 1, always. With thousands of tasks this hits the
inotify `max_user_watches` ceiling (default 8192 on many distros) and the
extension host dies watching.

The five-minute reconcile already re-reads _changed_ records (mtime/size check
in `hasFileChanged` :1126) and adds/removes cache entries — it refreshes task
list entries from disk, not just adds new ones. So a watcher on an idle task
folder is pure cost: the reconcile would pick up any change within ≤5 min.

## 2. Gating design

A task folder gets a watcher **only** while it is _live_ or _recent_:

- **Live** — the task currently occupies a provider's TaskSlot (D7: at most one
  per provider). Refcounted in the store (`Map<taskId, count>`) because the
  shared store serves several providers (sidebar + editor tab) that may hold
  the same task live.
- **Recent** — the task's `history_item.json` mtime is within a 10-minute
  window. 10 min = **2× the reconcile interval**: a watcher must outlive at
  least one full reconcile cycle, because that cycle is what refreshes the
  mtime for a task another window is still writing to. With 2×, a task that
  keeps being written never lapses out of watcher coverage between reconciles;
  a task that went idle is demoted after at most ~15 min (last write → next
  demotion-eligible tick) and is covered by the 5-min reconcile forever after.

### Promotion

1. **Touch promotion** — every record transaction (`withRecordTransaction`,
   used by `upsert`/`atomicReadAndUpdate`/`delete`/migration/`refreshTask`)
   refreshes the file's mtime in `fileMeta`; a transaction on a task whose
   watcher is missing re-arms it. Our own writes and reconcile-detected
   external writes therefore promote automatically.
2. **Live promotion** — `TaskHistoryStore.setTaskLive(taskId, live)` bumps/
   drops the refcount; a bump re-arms the watcher immediately.
3. **New-dir promotion** (unchanged) — the global watcher's dir event arms a
   watcher for a brand-new task dir, exactly as today.

### Demotion (grace, no flapping)

Demotion happens **only on the periodic sweep** (`refreshTaskDirWatchers`,
every 5 min) and only when the task is neither live nor recent. A watcher is
never torn down in the middle of activity: any write re-freshens the mtime
(keep) and a live mark pins the id (keep). Worst case for a task that just went
idle: its watcher survives ~15 min, then closes; from then on the 5-min
reconcile is the visibility guarantee.

### Provider wiring

- `TaskHistoryGateway.setLiveTaskId(taskId | undefined)` tracks the gateway's
  own current id; on change it issues `setTaskLive(old, false)` +
  `setTaskLive(new, true)`, fire-and-forget (a live mark must never block a
  task switch on store acquire; if the store isn't ready yet the id is applied
  on the next successful acquire). `dispose()` clears the mark.
- `ClineProvider.setCurrentTask` / `clearCurrentTask` / the `replaceInPlace`
  resume path call the gateway method.
- Background tasks (memory writers, subagents — kept out of the TaskSlot) are
  covered by touch promotion: their writes go through `upsert`.

## 3. Spec impact

| Spec                                                                             | Impact                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskHistoryStore.spec.ts` — F2 drain-helper case (:727)                         | **Unchanged contract.** `waitForWatcherRefreshesForTests` still fires the armed debounce and awaits `watcherRefreshTail`; touch promotion keeps arming watchers on upsert-created dirs, so the per-ID-lock accounting stays meaningful.                                                                                                                                                      |
| `TaskHistoryStore.spec.ts` — reconcile/revision cases                            | unaffected (reconcile semantics untouched)                                                                                                                                                                                                                                                                                                                                                   |
| `TaskHistoryStore.crossInstance.spec.ts`                                         | unaffected (reconcile-based)                                                                                                                                                                                                                                                                                                                                                                 |
| `TaskHistoryStore.migrationAndInit.spec.ts`, `TaskHistoryStore.realLock.spec.ts` | unaffected (migration writes promote via touch; no per-folder watcher assertions)                                                                                                                                                                                                                                                                                                            |
| **new** `TaskHistoryStore.watcherGating.spec.ts`                                 | (a) watcher count scales with live+recent, not total (1000 stale dirs + 1 live + 1 recent → 3 `fs.watch` calls); (b) an unwatched folder's external change is picked up by `reconcile()`; (c) live promotion arms a watcher immediately, demotion closes it only after the id is cleared AND the file ages out; (d) reconcile-observed external change promotes a watcher (touch promotion). |
| gateway/provider specs                                                           | none assert watcher state; the gateway gains one method (used by the provider — production reference, knip-safe)                                                                                                                                                                                                                                                                             |

Test-mechanics note: `fsSync.watch` is not spyable on current Node
(`Cannot redefine property: watch`), so the gating spec mocks the `fs` module
and returns **fake** FSWatcher objects (with `on`/`close`), keeping the
1000-dir case fast and inotify-free while counting real call sites.

## 4. Docs

`docs/06-persistence.md` :70-72 — "watches task folders for changes made by
other windows" becomes "watches the live and recently modified task folders";
`docs/architecture.md` has no watcher description (grep-verified), unchanged.

## 5. Verification

- `cd src && npx vitest run core/task-persistence` (all four store suites)
- full task-persistence + affected webview suites
- typecheck + eslint, `pnpm knip` (baseline exit 1 pre-existing, no new findings)
- after-evidence: same synthetic scenario, expect `fs.watch` calls = 1 global +
  live + recent only.

## 6. Results (finishing pass, 2026-09-28)

- All suites green: 151/151 across `core/task-persistence` + gateway +
  task-slot + completion-memory-writers specs (including the 6 new
  `watcherGating.spec.ts` cases).
- One defect found and fixed during verification: touch promotion originally
  armed a watcher on **every** record transaction, including the initial
  reconcile's read-only `refreshTask` over stale records — arming all 1000
  watchers again at startup. Fixed by gating the touch-promotion site through
  `shouldWatchTaskDir` in `withRecordTransaction`. Genuine writes still promote
  (they refresh the mtime first), read-only refreshes of stale records don't.
- `pnpm check-types`: 11/11 tasks successful. `pnpm knip`: exit 1 =
  pre-existing main baseline; no findings touch the P7 files (the one
  `TaskHistoryStore*` hit is `TaskHistoryStoreAcquireOptions` in
  `index.ts`, untouched by this branch and present on main).
- **After-evidence** — same synthetic scenario as the "before" measurement
  (mocked `fs.watch` counting calls, 200 task dirs aged past the recent window
  on disk, store `initialize()` + 500 ms settle):

    ```
    [evidence] total fs.watch calls: 1; per-task-dir watchers: 0 (task dirs on disk: 200)
    ```

    Before: 201 calls / 200 per-task watchers. After: 1 call / 0 per-task
    watchers for aged-out tasks (watcher count = 1 global + live + recent only;
    the gating spec's 1000-stale case asserts exactly 3 with 1 live + 1 recent).
    The throwaway measurement spec (`tmp-watcher-count.spec.ts`) was deleted
    after this run; the permanent coverage lives in
    `TaskHistoryStore.watcherGating.spec.ts`.
