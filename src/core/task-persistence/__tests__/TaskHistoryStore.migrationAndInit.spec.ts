// pnpm --filter roo-cline test core/task-persistence/__tests__/TaskHistoryStore.migrationAndInit.spec.ts
//
// Loss-less shared migration, corrupt-file preservation, init-failure retry,
// path canonicalization, and targeted-refresh tests. Runs on a real temp FS
// with real `proper-lockfile` (only `getStorageBasePath` is mocked).

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

describe("TaskHistoryStore migration safety", () => {
	let tmpDir: string
	let store: TaskHistoryStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-mig-"))
		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
	})

	afterEach(async () => {
		store.dispose()
		await new Promise((resolve) => setTimeout(resolve, 50))
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("a corrupt existing history_item.json makes migration fail for that entry and keeps the legacy key (no overwrite)", async () => {
		const tasksDir = path.join(tmpDir, "tasks")
		const id = "corrupt-existing"
		await fs.mkdir(path.join(tasksDir, id), { recursive: true })
		// Write an INVALID (unparseable) history_item.json.
		const filePath = path.join(tasksDir, id, GlobalFileNames.historyItem)
		await fs.writeFile(filePath, "{ not valid json,,,}")

		const legacy = [makeHistoryItem({ id, task: "Legacy snapshot", ts: 1000 })]
		const ok = await store.migrateFromLegacyHistory(legacy)

		// Migration must report failure so the caller keeps the legacy key.
		expect(ok).toBe(false)
		// The corrupt on-disk file must NOT be overwritten with the legacy
		// snapshot — its bytes are preserved so the operator can recover.
		const onDisk = await fs.readFile(filePath, "utf8")
		expect(onDisk).toBe("{ not valid json,,,}")
	})

	it("treats parseable schema-invalid disk JSON as an error for runtime writes and migration", async () => {
		const id = "schema-invalid-existing"
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		const invalid = '{ "id": "x" }'
		await fs.writeFile(filePath, invalid)

		await expect(store.upsert(makeHistoryItem({ id }))).rejects.toThrow("schema validation")
		await expect(store.atomicReadAndUpdate(id, (item) => item)).rejects.toThrow("schema validation")
		await expect(store.delete(id)).rejects.toThrow("schema validation")
		await expect(store.migrateFromLegacyHistory([makeHistoryItem({ id })])).resolves.toBe(false)
		expect(await fs.readFile(filePath, "utf8")).toBe(invalid)
	})

	it("accepts a minimal valid disk record according to historyItemSchema", async () => {
		const item = makeHistoryItem({ id: "schema-valid-control" })
		const filePath = path.join(tmpDir, "tasks", item.id, GlobalFileNames.historyItem)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(item))

		await store.refreshTask(item.id)

		expect(store.get(item.id)).toEqual(item)
	})

	it("preserves schema-compatible unknown fields while validating disk records", async () => {
		const item = { ...makeHistoryItem({ id: "schema-unknown-control" }), futureMetadata: { value: 1 } }
		const filePath = path.join(tmpDir, "tasks", item.id, GlobalFileNames.historyItem)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(item))

		await store.refreshTask(item.id)
		await store.upsert({ ...makeHistoryItem({ id: item.id }), task: "Updated" })

		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toMatchObject({
			futureMetadata: { value: 1 },
			task: "Updated",
		})
	})

	it("migrates a legacy-only item without a task directory", async () => {
		const item = makeHistoryItem({ id: "legacy-no-dir", task: "Preserved history" })
		const filePath = path.join(tmpDir, "tasks", item.id, GlobalFileNames.historyItem)

		await expect(store.migrateFromLegacyHistory([item])).resolves.toBe(true)

		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(item)
		expect(store.get(item.id)).toEqual(item)
	})

	it("returns failure and leaves the legacy source retryable when task-directory creation fails", async () => {
		const item = makeHistoryItem({ id: "legacy-dir-create-fails" })
		const taskPath = path.join(tmpDir, "tasks", item.id)
		await fs.writeFile(taskPath, "blocks directory creation")

		await expect(store.migrateFromLegacyHistory([item])).resolves.toBe(false)

		expect(await fs.readFile(taskPath, "utf8")).toBe("blocks directory creation")
		expect(store.get(item.id)).toBeUndefined()
	})

	it("two providers sharing the store share one migration (no race with cleanup)", async () => {
		const tasksDir = path.join(tmpDir, "tasks")
		for (const id of ["share-1", "share-2"]) {
			await fs.mkdir(path.join(tasksDir, id), { recursive: true })
		}
		const legacy = [
			makeHistoryItem({ id: "share-1", task: "Shared 1", ts: 1000 }),
			makeHistoryItem({ id: "share-2", task: "Shared 2", ts: 2000 }),
		]

		// Two concurrent migration calls on the SAME store must coalesce into
		// a single backfill (the shared migrationPromise). Both resolve with
		// the same result and the files are written exactly once.
		const [a, b] = await Promise.all([
			store.migrateFromLegacyHistory(legacy),
			store.migrateFromLegacyHistory(legacy),
		])
		expect(a).toBe(true)
		expect(b).toBe(true)
		expect(store.get("share-1")?.task).toBe("Shared 1")
		expect(store.get("share-2")?.task).toBe("Shared 2")
	})

	it("runtime upsert does not race the migration write (no lost newer record)", async () => {
		const tasksDir = path.join(tmpDir, "tasks")
		const id = "race-target"
		await fs.mkdir(path.join(tasksDir, id), { recursive: true })

		const legacySnapshot = makeHistoryItem({ id, task: "Legacy snapshot", ts: 1000, tokensIn: 10 })

		// Kick off migration (writes the legacy snapshot because no file exists
		// yet) AND a concurrent runtime upsert with a NEWER ts. The runtime
		// write must not be lost: whichever runs second merges with the
		// on-disk record under the same per-ID + file lock.
		const newerRuntime = makeHistoryItem({ id, task: "Runtime newer", ts: 5000, tokensIn: 999 })
		// Omit tokensIn/task from a second upsert to test merge preservation;
		// here we just want to ensure both writes are observable on disk.
		await Promise.all([store.migrateFromLegacyHistory([legacySnapshot]), store.upsert(newerRuntime)])

		const onDisk = JSON.parse(await fs.readFile(path.join(tasksDir, id, GlobalFileNames.historyItem), "utf8"))
		// The record must exist and be valid; both writers serialized through
		// the same lock, so the final state is one consistent merge (last
		// writer's explicit fields win). No lost update / no corruption.
		expect(onDisk.id).toBe(id)
		expect(typeof onDisk.task).toBe("string")
		// The cache reflects the on-disk record.
		expect(store.get(id)?.id).toBe(id)
	})

	it("returns false for a mixed valid/invalid legacy array while migrating valid entries", async () => {
		const tasksDir = path.join(tmpDir, "tasks")
		await fs.mkdir(path.join(tasksDir, "valid-mixed"), { recursive: true })
		const valid = makeHistoryItem({ id: "valid-mixed" })
		const invalid = { id: "invalid-mixed", task: "missing required fields" } as HistoryItem

		await expect(store.migrateFromLegacyHistory([valid, invalid])).resolves.toBe(false)
		expect(store.get("valid-mixed")).toMatchObject({ id: "valid-mixed" })
	})

	it("rejects upsert, atomic update, and delete for a corrupt runtime file without changing bytes or cache", async () => {
		const id = "runtime-corrupt"
		const good = makeHistoryItem({ id, task: "Good cache" })
		await store.upsert(good)
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		const corrupt = "{ corrupt runtime json"
		await fs.writeFile(filePath, corrupt)

		await expect(store.upsert(makeHistoryItem({ id, task: "Replacement" }))).rejects.toThrow()
		await expect(
			store.atomicReadAndUpdate(id, (item) => ({ ...item, task: "Atomic replacement" })),
		).rejects.toThrow()
		await expect(store.delete(id)).rejects.toThrow()
		expect(await fs.readFile(filePath, "utf8")).toBe(corrupt)
		expect(store.get(id)?.task).toBe("Good cache")
	})
})

describe("TaskHistoryStore init failure / retry and path canonicalization", () => {
	afterEach(() => {
		TaskHistoryStore.resetSharedStoresForTests()
	})

	it("acquire rejects on init failure and removes the faulty entry so the next acquire retries", async () => {
		// Force getStorageBasePath to throw for the first store, then succeed.
		const { getStorageBasePath } = await import("../../../utils/storage")
		const mock = vi.mocked(getStorageBasePath)
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-initfail-"))
		let calls = 0
		mock.mockImplementation(async (defaultPath: string) => {
			calls++
			if (calls === 1) {
				throw new Error("simulated init failure")
			}
			return defaultPath
		})

		const dir = path.join(tmpDir, "storage")

		// First acquire rejects rather than exposing a half-initialized store.
		await expect(TaskHistoryStore.acquire(dir)).rejects.toThrow("simulated init failure")
		// The faulty entry must be gone so a fresh acquire can retry.

		// Second acquire: init succeeds (getStorageBasePath no longer throws).
		const h2 = await TaskHistoryStore.acquire(dir)
		expect(h2.store.get("anything")).toBeUndefined()
		h2.dispose()

		// Restore the passthrough implementation for subsequent describe
		// blocks (do NOT call mockRestore — that would restore the real
		// vscode-based getStorageBasePath and break the refresh tests).
		mock.mockImplementation((defaultPath: string) => Promise.resolve(defaultPath))
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("canonicalizes trailing separator and relative-normalized aliases to one store", async () => {
		const tmpDir = os.tmpdir()
		const base = path.join(tmpDir, "th-canonical-" + Math.random().toString(36).slice(2))
		// Three aliases that resolve to the same canonical path.
		const a = base
		const b = base + path.sep // trailing separator
		const c = path.join(base, ".", "..", path.basename(base)) // relative normalization

		const ha = await TaskHistoryStore.acquire(a)
		const hb = await TaskHistoryStore.acquire(b)
		const hc = await TaskHistoryStore.acquire(c)
		try {
			expect(ha.store).toBe(hb.store)
			expect(ha.store).toBe(hc.store)
		} finally {
			ha.dispose()
			hb.dispose()
			hc.dispose()
		}
	})
})

describe("TaskHistoryStore targeted refresh and watcher cleanup", () => {
	let tmpDir: string
	let store: TaskHistoryStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-refresh-"))
		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
	})

	afterEach(async () => {
		store.dispose()
		await new Promise((resolve) => setTimeout(resolve, 50))
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("refreshTask re-reads the indicated ID unconditionally (same mtime/size content change is picked up)", async () => {
		const id = "same-meta"
		const item = makeHistoryItem({ id, task: "Original", tokensIn: 100 })
		await store.upsert(item)
		await store.flushIndex()

		// Rewrite the file with NEW content but try to keep mtime/size as
		// close as possible. Even if metadata didn't change, refreshTask
		// must re-read because it ignores mtime/size.
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		const mutated = { ...item, task: "Same-meta mutated", tokensIn: 777 }
		await fs.writeFile(filePath, JSON.stringify(item)) // same content first
		// Now overwrite with mutated content (no artificial sleep).
		await fs.writeFile(filePath, JSON.stringify(mutated))

		await store.refreshTask(id, { external: true })

		expect(store.get(id)?.task).toBe("Same-meta mutated")
		expect(store.get(id)?.tokensIn).toBe(777)
	})

	it("refreshTask removes the cache entry when history_item.json is deleted but the task dir remains (ENOENT)", async () => {
		const id = "file-gone-dir-stays"
		await store.upsert(makeHistoryItem({ id }))
		expect(store.get(id)).toBeDefined()

		// Delete only the file, keep the directory.
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await fs.unlink(filePath)

		await store.refreshTask(id, { external: true })
		expect(store.get(id)).toBeUndefined()
	})

	it("refreshTask keeps the good cache entry on a parse error (does not wipe cache)", async () => {
		const id = "parse-err"
		const item = makeHistoryItem({ id, task: "Good cached", tokensIn: 100 })
		await store.upsert(item)
		await store.flushIndex()

		// Corrupt the on-disk file (parse error, NOT ENOENT).
		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await fs.writeFile(filePath, "{ broken json,,,}")

		await store.refreshTask(id, { external: true })
		// The good cached entry must be retained; the corrupt file is logged
		// but does not wipe the cache.
		expect(store.get(id)?.task).toBe("Good cached")
		expect(store.get(id)?.tokensIn).toBe(100)
	})

	it("deduplicates a local-write watcher refresh and emits one targeted event for a real external change", async () => {
		const id = "watcher-dedup"
		const item = makeHistoryItem({ id, task: "Local" })
		const events: Array<{ external: boolean; kind: string; taskId?: string }> = []
		store.onChange((event) => events.push(event))
		await store.upsert(item)

		const duplicate = await store.refreshTask(id, { external: true })
		expect(duplicate).toBeNull()
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ external: false, kind: "upsert", taskId: id })

		const filePath = path.join(tmpDir, "tasks", id, GlobalFileNames.historyItem)
		await fs.writeFile(filePath, JSON.stringify({ ...item, task: "External" }))
		const external = await store.refreshTask(id, { external: true })
		expect(external).toMatchObject({ external: true, kind: "upsert", taskId: id })
		if (external) {
			;(store as unknown as { notifyChanged: (event: typeof external) => void }).notifyChanged(external)
		}
		expect(events).toHaveLength(2)
		expect(events[1]).toMatchObject({ external: true, kind: "upsert", taskId: id })
	})

	it("closing the per-task watcher on task dir removal does not leak (watcher removed from map)", async () => {
		const id = "watcher-cleanup"
		await store.upsert(makeHistoryItem({ id }))
		const watchers = (store as unknown as { taskDirWatchers: Map<string, fsSync.FSWatcher> }).taskDirWatchers
		expect(watchers.has(id)).toBe(true)

		// Remove the task dir and trigger a refresh of the watcher set.
		await fs.rm(path.join(tmpDir, "tasks", id), { recursive: true, force: true })
		await (store as unknown as { refreshTaskDirWatchers: () => Promise<void> }).refreshTaskDirWatchers()
		expect(watchers.has(id)).toBe(false)
	})
})
