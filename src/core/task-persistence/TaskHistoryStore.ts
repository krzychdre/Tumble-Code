import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"

import { historyItemSchema, type HistoryItem } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { safeWriteJson, withLockedJsonTransaction, type LockedJsonWriter } from "../../utils/safeWriteJson"
import { getStorageBasePath } from "../../utils/storage"
import { logger } from "../../utils/logging"

/**
 * Index file format for fast startup reads.
 */
interface HistoryIndex {
	version: number
	updatedAt: number
	entries: HistoryItem[]
}

/**
 * Lightweight metadata retained per task ID to detect external mutations
 * without re-reading the full history_item.json.
 *
 * `mtimeMs` is the file's last-modified time in milliseconds; `size` is the
 * byte length. Together they form a cheap revision token: if either changes,
 * the file was rewritten and the cache entry is stale.
 */
interface TaskFileMeta {
	mtimeMs: number
	size: number
	fingerprint: string
}

/**
 * Kind of mutation reported by {@link TaskHistoryStore.onChange2}.
 *
 * - `upsert`: a record was inserted or replaced (after `upsert` /
 *   `atomicReadAndUpdate` / migration backfill / external refresh).
 * - `delete`: a record was removed (after `delete` / `deleteMany` / external
 *   refresh observed the file/dir gone).
 * - `external`: a watcher/periodic reconcile pass altered the cache without a
 *   specific single-record origin (kept for backwards compatibility with the
 *   boolean `external` flag).
 */
export type TaskHistoryChangeKind = "upsert" | "delete" | "external"

/**
 * Detailed change event. `external` is true for filesystem-originated changes
 * (watcher/periodic reconcile/explicit invalidate) and false for local
 * mutations performed through this store. `kind` and `taskId`/`item` let
 * subscribers push targeted per-item updates without re-sending the whole
 * history. For batch/scan-driven external changes `kind` is `external` and
 * `taskId`/`item` may be undefined.
 */
export interface TaskHistoryChangeEvent {
	external: boolean
	kind: TaskHistoryChangeKind
	taskId?: string
	item?: HistoryItem
	origin?: symbol
}

/**
 * Listener invoked after the cache is mutated or an external change is
 * reconciled into it. Subscribers use this to push updates to their webviews.
 *
 * The legacy boolean callback form is still accepted: a listener declared as
 * `(external: boolean) => void` is wrapped so existing call sites keep
 * working.
 */
export type TaskHistoryChangeListener = (event: TaskHistoryChangeEvent) => void

/**
 * Options accepted by {@link TaskHistoryStore.acquire}.
 */
export interface TaskHistoryStoreAcquireOptions {
	/**
	 * Optional context discriminator. Two stores with different `context` are
	 * never shared even if they share a storage path. Defaults to `undefined`.
	 */
	context?: string
}

/**
 * A handle returned by {@link TaskHistoryStore.acquire} that releases the
 * shared store when disposed. The final consumer's `dispose()` tears down the
 * underlying watcher/timers; earlier consumers become inert observers.
 */
export interface TaskHistoryStoreHandle {
	/** The shared store. */
	readonly store: TaskHistoryStore
	/** Release this consumer's reference. Safe to call more than once. */
	dispose(): void
}

/**
 * Internal shared-store registry entry.
 */
interface SharedStoreEntry {
	store: TaskHistoryStore
	refCount: number
	ready: Promise<void>
}

/**
 * Process-wide registry of shared stores keyed by `(storagePath, context)`.
 *
 * Lives on the extension host only; tests get fresh registries because the
 * module is re-imported per worker. `acquire`/`release` are the only entry
 * points — never construct a store directly outside this module unless you
 * also own its lifecycle (the standalone `TaskHistoryStore` export exists for
 * focused unit tests).
 */
const sharedStores = new Map<string, SharedStoreEntry>()
function fingerprintHistoryItem(item: HistoryItem): string {
	const text = JSON.stringify(item)
	let hash = 2166136261
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return `${text.length}:${hash >>> 0}`
}

/**
 * Canonicalize a storage path for use as a registry key.
 *
 * - Normalizes separators to the platform separator.
 * - Strips a trailing separator so `…/storage` and `…/storage/` collide.
 * - Resolves `.`/`..` segments lexically via `path.resolve` (no symlink walk).
 *
 * `fs.realpath` is intentionally NOT used: the tasks storage directory may
 * not exist yet at acquire time, and `realpath` would throw ENOENT. Lexical
 * normalization is enough to collapse the common alias cases (`./a/../b`,
 * trailing slash, mixed separators) without requiring the dir to exist.
 */
function canonicalizeStoragePath(rawPath: string): string {
	// path.resolve already collapses `.`/`..` and normalizes separators for
	// the current platform; it does not touch the filesystem. We then strip
	// any trailing separator it might leave (it generally doesn't, but be
	// defensive) so aliases that differ only by trailing slash collapse.
	let resolved = path.resolve(rawPath)
	if (resolved.length > 1 && resolved.endsWith(path.sep)) {
		resolved = resolved.slice(0, -1)
	}
	return resolved
}

function sharedStoreKey(storagePath: string, context: string | undefined): string {
	const canon = canonicalizeStoragePath(storagePath)
	return context === undefined ? canon : `${canon}\0${context}`
}

/**
 * Result of reading a single task file, distinguishing "file is gone"
 * (ENOENT) from "file is unreadable/corrupt" (parse or I/O error).
 */
type ReadResult = { status: "ok"; item: HistoryItem } | { status: "missing" } | { status: "error"; error: unknown }

/**
 * TaskHistoryStore encapsulates all task history persistence logic.
 *
 * Each task's HistoryItem is stored as an individual JSON file in its
 * existing task directory (`globalStorage/tasks/<taskId>/history_item.json`).
 * A single index file (`globalStorage/tasks/_index.json`) is maintained
 * as a cache for fast list reads at startup.
 *
 * Locking / transaction model:
 *
 * Every mutation that touches a single record (`upsert`, `atomicReadAndUpdate`,
 * `delete`, and the migration write-back) funnels through a single internal
 * helper, {@link withRecordTransaction}, which acquires locks in ONE fixed
 * order to avoid deadlocks and lost updates:
 *
 *   1. in-process per-ID lock (serializes same-process callers on the same ID)
 *   2. inter-process `proper-lockfile` lock on the per-task file path
 *   3. fresh read from disk (authoritative, not the stale cache)
 *   4. merge / mutate / delete
 *   5. atomic JSON write while the transaction lock is held
 *   6. update in-memory cache, metadata, and notify subscribers
 *
 * Because every caller enters through the same per-ID gate and then the
 * shared transaction gateway, a public caller cannot bypass the record lock
 * or retain an unlocked raw writer.
 *
 * For shared lifecycle across multiple `ClineProvider` instances on the same
 * extension host (sidebar + editor tab, multiple windows on the same
 * storage), use {@link TaskHistoryStore.acquire} — it returns a ref-counted
 * handle whose final `dispose()` releases the watcher/timers. A failure in
 * `initialize()` rejects every pending acquirer and removes the registry
 * entry so the next `acquire` can retry from scratch.
 */
export class TaskHistoryStore {
	private readonly globalStoragePath: string
	private cache: Map<string, HistoryItem> = new Map()
	/** Cheap revision token per task ID, used to skip unchanged re-reads. */
	private fileMeta: Map<string, TaskFileMeta> = new Map()
	/**
	 * In-process per-ID locks. Each ID gets its own promise chain so two
	 * callers mutating different IDs never block each other, while two
	 * callers mutating the same ID are fully serialized.
	 */
	private perIdLocks: Map<string, Promise<void>> = new Map()
	/**
	 * Serialized index writes so a debounced flush can't race with a dispose
	 * flush or a migration flush.
	 */
	private indexWriteLock: Promise<void> = Promise.resolve()
	private indexWriteTimer: ReturnType<typeof setTimeout> | null = null
	private fsWatcher: fsSync.FSWatcher | null = null
	/** Per-task directory watchers for portable change detection. */
	private taskDirWatchers: Map<string, fsSync.FSWatcher> = new Map()
	private reconcileTimer: ReturnType<typeof setTimeout> | null = null
	/** Global watcher debounce: coalesces events into a set of changed IDs. */
	private watcherDebounce: ReturnType<typeof setTimeout> | null = null
	private pendingWatcherIds: Set<string> = new Set()
	private disposed = false
	private initializedSuccessfully = false
	private readonly listeners = new Set<TaskHistoryChangeListener>()

	/**
	 * Promise that resolves when initialization is complete.
	 * Callers can await this to ensure the store is ready before reading.
	 * Rejects if `initialize()` throws, so callers can surface the error and
	 * a fresh `acquire` can retry.
	 */
	public readonly initialized: Promise<void>
	private resolveInitialized!: () => void
	private rejectInitialized!: (err: Error) => void

	/**
	 * Shared, awaitable migration promise. The first provider to call
	 * {@link migrateFromLegacyHistory} for a given legacy snapshot runs the
	 * actual work; concurrent callers for the same store await the same
	 * promise so two providers never race the backfill/cleanup.
	 */
	private migrationPromise: Promise<boolean> | null = null

	static getPendingRecordLockCountForTests(store: TaskHistoryStore): number {
		return store.perIdLocks.size
	}

	/** Debounce window for index writes in milliseconds. */
	private static readonly INDEX_WRITE_DEBOUNCE_MS = 2000

	/** Periodic reconciliation interval in milliseconds. */
	private static readonly RECONCILE_INTERVAL_MS = 5 * 60 * 1000

	/** Debounce window for watcher-triggered targeted refresh. */
	private static readonly WATCHER_DEBOUNCE_MS = 500

	/** Legacy globalState keys cleared once migration to per-task files succeeds. */
	public static readonly LEGACY_TASK_HISTORY_KEY = "taskHistory"
	public static readonly LEGACY_MIGRATION_MARKER_KEY = "taskHistoryMigratedToFiles"

	constructor(globalStoragePath: string) {
		this.globalStoragePath = globalStoragePath
		this.initialized = new Promise<void>((resolve, reject) => {
			this.resolveInitialized = resolve
			this.rejectInitialized = reject
		})
	}

	// ────────────────────────────── Shared lifecycle ──────────────────────────────

	/**
	 * Acquire a shared {@link TaskHistoryStore} for the given storage path
	 * (and optional context discriminator). Subsequent acquisitions return the
	 * same underlying instance and bump its refcount; the final
	 * {@link TaskHistoryStoreHandle.dispose} tears down the watcher, periodic
	 * timer and pending index write. Disposing a non-final handle only
	 * detaches the subscriber — the store keeps running for the remaining
	 * consumers, so closing one panel never breaks the others.
	 *
	 * The returned handle's `store` is guaranteed ready: `acquire` awaits the
	 * store's `initialized` promise before resolving. If `initialize()` fails,
	 * the acquirer rejects with the init error AND the faulty registry entry
	 * is removed (with refcount adjusted) so the next `acquire` can build a
	 * fresh store and retry. Parallel `acquire` calls for the same key all
	 * reject together and the entry is torn down exactly once.
	 *
	 * Distinct storage paths or contexts always get distinct stores. Path
	 * aliases that resolve to the same canonical path (trailing separator,
	 * `.`/`..` segments, mixed separators) collapse to one store.
	 */
	static async acquire(
		storagePath: string,
		options?: TaskHistoryStoreAcquireOptions,
	): Promise<TaskHistoryStoreHandle> {
		const context = options?.context
		const key = sharedStoreKey(storagePath, context)
		let entry = sharedStores.get(key)
		if (!entry) {
			const store = new TaskHistoryStore(storagePath)
			store.initialized.catch(() => {})
			const newEntry: SharedStoreEntry = {
				store,
				refCount: 0,
				ready: Promise.resolve(),
			}
			newEntry.ready = store.initialize().catch((err) => {
				if (sharedStores.get(key) === newEntry) {
					sharedStores.delete(key)
				}
				store.dispose()
				throw err
			})
			entry = newEntry
			sharedStores.set(key, entry)
		}
		entry.refCount += 1
		const entrySnapshot = entry

		let released = false
		const doDispose = () => {
			if (released) {
				return
			}
			released = true
			const current = sharedStores.get(key)
			if (current !== entrySnapshot) {
				return
			}
			current.refCount -= 1
			if (current.refCount <= 0) {
				current.store.dispose()
				sharedStores.delete(key)
			}
		}

		try {
			await entrySnapshot.ready
		} catch (err) {
			doDispose()
			throw err
		}

		return {
			store: entrySnapshot.store,
			dispose: doDispose,
		}
	}

	/**
	 * Subscribe to cache-change notifications. Local mutations
	 * (upsert/delete/deleteMany/atomicReadAndUpdate) and watcher/periodic
	 * reconciliations that actually alter the cache fire the listener with a
	 * detailed event (kind, taskId, item, external). Returns an unsubscribe
	 * function. No-op after dispose. Safe to call from any consumer; one
	 * consumer's unsubscribe never affects another's subscription.
	 */
	onChange(listener: TaskHistoryChangeListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/**
	 * Fire change listeners. `external` distinguishes filesystem-originated
	 * changes (watcher/reconcile/invalidate) from local mutations so
	 * subscribers can avoid redundant full-history broadcasts for changes
	 * they initiated themselves.
	 */
	private notifyChanged(event: TaskHistoryChangeEvent): void {
		if (this.disposed || this.listeners.size === 0) {
			return
		}
		for (const listener of this.listeners) {
			try {
				listener(event)
			} catch (err) {
				logger.error(
					`[TaskHistoryStore] change listener threw: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}
	}

	/**
	 * Drop all shared stores from the process registry and dispose them.
	 *
	 * Intended for tests that need a clean slate between cases. Production
	 * code should use {@link TaskHistoryStoreHandle.dispose} instead.
	 */
	static resetSharedStoresForTests(): void {
		for (const entry of sharedStores.values()) {
			try {
				entry.store.dispose()
			} catch {
				// ignore
			}
		}
		sharedStores.clear()
	}

	// ────────────────────────────── Lifecycle ──────────────────────────────

	/**
	 * Load index, reconcile if needed, start watchers.
	 *
	 * On failure the `initialized` promise rejects (rather than silently
	 * resolving) so callers — notably {@link acquire} — can surface the error
	 * and tear down the faulty registry entry for a retry.
	 */
	async initialize(): Promise<void> {
		try {
			const tasksDir = await this.getTasksDir()
			await fs.mkdir(tasksDir, { recursive: true })

			// 1. Load existing index into the cache
			await this.loadIndex()

			// 2. Reconcile cache against actual task directories on disk
			await this.reconcile()

			// 3. Start fs.watch for cross-instance reactivity
			this.startWatcher()

			// 4. Start periodic reconciliation as a defensive fallback
			this.startPeriodicReconciliation()

			this.initializedSuccessfully = true
			this.resolveInitialized()
		} catch (err) {
			this.rejectInitialized(err instanceof Error ? err : new Error(String(err)))
			throw err
		}
	}

	/**
	 * Flush pending writes, clear watchers, release resources.
	 */
	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true

		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
			this.indexWriteTimer = null
		}

		if (this.reconcileTimer) {
			clearTimeout(this.reconcileTimer)
			this.reconcileTimer = null
		}

		if (this.watcherDebounce) {
			clearTimeout(this.watcherDebounce)
			this.watcherDebounce = null
		}
		this.pendingWatcherIds.clear()

		if (this.fsWatcher) {
			this.fsWatcher.close()
			this.fsWatcher = null
		}

		for (const watcher of this.taskDirWatchers.values()) {
			try {
				watcher.close()
			} catch {
				// ignore
			}
		}
		this.taskDirWatchers.clear()

		this.listeners.clear()

		// A store whose initialization failed never became authoritative and
		// must not race a fresh acquire by flushing a partial/empty index.
		if (this.initializedSuccessfully) {
			this.flushIndex().catch((err) => {
				console.error("[TaskHistoryStore] Error flushing index on dispose:", err)
			})
		}
	}

	// ────────────────────────────── Reads ──────────────────────────────

	/**
	 * Get a single history item by task ID.
	 */
	get(taskId: string): HistoryItem | undefined {
		return this.cache.get(taskId)
	}

	/**
	 * Get all history items, sorted by timestamp descending (newest first).
	 */
	getAll(): HistoryItem[] {
		return Array.from(this.cache.values()).sort((a, b) => b.ts - a.ts)
	}

	/**
	 * Get history items filtered by workspace path.
	 */
	getByWorkspace(workspace: string): HistoryItem[] {
		return this.getAll().filter((item) => item.workspace === workspace)
	}

	// ────────────────────────────── Mutations ──────────────────────────────

	/**
	 * Insert or update a history item.
	 *
	 * Writes the per-task file immediately (source of truth), updates the
	 * in-memory Map, schedules a debounced index write, and notifies
	 * subscribers. The on-disk file is always authoritative; the index is
	 * only a startup cache.
	 *
	 * Returns `void` — callers that need the full sorted history should call
	 * {@link getAll} explicitly. This avoids copying and sorting the entire
	 * history on every mutation when most call sites only need the per-item
	 * side effect (broadcast handled separately via {@link onChange}).
	 */
	async upsert(item: HistoryItem, origin?: symbol): Promise<void> {
		const written = await this.withRecordTransaction(item.id, async ({ filePath, ensureTaskDir, writeJson }) => {
			// Merge: preserve existing metadata unless explicitly overwritten.
			// Read the authoritative on-disk record (if any) so a concurrent
			// external write that the cache hasn't seen is observed under the
			// lock, exactly like atomicReadAndUpdate.
			const existing = await this.readTaskFileUnderLock(filePath)
			if (existing.status === "error") {
				throw existing.error
			}
			const base = existing.status === "ok" ? existing.item : this.cache.get(item.id)
			const merged = base ? { ...base, ...item } : item
			// The ID is the caller's; the merge cannot change it because we
			// spread `item` last and `item.id === taskId` by construction.
			await ensureTaskDir()
			await writeJson(merged)
			// Update the in-memory cache inside the locked section so
			// concurrent in-process readers see the new value.
			this.cache.set(merged.id, merged)
			return { record: merged, kind: "upsert" as const }
		})
		this.notifyChanged({ external: false, kind: "upsert", taskId: item.id, item: written.record, origin })
	}

	/**
	 * Delete a single task's history item.
	 */
	async delete(taskId: string, origin?: symbol): Promise<void> {
		await this.withRecordTransaction(taskId, async ({ filePath }) => {
			const existing = await this.readTaskFileResult(filePath)
			if (existing.status === "error") {
				throw existing.error
			}
			// Unlink under the lock; ENOENT is fine (already gone).
			try {
				await fs.unlink(filePath)
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					throw err
				}
			}
			// Drop the cache entry inside the locked section.
			this.cache.delete(taskId)
			this.fileMeta.delete(taskId)
			return { record: undefined, kind: "delete" as const }
		})
		this.notifyChanged({ external: false, kind: "delete", taskId, origin })
	}

	/**
	 * Delete multiple tasks' history items in a batch.
	 */
	async deleteMany(taskIds: string[], origin?: symbol): Promise<void> {
		// Each ID is handled by its own per-ID transaction; they run in
		// parallel across IDs and serially within an ID. We don't hold one
		// giant file lock because the IDs are independent.
		await Promise.all(taskIds.map((id) => this.delete(id, origin)))
	}

	// ────────────────────────────── Reconciliation ──────────────────────────────

	/**
	 * Scan task directories vs cache and fix any drift, including mutations
	 * of existing records detected via cheap mtime/size metadata.
	 *
	 * - Tasks on disk but missing from cache: read and add
	 * - Tasks in cache but missing from disk: remove
	 * - Tasks whose `history_item.json` mtime/size changed since last read:
	 *   re-read and replace the cached entry (preserves newer field values;
	 *   never overwrites a newer on-disk record with a stale cache copy)
	 *
	 * Runs through the per-ID locks for the records it touches so it cannot
	 * interleave with in-process upsert/delete on the same ID. Notifies
	 * subscribers only when the cache actually changed, so a no-op reconcile
	 * is free.
	 *
	 * This is the periodic/watcher fallback path. Watcher events for a known
	 * ID go through {@link refreshTask} instead (a targeted single-record
	 * refresh) to avoid scanning every task directory on every event.
	 */
	async reconcile(): Promise<void> {
		const tasksDir = await this.getTasksDir()

		let dirEntries: string[]
		try {
			dirEntries = await fs.readdir(tasksDir)
		} catch {
			return // tasks dir doesn't exist yet
		}

		// Filter out the index file and hidden files
		const taskDirNames = dirEntries.filter((name) => !name.startsWith("_") && !name.startsWith("."))

		const onDiskIds = new Set(taskDirNames)
		const cacheIds = new Set(this.cache.keys())

		const changedEvents: TaskHistoryChangeEvent[] = []

		// Tasks on disk but not in cache, OR on disk with changed metadata:
		// refresh each under its own per-ID lock. A per-ID failure (e.g. the
		// store being disposed mid-reconcile) is contained so one bad record
		// can't abort the whole scan.
		for (const taskId of onDiskIds) {
			if (this.disposed) {
				return
			}
			const inCache = cacheIds.has(taskId)
			if (!inCache || (await this.hasFileChanged(taskId))) {
				try {
					const event = await this.refreshTask(taskId, { external: true })
					if (event) {
						changedEvents.push(event)
					}
				} catch (err) {
					if (this.disposed) {
						return
					}
					logger.error(
						`[TaskHistoryStore.reconcile] refresh failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
					)
				}
			}
		}

		// Tasks in cache but not on disk: remove from cache.
		for (const taskId of cacheIds) {
			if (this.disposed) {
				return
			}
			if (!onDiskIds.has(taskId)) {
				try {
					await this.withRecordTransaction(taskId, async () => {
						this.cache.delete(taskId)
						this.fileMeta.delete(taskId)
						return { record: undefined, kind: "delete" as const }
					})
					changedEvents.push({ external: true, kind: "delete", taskId })
				} catch (err) {
					if (this.disposed) {
						return
					}
					logger.error(
						`[TaskHistoryStore.reconcile] prune failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
					)
				}
			}
		}

		if (changedEvents.length > 0) {
			this.scheduleIndexWrite()
			for (const ev of changedEvents) {
				this.notifyChanged(ev)
			}
		}
	}

	// ────────────────────────────── Targeted refresh ──────────────────────────────

	/**
	 * Re-read a single task's `history_item.json` from disk and update the
	 * cache, distinguishing ENOENT (remove cache entry) from parse/I/O error
	 * (keep the existing good cache entry, report the error).
	 *
	 * Runs under the per-ID lock so it can't interleave with a concurrent
	 * upsert/delete on the same ID. Unlike {@link reconcile}, this does NOT
	 * consult mtime/size — it reads the file unconditionally, because the
	 * caller (a watcher event or explicit invalidate) already has reason to
	 * believe the file changed (and a same-size/same-mtime content change
	 * would otherwise be missed).
	 *
	 * Returns the change event to notify, or `null` if nothing changed.
	 */
	async refreshTask(taskId: string, opts: { external?: boolean } = {}): Promise<TaskHistoryChangeEvent | null> {
		const external = opts.external ?? true
		const event = await this.withRecordTransaction(taskId, async ({ filePath }) => {
			const result = await this.readTaskFileResult(filePath)
			if (result.status === "ok") {
				const prev = this.cache.get(taskId)
				const nextFingerprint = fingerprintHistoryItem(result.item)
				const previousFingerprint = this.fileMeta.get(taskId)?.fingerprint
				await this.refreshFileMetaForPath(filePath, taskId, result.item)
				if (prev && previousFingerprint === nextFingerprint) {
					return null
				}
				this.cache.set(taskId, result.item)
				return {
					record: result.item,
					kind: "upsert" as const,
					external,
					taskId,
				} as TaskHistoryChangeEvent | null
			}
			if (result.status === "missing") {
				// File is gone but the task directory still exists (or we
				// wouldn't have been called with this ID). Remove the cache
				// entry — the record was externally deleted.
				if (!this.cache.has(taskId)) {
					return null
				}
				this.cache.delete(taskId)
				this.fileMeta.delete(taskId)
				return {
					record: undefined,
					kind: "delete" as const,
					external,
					taskId,
				} as TaskHistoryChangeEvent | null
			}
			// result.status === "error": parse or I/O error (NOT ENOENT).
			// Keep the existing good cache entry; do NOT wipe it. Log so the
			// operator can see the corrupt file and retry later.
			logger.error(
				`[TaskHistoryStore.refreshTask] keeping cached entry for ${taskId}; on-disk file unreadable: ${result.error instanceof Error ? (result.error as Error).message : String(result.error)}`,
			)
			return null
		})
		return event
	}

	/**
	 * Invalidate a single task's cache entry (re-read from disk on next access).
	 *
	 * Kept for backwards compatibility with the public API. Delegates to
	 * {@link refreshTask} so the ENOENT-vs-error distinction and per-ID lock
	 * are honored.
	 */
	async invalidate(taskId: string): Promise<void> {
		const event = await this.refreshTask(taskId, { external: true })
		if (event) {
			this.scheduleIndexWrite()
			this.notifyChanged(event)
		}
	}

	/**
	 * Clear all in-memory cache and reload from index.
	 */
	invalidateAll(): void {
		this.cache.clear()
		this.fileMeta.clear()
	}

	// ────────────────────────────── Migration ──────────────────────────────

	/**
	 * Idempotently migrate legacy `taskHistory` entries (previously stored as
	 * a single array in globalState) into per-task `history_item.json` files,
	 * then report whether migration completed so the caller can clear the
	 * legacy globalState keys.
	 *
	 * Safety contract:
	 * - Only writes a per-task file when one does not already exist on disk
	 *   AND the existing file (if any) is readable + valid. An existing but
	 *   UNREADABLE/INVALID `history_item.json` is treated as a failure for
	 *   that entry: the legacy key must be retained so the operator can
	 *   recover, and we never overwrite a corrupt file with a legacy snapshot
	 *   (that would silently destroy whatever the corruption was hiding).
	 * - The legacy array is never materialized unless the caller already
	 *   passed it in (ContextProxy reads it lazily and only when present).
	 * - Re-check of the file and the actual write happen under the SAME
	 *   per-ID + file lock as runtime writes, so a live `upsert` cannot slip
	 *   between the "file absent" decision and the migration write and cause
	 *   an overwrite or a post-error cleanup.
	 * - Returns `true` only when every legacy entry was either already
	 *   present on disk (and readable) or successfully written. On any write
	 *   failure the method returns `false` and the caller MUST keep the
	 *   legacy keys so the next start can retry.
	 * - Cleanup of the legacy globalState keys is the CALLER's responsibility
	 *   and MUST only run after this returns `true`. This store never clears
	 *   legacy state itself.
	 *
	 * Concurrency: the migration is guarded by a shared, awaitable promise on
	 * this store. Two providers sharing the store that both call this method
	 * with a legacy snapshot execute the backfill exactly once; the second
	 * caller awaits the first's result.
	 */
	async migrateFromLegacyHistory(legacyEntries: HistoryItem[]): Promise<boolean> {
		if (!legacyEntries || legacyEntries.length === 0) {
			return true
		}
		// Coalesce concurrent migration calls on the same store. The first
		// caller runs the work; later callers await the same promise so they
		// never race the backfill or the caller's subsequent cleanup.
		if (this.migrationPromise) {
			return this.migrationPromise
		}
		this.migrationPromise = this.runMigration(legacyEntries).finally(() => {
			// Allow a later migration (e.g. after a retry) to run fresh.
			this.migrationPromise = null
		})
		return this.migrationPromise
	}

	private async runMigration(legacyEntries: HistoryItem[]): Promise<boolean> {
		const tasksDir = await this.getTasksDir()
		let allSucceeded = true

		for (const candidate of legacyEntries) {
			const parsed = historyItemSchema.safeParse(candidate)
			if (!parsed.success) {
				allSucceeded = false
				continue
			}
			const item = { ...(candidate as HistoryItem), ...parsed.data }

			// Re-check + write happen under the same per-ID + file lock as
			// runtime writes, so a live upsert cannot slip between the
			// "file absent" decision and this write.
			try {
				const outcome = await this.withRecordTransaction(
					item.id,
					async ({ filePath, ensureTaskDir, writeJson }) => {
						// Is there already a per-task file? Read it (under the
						// lock) to decide.
						const existing = await this.readTaskFileResult(filePath)
						if (existing.status === "ok") {
							// Authoritative on-disk record — load it into the
							// cache so a stale cache entry from a prior run
							// doesn't shadow the newer record. Never overwrite.
							this.cache.set(item.id, existing.item)
							await this.refreshFileMetaForPath(filePath, item.id)
							return { kind: "skip" as const, fail: false }
						}
						if (existing.status === "error") {
							// Existing but unreadable/invalid: do NOT overwrite
							// with the legacy snapshot (we'd destroy whatever the
							// corruption is hiding) and report failure so the
							// caller keeps the legacy key for recovery.
							return { kind: "skip" as const, fail: true }
						}
						// existing.status === "missing": no file — write the
						// legacy snapshot under the record transaction lock.
						await ensureTaskDir()
						await writeJson(item)
						this.cache.set(item.id, item)
						await this.refreshFileMetaForPath(filePath, item.id)
						return { kind: "write" as const, fail: false }
					},
				)
				if (outcome.fail) {
					allSucceeded = false
				}
			} catch (err) {
				logger.error(
					`[TaskHistoryStore.migrateFromLegacyHistory] failed to write ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
				)
				allSucceeded = false
			}
		}

		if (allSucceeded) {
			// Persist the index so subsequent starts can read it without
			// re-scanning every task directory.
			try {
				await this.flushIndex()
			} catch (err) {
				logger.error(
					`[TaskHistoryStore.migrateFromLegacyHistory] index write failed: ${err instanceof Error ? err.message : String(err)}`,
				)
				// Index failure is non-fatal: per-task files are the source of
				// truth and the next start will rebuild the index via reconcile.
			}
		}

		return allSucceeded
	}

	// ────────────────────────────── Private: Index management ──────────────────────────────

	/**
	 * Load the `_index.json` file into the in-memory cache.
	 */
	private async loadIndex(): Promise<void> {
		const indexPath = await this.getIndexPath()

		try {
			const raw = await fs.readFile(indexPath, "utf8")
			const index: HistoryIndex = JSON.parse(raw)

			if (index.version === 1 && Array.isArray(index.entries)) {
				for (const entry of index.entries) {
					if (entry.id) {
						this.cache.set(entry.id, entry)
					}
				}
			}
		} catch {
			// Index doesn't exist or is corrupted; cache stays empty.
			// Reconciliation will rebuild it from per-task files.
		}
	}

	/**
	 * Write the full index to disk. Serialized through `indexWriteLock` so a
	 * debounced flush can't race a dispose/migration flush.
	 */
	private async writeIndex(): Promise<void> {
		const run = async () => {
			const indexPath = await this.getIndexPath()
			const index: HistoryIndex = {
				version: 1,
				updatedAt: Date.now(),
				entries: this.getAll(),
			}
			await safeWriteJson(indexPath, index)
		}
		this.indexWriteLock = this.indexWriteLock.then(run, run)
		await this.indexWriteLock
	}

	/**
	 * Schedule a debounced index write.
	 */
	private scheduleIndexWrite(): void {
		if (this.disposed) {
			return
		}

		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
		}

		this.indexWriteTimer = setTimeout(async () => {
			this.indexWriteTimer = null
			try {
				await this.writeIndex()
			} catch (err) {
				console.error("[TaskHistoryStore] Failed to write index:", err)
			}
		}, TaskHistoryStore.INDEX_WRITE_DEBOUNCE_MS)
	}

	/**
	 * Force an immediate index write (called on dispose/shutdown).
	 */
	async flushIndex(): Promise<void> {
		if (this.indexWriteTimer) {
			clearTimeout(this.indexWriteTimer)
			this.indexWriteTimer = null
		}

		await this.writeIndex()
	}

	// ────────────────────────────── Private: Per-task file I/O ──────────────────────────────

	/**
	 * Read a HistoryItem from its per-task `history_item.json` file.
	 * Returns `null` for missing OR corrupt files (legacy callers that don't
	 * need to distinguish). New code should use {@link readTaskFileResult}
	 * or {@link readTaskFileUnderLock}.
	 */
	private async readTaskFile(taskId: string): Promise<HistoryItem | null> {
		const filePath = await this.getTaskFilePath(taskId)
		const result = await this.readTaskFileResult(filePath)
		return result.status === "ok" ? result.item : null
	}

	/**
	 * Read a per-task file and return a discriminated result that separates
	 * "missing" (ENOENT) from "error" (parse or other I/O error).
	 */
	private async readTaskFileResult(filePath: string): Promise<ReadResult> {
		let raw: string
		try {
			raw = await fs.readFile(filePath, "utf8")
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				return { status: "missing" }
			}
			return { status: "error", error: err }
		}
		try {
			const decoded: unknown = JSON.parse(raw)
			const parsed = historyItemSchema.safeParse(decoded)
			if (!parsed.success) {
				return {
					status: "error",
					error: new Error(`history_item.json failed schema validation: ${parsed.error.message}`),
				}
			}
			return {
				status: "ok",
				item: { ...(decoded as HistoryItem), ...parsed.data },
			}
		} catch (err) {
			return { status: "error", error: err }
		}
	}

	/**
	 * Read a per-task file under a lock we already hold, returning the item
	 * or `null` if it's missing or corrupt. Used by {@link upsert} to merge
	 * against the authoritative on-disk record.
	 */
	private async readTaskFileUnderLock(filePath: string): Promise<ReadResult> {
		return this.readTaskFileResult(filePath)
	}

	/**
	 * Refresh the cached mtime/size metadata for a task file given its
	 * already-resolved path (avoids a second `getTasksDir` resolution when
	 * the caller already has the path).
	 */
	private async refreshFileMetaForPath(filePath: string, taskId: string, item?: HistoryItem): Promise<void> {
		try {
			const stat = await fs.stat(filePath)
			const record = item ?? this.cache.get(taskId)
			if (!record) {
				this.fileMeta.delete(taskId)
				return
			}
			this.fileMeta.set(taskId, {
				mtimeMs: stat.mtimeMs,
				size: stat.size,
				fingerprint: fingerprintHistoryItem(record),
			})
		} catch {
			this.fileMeta.delete(taskId)
		}
	}

	/**
	 * Refresh the cached mtime/size metadata for a task file.
	 */
	private async refreshFileMeta(taskId: string): Promise<void> {
		const filePath = await this.getTaskFilePath(taskId)
		await this.refreshFileMetaForPath(filePath, taskId)
	}

	/**
	 * Compare the on-disk mtime/size against the cached metadata.
	 * Returns `true` when the file appears to have been rewritten since the
	 * last cache refresh (or when metadata is missing).
	 */
	private async hasFileChanged(taskId: string): Promise<boolean> {
		const cached = this.fileMeta.get(taskId)
		try {
			const filePath = await this.getTaskFilePath(taskId)
			const stat = await fs.stat(filePath)
			if (!cached) {
				return true
			}
			return stat.mtimeMs !== cached.mtimeMs || stat.size !== cached.size
		} catch {
			// File is gone or unreadable — treat as changed so reconcile
			// re-evaluates it (refreshTask distinguishes ENOENT from error).
			return true
		}
	}

	// ────────────────────────────── Private: fs.watch ──────────────────────────────

	/**
	 * Watch the tasks directory for changes from other instances/processes.
	 *
	 * Strategy:
	 * - A single non-recursive watcher on the tasks directory detects new /
	 *   removed task subdirectories on all platforms. On a new subdir it arms
	 *   a per-task watcher; on a removed subdir it closes that watcher so we
	 *   don't leak it.
	 * - Per-task directory watchers detect modifications to existing
	 *   `history_item.json` files. When they fire, the changed ID is added to
	 *   a coalescing set and a single debounced pass issues a TARGETED
	 *   {@link refreshTask} per ID — never a full {@link reconcile} scan.
	 * - A periodic full reconcile remains as a fallback for platforms where
	 *   `fs.watch` is unreliable.
	 *
	 * Event-triggered targeted refresh reads the indicated ID unconditionally
	 * (ignoring mtime/size) so a same-size/same-mtime content change is still
	 * picked up. ENOENT on a still-existing task dir removes the cache entry;
	 * a parse/I/O error keeps the good cache entry and logs.
	 */
	private startWatcher(): void {
		if (this.disposed) {
			return
		}

		this.getTasksDir()
			.then((tasksDir) => {
				if (this.disposed) {
					return
				}

				try {
					this.fsWatcher = fsSync.watch(tasksDir, { recursive: false }, (_eventType, filename) => {
						if (this.disposed) {
							return
						}
						if (!filename) {
							return
						}
						// Ignore the index file and hidden files.
						if (filename.startsWith("_") || filename.startsWith(".")) {
							return
						}
						const taskId = filename
						// A new/renamed task subdirectory appeared: arm a
						// per-task watcher so future modifications to its
						// history_item.json are detected. A removed subdir is
						// handled by the per-task watcher's own close path
						// below (and by reconcile's cache-prune).
						this.ensureTaskDirWatcher(taskId).catch(() => {})
						// Schedule a targeted refresh for this ID (the dir
						// add/rename may have brought a new file with it).
						this.scheduleTargetedRefresh(taskId)
					})

					this.fsWatcher.on("error", (err) => {
						console.error("[TaskHistoryStore] fs.watch error:", err)
						// fs.watch is unreliable on some platforms; periodic
						// reconciliation serves as the fallback.
					})
				} catch (err) {
					console.error("[TaskHistoryStore] Failed to start fs.watch:", err)
				}

				// Arm watchers for task directories that already exist.
				this.refreshTaskDirWatchers().catch(() => {})
			})
			.catch((err) => {
				console.error("[TaskHistoryStore] Failed to get tasks dir for watcher:", err)
			})
	}

	/**
	 * Coalesce a watcher-observed change for `taskId` and schedule a single
	 * debounced pass that issues a targeted refresh per pending ID.
	 */
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
			// Targeted refresh per ID — never a full scan. Each refreshTask
			// runs under its own per-ID lock and notifies only if the cache
			// actually changed.
			Promise.all(
				ids.map(async (id) => {
					try {
						const event = await this.refreshTask(id, { external: true })
						if (event) {
							this.scheduleIndexWrite()
							this.notifyChanged(event)
						}
					} catch (err) {
						console.error(`[TaskHistoryStore] targeted refresh for ${id} failed:`, err)
					}
				}),
			).catch(() => {})
		}, TaskHistoryStore.WATCHER_DEBOUNCE_MS)
	}

	/**
	 * (Re)arm per-task watchers for every task directory currently on disk,
	 * and close watchers whose task directory no longer exists.
	 */
	private async refreshTaskDirWatchers(): Promise<void> {
		if (this.disposed) {
			return
		}
		const tasksDir = await this.getTasksDir()
		let entries: string[]
		try {
			entries = await fs.readdir(tasksDir)
		} catch {
			return
		}
		const onDisk = new Set(entries.filter((name) => !name.startsWith("_") && !name.startsWith(".")))
		// Close watchers for dirs that are gone.
		for (const [taskId, watcher] of this.taskDirWatchers) {
			if (!onDisk.has(taskId)) {
				try {
					watcher.close()
				} catch {
					// ignore
				}
				this.taskDirWatchers.delete(taskId)
			}
		}
		// Arm watchers for dirs that exist.
		for (const name of onDisk) {
			await this.ensureTaskDirWatcher(name)
		}
	}

	/**
	 * Arm a watcher for a single task directory if one isn't already active.
	 * The watcher triggers a targeted refresh when `history_item.json`
	 * changes, so cross-instance mutations to existing records are picked up
	 * without a full scan. If the task directory is removed, the watcher
	 * closes itself and we drop it from the map (and prune the cache via a
	 * targeted refresh).
	 */
	private async ensureTaskDirWatcher(taskId: string): Promise<void> {
		if (this.disposed || this.taskDirWatchers.has(taskId)) {
			return
		}
		const tasksDir = await this.getTasksDir()
		const taskDir = path.join(tasksDir, taskId)
		try {
			const stat = await fs.stat(taskDir)
			if (!stat.isDirectory()) {
				return
			}
		} catch {
			// Directory doesn't exist (anymore) — make sure we don't have a
			// stale watcher for it, and schedule a targeted refresh so the
			// cache is pruned.
			const existing = this.taskDirWatchers.get(taskId)
			if (existing) {
				try {
					existing.close()
				} catch {
					// ignore
				}
				this.taskDirWatchers.delete(taskId)
			}
			this.scheduleTargetedRefresh(taskId)
			return
		}

		try {
			const watcher = fsSync.watch(taskDir, { recursive: false }, (_eventType, filename) => {
				if (this.disposed) {
					return
				}
				// Only react to changes that could touch history_item.json.
				if (filename && filename === GlobalFileNames.historyItem) {
					this.scheduleTargetedRefresh(taskId)
				}
			})
			watcher.on("change", () => {
				/* no-op: we already handle the event above */
			})
			watcher.on("error", () => {
				// Per-task watcher errors are non-fatal; periodic reconcile
				// covers us. Drop the broken watcher so a later refresh can
				// re-arm it.
				const current = this.taskDirWatchers.get(taskId)
				if (current === watcher) {
					try {
						watcher.close()
					} catch {
						// ignore
					}
					this.taskDirWatchers.delete(taskId)
				}
			})
			// If the directory was deleted out from under us between stat and
			// watch, the watcher will emit an error or close; handle close by
			// dropping it and pruning the cache.
			watcher.on("close", () => {
				const current = this.taskDirWatchers.get(taskId)
				if (current === watcher) {
					this.taskDirWatchers.delete(taskId)
					this.scheduleTargetedRefresh(taskId)
				}
			})
			this.taskDirWatchers.set(taskId, watcher)
		} catch {
			// Some platforms can't watch every directory; non-fatal.
		}
	}

	/**
	 * Start periodic reconciliation as a defensive fallback for platforms
	 * where fs.watch is unreliable.
	 */
	private startPeriodicReconciliation(): void {
		if (this.disposed) {
			return
		}

		this.reconcileTimer = setTimeout(async () => {
			if (this.disposed) {
				return
			}
			try {
				await this.reconcile()
				// Re-arm watchers for any task dirs added since the last pass
				// and close watchers for dirs that are gone.
				await this.refreshTaskDirWatchers()
			} catch (err) {
				console.error("[TaskHistoryStore] Periodic reconciliation failed:", err)
			}
			this.startPeriodicReconciliation()
		}, TaskHistoryStore.RECONCILE_INTERVAL_MS)
	}

	// ────────────────────────────── Atomic read-modify-write ──────────────────────────────

	/**
	 * Read a HistoryItem, apply an updater, and write the result back to the
	 * per-task file — all while holding the per-ID in-process lock AND the
	 * cross-process `proper-lockfile` lock on that file. This guarantees
	 * that two instances (or two processes) mutating the same task ID cannot
	 * interleave their read and write and lose updates.
	 *
	 * The on-disk file is read fresh under the lock (not the in-memory cache),
	 * so an external mutation that hasn't been reconciled yet is still
	 * observed. The updater receives the current record and returns the new
	 * one synchronously; it must not perform I/O (it runs inside the locked
	 * section and re-entering a store mutation would deadlock on the per-ID
	 * lock). Field merge semantics are the caller's responsibility — the
	 * updater typically spreads the current record so newer fields are
	 * preserved.
	 *
	 * @throws If the on-disk file cannot be read (task missing) or if the
	 *         updater changes the task id.
	 */
	public async atomicReadAndUpdate(
		taskId: string,
		updater: (current: HistoryItem) => HistoryItem,
		origin?: symbol,
	): Promise<HistoryItem> {
		const result = await this.withRecordTransaction(taskId, async ({ filePath, writeJson }) => {
			// Read the authoritative on-disk record under the lock.
			const onDiskResult = await this.readTaskFileResult(filePath)
			if (onDiskResult.status !== "ok") {
				throw new Error(
					`[TaskHistoryStore.atomicReadAndUpdate] read failed for ${taskId}: ${
						onDiskResult.status === "missing"
							? "file not found"
							: onDiskResult.error instanceof Error
								? (onDiskResult.error as Error).message
								: String(onDiskResult.error)
					}`,
				)
			}
			const onDisk = onDiskResult.item

			// Deep-copy so a mutating updater cannot alter cached state before persistence.
			const snapshot = structuredClone(onDisk)
			const updated = updater(snapshot)
			if (!updated || typeof updated.id !== "string" || updated.id !== taskId) {
				throw new Error(
					`[TaskHistoryStore.atomicReadAndUpdate] updater changed task id from ${taskId} to ${updated?.id}`,
				)
			}

			await writeJson(updated)
			// Update the in-memory cache inside the locked section so
			// concurrent in-process readers see the new value.
			this.cache.set(taskId, updated)
			return { record: updated, kind: "upsert" as const }
		})
		this.notifyChanged({ external: false, kind: "upsert", taskId, item: result.record, origin })
		return result.record
	}

	// ────────────────────────────── Private: Transaction helper ──────────────────────────────

	/**
	 * The single internal transaction helper. EVERY mutation that touches one
	 * record (`upsert`, `atomicReadAndUpdate`, `delete`, and the migration
	 * write-back) funnels through here so the lock order is fixed:
	 *
	 *   1. in-process per-ID lock (serialize same-process callers on this ID)
	 *   2. inter-process `proper-lockfile` lock on the per-task file path
	 *   3. fresh read from disk (authoritative, not the stale cache)
	 *   4. merge / mutate / delete (the `body`)
	 *   5. destination-bound atomic JSON write supplied by the lock gateway
	 *   6. update in-memory cache metadata + schedule index write
	 *
	 * The body receives `{ taskId, filePath }` and returns its result. The
	 * body MUST NOT re-enter a store mutation (it would deadlock on the
	 * per-ID lock) and MUST NOT change the task id. The caller is responsible
	 * for notifying subscribers with a precise event based on the result.
	 *
	 * Because every caller enters through the per-ID gate, a public caller
	 * cannot bypass the file lock, and the lock order is always
	 * per-ID-lock → file-lock (never the reverse), so there is no re-entrant
	 * deadlock.
	 */
	private async withRecordTransaction<T>(
		taskId: string,
		body: (ctx: {
			taskId: string
			filePath: string
			ensureTaskDir: () => Promise<void>
			writeJson: LockedJsonWriter
		}) => Promise<T>,
	): Promise<T> {
		// 1. In-process per-ID lock: serialize same-process callers on the
		//    same ID. Different IDs run in parallel.
		const prev = this.perIdLocks.get(taskId) ?? Promise.resolve()
		let releaseNext: () => void = () => {}
		const next = new Promise<void>((resolve) => {
			releaseNext = resolve
		})
		const tail = prev.then(() => next)
		this.perIdLocks.set(taskId, tail)
		await prev
		try {
			if (this.disposed) {
				throw new Error("[TaskHistoryStore] store disposed during transaction")
			}

			const tasksDir = await this.getTasksDir()
			await fs.mkdir(tasksDir, { recursive: true })
			const taskDir = path.join(tasksDir, taskId)
			const filePath = path.join(taskDir, GlobalFileNames.historyItem)
			const lockRoot = path.join(tasksDir, ".history-locks")
			const lockTarget = path.join(lockRoot, `${encodeURIComponent(taskId)}.lock-target`)
			return await withLockedJsonTransaction(lockTarget, filePath, async (writeJson) => {
				const result = await body({
					taskId,
					filePath,
					writeJson,
					ensureTaskDir: async () => {
						await fs.mkdir(taskDir, { recursive: true })
					},
				})
				await this.refreshFileMetaForPath(filePath, taskId)
				this.scheduleIndexWrite()
				return result
			})
		} catch (err) {
			throw err instanceof Error && err.message.startsWith("[TaskHistoryStore]")
				? err
				: new Error(
						`[TaskHistoryStore] transaction failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
						{ cause: err },
					)
		} finally {
			releaseNext()
			// If no one else is waiting on this ID, drop the entry to avoid
			// unbounded map growth.
			if (this.perIdLocks.get(taskId) === tail) {
				this.perIdLocks.delete(taskId)
			}
		}
	}

	// ────────────────────────────── Private: Path helpers ──────────────────────────────

	/**
	 * Get the tasks base directory path, resolving custom storage paths.
	 */
	private async getTasksDir(): Promise<string> {
		const basePath = await getStorageBasePath(this.globalStoragePath)
		return path.join(basePath, "tasks")
	}

	/**
	 * Get the path to a task's `history_item.json` file.
	 */
	private async getTaskFilePath(taskId: string): Promise<string> {
		const tasksDir = await this.getTasksDir()
		return path.join(tasksDir, taskId, GlobalFileNames.historyItem)
	}

	/**
	 * Get the path to the `_index.json` file.
	 */
	private async getIndexPath(): Promise<string> {
		const tasksDir = await this.getTasksDir()
		return path.join(tasksDir, GlobalFileNames.historyIndex)
	}
}
