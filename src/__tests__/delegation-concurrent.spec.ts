// npx vitest run __tests__/delegation-concurrent.spec.ts
//
// Verifies the in-process serialization contract of
// `TaskHistoryStore.atomicReadAndUpdate`: two concurrent updaters on the same
// task ID must not lose updates, and the pure updater must not re-enter the
// lock (no deadlock). The cross-process `proper-lockfile` behavior is covered
// separately by the real-FS suite in
// `core/task-persistence/__tests__/TaskHistoryStore.spec.ts`; here we mock the
// filesystem and lockfile to focus on the in-process per-ID lock ordering.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { HistoryItem } from "@roo-code/types"

// In-memory backing store so atomicReadAndUpdate's "read from disk under lock"
// contract can be exercised without a real filesystem. Keyed by absolute file
// path.
const backingFiles = new Map<string, string>()

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	// Read returns the seeded JSON for the requested path, or rejects with
	// ENOENT when the file was never written — mirroring real fs semantics so
	// atomicReadAndUpdate's "read failed" branch is reachable when a task is
	// genuinely absent.
	readFile: vi.fn(async (filePath: string) => {
		const raw = backingFiles.get(filePath)
		if (raw === undefined) {
			const err = new Error("ENOENT")
			;(err as NodeJS.ErrnoException).code = "ENOENT"
			throw err
		}
		return raw
	}),
	readdir: vi.fn().mockResolvedValue([]),
	unlink: vi.fn().mockResolvedValue(undefined),
	access: vi.fn(async (filePath: string) => {
		if (!backingFiles.has(filePath)) {
			const err = new Error("ENOENT")
			;(err as NodeJS.ErrnoException).code = "ENOENT"
			throw err
		}
	}),
	stat: vi.fn(async (filePath: string) => ({
		mtimeMs: 0,
		size: backingFiles.get(filePath)?.length ?? 0,
		isDirectory: () => true,
	})),
	writeFile: vi.fn(async (filePath: string, data: string) => {
		backingFiles.set(filePath, data)
	}),
}))

vi.mock("fs", () => ({
	default: {
		watch: vi.fn().mockReturnValue({ on: vi.fn(), close: vi.fn() }),
		existsSync: vi.fn().mockReturnValue(false),
		createWriteStream: vi.fn(),
	},
	watch: vi.fn().mockReturnValue({ on: vi.fn(), close: vi.fn() }),
	existsSync: vi.fn().mockReturnValue(false),
	createWriteStream: vi.fn(),
}))

// Mock proper-lockfile to a no-op lock so the in-process per-ID lock is the
// only serialization mechanism under test here. The real lockfile path is
// exercised by the real-FS suite.
vi.mock("proper-lockfile", () => ({
	lock: vi.fn(async () => async () => {}),
	unlock: vi.fn(async () => {}),
	check: vi.fn(async () => false),
}))

// safeWriteJson is mocked to a plain write so we don't pull in the
// stream/stringify machinery.
vi.mock("../utils/safeWriteJson", () => {
	const write = vi.fn(async (filePath: string, data: any) => {
		backingFiles.set(filePath, JSON.stringify(data))
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

vi.mock("../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockResolvedValue("/tmp/test-storage"),
}))

import { TaskHistoryStore } from "../core/task-persistence/TaskHistoryStore"

const makeItem = (id: string, overrides: Partial<HistoryItem> = {}): HistoryItem =>
	({
		id,
		number: 1,
		ts: Date.now(),
		task: "test task",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		status: "active",
		mode: "code",
		workspace: "/tmp",
		...overrides,
	}) as HistoryItem

// Seed the in-memory backing file for a task so atomicReadAndUpdate's on-disk
// read returns it. The cache is also seeded so a stale-cache scenario can be
// constructed when needed.
function seedOnDisk(store: TaskHistoryStore, item: HistoryItem): void {
	const filePath = `/tmp/test-storage/tasks/${item.id}/history_item.json`
	backingFiles.set(filePath, JSON.stringify(item))
	;(store as any).cache.set(item.id, item)
}

describe("TaskHistoryStore.atomicReadAndUpdate", () => {
	let store: TaskHistoryStore

	beforeEach(() => {
		backingFiles.clear()
		vi.clearAllMocks()
		store = new TaskHistoryStore("/tmp/test-storage")
	})

	it("serializes concurrent operations — second caller reads the state written by the first", async () => {
		// Seed the on-disk record (atomicReadAndUpdate reads from disk under
		// the lock, not the cache) with an item that has no childIds yet.
		const item = makeItem("parent-task", { childIds: [] })
		seedOnDisk(store, item)

		// Two concurrent delegations each append their child ID.
		// Because they are serialized by the in-process per-ID lock, the
		// second caller must read the on-disk state that the first caller
		// wrote — not the original.
		const delegation1 = store.atomicReadAndUpdate("parent-task", (current) => ({
			...current,
			childIds: [...(current.childIds ?? []), "child-A"],
		}))

		const delegation2 = store.atomicReadAndUpdate("parent-task", (current) => ({
			...current,
			childIds: [...(current.childIds ?? []), "child-B"],
		}))

		await Promise.all([delegation1, delegation2])

		// Both child IDs must be present: delegation2 saw delegation1's write.
		const final = (store as any).cache.get("parent-task") as HistoryItem
		expect(final.childIds).toContain("child-A")
		expect(final.childIds).toContain("child-B")
	})

	it("two concurrent delegations produce consistent HistoryItem state (full field set)", async () => {
		const item = makeItem("parent-task", { status: "active", childIds: [] })
		seedOnDisk(store, item)

		// Each delegation sets awaitingChildId and appends to childIds.
		const delegation1 = store.atomicReadAndUpdate("parent-task", (historyItem) => {
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), "child-A"]))
			return {
				...historyItem,
				status: "delegated",
				delegatedToId: "child-A",
				awaitingChildId: "child-A",
				childIds,
			}
		})

		const delegation2 = store.atomicReadAndUpdate("parent-task", (historyItem) => {
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), "child-B"]))
			return {
				...historyItem,
				status: "delegated",
				delegatedToId: "child-B",
				awaitingChildId: "child-B",
				childIds,
			}
		})

		await Promise.all([delegation1, delegation2])

		const final = (store as any).cache.get("parent-task") as HistoryItem
		// Both child IDs present — neither write clobbered the other's childIds.
		expect(final.childIds).toContain("child-A")
		expect(final.childIds).toContain("child-B")
		// The last writer wins on scalar fields; whichever child ran second is authoritative.
		expect(final.status).toBe("delegated")
		expect(["child-A", "child-B"]).toContain(final.awaitingChildId)
		expect(final.delegatedToId).toBe(final.awaitingChildId)
		expect(final.childIds).toContain(final.awaitingChildId)
	})

	it("completes without deadlock — updater is pure and does not re-acquire the lock", async () => {
		const item = makeItem("task-1", { childIds: [] })
		seedOnDisk(store, item)

		// With the typed (taskId, updater) API, the updater is synchronous and
		// cannot call upsert/withLock — no re-entrancy, no deadlock.
		const result = await Promise.race([
			store
				.atomicReadAndUpdate("task-1", (current) => ({
					...current,
					childIds: [...(current.childIds ?? []), "child-1"],
				}))
				.then(() => "completed"),
			new Promise<string>((resolve) => setTimeout(() => resolve("deadlocked"), 100)),
		])

		expect(result).toBe("completed")

		const final = (store as any).cache.get("task-1") as HistoryItem
		expect(final.childIds).toContain("child-1")
	})

	it("throws if the task is not on disk (read fails under the lock)", async () => {
		// No seedOnDisk: the on-disk file is absent, so the locked read fails.
		await expect(
			store.atomicReadAndUpdate("nonexistent-task", (current) => ({ ...current, status: "delegated" })),
		).rejects.toThrow("nonexistent-task")
	})
})
