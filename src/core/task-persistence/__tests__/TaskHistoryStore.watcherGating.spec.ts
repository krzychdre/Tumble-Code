// pnpm --filter roo-cline test core/task-persistence/__tests__/TaskHistoryStore.watcherGating.spec.ts

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import type * as fsSyncType from "fs"

import type { HistoryItem } from "@roo-code/types"

import { TaskHistoryStore } from "../TaskHistoryStore"
import { GlobalFileNames } from "../../../shared/globalFileNames"

vi.mock("../../../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

vi.mock("@roo-code/core/fs", () => {
	const write = vi.fn().mockImplementation(async (filePath: string, data: any) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"), "utf8")
	})
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: any) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

/**
 * Fake FSWatcher returned by the mocked `fs.watch`: records its target,
 * accepts the listener registrations the store performs, and counts closes.
 */
class FakeWatcher {
	static instances: FakeWatcher[] = []
	closeCalls = 0
	closed = false
	constructor(
		readonly target: string,
		private readonly listeners: Record<string, Array<(...args: unknown[]) => void>> = {},
	) {
		FakeWatcher.instances.push(this)
	}
	on(event: string, listener: (...args: unknown[]) => void): this {
		;(this.listeners[event] ??= []).push(listener)
		return this
	}
	close(): void {
		this.closeCalls += 1
		this.closed = true
	}
}

const watchCalls: string[] = []

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	return {
		...actual,
		watch: ((target: any, _options: any, _listener: any) => {
			watchCalls.push(String(target))
			return new FakeWatcher(String(target)) as unknown as fsSyncType.FSWatcher
		}) as typeof actual.watch,
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

/** Wait until the store's asynchronous watcher-arming chains settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250))

describe("TaskHistoryStore watcher gating (P7: live + recent only)", () => {
	let tmpDir: string
	let tasksDir: string
	let store: TaskHistoryStore

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "watcher-gating-"))
		tasksDir = path.join(tmpDir, "tasks")
		await fs.mkdir(tasksDir, { recursive: true })
		watchCalls.length = 0
		FakeWatcher.instances.length = 0
	})

	afterEach(async () => {
		store.dispose()
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	/** Write a task dir + history_item.json directly on disk (as another process would). */
	async function writeTaskDirOnDisk(taskId: string, ageMs = 0): Promise<void> {
		const dir = path.join(tasksDir, taskId)
		await fs.mkdir(dir, { recursive: true })
		const item = makeHistoryItem({ id: taskId, ts: 1000 })
		const filePath = path.join(dir, GlobalFileNames.historyItem)
		await fs.writeFile(filePath, JSON.stringify(item))
		if (ageMs > 0) {
			const past = new Date(Date.now() - ageMs)
			await fs.utimes(filePath, past, past)
			await fs.utimes(dir, past, past)
		}
	}

	it("arms watchers only for recent tasks — not one per task folder", async () => {
		// 20 fresh task dirs + 20 stale ones (older than the recent window).
		for (let i = 0; i < 20; i++) {
			await writeTaskDirOnDisk(`fresh-${i}`)
		}
		for (let i = 0; i < 20; i++) {
			await writeTaskDirOnDisk(`stale-${i}`, 11 * 60 * 1000)
		}

		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()

		const globalWatcherCalls = watchCalls.filter((c) => c === tasksDir).length
		const taskDirWatches = watchCalls.filter((c) => c !== tasksDir)
		expect(globalWatcherCalls).toBe(1)
		// Only the fresh dirs qualify; the stale ones must stay unwatched.
		expect(taskDirWatches).toHaveLength(20)
		for (let i = 0; i < 20; i++) {
			expect(taskDirWatches).toContain(path.join(tasksDir, `fresh-${i}`))
		}
		for (let i = 0; i < 20; i++) {
			expect(taskDirWatches).not.toContain(path.join(tasksDir, `stale-${i}`))
		}
		// Watcher count is bounded by fresh dirs, not by total task count.
		expect(taskDirWatches.length).toBeLessThan(40)
	})

	it("scales with live+recent, not total: 1000 stale dirs, 1 live, 1 recent → 3 watchers", async () => {
		for (let i = 0; i < 1000; i++) {
			await writeTaskDirOnDisk(`stale-${i}`, 11 * 60 * 1000)
		}
		await writeTaskDirOnDisk("recent-1")

		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()

		// Mark one stale task live (as the provider would on setCurrentTask).
		store.setTaskLive("stale-0", true)
		await settle()

		const taskDirWatches = watchCalls.filter((c) => c !== tasksDir)
		expect(taskDirWatches.sort()).toEqual([path.join(tasksDir, "recent-1"), path.join(tasksDir, "stale-0")].sort())
		// 1 global + 2 gated task-dir watchers — NOT 1001.
		expect(watchCalls).toHaveLength(3)
	}, 60000)

	it("an unwatched folder's external change is still picked up by reconcile", async () => {
		await writeTaskDirOnDisk("stale-external", 11 * 60 * 1000)

		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()

		// Sanity: the folder is not watched.
		expect(watchCalls).not.toContain(path.join(tasksDir, "stale-external"))

		// Another process rewrites the record.
		const item = makeHistoryItem({ id: "stale-external", ts: 1000, task: "Externally changed" })
		await fs.writeFile(path.join(tasksDir, "stale-external", GlobalFileNames.historyItem), JSON.stringify(item))

		// Reconcile (the five-minute fallback path) must observe it.
		await store.reconcile()

		expect(store.get("stale-external")).toMatchObject({ task: "Externally changed" })
	})

	it("demotes a watcher only after the task is neither live nor recent (grace)", async () => {
		await writeTaskDirOnDisk("grace-task")
		await writeTaskDirOnDisk("gone-idle", 11 * 60 * 1000)

		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()
		expect(watchCalls).not.toContain(path.join(tasksDir, "gone-idle"))

		// gone-idle goes live: its watcher must be armed and pinned even
		// though its file is older than the recent window.
		store.setTaskLive("gone-idle", true)
		await settle()
		expect(watchCalls).toContain(path.join(tasksDir, "gone-idle"))

		// Age the fresh task out too, then run the demotion sweep.
		const past = new Date(Date.now() - 11 * 60 * 1000)
		await fs.utimes(path.join(tasksDir, "grace-task", GlobalFileNames.historyItem), past, past)

		await store.reconcile()
		// Sweep is a private method; the periodic reconcile path calls it.
		// Reach it the same way production does: via the (already running)
		// periodic timer is too slow, so invoke through the store's private
		// API surface below.
		await (store as unknown as { refreshTaskDirWatchers(): Promise<void> }).refreshTaskDirWatchers()

		const liveWatches = FakeWatcher.instances.filter((w) => !w.closed)
		const liveTargets = liveWatches.map((w) => w.target)
		// Live task keeps its watcher; the aged-out non-live one loses it.
		expect(liveTargets).toContain(path.join(tasksDir, "gone-idle"))
		expect(liveTargets).not.toContain(path.join(tasksDir, "grace-task"))

		// Clearing the live mark alone must NOT close the watcher while the
		// file is still fresh (recency grace).
		const before = FakeWatcher.instances.find((w) => w.target === path.join(tasksDir, "gone-idle"))
		expect(before?.closed).toBeFalsy()

		// Unmark, age the file out, sweep again: now it demotes.
		store.setTaskLive("gone-idle", false)
		const idlePast = new Date(Date.now() - 11 * 60 * 1000)
		await fs.utimes(path.join(tasksDir, "gone-idle", GlobalFileNames.historyItem), idlePast, idlePast)
		await store.reconcile()
		await (store as unknown as { refreshTaskDirWatchers(): Promise<void> }).refreshTaskDirWatchers()

		expect(before?.closed).toBe(true)
	}, 30000)

	it("a reconcile-observed external change promotes a watcher (touch promotion)", async () => {
		await writeTaskDirOnDisk("touch-task", 11 * 60 * 1000)

		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()
		expect(watchCalls).not.toContain(path.join(tasksDir, "touch-task"))

		// External write, picked up by reconcile (refreshTask runs under a
		// record transaction, which is the touch-promotion site).
		const item = makeHistoryItem({ id: "touch-task", ts: 1000, task: "Touched" })
		await fs.writeFile(path.join(tasksDir, "touch-task", GlobalFileNames.historyItem), JSON.stringify(item))
		await store.reconcile()
		await settle()

		// The refreshed record is recent again → the transaction re-arms
		// its watcher.
		expect(watchCalls).toContain(path.join(tasksDir, "touch-task"))
	})

	it("setTaskLive is refcounted: the watcher pins until the last consumer unmarks", async () => {
		await writeTaskDirOnDisk("shared-live")
		store = new TaskHistoryStore(tmpDir)
		await store.initialize()
		await settle()

		store.setTaskLive("shared-live", true) // provider A (sidebar)
		store.setTaskLive("shared-live", true) // provider B (editor tab)
		store.setTaskLive("shared-live", false) // A closes
		await settle()

		const watcher = FakeWatcher.instances.find((w) => w.target === path.join(tasksDir, "shared-live"))
		expect(watcher?.closed).toBeFalsy()

		store.setTaskLive("shared-live", false) // B closes
		// Refcount is gone; the watcher survives only via recency grace
		// (its file is fresh), which the next sweep honors.
		await store.reconcile()
		await (store as unknown as { refreshTaskDirWatchers(): Promise<void> }).refreshTaskDirWatchers()
		expect(watcher?.closed).toBeFalsy() // still recent → kept
	})
})
