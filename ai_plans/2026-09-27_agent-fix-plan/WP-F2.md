# WP-F2: Count TaskHistoryStore per-ID locks without the folder watcher (Windows flake)

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/f2-task-history-lock-count-flake      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

The unit test "TaskHistoryStore > record transaction cleanup > releases per-ID lock tails for many unique IDs"
fails on windows-latest CI (expected 0 pending per-ID locks, got 100). The failure is caused by the store's own
file watcher, not by a lock leak. Fix the TEST: run the lock-count test without the watcher, make the race
reproducible on every platform (slow writes) so the test proves it is isolated, and add one test for the
"refresh queued behind upsert" lock path. No production code changes.

## 2. Why it matters (user-visible effect, 2-4 sentences)

No user-visible effect: production code has no leak (see section 5). The flake makes the Windows unit-test job
red at random, so real failures get ignored ("CI is trustworthy again" is priority 1 in
`ai_plans/2026-09-27_simplification-roadmap.md`, item F2).

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md` (test placement rules) and `docs/architecture.md` ("Do not touch": `TaskHistoryStore` is listed
  under "Task control", which is why this WP changes only the test).
- `docs/06-persistence.md`, section "Save timing" (the store watches task folders).
- `src/core/task-persistence/TaskHistoryStore.ts`:
  - `withRecordTransaction` (the per-ID lock, `perIdLocks`, cleanup in `finally`)
  - `getPendingRecordLockCountForTests` (returns `perIdLocks.size`)
  - `initialize` (calls `this.startWatcher()` after `reconcile()`)
  - `startWatcher` (the `fsSync.watch(tasksDir, ...)` callback)
  - `scheduleTargetedRefresh` (500 ms trailing debounce, `WATCHER_DEBOUNCE_MS`)
  - `ensureTaskDirWatcher` (per-task-folder watcher, also calls `scheduleTargetedRefresh`)
  - `refreshTask` (takes the per-ID lock through `withRecordTransaction`)
- `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`:
  - the `vi.mock("../../../utils/safeWriteJson", ...)` at the top (writes go through one `vi.fn` named `write`,
    exported as `safeWriteJson`, and `withLockedJsonTransaction` calls the same `write`)
  - `beforeEach` / `afterEach` of `describe("TaskHistoryStore")`
  - `describe("record transaction cleanup")` (the block you change)
  - the test "does not re-read unchanged files (cheap metadata check)" (existing precedent for
    `vi.spyOn(store as unknown as {...}, "<privateMethod>")`)
  - the test "returns false and leaves data on disk when a write fails (no cleanup)" (existing precedent for
    `vi.mocked(safeWriteJson).mockImplementationOnce(...)`)

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/core/task-persistence/TaskHistoryStore.ts`, `withRecordTransaction` (near line 1450), the lock part ("..." marks omitted lines):

```ts
		const prev = this.perIdLocks.get(taskId) ?? Promise.resolve()
		let releaseNext: () => void = () => {}
		const next = new Promise<void>((resolve) => {
			releaseNext = resolve
		})
		const tail = prev.then(() => next)
		this.perIdLocks.set(taskId, tail)
		await prev
		try {
			...
		} finally {
			releaseNext()
			// If no one else is waiting on this ID, drop the entry to avoid
			// unbounded map growth.
			if (this.perIdLocks.get(taskId) === tail) {
				this.perIdLocks.delete(taskId)
			}
		}
```

`src/core/task-persistence/TaskHistoryStore.ts`, `getPendingRecordLockCountForTests` (near line 275):

```ts
	static getPendingRecordLockCountForTests(store: TaskHistoryStore): number {
		return store.perIdLocks.size
	}
```

`src/core/task-persistence/TaskHistoryStore.ts`, `startWatcher` (near line 1153), the folder-watcher callback:

```ts
					this.fsWatcher = fsSync.watch(tasksDir, { recursive: false }, (_eventType, filename) => {
						...
						const taskId = filename
						...
						this.ensureTaskDirWatcher(taskId).catch(() => {})
						// Schedule a targeted refresh for this ID (the dir
						// add/rename may have brought a new file with it).
						this.scheduleTargetedRefresh(taskId)
					})
```

`src/core/task-persistence/TaskHistoryStore.ts`, `scheduleTargetedRefresh` (near line 1197) (the original comment has an em dash after "per ID"; shown here as "-"):

```ts
	private scheduleTargetedRefresh(taskId: string): void {
		if (this.disposed) {
			return
		}
		this.pendingWatcherIds.add(taskId)
		if (this.watcherDebounce) {
			clearTimeout(this.watcherDebounce)
		}
		this.watcherDebounce = setTimeout(() => {
			this.watcherDebounce = null
			const ids = Array.from(this.pendingWatcherIds)
			this.pendingWatcherIds.clear()
			// Targeted refresh per ID - never a full scan. Each refreshTask
			// runs under its own per-ID lock and notifies only if the cache
			// actually changed.
			Promise.all(
				ids.map(async (id) => {
					try {
						const event = await this.refreshTask(id, { external: true })
						...
		}, TaskHistoryStore.WATCHER_DEBOUNCE_MS)
	}
```

(`WATCHER_DEBOUNCE_MS = 500`.) `refreshTask` starts with
`const event = await this.withRecordTransaction(taskId, async ({ filePath }) => {`, i.e. it takes the same per-ID
lock as `upsert`.

`src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`, setup (near line 48):

```ts
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-test-"))
		store = new TaskHistoryStore(tmpDir)
	})

	afterEach(async () => {
		store.dispose()
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})
```

`src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`, `describe("record transaction cleanup")`
(near line 726), the whole block as it is today:

```ts
	describe("record transaction cleanup", () => {
		it("releases per-ID lock tails for many unique IDs", async () => {
			await store.initialize()
			await Promise.all(
				Array.from({ length: 100 }, (_, index) => store.upsert(makeHistoryItem({ id: `lock-${index}` }))),
			)
			expect(TaskHistoryStore.getPendingRecordLockCountForTests(store)).toBe(0)
		})

		it("does not recreate a missing task directory during refresh", async () => {
			await store.initialize()
			await store.refreshTask("refresh-missing")
			await expect(fs.access(path.join(tmpDir, "tasks", "refresh-missing"))).rejects.toMatchObject({
				code: "ENOENT",
			})
		})
	})
```

## 5. Root cause / analysis

VERIFIED (read and ran):

1. The spec's store is real apart from the mocked `safeWriteJson` / `getStorageBasePath`; `fs.watch` is NOT
   mocked. `store.initialize()` calls `startWatcher()`, so every test that calls `initialize()` has a live
   `fsSync.watch` on `<tmpDir>/tasks` and per-task-folder watchers.
2. Each `upsert` creates `<tmpDir>/tasks/lock-N/`. The folder watcher fires for each new folder and calls
   `scheduleTargetedRefresh(taskId)`. That is a 500 ms TRAILING debounce: every event restarts the timer, and when
   it fires it calls `refreshTask(id)` for ALL pending ids at once. `refreshTask` takes the same per-ID lock via
   `withRecordTransaction`.
3. `withRecordTransaction` deletes the map entry in `finally` only if the entry is still its own `tail`. If a
   refresh queued behind the upsert, the upsert leaves the entry and the refresh deletes it when it finishes.
   So there is no permanent leak; the entries are transient.
4. The count of exactly 100 therefore means: the debounce fired while the upserts were still running (slow file
   I/O on Windows CI, more than 500 ms without a watcher event), all 100 refreshes queued behind or ran after the
   upserts, and they were still in flight when `Promise.all` resolved and the test read the count synchronously.
   (The debounce timer cannot fire between the last upsert resolving and the assertion: both are microtasks.)
5. Deterministic reproduction on Linux (ran it 5 times, failed 5 times with "expected 100 to be +0"): make every
   record write wait 700 ms (longer than the debounce) in the existing test. The watcher debounce then fires
   while all upserts are blocked in the write, and the count is 100. With `startWatcher` stubbed, the same slow
   test passes (0). The full existing spec passes on Linux today (43 tests).

Production assessment (VERIFIED by reading): every local `upsert` triggers a watcher event, and 500 ms later a
targeted `refreshTask` that re-reads the file just written under the per-ID and file lock. It returns `null`
(fingerprint unchanged) so there is no extra notification; the cost is one read + stat per written record,
coalesced by the debounce. That is redundant work, not a correctness bug, and `TaskHistoryStore` is on the
"Do not touch without a dedicated item" list. Do NOT change production code in this WP. (If someone wants the
self-refresh gone later, that is a separate item.)

HYPOTHESIS: none left that affects the fix. If the Windows job still shows this test failing after the change,
see section 12.

Why this fix (least invasive, keeps the test meaningful): the test is about `withRecordTransaction` releasing its
own lock entries, so it must not share the lock map with an unrelated background refresh. Stubbing the private
`startWatcher` on that one store instance removes the only source of foreign lock holders (the periodic reconcile
runs every 5 minutes and cannot fire during the test). Adding the 700 ms slow writes turns "flaky on Windows" into
"fails everywhere if the watcher is not disabled", which is the proof the test needs. The new second test covers
the path the flake exposed (a refresh queued behind an upsert on the same id) deterministically, without timers.
Alternatives rejected: `vi.waitFor(count === 0)` (hides the cause and depends on timing); a new public or
test-only quiescence hook in `TaskHistoryStore` (touches a "do not touch" file for a test-only need).

## 6. Step-by-step changes

Only one file changes: `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`.

Step 1. In `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts`, find this exact block (it is unique;
it starts with `describe("record transaction cleanup"` and ends right before
`describe("shared lifecycle (acquire/dispose)"`):

```ts
	describe("record transaction cleanup", () => {
		it("releases per-ID lock tails for many unique IDs", async () => {
			await store.initialize()
			await Promise.all(
				Array.from({ length: 100 }, (_, index) => store.upsert(makeHistoryItem({ id: `lock-${index}` }))),
			)
			expect(TaskHistoryStore.getPendingRecordLockCountForTests(store)).toBe(0)
		})

		it("does not recreate a missing task directory during refresh", async () => {
			await store.initialize()
			await store.refreshTask("refresh-missing")
			await expect(fs.access(path.join(tmpDir, "tasks", "refresh-missing"))).rejects.toMatchObject({
				code: "ENOENT",
			})
		})
	})
```

Replace it with exactly:

```ts
	describe("record transaction cleanup", () => {
		// F2: the store's fs.watch callbacks schedule a debounced (500 ms) refreshTask for every new task
		// folder, and refreshTask takes the same per-ID lock as upsert. When the writes are slow (Windows CI),
		// that debounce fires while the upserts still hold their locks, the refreshes queue behind them and
		// are still running when the upserts resolve, so a lock count taken right then sees them. The lock
		// count tests therefore run without the watcher; the slow writes make the race happen on every
		// platform, so a test that forgets to disable the watcher fails everywhere, not only on Windows.
		function disableWatcher(target: TaskHistoryStore) {
			return vi
				.spyOn(target as unknown as { startWatcher: () => void }, "startWatcher")
				.mockImplementation(() => {})
		}

		async function withSlowRecordWrites<T>(delayMs: number, run: () => Promise<T>): Promise<T> {
			const { safeWriteJson } = await import("../../../utils/safeWriteJson")
			const mock = vi.mocked(safeWriteJson)
			const original = mock.getMockImplementation()!
			mock.mockImplementation(async (filePath: string, data: any) => {
				await new Promise((resolve) => setTimeout(resolve, delayMs))
				return original(filePath, data)
			})
			try {
				return await run()
			} finally {
				mock.mockImplementation(original)
			}
		}

		it("releases per-ID lock tails for many unique IDs", async () => {
			const startWatcher = disableWatcher(store)
			await store.initialize()
			expect(startWatcher).toHaveBeenCalledTimes(1)

			// Longer than the 500 ms watcher debounce, see the comment above.
			await withSlowRecordWrites(700, () =>
				Promise.all(
					Array.from({ length: 100 }, (_, index) => store.upsert(makeHistoryItem({ id: `lock-${index}` }))),
				),
			)

			expect(TaskHistoryStore.getPendingRecordLockCountForTests(store)).toBe(0)
		})

		it("releases lock tails taken by refreshes queued behind upserts on the same IDs", async () => {
			disableWatcher(store)
			await store.initialize()
			const ids = Array.from({ length: 100 }, (_, index) => `queued-${index}`)

			// Each refreshTask queues behind the upsert on its ID, so the upsert's own cleanup finds a newer
			// tail and leaves the entry to the refresh, which must remove it when it finishes.
			await Promise.all([
				...ids.map((id) => store.upsert(makeHistoryItem({ id }))),
				...ids.map((id) => store.refreshTask(id)),
			])

			expect(TaskHistoryStore.getPendingRecordLockCountForTests(store)).toBe(0)
		})

		it("does not recreate a missing task directory during refresh", async () => {
			await store.initialize()
			await store.refreshTask("refresh-missing")
			await expect(fs.access(path.join(tmpDir, "tasks", "refresh-missing"))).rejects.toMatchObject({
				code: "ENOENT",
			})
		})
	})
```

Nothing else changes: no new imports are needed (`vi`, `fs`, `path`, `TaskHistoryStore`, `makeHistoryItem`,
`store`, `tmpDir` already exist in the file; the `../../../utils/safeWriteJson` dynamic import is already used in
the migration test). Keep tabs for indentation, as in the rest of the file.

## 7. Tests to add or change

All in `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts` (package-local unit test: the lowest layer
that can show the race; no e2e needed). The full code is the replacement block in step 1.

1. "releases per-ID lock tails for many unique IDs" (changed): stubs `startWatcher` on the store instance and
   makes each record write take 700 ms. Without `disableWatcher(store)` it fails on Linux every time with
   "expected 100 to be +0" (verified), because the watcher's debounced refreshes queue behind the slow upserts.
   With it, it passes. `expect(startWatcher).toHaveBeenCalledTimes(1)` guards against the spy silently not
   applying (for example if `startWatcher` is renamed: then `vi.spyOn` throws, which is also a clear failure).
2. "releases lock tails taken by refreshes queued behind upserts on the same IDs" (new): 100 upserts plus a
   `refreshTask` on each same id, started in the same tick, so each refresh queues behind its upsert and the
   upsert's `finally` finds a newer tail. Asserts the map is empty after all settle. It passes today (there is no
   leak); it pins the cleanup contract for the queued path so a future change to the `finally` that stopped the
   last holder from deleting the entry fails here.
3. "does not recreate a missing task directory during refresh": unchanged.

How to prove the fix without Windows (do this once, do NOT commit it): after step 1, temporarily delete the three
lines

```ts
			const startWatcher = disableWatcher(store)
			await store.initialize()
			expect(startWatcher).toHaveBeenCalledTimes(1)
```

and put back only `await store.initialize()` in the first test. Run the spec: that test must fail with
"expected 100 to be +0". Restore the three lines: it passes. (Running the ORIGINAL test on Linux passes, because
Linux writes are fast; that is why the 700 ms delay is part of the committed test.)

## 8. Commands to run (exact, from which directory) and the expected result

From `/home/user/Tumble-Code/src` (or the repository's `src/` folder):

1. Before the change, to see the current test pass on Linux (the flake is Windows-only):
   `npx vitest run core/task-persistence/__tests__/TaskHistoryStore.spec.ts`
   Expected: `Tests  43 passed (43)`.
2. After step 1: same command. Expected: `Tests  44 passed (44)`, duration about 1 to 2 s longer (the 700 ms
   delay).
3. Proof run (section 7, temporary edit): same command. Expected: 1 failed, "releases per-ID lock tails for many
   unique IDs", `AssertionError: expected 100 to be +0`. Undo the temporary edit and rerun: 44 passed.
4. Stability: run the spec 5 times in a row:
   `for i in 1 2 3 4 5; do npx vitest run core/task-persistence/__tests__/TaskHistoryStore.spec.ts 2>&1 | grep "Tests "; done`
   Expected: `Tests  44 passed (44)` five times.
5. Wider folder: `npx vitest run core/task-persistence`. Expected: all files pass.
6. Type check: `npx tsc --noEmit -p .` Expected: no output, exit code 0. (The repo script `pnpm check-types`
   runs `scripts/check-unused-locals.mjs`; run it too if it is part of your normal flow.)
7. Lint: `npx eslint --max-warnings=0 core/task-persistence/__tests__/TaskHistoryStore.spec.ts` Expected: no
   output.
8. Format: `npx prettier --check core/task-persistence/__tests__/TaskHistoryStore.spec.ts` Expected:
   "All matched files use Prettier code style!" (a warning "Ignored unknown option { ignore: ... }" is normal).

## 9. Do not touch / pitfalls

- Do NOT change `src/core/task-persistence/TaskHistoryStore.ts`. It is on the "Do not touch without a dedicated
  item" list in `docs/architecture.md` (Task control: `TaskHistoryStore`). Do not add a test hook there either.
- Do not replace the assertion with `vi.waitFor(...)` or a sleep; that hides the cause and stays timing-dependent.
- Do not lower the 700 ms delay below the 500 ms `WATCHER_DEBOUNCE_MS`: then the test no longer proves that the
  watcher is disabled. If `WATCHER_DEBOUNCE_MS` changes one day, the delay must stay above it.
- `withSlowRecordWrites` must restore the original mock implementation in `finally` (it does); other tests in the
  file rely on `safeWriteJson` writing immediately.
- `disableWatcher` spies on the store INSTANCE created in `beforeEach`, so it does not leak to other tests; do not
  spy on `TaskHistoryStore.prototype`.
- Do not use fake timers here: the store awaits real `fs/promises` I/O and the debounce uses `setTimeout`.
- Known flaky tests you may see elsewhere and must not "fix" in this WP: F1 (`cli-integration` case
  `create-with-session-id-resume-loads-correct-session`). This WP is F2 itself.
- The Windows CI job runs test files one at a time (`maxWorkers: 1` in `src/vitest.config.ts`); do not change the
  vitest config.

## 10. Acceptance checklist (checkboxes)

- [ ] Only `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts` changed (plus the `ai_plans` note).
- [ ] The first test stubs `startWatcher` and uses 700 ms slow writes; the new queued-refresh test exists; the
      "does not recreate a missing task directory during refresh" test is unchanged.
- [ ] Proof run done: without `disableWatcher` the first test fails with "expected 100 to be +0" on Linux; with it,
      it passes.
- [ ] `npx vitest run core/task-persistence` passes; 5 consecutive runs of the spec pass.
- [ ] tsc, eslint and prettier are clean for the changed file.
- [ ] No changeset (test-only).
- [ ] Windows CI unit-test job green on the PR (if it is red on this test, follow section 12).

## 11. Commit, changeset and PR text

- Commit title: `test(persistence): count TaskHistoryStore lock tails without the folder watcher (F2)`
- Commit body:

```
The lock-count test ran with the store's real fs.watch. Every new task
folder schedules a debounced refreshTask, which takes the same per-ID
lock. On slow Windows CI the debounce fired while the 100 upserts were
still writing, so the refreshes were still holding the locks when the
test counted them (expected 0, got 100). Production code has no leak:
the last holder removes the entry.

The test now stubs startWatcher on its store and makes every record
write take 700 ms (longer than the 500 ms watcher debounce), so it would
fail on every platform if the watcher were active. A new test covers a
refresh queued behind an upsert on the same id.
```

  End the body with the attribution lines required by the session (Co-Authored-By / Claude-Session), if any.
- Changeset: none (test-only).
- `ai_plans/2026-09-27_f2-task-history-lock-count-flake.md` (use the date of the commit):

```
# F2: TaskHistoryStore lock-count test flaky on Windows

Item F2 of `2026-09-27_simplification-roadmap.md`.

## Problem

"releases per-ID lock tails for many unique IDs" failed on windows-latest (expected 0, got 100). The store's
folder watcher schedules a debounced (500 ms) `refreshTask` per new task folder; `refreshTask` takes the same
per-ID lock. With slow writes the debounce fired during the upserts, and the refreshes still held the locks when
the test counted them. Not a production leak: the last holder deletes the entry.

## Change

Test only. The test stubs the private `startWatcher` on its store and makes each record write take 700 ms, so
the race happens on every platform and the stub is what keeps the test green. New test: a `refreshTask` queued
behind an upsert on the same id also leaves no lock entry.

## Tests

`TaskHistoryStore.spec.ts`, `describe("record transaction cleanup")`. Verified on Linux: without the stub the
test fails with "expected 100 to be +0"; with it, 5/5 runs pass.
```

- PR body outline: Problem (Windows flake, root cause: watcher-driven `refreshTask` holds the same per-ID locks,
  not a leak); Change (test-only, watcher stubbed, slow writes make the race deterministic, new queued-refresh
  test); Proof (the failing run without the stub on Linux); Out of scope (the redundant self-refresh after each
  local upsert, production code untouched because `TaskHistoryStore` is on the do-not-touch list). End with the
  PR attribution footer required by the session.

## 12. If stuck

- If `vi.spyOn(store as unknown as { startWatcher: () => void }, "startWatcher")` throws "startWatcher does not
  exist", the method was renamed: find the method that `initialize()` calls to start `fsSync.watch`, spy on that
  one instead, and say so in the PR. Do not edit `TaskHistoryStore.ts`.
- If the proof run (section 7) does NOT fail on Linux (count 0 even without the stub), stop and report: the
  watcher debounce or event delivery changed, and the root cause above needs to be re-checked before merging.
- If the Windows CI job still fails this test with the watcher stubbed, stop and report the exact count and the
  CI log; do not add retries or `vi.waitFor`. Another lock holder (for example the periodic reconcile or an
  un-disposed store from another test) would then be involved, which needs a new analysis.
