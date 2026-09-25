import os from "os"
import * as path from "path"
import fs from "fs/promises"

import { Anthropic } from "@anthropic-ai/sdk"

import type { ExtensionMessage, ExtensionState, HistoryItem } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { downloadTask, getTaskFileName } from "../../integrations/misc/export-markdown"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../utils/export"
import { fileExistsAtPath } from "../../utils/fs"
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService"

import type { ContextProxy } from "../config/ContextProxy"
import { TaskHistoryStore, type TaskHistoryStoreHandle } from "../task-persistence"
import { aggregateTaskCostsRecursive, type AggregatedCosts } from "./aggregateTaskCosts"

/**
 * What the task-history gateway needs from its provider. The member names
 * match ClineProvider's, so the provider hands in closures over itself (which
 * also pick up methods that tests replace on the instance) and a test can
 * hand in a plain object.
 */
export interface TaskHistoryGatewayHost {
	/** Webview messages are pushed only while the view is launched. */
	readonly isViewLaunched: boolean
	/** True from the first line of the provider's dispose on. */
	readonly isDisposed: boolean
	readonly contextProxy: Pick<
		ContextProxy,
		| "globalStorageUri"
		| "hasLegacyTaskHistory"
		| "getLegacyTaskHistory"
		| "clearLegacyTaskHistoryKeys"
		| "getValue"
		| "setValue"
	>
	/** The workspace directory, used to delete a task's checkpoints. */
	readonly cwd: string
	log(message: string): void
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	postStateToWebview(): Promise<void>
	postStateToWebviewWithoutClineMessages(): Promise<void>
	getCurrentTask(): { readonly taskId: string } | undefined
	removeClineFromStack(): Promise<void>
}

/**
 * The provider's gateway to the task history (CORE-R6 a): it owns the
 * provider's handle on the shared {@link TaskHistoryStore}, the storage-error
 * banner state and the task-history operations.
 *
 * - Store wiring: one shared, ref-counted store per storage path, acquired
 *   eagerly and reacquired after a failure (see {@link acquire}).
 * - Echo suppression: every write carries {@link origin}; the store echoes it
 *   back on its change event, which is how {@link subscribe} recognises (and
 *   skips) the echo of our own writes. Other providers sharing the store do
 *   act on it.
 * - Storage-error banner: a persistent failure is kept in
 *   {@link storageErrorMessage} and pushed to the webview until cleared.
 *   The provider also reports and clears provider-profile save failures
 *   here, so there is one banner for all persistent storage.
 */
export class TaskHistoryGateway {
	/**
	 * Minimum time between TaskHistoryStore acquire retries after a failure.
	 * Constant on purpose (not configurable): it only guards against a
	 * hammering loop on a permanently broken FS, it is not a tuning knob.
	 */
	static readonly RETRY_COOLDOWN_MS = 5000

	/**
	 * Origin token passed with every task-history mutation this provider
	 * makes. The shared store echoes it back on the change event, which is
	 * how {@link subscribe} recognises (and skips) the echo of our own writes.
	 */
	readonly origin = Symbol("ClineProvider.taskHistoryOrigin")

	/**
	 * In-flight (or settled-successful) {@link TaskHistoryStore} acquire.
	 * Unlike the old `taskHistoryStoreReady` promise, a FAILED acquire clears
	 * this field so the next caller retries the acquire instead of rethrowing
	 * the same rejection forever (one transient I/O error at window start
	 * used to kill all task handling until reload).
	 */
	private storePromise: Promise<TaskHistoryStore> | null = null
	/**
	 * Timestamp of the last failed acquire. A retry cooldown of
	 * {@link TaskHistoryGateway.RETRY_COOLDOWN_MS} keeps a permanently broken
	 * storage path (disk full, read-only FS) from being hammered on every
	 * state push.
	 */
	private lastFailureTs = 0
	/** The error remembered from the last failed acquire; rethrown during the cooldown window. */
	private lastError?: unknown
	/**
	 * Ref-counted handle that owns the shared {@link TaskHistoryStore} for
	 * this storage path. Released in {@link dispose} so the final consumer
	 * tears down the watcher/timers; earlier consumers keep the store alive.
	 */
	private handle?: TaskHistoryStoreHandle
	/** Unsubscribe for the shared store's change notifications. */
	private unsubscribe?: () => void
	/**
	 * Last persistent storage failure, formatted as "<context>: <message>".
	 * Empty string means storage is healthy. Sent to the webview as part of
	 * the state so the StorageErrorBanner can surface failures (disk full,
	 * quota, permissions, Remote SSH server storage) that would otherwise
	 * only show up as a transient toast or a log line.
	 */
	private _storageErrorMessage = ""

	constructor(private readonly host: TaskHistoryGatewayHost) {}

	get storageErrorMessage(): string {
		return this._storageErrorMessage
	}

	// Store wiring

	/**
	 * Acquires the shared, ref-counted {@link TaskHistoryStore} for this
	 * storage path, retrying after failures.
	 *
	 * Semantics:
	 * - Parallel callers share one acquire (no hammering of the store
	 *   registry).
	 * - A failed acquire is remembered for
	 *   {@link TaskHistoryGateway.RETRY_COOLDOWN_MS}; within that window
	 *   callers get the remembered error back without a new acquire, after it
	 *   the acquire is retried.
	 * - On a successful acquire the legacy-history migration runs once
	 *   (idempotent, so re-running after a reacquire is safe) and a
	 *   previously reported storage error is cleared.
	 * - Failures are reported as a persistent storage error (see
	 *   {@link reportStorageError}) and rethrown; task operations must fail
	 *   loudly, the degradation to empty history happens only in the state
	 *   builder.
	 */
	async acquire(): Promise<TaskHistoryStore> {
		// Parallel calls share one acquire attempt; it stays cached until it
		// settles (a failure clears it below, so the next call retries).
		if (this.storePromise) {
			return this.storePromise
		}

		// Cooldown: with a permanently broken storage path every acquire is
		// doomed, so rethrow the remembered error without touching the FS
		// again until the window has elapsed.
		if (Date.now() - this.lastFailureTs < TaskHistoryGateway.RETRY_COOLDOWN_MS) {
			throw this.lastError
		}

		const acquirePromise = TaskHistoryStore.acquire(this.host.contextProxy.globalStorageUri.fsPath)
			.then(async (handle) => {
				if (this.host.isDisposed) {
					handle.dispose()
					throw new Error("ClineProvider was disposed before TaskHistoryStore became ready")
				}
				this.handle = handle
				this.subscribe(handle.store)

				// Legacy migration runs once per successful acquire. A failed
				// migration does NOT fail the acquire: the store itself is
				// usable and the legacy keys are retained for the next retry
				// (the error is reported like any other storage failure).
				try {
					await this.migrateLegacyHistory(handle.store)
					this.clearStorageError()
				} catch (error) {
					this.host.log(`Failed to initialize TaskHistoryStore: ${error}`)
					if (!this.host.isDisposed) {
						this.reportStorageError("TaskHistoryStore", error)
					}
				}

				if (this.host.isDisposed) {
					throw new Error("ClineProvider is disposed")
				}
				return handle.store
			})
			.catch((error) => {
				this.storePromise = null
				this.lastFailureTs = Date.now()
				this.lastError = error
				if (!this.host.isDisposed) {
					this.reportStorageError("TaskHistoryStore", error)
				}
				throw error
			})

		this.storePromise = acquirePromise
		return acquirePromise
	}

	/** The store, acquired on demand; throws once the provider is disposed. */
	async getStore(): Promise<TaskHistoryStore> {
		if (this.host.isDisposed) {
			throw new Error("ClineProvider is disposed")
		}
		const taskHistoryStore = await this.acquire()
		if (this.host.isDisposed) {
			throw new Error("ClineProvider is disposed")
		}
		return taskHistoryStore
	}

	/**
	 * Migrates the legacy `taskHistory` globalState array, if present, into
	 * per-task files before clearing the legacy key.
	 *
	 * Migration safety:
	 * - The legacy array is only read when {@link ContextProxy.hasLegacyTaskHistory}
	 *   reports a value, so starts after a successful cleanup never
	 *   materialize it.
	 * - {@link TaskHistoryStore.migrateFromLegacyHistory} is idempotent and
	 *   never overwrites an existing per-task file, so a partially-migrated
	 *   state resumes without clobbering newer records.
	 * - The legacy keys are cleared only after migration reports success; on
	 *   failure they are left intact so the next start can retry.
	 *
	 * The store is a parameter because {@link acquire} runs the migration on
	 * its fresh handle; awaiting {@link getStore} from inside the acquire
	 * chain would deadlock on its own promise.
	 */
	private async migrateLegacyHistory(store: TaskHistoryStore): Promise<void> {
		const { contextProxy } = this.host

		// One-time backfill from the legacy globalState array. Skipped
		// entirely (no read, no writes) once cleanup has run.
		if (contextProxy.hasLegacyTaskHistory()) {
			const legacy = contextProxy.getLegacyTaskHistory<HistoryItem>() ?? []
			if (legacy.length > 0) {
				this.host.log(`[initializeTaskHistoryStore] Migrating ${legacy.length} legacy entries`)
				const ok = await store.migrateFromLegacyHistory(legacy)
				if (!ok) {
					this.host.log(
						"[initializeTaskHistoryStore] Migration incomplete, legacy keys retained for retry",
					)
					return
				}
				this.host.log("[initializeTaskHistoryStore] Migration complete")
			}
			// Only clear after a successful migration (or when the
			// legacy array was empty: nothing to migrate).
			await contextProxy.clearLegacyTaskHistoryKeys()
		}
	}

	/**
	 * Reacts to changes in the shared store. The store fires one event per
	 * change with `kind` ("upsert" | "delete" | "external"), the affected
	 * `taskId`/`item` when known, and the `origin` token of the writer.
	 *
	 * - A mutation made through THIS provider (`updateTaskHistory`,
	 *   `deleteTaskFromState`, `deleteTaskWithId`, the delegation
	 *   `atomicReadAndUpdate`) carries {@link origin}; it is skipped because
	 *   the caller already sent the targeted webview message. Other
	 *   providers sharing the store do act on it.
	 * - A mutation made by ANOTHER provider sharing the store is pushed as a
	 *   targeted `taskHistoryItemUpdated` / `taskHistoryItemDeleted`
	 *   message, without rebroadcasting the full history.
	 * - An `external` change (the watcher or periodic reconcile picked up a
	 *   change from another process, or an explicit invalidate) falls back
	 *   to a full `taskHistoryUpdated` broadcast, because the watcher
	 *   coalesces IDs and a targeted message per ID is not always available.
	 */
	private subscribe(taskHistoryStore: TaskHistoryStore): void {
		this.unsubscribe = taskHistoryStore.onChange((event) => {
			if (event.origin === this.origin || !this.host.isViewLaunched || this.host.isDisposed) {
				return
			}

			if (event.kind === "delete" && event.taskId) {
				this.host
					.postMessageToWebview({
						type: "taskHistoryItemDeleted",
						taskHistoryItemId: event.taskId,
					})
					.catch((err) => {
						this.host.log(
							`[TaskHistoryStore onChange] targeted delete push failed: ${err instanceof Error ? err.message : String(err)}`,
						)
					})
			} else if (event.kind === "upsert" && event.item) {
				this.host
					.postMessageToWebview({
						type: "taskHistoryItemUpdated",
						taskHistoryItem: event.item,
					})
					.catch((err) => {
						this.host.log(
							`[TaskHistoryStore onChange] targeted upsert push failed: ${err instanceof Error ? err.message : String(err)}`,
						)
					})
			} else if (event.kind === "external") {
				this.broadcastTaskHistoryUpdate().catch((err) => {
					this.host.log(
						`[TaskHistoryStore onChange] broadcast failed: ${err instanceof Error ? err.message : String(err)}`,
					)
				})
			}
		})
	}

	/**
	 * Stops listening to the store and releases the shared handle. The final
	 * consumer's release disposes the underlying watcher/timers; earlier
	 * consumers only detach so closing one panel never breaks the others.
	 */
	dispose(): void {
		this.unsubscribe?.()
		this.unsubscribe = undefined
		this.handle?.dispose()
		this.handle = undefined
		// Hygiene: an acquire still in flight is already caught by the
		// isDisposed guard inside acquire, but a settled promise must not
		// survive dispose either.
		this.storePromise = null
	}

	// Storage-error banner

	/**
	 * Records a persistent storage failure and makes it visible: it is
	 * logged to the Output channel and pushed to the webview as part of the
	 * state, where the StorageErrorBanner renders it until
	 * {@link clearStorageError} runs.
	 *
	 * Reporting the same message twice is a no-op (the provider wires two
	 * catch sites onto the same acquire rejection), so the webview is not
	 * spammed with identical state pushes.
	 */
	reportStorageError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error)
		const storageErrorMessage = `${context}: ${message}`
		this.host.log(`[storage error] ${storageErrorMessage}`)

		if (this._storageErrorMessage === storageErrorMessage) {
			return
		}

		this._storageErrorMessage = storageErrorMessage
		this.postStorageErrorState()
	}

	/**
	 * Clears the persistent storage error marker. Posts state only when an
	 * error was actually set, so healthy paths do not trigger pushes.
	 */
	clearStorageError(): void {
		if (!this._storageErrorMessage) {
			return
		}

		this._storageErrorMessage = ""
		this.postStorageErrorState()
	}

	/**
	 * Pushes the storage error flag to the webview. The full state build
	 * awaits the TaskHistoryStore, which is often the very component that
	 * failed here, so the full push can reject until the store recovers. In
	 * that case fall back to a minimal partial state push (the webview
	 * merges partial state) so the banner still appears.
	 */
	private postStorageErrorState(): void {
		this.host.postStateToWebviewWithoutClineMessages().catch((postError) => {
			this.host.log(
				`[storage error] Failed to post full state: ${postError instanceof Error ? postError.message : String(postError)}`,
			)
			this.host
				.postMessageToWebview({
					type: "state",
					// Partial state on purpose: the webview merges it into its
					// current state instead of replacing it.
					state: { storageErrorMessage: this._storageErrorMessage } as ExtensionState,
				})
				.catch((pushError) => {
					this.host.log(
						`[storage error] Failed to post partial state: ${pushError instanceof Error ? pushError.message : String(pushError)}`,
					)
				})
		})
	}

	// Task-history operations

	/**
	 * Looks up a task's history item without touching its conversation
	 * file. Use this unless you need the API conversation or its file paths
	 * (then use {@link getTaskWithId}). Throws "Task not found" like it.
	 */
	async getHistoryItem(id: string): Promise<HistoryItem> {
		// Ensure the store is initialized before reading: an early task lookup
		// (e.g. resume via command before the constructor's fire-and-forget init
		// completes) would otherwise miss entries that haven't been loaded yet.
		const taskHistoryStore = await this.getStore()

		const historyItem = taskHistoryStore.get(id)

		if (!historyItem) {
			throw new Error("Task not found")
		}

		return historyItem
	}

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const historyItem = await this.getHistoryItem(id)

		const { getTaskDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.host.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
		const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
		const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
		const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)

		let apiConversationHistory: Anthropic.MessageParam[] = []

		if (fileExists) {
			try {
				apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
			} catch (error) {
				console.warn(
					`[getTaskWithId] api_conversation_history.json corrupted for task ${id}, returning empty history: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} else {
			console.warn(
				`[getTaskWithId] api_conversation_history.json missing for task ${id}, returning empty history`,
			)
		}

		return {
			historyItem,
			taskDirPath,
			apiConversationHistoryFilePath,
			uiMessagesFilePath,
			apiConversationHistory,
		}
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		const historyItem = await this.getHistoryItem(taskId)

		const aggregatedCosts = await aggregateTaskCostsRecursive(taskId, async (id: string) => {
			return this.getHistoryItem(id)
		})

		return { historyItem, aggregatedCosts }
	}

	async exportTaskWithId(id: string): Promise<void> {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		const fileName = getTaskFileName(historyItem.ts)
		const defaultUri = await resolveDefaultSaveUri(this.host.contextProxy, "lastTaskExportPath", fileName, {
			useWorkspace: false,
			fallbackDir: path.join(os.homedir(), "Downloads"),
		})
		const saveUri = await downloadTask(historyItem.ts, apiConversationHistory, defaultUri)

		if (saveUri) {
			await saveLastExportPath(this.host.contextProxy, "lastTaskExportPath", saveUri)
		}
	}

	// this function deletes a task from task history, and deletes its checkpoints and delete the task folder
	// If the task has subtasks (childIds), they will also be deleted recursively
	async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true): Promise<void> {
		try {
			// Existence check: throws "Task not found" (handled below).
			await this.getHistoryItem(id)

			// Collect all task IDs to delete (parent + all subtasks)
			const allIdsToDelete: string[] = [id]

			if (cascadeSubtasks) {
				// Recursively collect all child IDs
				const collectChildIds = async (taskId: string): Promise<void> => {
					try {
						const item = await this.getHistoryItem(taskId)
						if (item.childIds && item.childIds.length > 0) {
							for (const childId of item.childIds) {
								allIdsToDelete.push(childId)
								await collectChildIds(childId)
							}
						}
					} catch (error) {
						// Child task may already be deleted or not found, continue
						console.log(`[deleteTaskWithId] child task ${taskId} not found, skipping`)
					}
				}

				await collectChildIds(id)
			}

			// Remove from stack if any of the tasks to delete are in the current task stack
			for (const taskId of allIdsToDelete) {
				if (taskId === this.host.getCurrentTask()?.taskId) {
					// Close the current task instance; delegation flows will be handled via metadata if applicable.
					await this.host.removeClineFromStack()
					break
				}
			}

			// Delete all tasks from state in one batch. Mark each as
			// self-originated so the shared store's onChange echo
			// (external:false) is suppressed for us; we send our own
			// targeted delete messages below. Other providers sharing the
			// store still receive the echo and push their own targeted
			// deletes.
			const taskHistoryStore = await this.getStore()
			await taskHistoryStore.deleteMany(allIdsToDelete, this.origin)
			// Push a targeted delete message per ID so the webview removes
			// just these items without a full history resend (the full state
			// push below still runs for legacy callers).
			if (this.host.isViewLaunched) {
				for (const taskId of allIdsToDelete) {
					await this.host
						.postMessageToWebview({
							type: "taskHistoryItemDeleted",
							taskHistoryItemId: taskId,
						})
						.catch((err) => {
							this.host.log(
								`[deleteTaskWithId] targeted delete push failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
							)
						})
				}
			}

			// Delete associated shadow repositories or branches and task directories
			const globalStorageDir = this.host.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.host.cwd
			const { getTaskDirectoryPath } = await import("../../utils/storage")
			const globalStoragePath = this.host.contextProxy.globalStorageUri.fsPath

			for (const taskId of allIdsToDelete) {
				try {
					await ShadowCheckpointService.deleteTask({ taskId, globalStorageDir, workspaceDir })
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				// Delete the task directory
				try {
					const dirPath = await getTaskDirectoryPath(globalStoragePath, taskId)
					await fs.rm(dirPath, { recursive: true, force: true })
					console.log(`[deleteTaskWithId${taskId}] removed task directory`)
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			await this.host.postStateToWebview()
		} catch (error) {
			// If task is not found, just remove it from state
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string): Promise<void> {
		// Mark this as a self-originated mutation so the shared store's
		// `onChange` echo (external:false) is suppressed for us; we send
		// our own targeted delete message below. Other providers sharing the
		// store still receive the echo and push their own targeted delete.
		const taskHistoryStore = await this.getStore()
		await taskHistoryStore.delete(id, this.origin)

		// Send a targeted delete message so the webview removes just this
		// item without a full history resend. The full state push below
		// still runs for legacy callers, but the webview's history list is
		// updated by this lightweight message first.
		if (this.host.isViewLaunched) {
			await this.host
				.postMessageToWebview({
					type: "taskHistoryItemDeleted",
					taskHistoryItemId: id,
				})
				.catch((err) => {
					this.host.log(
						`[deleteTaskFromState] targeted delete push failed: ${err instanceof Error ? err.message : String(err)}`,
					)
				})
		}

		await this.host.postStateToWebview()
	}

	/**
	 * Updates a task in the task history and optionally broadcasts the
	 * updated item to the webview. Delegates persistence to the shared
	 * {@link TaskHistoryStore}.
	 *
	 * Returns `void`: callers that need the full sorted history should call
	 * {@link getTaskHistory} explicitly. This avoids copying and sorting the
	 * entire history on every mutation; the webview is kept in sync via the
	 * targeted `taskHistoryItemUpdated` message and the store's
	 * {@link TaskHistoryStore.onChange} subscription.
	 *
	 * @param item The history item to update or add
	 * @param options.broadcast Whether to broadcast the updated item to the webview (default: true)
	 */
	async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<void> {
		const { broadcast = true } = options

		// Mark this as a self-originated mutation so the shared store's
		// `onChange` echo (external:false) is suppressed for us; we send
		// our own targeted message below. Other providers sharing the store
		// still receive the echo and push their own targeted update.
		const taskHistoryStore = await this.getStore()
		await taskHistoryStore.upsert(item, this.origin)

		// Broadcast the updated item to the webview if requested.
		// Prefer per-item updates to avoid repeatedly cloning/sending the full history.
		if (broadcast && this.host.isViewLaunched) {
			const updatedItem = taskHistoryStore.get(item.id) ?? item
			await this.host.postMessageToWebview({ type: "taskHistoryItemUpdated", taskHistoryItem: updatedItem })
		}
	}

	/**
	 * Broadcasts a task history update to the webview.
	 * This sends a lightweight message with just the task history, rather than the full state.
	 * @param history The task history to broadcast (if not provided, reads from the store)
	 */
	async broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		if (!this.host.isViewLaunched) {
			return
		}

		const taskHistoryStore = await this.getStore()
		const taskHistory = history ?? taskHistoryStore.getAll()

		// Sort and filter the history the same way as getStateToPostToWebview
		const sortedHistory = taskHistory
			.filter((item: HistoryItem) => item.ts && item.task)
			.sort((a: HistoryItem, b: HistoryItem) => b.ts - a.ts)

		await this.host.postMessageToWebview({
			type: "taskHistoryUpdated",
			taskHistory: sortedHistory,
		})
	}

	/**
	 * Focused accessor for the full task history from the store.
	 *
	 * Used by consumers (e.g. TaskLifecycle auto-dream) that previously read
	 * `taskHistory` from globalState. The TaskHistoryStore is the sole
	 * persistence source, so this replaces those globalState reads.
	 *
	 * @returns All history items sorted by timestamp descending (newest first).
	 */
	async getTaskHistory(): Promise<HistoryItem[]> {
		return (await this.getStore()).getAll()
	}

	/**
	 * Atomically read a task's `HistoryItem`, apply `updater`, and write it
	 * back with {@link origin}. Throws if the store is missing the task.
	 */
	async atomicReadAndUpdateHistoryItem(
		taskId: string,
		updater: (current: HistoryItem) => HistoryItem,
	): Promise<HistoryItem> {
		const taskHistoryStore = await this.getStore()
		return taskHistoryStore.atomicReadAndUpdate(taskId, updater, this.origin)
	}
}
