// pnpm --filter roo-cline test core/task-persistence/__tests__/TaskHistoryStore.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import type { HistoryItem } from "@roo-code/types"

import { TaskHistoryStore } from "../TaskHistoryStore"
import { GlobalFileNames } from "../../../shared/globalFileNames"

vi.mock("../../../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

// Mock safeWriteJson to use plain fs writes in tests (avoids proper-lockfile issues)
vi.mock("../../../utils/safeWriteJson", () => {
	const write = vi.fn().mockImplementation(async (filePath: string, data: any) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"), "utf8")
	})
	return {
		safeWriteJson: write,
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: any) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

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

describe("TaskHistoryStore", () => {
	let tmpDir: string
	let store: TaskHistoryStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-test-"))
		store = new TaskHistoryStore(tmpDir)
	})

	afterEach(async () => {
		store.dispose()
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	describe("initialize()", () => {
		it("initializes from empty state (no index, no task dirs)", async () => {
			await store.initialize()
			expect(store.getAll()).toEqual([])
		})

		it("initializes from existing index file", async () => {
			const tasksDir = path.join(tmpDir, "tasks")
			await fs.mkdir(tasksDir, { recursive: true })

			const item1 = makeHistoryItem({ id: "task-1", ts: 1000 })
			const item2 = makeHistoryItem({ id: "task-2", ts: 2000 })

			// Create task directories so reconciliation doesn't remove them
			await fs.mkdir(path.join(tasksDir, "task-1"), { recursive: true })
			await fs.mkdir(path.join(tasksDir, "task-2"), { recursive: true })

			// Write per-task files
			await fs.writeFile(path.join(tasksDir, "task-1", GlobalFileNames.historyItem), JSON.stringify(item1))
			await fs.writeFile(path.join(tasksDir, "task-2", GlobalFileNames.historyItem), JSON.stringify(item2))

			// Write index
			const index = {
				version: 1,
				updatedAt: Date.now(),
				entries: [item1, item2],
			}
			await fs.writeFile(path.join(tasksDir, GlobalFileNames.historyIndex), JSON.stringify(index))

			await store.initialize()

			expect(store.getAll()).toHaveLength(2)
			expect(store.get("task-1")).toBeDefined()
			expect(store.get("task-2")).toBeDefined()
		})
	})

	describe("get()", () => {
		it("returns undefined for non-existent task", async () => {
			await store.initialize()
			expect(store.get("non-existent")).toBeUndefined()
		})

		it("returns the item after upsert", async () => {
			await store.initialize()
			const item = makeHistoryItem({ id: "task-get" })
			await store.upsert(item)
			expect(store.get("task-get")).toMatchObject({ id: "task-get" })
		})
	})

	describe("getAll()", () => {
		it("returns items sorted by ts descending", async () => {
			await store.initialize()

			await store.upsert(makeHistoryItem({ id: "old", ts: 1000 }))
			await store.upsert(makeHistoryItem({ id: "mid", ts: 2000 }))
			await store.upsert(makeHistoryItem({ id: "new", ts: 3000 }))

			const all = store.getAll()
			expect(all).toHaveLength(3)
			expect(all[0].id).toBe("new")
			expect(all[1].id).toBe("mid")
			expect(all[2].id).toBe("old")
		})
	})

	describe("getByWorkspace()", () => {
		it("filters by workspace path", async () => {
			await store.initialize()

			await store.upsert(makeHistoryItem({ id: "ws-a-1", workspace: "/workspace-a" }))
			await store.upsert(makeHistoryItem({ id: "ws-a-2", workspace: "/workspace-a" }))
			await store.upsert(makeHistoryItem({ id: "ws-b-1", workspace: "/workspace-b" }))

			const wsA = store.getByWorkspace("/workspace-a")
			expect(wsA).toHaveLength(2)
			expect(wsA.every((item) => item.workspace === "/workspace-a")).toBe(true)

			const wsB = store.getByWorkspace("/workspace-b")
			expect(wsB).toHaveLength(1)
			expect(wsB[0].id).toBe("ws-b-1")
		})
	})

	describe("upsert()", () => {
		it("writes per-task file and updates cache (returns void)", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "upsert-task" })
			const result = await store.upsert(item)

			// New contract: upsert returns void (no full-history copy/sort)
			expect(result).toBeUndefined()

			// Cache should be updated
			expect(store.get("upsert-task")).toBeDefined()
			expect(store.getAll()).toHaveLength(1)

			// Per-task file should exist
			const filePath = path.join(tmpDir, "tasks", "upsert-task", GlobalFileNames.historyItem)
			const raw = await fs.readFile(filePath, "utf8")
			const written = JSON.parse(raw)
			expect(written.id).toBe("upsert-task")
		})

		it("preserves existing metadata on partial updates (delegation fields)", async () => {
			await store.initialize()

			const original = makeHistoryItem({
				id: "delegate-task",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: ["child-1"],
			})
			await store.upsert(original)

			// Partial update that doesn't include delegation fields
			const partialUpdate: HistoryItem = makeHistoryItem({
				id: "delegate-task",
				tokensIn: 500,
				tokensOut: 200,
			})
			await store.upsert(partialUpdate)

			const result = store.get("delegate-task")!
			expect(result.status).toBe("delegated")
			expect(result.delegatedToId).toBe("child-1")
			expect(result.awaitingChildId).toBe("child-1")
			expect(result.childIds).toEqual(["child-1"])
			expect(result.tokensIn).toBe(500)
			expect(result.tokensOut).toBe(200)
		})

		it("does not return the full history (callers use getAll)", async () => {
			await store.initialize()

			const item1 = makeHistoryItem({ id: "item-1", ts: 1000 })
			const item2 = makeHistoryItem({ id: "item-2", ts: 2000 })

			await store.upsert(item1)
			const result = await store.upsert(item2)

			// void contract — callers that need history call getAll()
			expect(result).toBeUndefined()

			const all = store.getAll()
			expect(all).toHaveLength(2)
			// getAll() still sorts by ts descending
			expect(all[0].id).toBe("item-2")
			expect(all[1].id).toBe("item-1")
		})
	})

	describe("delete()", () => {
		it("removes per-task file and updates cache", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "del-task" })
			await store.upsert(item)
			expect(store.get("del-task")).toBeDefined()

			await store.delete("del-task")
			expect(store.get("del-task")).toBeUndefined()
			expect(store.getAll()).toHaveLength(0)
		})

		it("handles deleting non-existent task gracefully", async () => {
			await store.initialize()
			await expect(store.delete("non-existent")).resolves.not.toThrow()
			await expect(fs.access(path.join(tmpDir, "tasks", "non-existent"))).rejects.toMatchObject({
				code: "ENOENT",
			})
		})
	})

	describe("deleteMany()", () => {
		it("removes multiple tasks in batch", async () => {
			await store.initialize()

			await store.upsert(makeHistoryItem({ id: "batch-1" }))
			await store.upsert(makeHistoryItem({ id: "batch-2" }))
			await store.upsert(makeHistoryItem({ id: "batch-3" }))
			expect(store.getAll()).toHaveLength(3)

			await store.deleteMany(["batch-1", "batch-3"])
			expect(store.getAll()).toHaveLength(1)
			expect(store.get("batch-2")).toBeDefined()
		})
	})

	describe("reconcile()", () => {
		it("detects tasks on disk missing from index", async () => {
			await store.initialize()

			// Manually create a task directory with history_item.json
			const tasksDir = path.join(tmpDir, "tasks")
			const taskDir = path.join(tasksDir, "orphan-task")
			await fs.mkdir(taskDir, { recursive: true })

			const item = makeHistoryItem({ id: "orphan-task" })
			await fs.writeFile(path.join(taskDir, GlobalFileNames.historyItem), JSON.stringify(item))

			// Reconcile should pick it up
			await store.reconcile()

			expect(store.get("orphan-task")).toBeDefined()
			expect(store.get("orphan-task")!.id).toBe("orphan-task")
		})

		it("removes tasks from cache that no longer exist on disk", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "removed-task" })
			await store.upsert(item)
			expect(store.get("removed-task")).toBeDefined()

			// Remove the task directory from disk
			const taskDir = path.join(tmpDir, "tasks", "removed-task")
			await fs.rm(taskDir, { recursive: true, force: true })

			// Reconcile should remove it from cache
			await store.reconcile()

			expect(store.get("removed-task")).toBeUndefined()
		})
	})

	describe("concurrent upsert() calls are serialized", () => {
		it("serializes concurrent writes so no entries are lost", async () => {
			await store.initialize()

			// Fire 5 concurrent upserts
			const promises = Array.from({ length: 5 }, (_, i) =>
				store.upsert(makeHistoryItem({ id: `concurrent-${i}`, ts: 1000 + i })),
			)

			await Promise.all(promises)

			const all = store.getAll()
			expect(all).toHaveLength(5)
			const ids = all.map((h) => h.id)
			for (let i = 0; i < 5; i++) {
				expect(ids).toContain(`concurrent-${i}`)
			}
		})

		it("serializes interleaved upsert and delete", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "interleave-test", ts: 1000 })
			await store.upsert(item)

			// Concurrent update and delete of different items
			const promise1 = store.upsert(makeHistoryItem({ id: "survivor", ts: 2000 }))
			const promise2 = store.delete("interleave-test")

			await Promise.all([promise1, promise2])

			expect(store.get("interleave-test")).toBeUndefined()
			expect(store.get("survivor")).toBeDefined()
		})
	})

	describe("flushIndex()", () => {
		it("writes index to disk on flush", async () => {
			await store.initialize()

			await store.upsert(makeHistoryItem({ id: "flush-task" }))
			await store.flushIndex()

			const indexPath = path.join(tmpDir, "tasks", GlobalFileNames.historyIndex)
			const raw = await fs.readFile(indexPath, "utf8")
			const index = JSON.parse(raw)

			expect(index.version).toBe(1)
			expect(index.entries).toHaveLength(1)
			expect(index.entries[0].id).toBe("flush-task")
		})
	})

	describe("dispose()", () => {
		it("flushes index on dispose", async () => {
			await store.initialize()

			await store.upsert(makeHistoryItem({ id: "dispose-task" }))
			store.dispose()

			// Give the flush a moment to complete
			await new Promise((resolve) => setTimeout(resolve, 100))

			const indexPath = path.join(tmpDir, "tasks", GlobalFileNames.historyIndex)
			const raw = await fs.readFile(indexPath, "utf8")
			const index = JSON.parse(raw)
			expect(index.entries).toHaveLength(1)
		})
	})

	describe("invalidate()", () => {
		it("re-reads a task from disk", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "invalidate-task", tokensIn: 100 })
			await store.upsert(item)

			// Manually update the file on disk
			const filePath = path.join(tmpDir, "tasks", "invalidate-task", GlobalFileNames.historyItem)
			const updated = { ...item, tokensIn: 999 }
			await fs.writeFile(filePath, JSON.stringify(updated))

			await store.invalidate("invalidate-task")

			expect(store.get("invalidate-task")!.tokensIn).toBe(999)
		})

		it("removes item from cache if file no longer exists", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "gone-task" })
			await store.upsert(item)

			// Delete the file
			const filePath = path.join(tmpDir, "tasks", "gone-task", GlobalFileNames.historyItem)
			await fs.unlink(filePath)

			await store.invalidate("gone-task")

			expect(store.get("gone-task")).toBeUndefined()
		})
	})

	describe("migrateFromLegacyHistory()", () => {
		it("backfills legacy entries into per-task files", async () => {
			await store.initialize()

			// Simulate pre-existing task directories (created by past runs)
			const tasksDir = path.join(tmpDir, "tasks")
			for (const id of ["legacy-1", "legacy-2"]) {
				await fs.mkdir(path.join(tasksDir, id), { recursive: true })
			}

			const legacy: HistoryItem[] = [
				makeHistoryItem({ id: "legacy-1", task: "Legacy 1", ts: 1000 }),
				makeHistoryItem({ id: "legacy-2", task: "Legacy 2", ts: 2000 }),
				// No task directory on disk -> migration creates it and preserves history
				makeHistoryItem({ id: "orphan-no-dir", task: "Orphan", ts: 3000 }),
			]

			const ok = await store.migrateFromLegacyHistory(legacy)
			expect(ok).toBe(true)

			expect(store.get("legacy-1")?.task).toBe("Legacy 1")
			expect(store.get("legacy-2")?.task).toBe("Legacy 2")
			expect(store.get("orphan-no-dir")?.task).toBe("Orphan")

			// Per-task files written
			for (const id of ["legacy-1", "legacy-2", "orphan-no-dir"]) {
				const raw = await fs.readFile(path.join(tasksDir, id, GlobalFileNames.historyItem), "utf8")
				expect(JSON.parse(raw).id).toBe(id)
			}
		})

		it("is idempotent: a second run does not overwrite newer per-task files", async () => {
			await store.initialize()

			const tasksDir = path.join(tmpDir, "tasks")
			await fs.mkdir(path.join(tasksDir, "legacy-id"), { recursive: true })

			// First migration writes the legacy snapshot
			const legacySnapshot = makeHistoryItem({ id: "legacy-id", task: "Legacy snapshot", ts: 1000, tokensIn: 10 })
			await store.migrateFromLegacyHistory([legacySnapshot])

			// A newer per-task record is now on disk (e.g. from a real run)
			const newer = { ...legacySnapshot, task: "Newer on-disk record", tokensIn: 999, ts: 5000 }
			await fs.writeFile(path.join(tasksDir, "legacy-id", GlobalFileNames.historyItem), JSON.stringify(newer))

			// Second migration with the SAME stale legacy snapshot must NOT overwrite
			const ok = await store.migrateFromLegacyHistory([legacySnapshot])
			expect(ok).toBe(true)

			const onDisk = JSON.parse(
				await fs.readFile(path.join(tasksDir, "legacy-id", GlobalFileNames.historyItem), "utf8"),
			)
			expect(onDisk.task).toBe("Newer on-disk record")
			expect(onDisk.tokensIn).toBe(999)
			// Cache reflects the on-disk record, not the stale snapshot
			expect(store.get("legacy-id")?.task).toBe("Newer on-disk record")
			expect(store.get("legacy-id")?.tokensIn).toBe(999)
		})

		it("resumes a partial migration without clobbering already-migrated records", async () => {
			await store.initialize()

			const tasksDir = path.join(tmpDir, "tasks")
			await fs.mkdir(path.join(tasksDir, "partial-1"), { recursive: true })
			await fs.mkdir(path.join(tasksDir, "partial-2"), { recursive: true })

			// partial-1 already migrated (file exists)
			const already = makeHistoryItem({ id: "partial-1", task: "Already migrated", ts: 1000 })
			await fs.writeFile(path.join(tasksDir, "partial-1", GlobalFileNames.historyItem), JSON.stringify(already))

			const legacy: HistoryItem[] = [
				already,
				makeHistoryItem({ id: "partial-2", task: "Pending migration", ts: 2000 }),
			]

			const ok = await store.migrateFromLegacyHistory(legacy)
			expect(ok).toBe(true)

			// partial-1 untouched
			expect(
				JSON.parse(await fs.readFile(path.join(tasksDir, "partial-1", GlobalFileNames.historyItem), "utf8"))
					.task,
			).toBe("Already migrated")
			// partial-2 now migrated
			expect(store.get("partial-2")?.task).toBe("Pending migration")
		})

		it("returns false and leaves data on disk when a write fails (no cleanup)", async () => {
			await store.initialize()

			const tasksDir = path.join(tmpDir, "tasks")
			await fs.mkdir(path.join(tasksDir, "fail-target"), { recursive: true })

			// Force safeWriteJson to fail for the target file
			const { safeWriteJson } = await import("../../../utils/safeWriteJson")
			const mock = vi.mocked(safeWriteJson)
			mock.mockImplementationOnce(async (filePath: string) => {
				if (filePath.endsWith(GlobalFileNames.historyItem)) {
					throw new Error("disk full")
				}
			})

			const legacy = [makeHistoryItem({ id: "fail-target", task: "Failing", ts: 1000 })]
			const ok = await store.migrateFromLegacyHistory(legacy)

			expect(ok).toBe(false)
			// Task directory still exists — caller (ContextProxy) keeps the
			// legacy key so the next start can retry.
			await expect(fs.access(path.join(tasksDir, "fail-target"))).resolves.toBeUndefined()
		})

		it("is a no-op for an empty legacy array", async () => {
			await store.initialize()
			const ok = await store.migrateFromLegacyHistory([])
			expect(ok).toBe(true)
			expect(store.getAll()).toEqual([])
		})
	})

	describe("reconcile() detects modifications to existing records", () => {
		it("picks up an external mutation to an existing history_item.json without manual invalidate()", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "mutate-me", tokensIn: 100, ts: 1000 })
			await store.upsert(item)
			await store.flushIndex()

			// Externally rewrite the file (simulating another process/instance)
			const filePath = path.join(tmpDir, "tasks", "mutate-me", GlobalFileNames.historyItem)
			// Bump mtime by writing with a small delay so mtimeMs differs
			await new Promise((resolve) => setTimeout(resolve, 20))
			const mutated = { ...item, tokensIn: 777, task: "Externally mutated" }
			await fs.writeFile(filePath, JSON.stringify(mutated))

			// reconcile() must detect the mtime/size change and re-read
			await store.reconcile()

			expect(store.get("mutate-me")?.tokensIn).toBe(777)
			expect(store.get("mutate-me")?.task).toBe("Externally mutated")
		})

		it("does not re-read unchanged files (cheap metadata check)", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "stable", tokensIn: 100 })
			await store.upsert(item)
			await store.flushIndex()

			// Spy on the store's private readTaskFileResult — the only path
			// that re-reads a task's history_item.json during reconcile (via
			// refreshTask). readTaskFile is a legacy wrapper that is no
			// longer on the reconcile path.
			const readTaskFileResult = vi.spyOn(
				store as unknown as {
					readTaskFileResult: (
						filePath: string,
					) => Promise<
						| { status: "ok"; item: HistoryItem }
						| { status: "missing" }
						| { status: "error"; error: unknown }
					>
				},
				"readTaskFileResult",
			)

			// First reconcile after upsert: metadata is fresh, no re-read expected
			await store.reconcile()
			expect(readTaskFileResult).not.toHaveBeenCalled()

			// Touch the file (rewrite with new mtime) so metadata changes
			const filePath = path.join(tmpDir, "tasks", "stable", GlobalFileNames.historyItem)
			await new Promise((resolve) => setTimeout(resolve, 20))
			await fs.writeFile(filePath, JSON.stringify({ ...item, tokensIn: 100 }))

			readTaskFileResult.mockClear()
			await store.reconcile()
			// Now mtime changed so the file is re-read once (refreshTask →
			// readTaskFileResult).
			expect(readTaskFileResult).toHaveBeenCalledTimes(1)

			readTaskFileResult.mockRestore()
		})
	})

	describe("atomicReadAndUpdate()", () => {
		it("reads, applies, and writes under a file lock (no stale cache)", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "armu-task", tokensIn: 100, task: "Original" })
			await store.upsert(item)
			await store.flushIndex()

			const updated = await store.atomicReadAndUpdate("armu-task", (current) => ({
				...current,
				tokensIn: current.tokensIn + 50,
				task: "Updated",
			}))

			expect(updated.tokensIn).toBe(150)
			expect(updated.task).toBe("Updated")
			// Cache mirrors the on-disk write
			expect(store.get("armu-task")?.tokensIn).toBe(150)

			// On-disk file reflects the locked write
			const onDisk = JSON.parse(
				await fs.readFile(path.join(tmpDir, "tasks", "armu-task", GlobalFileNames.historyItem), "utf8"),
			)
			expect(onDisk.tokensIn).toBe(150)
		})

		it("reads the on-disk record (not a stale cache) when an external mutation happened", async () => {
			await store.initialize()

			const item = makeHistoryItem({ id: "stale-cache", tokensIn: 100, task: "Original" })
			await store.upsert(item)
			await store.flushIndex()

			// Externally rewrite the file with a newer value the cache hasn't seen
			const filePath = path.join(tmpDir, "tasks", "stale-cache", GlobalFileNames.historyItem)
			await new Promise((resolve) => setTimeout(resolve, 20))
			const externallyNewer = { ...item, tokensIn: 999, task: "Externally newer" }
			await fs.writeFile(filePath, JSON.stringify(externallyNewer))

			// atomicReadAndUpdate must read on-disk under the lock, not the
			// stale cache (which still says tokensIn: 100)
			const updated = await store.atomicReadAndUpdate("stale-cache", (current) => ({
				...current,
				tokensIn: current.tokensIn + 1,
			}))

			expect(updated.tokensIn).toBe(1000)
			expect(updated.task).toBe("Externally newer")
		})

		it("rejects an updater that changes the task id", async () => {
			await store.initialize()
			const item = makeHistoryItem({ id: "id-stable" })
			await store.upsert(item)

			await expect(
				store.atomicReadAndUpdate("id-stable", (current) => ({ ...current, id: "id-changed" })),
			).rejects.toThrow(/changed task id/)
		})

		it("serializes concurrent updates to the same id (last writer wins, no lost update)", async () => {
			await store.initialize()
			const item = makeHistoryItem({ id: "concurrent-armu", ts: 1000 })
			// Use tokensIn as the counter field to avoid schema issues
			await store.upsert({ ...item, tokensIn: 0 })

			// Five concurrent increments must produce 5 (no lost updates)
			const updates = Array.from({ length: 5 }, () =>
				store.atomicReadAndUpdate("concurrent-armu", (current) => ({
					...current,
					tokensIn: current.tokensIn + 1,
				})),
			)
			await Promise.all(updates)

			expect(store.get("concurrent-armu")?.tokensIn).toBe(5)
		})
	})

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

	describe("shared lifecycle (acquire/dispose)", () => {
		afterEach(() => {
			TaskHistoryStore.resetSharedStoresForTests()
		})

		it("returns the same store instance for the same storage path", async () => {
			const a = await TaskHistoryStore.acquire(tmpDir)
			const b = await TaskHistoryStore.acquire(tmpDir)
			expect(a.store).toBe(b.store)
			a.dispose()
			b.dispose()
		})

		it("returns distinct stores for distinct storage paths", async () => {
			const a = await TaskHistoryStore.acquire(tmpDir)
			const b = await TaskHistoryStore.acquire(tmpDir + "-other")
			expect(a.store).not.toBe(b.store)
			a.dispose()
			b.dispose()
		})

		it("returns distinct stores for distinct contexts on the same path", async () => {
			const a = await TaskHistoryStore.acquire(tmpDir, { context: "ctx-a" })
			const b = await TaskHistoryStore.acquire(tmpDir, { context: "ctx-b" })
			expect(a.store).not.toBe(b.store)
			a.dispose()
			b.dispose()
		})

		it("keeps the store alive until the last consumer disposes", async () => {
			const a = await TaskHistoryStore.acquire(tmpDir)
			const b = await TaskHistoryStore.acquire(tmpDir)
			const store = a.store

			// Dispose one consumer — the store must still be usable by the other
			a.dispose()
			await store.upsert(makeHistoryItem({ id: "after-a-dispose" }))
			expect(store.get("after-a-dispose")).toBeDefined()

			// Final dispose tears down the store
			b.dispose()
			// After final dispose, acquiring again yields a fresh store
			const c = await TaskHistoryStore.acquire(tmpDir)
			expect(c.store).not.toBe(store)
			c.dispose()
		})

		it("notifies subscribers on upsert (local) and dispose unsubscribes", async () => {
			const handle = await TaskHistoryStore.acquire(tmpDir)
			const store = handle.store
			await store.initialized

			let calls = 0
			let lastExternal: boolean | undefined
			let lastKind: string | undefined
			const unsub = store.onChange((event) => {
				calls++
				lastExternal = event.external
				lastKind = event.kind
			})

			await store.upsert(makeHistoryItem({ id: "sub-task" }))
			expect(calls).toBeGreaterThanOrEqual(1)
			// Local mutations report external=false and kind="upsert" so
			// consumers can skip a redundant full-history broadcast for
			// their own writes and push a targeted update instead.
			expect(lastExternal).toBe(false)
			expect(lastKind).toBe("upsert")

			unsub()
			await store.upsert(makeHistoryItem({ id: "sub-task-2" }))
			expect(calls).toBe(1) // no new calls after unsubscribe

			handle.dispose()
		})

		it("notifies subscribers with external=true on reconcile-detected changes", async () => {
			const handle = await TaskHistoryStore.acquire(tmpDir)
			const store = handle.store
			await store.initialized

			// Seed a task so the cache has something to compare against.
			const item = makeHistoryItem({ id: "ext-change", tokensIn: 100 })
			await store.upsert(item)
			await store.flushIndex()

			let externalFlag: boolean | undefined
			let lastKind: string | undefined
			const unsub = store.onChange((event) => {
				externalFlag = event.external
				lastKind = event.kind
			})

			// Externally rewrite the file so reconcile detects the mtime change.
			const filePath = path.join(tmpDir, "tasks", "ext-change", GlobalFileNames.historyItem)
			await new Promise((resolve) => setTimeout(resolve, 20))
			await fs.writeFile(filePath, JSON.stringify({ ...item, tokensIn: 999 }))

			await store.reconcile()

			expect(externalFlag).toBe(true)
			// Reconcile re-reads an existing record -> upsert event.
			expect(lastKind).toBe("upsert")
			expect(store.get("ext-change")?.tokensIn).toBe(999)

			unsub()
			handle.dispose()
		})

		it("closing one consumer does not break the other's store", async () => {
			const a = await TaskHistoryStore.acquire(tmpDir)
			const b = await TaskHistoryStore.acquire(tmpDir)
			const store = a.store

			a.dispose()

			// b's store (same instance) must still accept writes
			await b.store.upsert(makeHistoryItem({ id: "survivor" }))
			expect(store.get("survivor")).toBeDefined()

			b.dispose()
		})
	})
})
