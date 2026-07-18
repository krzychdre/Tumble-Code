// pnpm --filter roo-cline test core/task-persistence/__tests__/TaskHistoryStore.realLock.spec.ts
//
// Real-filesystem + real `proper-lockfile` tests for the unified transaction
// model. These prove the locking contract on disk, not via mocks:
//   - concurrent upsert + atomic update + delete on the same ID don't lose
//     updates or deadlock (lock order is always per-ID → file, never reverse)
//   - two independent stores with a real lock on the same path serialize
//     (cross-instance safety)
//
// Mocks only `getStorageBasePath` (so the store uses the temp dir directly).
// `safeWriteJson` and `proper-lockfile` run for real.

import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as os from "os"

import type { HistoryItem } from "@roo-code/types"

import { TaskHistoryStore } from "../TaskHistoryStore"
import { GlobalFileNames } from "../../../shared/globalFileNames"

vi.mock("../../../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

// The shared JSON transaction gateway and its destination-bound atomic writer
// run for real, proving the store does not re-enter the record lock.

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
		number: 1,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
		workspace: "/test/workspace",
		...overrides,
	}
}

describe("TaskHistoryStore real-FS locking", () => {
	let tmpDir: string
	let store: TaskHistoryStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-reallock-"))
		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
	})

	afterEach(async () => {
		store.dispose()
		// Give the dispose-time index flush a moment.
		await new Promise((resolve) => setTimeout(resolve, 50))
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("concurrent upsert + atomicReadAndUpdate + delete on the same ID do not lose updates or deadlock", async () => {
		const id = "contended-task"
		// Seed with tokensIn: 0.
		await store.upsert({ ...makeHistoryItem({ id, ts: 1000 }), tokensIn: 0 })

		// A mix of concurrent operations on the SAME id:
		//  - 5 atomic increments (each reads on-disk, +1, writes back)
		//  - 1 upsert that sets a marker field
		//  - 1 delete that runs last (after we snapshot the counter)
		// All funnel through withRecordTransaction's per-ID lock, so they
		// serialize. No lost update, no deadlock (lock order is fixed).
		const increments = Array.from({ length: 5 }, () =>
			store.atomicReadAndUpdate(id, (current) => ({ ...current, tokensIn: current.tokensIn + 1 })),
		)
		// The marker upsert only sets `task` — it deliberately does NOT pass
		// tokensIn, so the merge preserves whatever the increments wrote.
		// (upsert merges {...onDisk, ...item}; an explicit field in `item`
		// wins, so we must omit tokensIn to avoid clobbering the counter.)
		const marker = store.upsert({
			id,
			number: 1,
			ts: 2000,
			task: "marker-set",
			tokensOut: 50,
			totalCost: 0.01,
			workspace: "/test/workspace",
		} as HistoryItem)
		await Promise.all([...increments, marker])

		// After 5 increments from a base of 0, tokensIn must be exactly 5
		// (no lost updates). The marker upsert preserved tokensIn (it didn't
		// pass it) and set task.
		expect(store.get(id)?.tokensIn).toBe(5)
		expect(store.get(id)?.task).toBe("marker-set")

		// Now delete must take the same per-ID lock and remove the record.
		await store.delete(id)
		expect(store.get(id)).toBeUndefined()
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" })
	})

	it("prevents lock-order deadlock: concurrent atomic updates on two IDs from two stores complete", async () => {
		// Two independent stores on the SAME path (simulating two windows).
		// Each performs atomic updates on both IDs. The lock order is always
		// per-ID → file, so even with two IDs and two stores there is no
		// circular wait. The cross-process file lock serializes the two
		// stores' accesses to the same file, so no increment is lost.
		const storeB = new TaskHistoryStore(tmpDir)
		await storeB.initialize()

		const idA = "deadlock-A"
		const idB = "deadlock-B"
		await store.upsert({ ...makeHistoryItem({ id: idA, ts: 1000 }), tokensIn: 0 })
		await store.upsert({ ...makeHistoryItem({ id: idB, ts: 1000 }), tokensIn: 0 })
		// Make sure storeB sees the seeded records on disk.
		await storeB.reconcile()

		const deadline = Promise.race([
			Promise.all([
				// Store A updates both IDs.
				store.atomicReadAndUpdate(idA, (c) => ({ ...c, tokensIn: c.tokensIn + 1 })),
				store.atomicReadAndUpdate(idB, (c) => ({ ...c, tokensIn: c.tokensIn + 1 })),
				// Store B updates both IDs in the opposite order.
				storeB.atomicReadAndUpdate(idB, (c) => ({ ...c, tokensIn: c.tokensIn + 1 })),
				storeB.atomicReadAndUpdate(idA, (c) => ({ ...c, tokensIn: c.tokensIn + 1 })),
			]).then(() => "completed"),
			new Promise<string>((resolve) => setTimeout(() => resolve("deadlocked"), 5000)),
		])

		const result = await deadline
		expect(result).toBe("completed")
		// Each ID was incremented twice (once per store); the file lock
		// serializes the read-modify-write so no increment is lost. Read the
		// authoritative on-disk value (either store's cache may be stale wrt
		// the other store's write).
		const onDiskA = JSON.parse(
			await fs.readFile(path.join(tmpDir, "tasks", idA, GlobalFileNames.historyItem), "utf8"),
		)
		const onDiskB = JSON.parse(
			await fs.readFile(path.join(tmpDir, "tasks", idB, GlobalFileNames.historyItem), "utf8"),
		)
		expect(onDiskA.tokensIn).toBe(2)
		expect(onDiskB.tokensIn).toBe(2)

		storeB.dispose()
	})

	it("delete on a never-existed ID under a real lock does not throw (lockfile handles missing target)", async () => {
		// The task dir doesn't exist; withRecordTransaction locks a stable
		// target outside it, then the body unlinks (ENOENT is swallowed).
		await expect(store.delete("ghost-id")).resolves.toBeUndefined()
		await expect(fs.access(path.join(tmpDir, "tasks", "ghost-id"))).rejects.toMatchObject({ code: "ENOENT" })
		// Reconcile must not resurrect it.
		await store.reconcile()
		expect(store.get("ghost-id")).toBeUndefined()
	})

	it("upsert then delete leaves no watcher leak (task dir watcher closed)", async () => {
		const id = "watcher-leak-task"
		await store.upsert(makeHistoryItem({ id }))
		// The per-task watcher should be armed.
		const watchersBefore = (store as unknown as { taskDirWatchers: Map<string, fsSync.FSWatcher> }).taskDirWatchers
		expect(watchersBefore.has(id)).toBe(true)

		await store.delete(id)
		// Remove the task directory to simulate full deletion (deleteTaskWithId
		// removes the dir). The periodic refresh closes the watcher for gone
		// dirs; trigger that synchronously by calling refreshTaskDirWatchers.
		await fs.rm(path.join(tmpDir, "tasks", id), { recursive: true, force: true })
		await (store as unknown as { refreshTaskDirWatchers: () => Promise<void> }).refreshTaskDirWatchers()

		expect(watchersBefore.has(id)).toBe(false)
	})

	it.runIf(process.platform !== "win32")("locked atomic writes preserve existing POSIX mode", async () => {
		const id = "locked-mode"
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await store.upsert(makeHistoryItem({ id, task: "Initial" }))
		await fs.chmod(filePath, 0o600)

		await store.upsert(makeHistoryItem({ id, task: "Updated" }))

		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600)
	})

	it.runIf(process.platform !== "win32")("locked atomic writes use umask-safe mode for a new file", async () => {
		const id = "locked-new-mode"
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)

		await store.upsert(makeHistoryItem({ id }))

		const mode = (await fs.stat(filePath)).mode & 0o777
		expect(mode).toBe(0o666 & ~process.umask())
	})
})
