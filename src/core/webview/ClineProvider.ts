import os from "os"
import * as path from "path"
import fs from "fs/promises"
import EventEmitter from "events"

import delay from "delay"
import axios from "axios"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
	type GlobalState,
	type ProviderSettings,
	type CliModeProviderSettings,
	type RooCodeSettings,
	type ProviderSettingsEntry,
	type StaticAppProperties,
	type DynamicAppProperties,
	type CloudAppProperties,
	type TaskProperties,
	type GitProperties,
	type TelemetryProperties,
	type TelemetryPropertiesProvider,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	type HistoryItem,
	type CreateTaskOptions,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceInstalledMetadata,
	RooCodeEventName,
	openRouterDefaultModelId,
	DEFAULT_MODES,
	isRetiredProvider,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { CloudService } from "@roo-code/cloud"

import { Package } from "../../shared/package"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { Mode } from "../../shared/modes"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"

import { Terminal } from "../../integrations/terminal/Terminal"
import { getCustomSoundsDir } from "../../integrations/misc/custom-sounds"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"

import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { MarketplaceManager } from "../../services/marketplace"
import { CodeIndexManager } from "../../services/code-index/manager"
import type { IndexProgressUpdate } from "../../services/code-index/interfaces/manager"
import { MdmService } from "../../services/mdm/MdmService"
import { SkillsManager } from "../../services/skills/SkillsManager"

import { getWorkspaceGitInfo } from "../../utils/git"
import { getWorkspacePath } from "../../utils/path"
import { OrganizationAllowListViolationError } from "../../utils/errors"

import { setPanel } from "./panelRegistry"

import { t } from "../../i18n"

import { buildApiHandler } from "../../api"
import { forceFullModelDetailsLoad, hasLoadedFullDetails } from "../../api/providers/fetchers/lmstudio"

import { ContextProxy } from "../config/ContextProxy"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { Task } from "../task/Task"
import type { SubTaskRunner } from "../memory"

import { webviewMessageHandler } from "./webviewMessageHandler"
import type { TodoItem } from "@roo-code/types"
import type { TaskHistoryStore } from "../task-persistence"
import { SubagentRegistry } from "./SubagentRegistry"
import { ProviderStateBuilder, type ProviderState } from "./ProviderStateBuilder"
import { DelegationService } from "./DelegationService"
import { CloudProfileSync } from "./CloudProfileSync"
import { ModeProfileBinding } from "./ModeProfileBinding"
import { forwardTaskEvents, type TaskEventForwardingHost } from "./taskEventForwarding"
import { getHmrHtml, getProductionHtml, openRouterOrigin, type WebviewHtmlOptions } from "./WebviewHtml"
import { TaskHistoryGateway } from "./TaskHistoryGateway"
import { BackgroundTaskRunner, type BackgroundTaskOptions, type BackgroundTaskOutcome } from "./BackgroundTaskRunner"
import { profileTaskOptions } from "./profileTaskOptions"

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

interface PendingEditOperation {
	messageTs: number
	editedContent: string
	images?: string[]
	messageIndex: number
	apiConversationHistoryIndex: number
	timeoutId: NodeJS.Timeout
	createdAt: number
}

export class ClineProvider
	extends EventEmitter<TaskProviderEvents>
	implements vscode.WebviewViewProvider, TelemetryPropertiesProvider, TaskProviderLike
{
	// Used in package.json as the view's id. This value cannot be changed due
	// to how VSCode caches views based on their id, and updating the id would
	// break existing instances of the extension.
	public static readonly sideBarId = `${Package.name}.SidebarProvider`
	public static readonly tabPanelId = `${Package.name}.TabPanelProvider`
	private static activeInstances: Set<ClineProvider> = new Set()
	private disposables: vscode.Disposable[] = []
	private webviewDisposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private clineStack: Task[] = []
	// Live summaries + tail subscriptions for the UI-visible subset of
	// backgroundTasks (parallel subagents). Memory writers never register.
	// The `currentTaskIdProvider` stamps `sourceTaskId` on every
	// `subagentsUpdated` push so the webview can scope updates by
	// `currentTaskId` (defense-in-depth against late terminal updates from a
	// just-abandoned task leaking into the new task's panel).
	public readonly subagentRegistry = new SubagentRegistry(
		(message) => {
			this.postMessageToWebview(message).catch(() => {})
		},
		() => this.getCurrentTask()?.taskId,
	)
	private codeIndexStatusSubscription?: vscode.Disposable
	private codeIndexManager?: CodeIndexManager
	private _workspaceTracker?: WorkspaceTracker // workSpaceTracker read-only for access outside this class
	protected mcpHub?: McpHub // Change from private to protected
	protected skillsManager?: SkillsManager
	private marketplaceManager: MarketplaceManager
	private mdmService?: MdmService
	private taskCreationCallback: (task: Task) => void
	private taskEventListeners: WeakMap<Task, Array<() => void>> = new WeakMap()
	private currentWorkspacePath: string | undefined
	private _disposed = false

	/**
	 * Mode-to-profile binding and profile activation (CORE-R6 c), including
	 * the CLI's per-mode provider settings.
	 */
	private readonly modeProfiles: ModeProfileBinding
	/**
	 * The task-history gateway (CORE-R6 a): the shared TaskHistoryStore
	 * handle, echo suppression, the storage-error banner and the history
	 * operations.
	 */
	private readonly taskHistory: TaskHistoryGateway
	/**
	 * Chat-message edits waiting for the user to confirm a checkpoint
	 * restore, keyed by operation ID. Written by
	 * {@link setPendingEditOperation} (from checkpointRestoreHandler) and
	 * consumed when the restore finishes; each entry clears itself after
	 * {@link ClineProvider.PENDING_OPERATION_TIMEOUT_MS}.
	 */
	private pendingOperations: Map<string, PendingEditOperation> = new Map()
	private static readonly PENDING_OPERATION_TIMEOUT_MS = 30000 // 30 seconds

	/**
	 * Monotonically increasing sequence number for clineMessages state pushes.
	 * Used by the frontend to reject stale state that arrives out-of-order.
	 * Stamped in getStateToPostToWebview at the moment clineMessages is read, so the
	 * number follows the age of the snapshot even when overlapping builds finish
	 * (and are posted) in a different order.
	 */
	private clineMessagesSeq = 0

	/** Builds getState() and the webview state (CORE-R1). */
	private readonly stateBuilder: ProviderStateBuilder

	/** The parent/child delegation state machine (CORE-R2). */
	private readonly delegation: DelegationService

	/** Keeps local provider profiles in step with the cloud organization (CORE-R6 b). */
	private readonly cloudProfileSync: CloudProfileSync

	/**
	 * Headless background tasks: memory writers and parallel subagents
	 * (CORE-R6 d). Kept OFF `clineStack` so `getCurrentTask()` and the webview
	 * stay bound to the foreground task.
	 */
	private readonly backgroundTaskRunner: BackgroundTaskRunner

	public isViewLaunched = false
	public settingsImportedAt?: number
	public readonly latestAnnouncementId = "apr-2026-v3.53.0-community-handoff-gpt55-opus47" // v3.53.0 Community handoff, GPT-5.5, Claude Opus 4.7, checkpoint navigation
	public readonly providerSettingsManager: ProviderSettingsManager
	public readonly customModesManager: CustomModesManager

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: ContextProxy,
		mdmService?: MdmService,
	) {
		super()
		this.currentWorkspacePath = getWorkspacePath()

		ClineProvider.activeInstances.add(this)

		this.mdmService = mdmService
		// Closures, not `this`: they reach private members and pick up
		// methods that tests replace on the instance after construction.
		const isViewLaunched = () => this.isViewLaunched
		const isDisposed = () => this._disposed
		const getCwd = () => this.cwd
		this.taskHistory = new TaskHistoryGateway({
			get isViewLaunched() {
				return isViewLaunched()
			},
			get isDisposed() {
				return isDisposed()
			},
			get cwd() {
				return getCwd()
			},
			contextProxy,
			log: (message) => this.log(message),
			postMessageToWebview: (message) => this.postMessageToWebview(message),
			postStateToWebview: () => this.postStateToWebview(),
			postStateToWebviewWithoutClineMessages: () => this.postStateToWebviewWithoutClineMessages(),
			getCurrentTask: () => this.getCurrentTask(),
			removeClineFromStack: () => this.removeClineFromStack(),
		})
		this.stateBuilder = new ProviderStateBuilder({
			contextProxy,
			getCustomModes: () => this.customModesManager.getCustomModes(),
			getCwd: () => this.cwd,
			getMcpServers: () => this.mcpHub?.getAllServers() ?? [],
			isApiConfigLockedAcrossModes: () => this.context.workspaceState.get("lockApiConfigAcrossModes", false),
			getState: () => this.getState(),
			getTaskHistoryStore: () => this.getTaskHistoryStore(),
			log: (message) => this.log(message),
			getCurrentTask: () => this.getCurrentTask(),
			nextClineMessagesSeq: () => ++this.clineMessagesSeq,
			listSubagents: () => this.subagentRegistry.list(),
			getMemoryActivity: () => this.backgroundTaskRunner.memoryActivity,
			getWebview: () => this.view?.webview,
			getExtensionVersion: () => this.context.extension?.packageJSON?.version ?? "",
			getStorageErrorMessage: () => this.taskHistory.storageErrorMessage,
			getSettingsImportedAt: () => this.settingsImportedAt,
			getCloudAuthSkipModel: () => this.context.globalState.get<boolean>("roo-auth-skip-model"),
			getHasOpenedModeSelector: () => this.getGlobalState("hasOpenedModeSelector"),
			getMdmCompliance: () => (this.mdmService?.requiresCloudAuth() ? this.checkMdmCompliance() : undefined),
			latestAnnouncementId: this.latestAnnouncementId,
			renderContext: this.renderContext,
		})
		this.delegation = new DelegationService({
			get isViewLaunched() {
				return isViewLaunched()
			},
			contextProxy,
			taskHistoryOrigin: this.taskHistory.origin,
			getTaskHistoryStore: () => this.getTaskHistoryStore(),
			getHistoryItem: (id) => this.getHistoryItem(id),
			updateTaskHistory: (item) => this.updateTaskHistory(item),
			postMessageToWebview: (message) => this.postMessageToWebview(message),
			log: (message) => this.log(message),
			getCurrentTask: () => this.getCurrentTask(),
			getCurrentTaskStack: () => this.getCurrentTaskStack(),
			removeClineFromStack: (options) => this.removeClineFromStack(options),
			createTask: (text, images, parentTask, options) => this.createTask(text, images, parentTask, options),
			createTaskWithHistoryItem: (item, options) => this.createTaskWithHistoryItem(item, options),
			handleModeSwitch: (mode) => this.handleModeSwitch(mode),
			emit: (event, ...args) => this.emit(event as any, ...(args as any)),
			showAllowListViolation: (error) => this.showAllowListViolation(error),
		})
		const getProviderSettingsManager = () => this.providerSettingsManager
		this.modeProfiles = new ModeProfileBinding({
			contextProxy,
			get providerSettingsManager() {
				return getProviderSettingsManager()
			},
			isApiConfigLockedAcrossModes: () => this.context.workspaceState.get("lockApiConfigAcrossModes", false),
			getCustomModes: () => this.customModesManager.getCustomModes(),
			getState: () => this.getState(),
			updateGlobalState: (key, value) => this.updateGlobalState(key, value),
			getGlobalState: (key) => this.getGlobalState(key),
			getCurrentTask: () => this.getCurrentTask(),
			getTaskHistoryStore: () => this.getTaskHistoryStore(),
			updateTaskHistory: (item) => this.updateTaskHistory(item),
			activateProviderProfile: (...args) => this.activateProviderProfile(...args),
			postStateToWebview: () => this.postStateToWebview(),
			emitModeChanged: (mode) => this.emit(RooCodeEventName.ModeChanged, mode),
			emitProviderProfileChanged: (profile) => this.emit(RooCodeEventName.ProviderProfileChanged, profile),
			clearStorageError: () => this.taskHistory.clearStorageError(),
			reportStorageError: (error) => this.taskHistory.reportStorageError("ProviderProfile", error),
			log: (message) => this.log(message),
		})
		this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES)

		// Acquire a shared, ref-counted TaskHistoryStore for this storage
		// path. Multiple ClineProvider instances (sidebar + editor tab,
		// multiple windows on the same storage) share one watcher/timer set;
		// the final dispose tears them down. Distinct storage paths or
		// contexts get distinct stores. Path aliases that canonicalize to the
		// same path (trailing separator, `.`/`..` segments, mixed separators)
		// collapse to one store.
		//
		// Eager init stays, but a failure is no longer permanent:
		// TaskHistoryGateway.acquire clears the remembered promise on failure
		// so the next getTaskHistoryStore() retries, and it reports the
		// failure as a persistent storage error (see TaskHistoryGateway.reportStorageError).
		void this.taskHistory.acquire().catch(() => {
			// Already reported by TaskHistoryGateway.acquire; the eager init
			// must not surface as an unhandled rejection.
		})

		// Register this provider with the telemetry service to enable it to add
		// properties like mode and provider.
		TelemetryService.instance.setProvider(this)

		this._workspaceTracker = new WorkspaceTracker(this)

		this.providerSettingsManager = new ProviderSettingsManager(this.context)
		this.cloudProfileSync = new CloudProfileSync({
			contextProxy,
			get providerSettingsManager() {
				return getProviderSettingsManager()
			},
			activateProviderProfile: (args) => this.activateProviderProfile(args),
			postStateToWebviewWithoutClineMessages: () => this.postStateToWebviewWithoutClineMessages(),
			log: (message) => this.log(message),
		})
		const getTaskCreationCallback = () => this.taskCreationCallback
		const getGlobalStoragePath = () => this.globalStoragePath
		this.backgroundTaskRunner = new BackgroundTaskRunner({
			provider: this,
			get globalStoragePath() {
				return getGlobalStoragePath()
			},
			subagentRegistry: this.subagentRegistry,
			get taskCreationCallback() {
				return getTaskCreationCallback()
			},
			getState: () => this.getState(),
			getApiConfigurationForMode: (mode) => this.getApiConfigurationForMode(mode),
			getMemoryWriterApiConfigId: () => this.getValue("memoryWriterApiConfigId"),
			activateProfile: (params) => this.providerSettingsManager.activateProfile(params),
			postMessageToWebview: (message) => this.postMessageToWebview(message),
			log: (message) => this.log(message),
		})

		this.customModesManager = new CustomModesManager(this.context, async () => {
			await this.postStateToWebviewWithoutClineMessages()
		})

		// Initialize MCP Hub through the singleton manager
		McpServerManager.getInstance(this.context, this)
			.then((hub) => {
				this.mcpHub = hub
				this.mcpHub.registerClient()
			})
			.catch((error) => {
				this.log(`Failed to initialize MCP Hub: ${error}`)
			})

		// Initialize Skills Manager for skill discovery
		this.skillsManager = new SkillsManager(this)
		this.skillsManager.initialize().catch((error) => {
			this.log(`Failed to initialize Skills Manager: ${error}`)
		})

		this.marketplaceManager = new MarketplaceManager(this.context, this.customModesManager)

		// Forward <most> task events to the provider (the table lives in
		// taskEventForwarding.ts, CORE-R6 f). We do something fairly similar
		// for the IPC-based API.
		const getSubagentRegistry = () => this.subagentRegistry
		const forwardingHost: TaskEventForwardingHost = {
			emit: (event, ...args) => this.emit(event as any, ...(args as any)),
			get subagentRegistry() {
				return getSubagentRegistry()
			},
			rehydrateAfterStreamingFailure: (task) => this.rehydrateAfterStreamingFailure(task as Task),
		}
		this.taskCreationCallback = (instance: Task) => {
			this.emit(RooCodeEventName.TaskCreated, instance)

			// Store the cleanup functions for later removal.
			this.taskEventListeners.set(instance, forwardTaskEvents(instance, forwardingHost))
		}

		// Initialize Roo Code Cloud profile sync. When CloudService is not
		// ready yet, extension activation calls
		// initializeCloudProfileSyncWhenReady() again once it is.
		if (CloudService.hasInstance()) {
			void this.initializeCloudProfileSyncWhenReady()
		} else {
			this.log("CloudService not ready, deferring cloud profile sync")
		}
	}

	/**
	 * Reveals the extension's Output channel. Used by the webview's
	 * StorageErrorBanner so the user can inspect the log entries behind a
	 * reported storage failure (crucial in Remote SSH windows where storage
	 * lives on the server).
	 */
	public showOutputChannel(): void {
		this.outputChannel.show(true)
	}

	/** The shared TaskHistoryStore, acquired on demand (see {@link TaskHistoryGateway.getStore}). */
	private getTaskHistoryStore(): Promise<TaskHistoryStore> {
		return this.taskHistory.getStore()
	}

	/**
	 * Override EventEmitter's on method to match TaskProviderLike interface
	 */
	override on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.on(event, listener as any)
	}

	/**
	 * Override EventEmitter's off method to match TaskProviderLike interface
	 */
	override off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.off(event, listener as any)
	}

	/**
	 * After a task's abort has been forwarded: rehydrate it from history, but
	 * only on a genuine streaming failure of a foreground task. User-initiated
	 * cancels are handled by cancelTask(); background tasks (memory writers,
	 * subagents) are never on the stack and must not rehydrate as a
	 * foreground task. Never throws.
	 */
	private async rehydrateAfterStreamingFailure(instance: Task): Promise<void> {
		try {
			if (instance.abortReason === "streaming_failed" && !instance.isBackground) {
				// Defensive safeguard: if another path already replaced this instance, skip
				const current = this.getCurrentTask()
				if (current && current.instanceId !== instance.instanceId) {
					this.log(
						`[onTaskAborted] Skipping rehydrate: current instance ${current.instanceId} != aborted ${instance.instanceId}`,
					)
					return
				}

				const historyItem = await this.getHistoryItem(instance.taskId)
				const rootTask = instance.rootTask
				const parentTask = instance.parentTask
				await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
			}
		} catch (error) {
			this.showAllowListViolation(error)
			this.log(
				`[onTaskAborted] Failed to rehydrate after streaming failure: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * Initialize cloud profile synchronization: sync now if signed in, and
	 * (re)subscribe to settings updates. Idempotent, never throws. Called from
	 * the constructor when CloudService already exists and again by extension
	 * activation once CloudService has been initialized.
	 * See {@link CloudProfileSync.initializeWhenReady}.
	 */
	public initializeCloudProfileSyncWhenReady(): Promise<void> {
		return this.cloudProfileSync.initializeWhenReady()
	}

	// Adds a new Task instance to clineStack, marking the start of a new task.
	// The instance is pushed to the top of the stack (LIFO order).
	// When the task is completed, the top instance is removed, reactivating the
	// previous task.
	async addClineToStack(task: Task) {
		// Add this cline instance into the stack that represents the order of
		// all the called tasks.
		this.clineStack.push(task)
		task.emit(RooCodeEventName.TaskFocused)

		// Perform special setup provider specific tasks.
		await this.performPreparationTasks(task)

		// Ensure getState() resolves correctly.
		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	async performPreparationTasks(cline: Task) {
		// LMStudio: We need to force model loading in order to read its context
		// size; we do it now since we're starting a task with that model selected.
		if (cline.apiConfiguration && cline.apiConfiguration.apiProvider === "lmstudio") {
			try {
				if (!hasLoadedFullDetails(cline.apiConfiguration.lmStudioModelId!)) {
					await forceFullModelDetailsLoad(
						cline.apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234",
						cline.apiConfiguration.lmStudioModelId!,
					)
				}
			} catch (error) {
				this.log(`Failed to load full model details for LM Studio: ${error}`)
				vscode.window.showErrorMessage(error.message)
			}
		}
	}

	// Removes and destroys the top Cline instance (the current finished task),
	// activating the previous one (resuming the parent task).
	async removeClineFromStack(options?: { skipDelegationRepair?: boolean }) {
		if (this.clineStack.length === 0) {
			return
		}

		// Pop the top Cline instance from the stack.
		let task = this.clineStack.pop()

		if (task) {
			// Capture delegation metadata before abort/dispose, since abortTask(true)
			// is async and the task reference is cleared afterwards.
			const childTaskId = task.taskId
			const parentTaskId = task.parentTaskId

			// NOTE: deliberately no subagentRegistry cleanup here. Popping a
			// task is often mere abandonment (switching tasks via history, an
			// in-place rehydrate) — its fan-out children keep running detached
			// and must stay visible in the panel. The panel is reset at task
			// boundaries by the entry points (createTask / clearTask /
			// createTaskWithHistoryItem) via `resetSubagentPanel`, NOT here,
			// so mid-task re-fan-out for the same parent (beginFanOut) keeps
			// its semantics. For a pure abandonment (history switch), the
			// detached children stay visible until the next task boundary.

			task.emit(RooCodeEventName.TaskUnfocused)

			try {
				// Abort the running task and set isAbandoned to true so
				// all running promises will exit as well.
				await task.abortTask(true)
			} catch (e) {
				this.log(
					`[ClineProvider#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners before clearing the reference.
			const cleanupFunctions = this.taskEventListeners.get(task)

			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(task)
			}

			// Make sure no reference kept, once promises end it will be
			// garbage collected.
			task = undefined

			// Delegation-aware parent metadata repair:
			// If the popped task was a delegated child, repair the parent's metadata
			// so it transitions from "delegated" back to "active" and becomes resumable
			// from the task history list.
			// Skip when called from delegateParentAndOpenChild() during nested delegation
			// transitions (A→B→C), where the caller intentionally replaces the active
			// child and will update the parent to point at the new child.
			if (parentTaskId && childTaskId && !options?.skipDelegationRepair) {
				try {
					if (await this.delegation.detach(parentTaskId, childTaskId)) {
						this.log(
							`[ClineProvider#removeClineFromStack] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
						)
					}
				} catch (err) {
					// Non-fatal: log but do not block the pop operation.
					this.log(
						`[ClineProvider#removeClineFromStack] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
							err instanceof Error ? err.message : String(err)
						}`,
					)
				}
			}
		}
	}

	getTaskStackSize(): number {
		return this.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.clineStack.map((cline) => cline.taskId)
	}

	// Pending Edit Operations Management

	/**
	 * Sets a pending edit operation with automatic timeout cleanup
	 */
	public setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void {
		// Clear any existing operation with the same ID
		this.clearPendingEditOperation(operationId)

		// Create timeout for automatic cleanup
		const timeoutId = setTimeout(() => {
			this.clearPendingEditOperation(operationId)
			this.log(`[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`)
		}, ClineProvider.PENDING_OPERATION_TIMEOUT_MS)

		// Store the operation
		this.pendingOperations.set(operationId, {
			...editData,
			timeoutId,
			createdAt: Date.now(),
		})

		this.log(`[setPendingEditOperation] Set pending operation: ${operationId}`)
	}

	/**
	 * Gets a pending edit operation by ID
	 */
	private getPendingEditOperation(operationId: string): PendingEditOperation | undefined {
		return this.pendingOperations.get(operationId)
	}

	/**
	 * Clears a specific pending edit operation
	 */
	private clearPendingEditOperation(operationId: string): boolean {
		const operation = this.pendingOperations.get(operationId)
		if (operation) {
			clearTimeout(operation.timeoutId)
			this.pendingOperations.delete(operationId)
			this.log(`[clearPendingEditOperation] Cleared pending operation: ${operationId}`)
			return true
		}
		return false
	}

	/**
	 * Clears all pending edit operations
	 */
	private clearAllPendingEditOperations(): void {
		for (const [operationId, operation] of this.pendingOperations) {
			clearTimeout(operation.timeoutId)
		}
		this.pendingOperations.clear()
		this.log(`[clearAllPendingEditOperations] Cleared all pending operations`)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	private clearWebviewResources() {
		while (this.webviewDisposables.length) {
			const x = this.webviewDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	async dispose() {
		if (this._disposed) {
			return
		}

		this._disposed = true
		this.log("Disposing ClineProvider...")

		// Clear all tasks from the stack.
		while (this.clineStack.length > 0) {
			await this.removeClineFromStack()
		}

		this.log("Cleared all tasks")

		// Clear all pending edit operations to prevent memory leaks
		this.clearAllPendingEditOperations()
		this.log("Cleared pending operations")

		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.log("Disposed webview")
		}

		this.clearWebviewResources()

		// Clean up cloud service event listener
		this.cloudProfileSync.dispose()

		while (this.disposables.length) {
			const x = this.disposables.pop()

			if (x) {
				x.dispose()
			}
		}

		this._workspaceTracker?.dispose()
		this._workspaceTracker = undefined
		await this.mcpHub?.unregisterClient()
		this.mcpHub = undefined
		await this.skillsManager?.dispose()
		this.skillsManager = undefined
		this.marketplaceManager?.cleanup()
		this.customModesManager?.dispose()
		// Unsubscribe and release the shared store handle. The final
		// consumer's release disposes the underlying watcher/timers.
		this.taskHistory.dispose()
		this.log("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)

		// Clean up any event listeners attached to this provider
		this.removeAllListeners()

		McpServerManager.unregisterProvider(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	public static async getInstance(): Promise<ClineProvider | undefined> {
		let visibleProvider = ClineProvider.getVisibleInstance()

		// If no visible provider, try to show the sidebar view
		if (!visibleProvider) {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			// Wait briefly for the view to become visible
			await delay(100)
			visibleProvider = ClineProvider.getVisibleInstance()
		}

		// If still no visible provider, return
		if (!visibleProvider) {
			return
		}

		return visibleProvider
	}

	public static async handleCodeAction(
		command: CodeActionId,
		promptType: CodeActionName,
		params: Record<string, string | any[]>,
	): Promise<void> {
		// Capture telemetry for code action usage
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		// TODO: Improve type safety for promptType.
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "addToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		await visibleProvider.createTask(prompt)
	}

	public static async handleTerminalAction(
		command: TerminalActionId,
		promptType: TerminalActionPromptType,
		params: Record<string, string | any[]>,
	): Promise<void> {
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "terminalAddToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		try {
			await visibleProvider.createTask(prompt)
		} catch (error) {
			if (error instanceof OrganizationAllowListViolationError) {
				// Errors from terminal commands seem to get swallowed / ignored.
				vscode.window.showErrorMessage(error.message)
			}

			throw error
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.view = webviewView
		const inTabMode = "onDidChangeViewState" in webviewView

		if (inTabMode) {
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			setPanel(webviewView, "sidebar")
		}

		// Initialize out-of-scope variables that need to receive persistent
		// global state values.
		this.getState().then(
			({
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
				terminalProfile,
			}) => {
				Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout)
				Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled)
				Terminal.setCommandDelay(terminalCommandDelay)
				Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark)
				Terminal.setTerminalZshOhMy(terminalZshOhMy)
				Terminal.setTerminalZshP10k(terminalZshP10k)
				Terminal.setPowershellCounter(terminalPowershellCounter)
				Terminal.setTerminalZdotdir(terminalZdotdir)
				Terminal.setTerminalProfile(terminalProfile)
			},
		)

		// Set up webview options with proper resource roots
		const resourceRoots = [this.contextProxy.extensionUri]

		// Add workspace folders to allow access to workspace files
		if (vscode.workspace.workspaceFolders) {
			resourceRoots.push(...vscode.workspace.workspaceFolders.map((folder) => folder.uri))
		}

		// Allow webview to load user-uploaded custom sound files (notification settings).
		resourceRoots.push(vscode.Uri.file(getCustomSoundsDir(this.contextProxy.globalStorageUri.fsPath)))

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		}

		webviewView.webview.html =
			this.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: await this.getHtmlContent(webviewView.webview)

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received.
		this.setWebviewMessageListener(webviewView.webview)

		// Initialize code index status subscription for the current workspace.
		this.updateCodeIndexStatusSubscription()

		// Listen for active editor changes to update code index status for the
		// current workspace.
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
			// Update subscription when workspace might have changed.
			this.updateCodeIndexStatusSubscription()
		})
		this.webviewDisposables.push(activeEditorSubscription)

		// Listen for when the panel becomes visible.
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except
			// for this visibility listener panel.
			const viewStateDisposable = webviewView.onDidChangeViewState(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				} else {
					this.logWebviewHiddenDiagnostics()
				}
			})

			this.webviewDisposables.push(viewStateDisposable)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				} else {
					this.logWebviewHiddenDiagnostics()
				}
			})

			this.webviewDisposables.push(visibilityDisposable)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				if (inTabMode) {
					this.log("Disposing ClineProvider instance for tab view")
					await this.dispose()
				} else {
					this.log("Clearing webview resources for sidebar view")
					this.clearWebviewResources()
					// Reset current workspace manager reference when view is disposed
					this.codeIndexManager = undefined
				}
			},
			null,
			this.disposables,
		)

		// Listen for when color changes
		const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e && e.affectsConfiguration("workbench.colorTheme")) {
				// Sends latest theme name to webview
				await this.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
			}
		})
		this.webviewDisposables.push(configDisposable)

		// If the extension is starting a new session, clear previous task state.
		// But don't clear if there's already an active task (e.g., resumed via IPC/bridge).
		const currentTask = this.getCurrentTask()
		if (!currentTask || currentTask.abandoned || currentTask.abort) {
			await this.removeClineFromStack()
		}
	}

	public async createTaskWithHistoryItem(
		historyItem: HistoryItem & { rootTask?: Task; parentTask?: Task },
		options?: { startTask?: boolean },
	) {
		// Check if we're rehydrating the current task to avoid flicker
		const currentTask = this.getCurrentTask()
		const isRehydratingCurrentTask = currentTask && currentTask.taskId === historyItem.id

		if (!isRehydratingCurrentTask) {
			// Reset the subagent panel BEFORE popping the stack so the
			// broadcast still carries the about-to-be-popped task's id as
			// `sourceTaskId` (the webview scopes by currentTaskId; after the
			// pop there is no current task and the post would be dropped by
			// the scope guard). Historical subagents for the task we are
			// about to rehydrate are restored AFTER the new Task is on the
			// stack, via `rehydrateSubagents` below.
			try {
				await this.resetSubagentPanel()
			} catch {
				// Non-fatal: panel reset is best-effort.
			}
			await this.removeClineFromStack()
		}

		// Restore the saved mode and its provider profile (or the CLI's
		// per-mode settings) before the task reads its configuration.
		await this.modeProfiles.restoreForHistoryItem(historyItem)

		const {
			apiConfiguration,
			organizationAllowList,
			enableCheckpoints,
			checkpointTimeout,
			experiments,
			cloudUserInfo,
			taskSyncEnabled,
		} = await this.getState()

		// The profile is known only now, after the saved mode and profile were
		// restored above. A reopened task obeys the same organization allow
		// list as a new one. On rejection the current task (when rehydrating
		// it) is left in place; otherwise it was already closed above, exactly
		// as `createTask` does, and the webview is told there is no task open.
		let profileOptions: ReturnType<typeof profileTaskOptions>
		try {
			profileOptions = profileTaskOptions(apiConfiguration, organizationAllowList)
		} catch (error) {
			await this.postStateToWebview()
			throw error
		}

		const task = new Task({
			provider: this,
			...profileOptions,
			enableCheckpoints,
			checkpointTimeout,
			historyItem,
			experiments,
			rootTask: historyItem.rootTask,
			parentTask: historyItem.parentTask,
			taskNumber: historyItem.number,
			workspacePath: historyItem.workspace,
			onCreated: this.taskCreationCallback,
			startTask: options?.startTask ?? true,
			// Preserve the status from the history item to avoid overwriting it when the task saves messages
			initialStatus: historyItem.status,
		})

		if (isRehydratingCurrentTask) {
			// Replace the current task in-place to avoid UI flicker
			const stackIndex = this.clineStack.length - 1

			// Properly dispose of the old task to ensure garbage collection
			const oldTask = this.clineStack[stackIndex]

			// Abort the old task to stop running processes and mark as abandoned
			try {
				await oldTask.abortTask(true)
			} catch (e) {
				this.log(
					`[createTaskWithHistoryItem] abortTask() failed for old task ${oldTask.taskId}.${oldTask.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners from the old task
			const cleanupFunctions = this.taskEventListeners.get(oldTask)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(oldTask)
			}

			// Replace the task in the stack
			this.clineStack[stackIndex] = task
			task.emit(RooCodeEventName.TaskFocused)

			// Perform preparation tasks and set up event listeners
			await this.performPreparationTasks(task)

			this.log(
				`[createTaskWithHistoryItem] rehydrated task ${task.taskId}.${task.instanceId} in-place (flicker-free)`,
			)
		} else {
			await this.addClineToStack(task)

			this.log(
				`[createTaskWithHistoryItem] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
			)
		}

		// Restore the historical parallel-subagent panel for this task. Reads
		// `parallelChildIds` + the `subagents.json` sidecar written by
		// `run_parallel_tasks`; no-op (panel stays empty) for pre-fix history
		// items or tasks that never fanned out. Done after the Task is on the
		// stack so `getCurrentTask()` matches the parent we are restoring,
		// and before the eager state push so the push carries the restored
		// rows. Best-effort: a missing/corrupt sidecar never breaks the
		// parent rehydration.
		await this.rehydrateSubagents(historyItem)

		// Eager state push so the webview shows the new task immediately;
		// resumeTaskFromHistory pushes further updates asynchronously.
		await this.postStateToWebview()

		// Check if there's a pending edit after checkpoint restoration
		const operationId = `task-${task.taskId}`
		const pendingEdit = this.getPendingEditOperation(operationId)
		if (pendingEdit) {
			this.clearPendingEditOperation(operationId) // Clear the pending edit

			this.log(`[createTaskWithHistoryItem] Processing pending edit after checkpoint restoration`)

			// Process the pending edit after a short delay to ensure the task is fully initialized
			setTimeout(async () => {
				try {
					// Find the message index in the restored state
					const { messageIndex, apiConversationHistoryIndex } = (() => {
						const messageIndex = task.clineMessages.findIndex((msg) => msg.ts === pendingEdit.messageTs)
						const apiConversationHistoryIndex = task.apiConversationHistory.findIndex(
							(msg) => msg.ts === pendingEdit.messageTs,
						)
						return { messageIndex, apiConversationHistoryIndex }
					})()

					if (messageIndex !== -1) {
						// Remove the target message and all subsequent messages
						await task.overwriteClineMessages(task.clineMessages.slice(0, messageIndex))

						if (apiConversationHistoryIndex !== -1) {
							await task.overwriteApiConversationHistory(
								task.apiConversationHistory.slice(0, apiConversationHistoryIndex),
							)
						}

						// Process the edited message
						await task.handleWebviewAskResponse(
							"messageResponse",
							pendingEdit.editedContent,
							pendingEdit.images,
						)
					}
				} catch (error) {
					this.log(`[createTaskWithHistoryItem] Error processing pending edit: ${error}`)
				}
			}, 100) // Small delay to ensure task is fully ready
		}

		return task
	}

	public async postMessageToWebview(message: ExtensionMessage) {
		if (this._disposed) {
			return
		}

		try {
			await this.view?.webview.postMessage(message)
		} catch {
			// View disposed, drop message silently
		}
	}

	/** The sidebar's differences from the other webviews; see {@link getProductionHtml}. */
	private webviewHtmlOptions(webview: vscode.Webview, openRouterBaseUrl: string | undefined): WebviewHtmlOptions {
		return {
			webview,
			extensionUri: this.contextProxy.extensionUri,
			title: "Roo Code",
			connectOrigins: [openRouterOrigin(openRouterBaseUrl)],
			hmrAnalyticsOrigins: ["https://*.posthog.com"],
		}
	}

	/** The sidebar HTML served by the Vite dev server (CORE-R6 e: built by {@link getHmrHtml}). */
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const { apiConfiguration } = await this.getState()
		return getHmrHtml({
			...this.webviewHtmlOptions(webview, apiConfiguration.openRouterBaseUrl),
			logTag: "ClineProvider:Vite",
			onDevServerMissing: () => vscode.window.showErrorMessage(t("common:errors.hmr_not_running")),
		})
	}

	/** The sidebar HTML for the built webview (CORE-R6 e: built by {@link getProductionHtml}). */
	private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		const { apiConfiguration } = await this.getState()
		return getProductionHtml(this.webviewHtmlOptions(webview, apiConfiguration.openRouterBaseUrl))
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		const onReceiveMessage = async (message: WebviewMessage) =>
			webviewMessageHandler(this, message, this.marketplaceManager)

		const messageDisposable = webview.onDidReceiveMessage(onReceiveMessage)
		this.webviewDisposables.push(messageDisposable)
	}

	/**
	 * Provider settings per mode from the CLI's settings file; see
	 * {@link ModeProfileBinding.setCliModeProviderSettings}.
	 */
	public setCliModeProviderSettings(settings: CliModeProviderSettings | undefined) {
		this.modeProfiles.setCliModeProviderSettings(settings)
	}

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 * @param newMode The mode to switch to
	 */
	public async handleModeSwitch(newMode: Mode) {
		await this.modeProfiles.handleModeSwitch(newMode)
	}

	// Provider Profile Management

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		return this.modeProfiles.upsertProviderProfile(name, providerSettings, activate)
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.postStateToWebview()
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		await this.modeProfiles.activateProviderProfile(args, options)
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field.
		await this.updateGlobalState("customInstructions", instructions || undefined)
		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		// Get platform-specific application data directory
		let mcpServersDir: string
		if (process.platform === "win32") {
			// Windows: %APPDATA%\Roo-Code\MCP
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Roo-Code", "MCP")
		} else if (process.platform === "darwin") {
			// macOS: ~/Documents/Cline/MCP
			mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		} else {
			// Linux: ~/.local/share/Cline/MCP
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Roo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			// Fallback to a relative path if directory creation fails
			return path.join(os.homedir(), ".roo-code", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		let apiKey: string

		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			// Extract the base domain for the auth endpoint.
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })

			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}

	// Task history

	/**
	 * Looks up a task's history item without touching its conversation
	 * file. Use this unless you need the API conversation or its file paths
	 * (then use {@link getTaskWithId}). Throws "Task not found" like it.
	 */
	getHistoryItem(id: string): Promise<HistoryItem> {
		return this.taskHistory.getHistoryItem(id)
	}

	getTaskWithId(id: string): ReturnType<TaskHistoryGateway["getTaskWithId"]> {
		return this.taskHistory.getTaskWithId(id)
	}

	getTaskWithAggregatedCosts(taskId: string): ReturnType<TaskHistoryGateway["getTaskWithAggregatedCosts"]> {
		return this.taskHistory.getTaskWithAggregatedCosts(taskId)
	}

	async showTaskWithId(id: string) {
		if (id !== this.getCurrentTask()?.taskId) {
			const historyItem = await this.getHistoryItem(id)

			// Resolve rootTask/parentTask references from the active stack so
			// that subtask delegation metadata survives history-item round-trips
			// (only the IDs are persisted, not the live Task objects).
			let rootTask: Task | undefined
			let parentTask: Task | undefined
			if (historyItem.rootTaskId) {
				rootTask = this.clineStack.find((t) => t.taskId === historyItem.rootTaskId)
			}
			if (historyItem.parentTaskId) {
				parentTask = this.clineStack.find((t) => t.taskId === historyItem.parentTaskId)
			}

			await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
		}

		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	exportTaskWithId(id: string): Promise<void> {
		return this.taskHistory.exportTaskWithId(id)
	}

	/* Condenses a task's message history to use fewer tokens. */
	async condenseTaskContext(taskId: string) {
		let task: Task | undefined
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				task = this.clineStack[i]
				break
			}
		}
		if (!task) {
			// Task gone: still dismiss the spinner so the UI doesn't hang.
			await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
			throw new Error(`Task with id ${taskId} not found in stack`)
		}
		// Claim 1: wrap condenseContext in try/finally so the
		// condenseTaskContextResponse (which dismisses the ChatView spinner and
		// re-enables input) is ALWAYS sent, even when condenseContext throws.
		// Without this, an unwrapped throw leaves the spinner hanging forever
		// and the input blocked — the manual condense path has no other
		// finally (unlike manageContextIfNeeded, which has its own).
		try {
			await task.condenseContext()
		} finally {
			await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
		}
	}

	/**
	 * Deletes a task from the history with its checkpoints and task folder,
	 * and (by default) its subtasks recursively.
	 */
	deleteTaskWithId(id: string, cascadeSubtasks: boolean = true): Promise<void> {
		return this.taskHistory.deleteTaskWithId(id, cascadeSubtasks)
	}

	deleteTaskFromState(id: string): Promise<void> {
		return this.taskHistory.deleteTaskFromState(id)
	}

	async refreshWorkspace() {
		this.currentWorkspacePath = getWorkspacePath()
		await this.postStateToWebview()
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview({ includeTaskHistory: true })
		this.postMessageToWebview({ type: "state", state })

		// Check MDM compliance and send user to account tab if not compliant
		// Only redirect if there's an actual MDM policy requiring authentication
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Like postStateToWebview but intentionally omits taskHistory.
	 *
	 * Rationale:
	 * - taskHistory can be large and was being resent on every chat message update.
	 * - The webview maintains taskHistory in-memory and receives updates via
	 *   `taskHistoryUpdated` / `taskHistoryItemUpdated` / `taskHistoryItemDeleted`.
	 *
	 * This path does NOT call `taskHistoryStore.getAll()`: the builder is
	 * invoked with `includeTaskHistory: false`, so the history is never
	 * materialized or sorted here. The webview keeps its in-memory history
	 * list in sync via the targeted messages.
	 */
	async postStateToWebviewWithoutTaskHistory(): Promise<void> {
		const state = await this.getStateToPostToWebview({ includeTaskHistory: false })
		const { taskHistory: _omit, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Like postStateToWebview but intentionally omits both clineMessages and taskHistory.
	 *
	 * Rationale:
	 * - Cloud event handlers (auth, settings, user-info) and mode changes trigger state pushes
	 *   that have nothing to do with chat messages. Including clineMessages in these pushes
	 *   creates race conditions where a stale snapshot of clineMessages (captured during async
	 *   getStateToPostToWebview) overwrites newer messages the task has streamed in the meantime.
	 * - This method ensures cloud/mode events only push the state fields they actually affect
	 *   (cloud auth, org settings, profiles, etc.) without interfering with task message streaming.
	 *
	 * This path does NOT call `taskHistoryStore.getAll()` (the builder is
	 * invoked with `includeTaskHistory: false`).
	 */
	async postStateToWebviewWithoutClineMessages(): Promise<void> {
		const state = await this.getStateToPostToWebview({ includeTaskHistory: false })
		// Drop the sequence number with the messages: a push without messages must not raise the
		// webview's high-water mark and make it reject an older-numbered push that has them.
		const { clineMessages: _omitMessages, clineMessagesSeq: _omitSeq, taskHistory: _omitHistory, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })

		// Preserve existing MDM redirect behavior
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	/**
	 * Fetches marketplace data on demand to avoid blocking main state updates
	 */
	async fetchMarketplaceData() {
		try {
			const [marketplaceResult, marketplaceInstalledMetadata] = await Promise.all([
				this.marketplaceManager.getMarketplaceItems().catch((error) => {
					console.error("Failed to fetch marketplace items:", error)
					return { organizationMcps: [], marketplaceItems: [], errors: [error.message] }
				}),
				this.marketplaceManager.getInstallationMetadata().catch((error) => {
					console.error("Failed to fetch installation metadata:", error)
					return { project: {}, global: {} } as MarketplaceInstalledMetadata
				}),
			])

			// Send marketplace data separately
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: marketplaceResult.organizationMcps || [],
				marketplaceItems: marketplaceResult.marketplaceItems || [],
				marketplaceInstalledMetadata: marketplaceInstalledMetadata || { project: {}, global: {} },
				errors: marketplaceResult.errors,
			})
		} catch (error) {
			console.error("Failed to fetch marketplace data:", error)

			// Send empty data on error to prevent UI from hanging
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: [],
				marketplaceItems: [],
				marketplaceInstalledMetadata: { project: {}, global: {} },
				errors: [error instanceof Error ? error.message : String(error)],
			})

			// Show user-friendly error notification for network issues
			if (error instanceof Error && error.message.includes("timeout")) {
				vscode.window.showWarningMessage(
					"Marketplace data could not be loaded due to network restrictions. Core functionality remains available.",
				)
			}
		}
	}

	getStateToPostToWebview(options: { includeTaskHistory?: boolean } = {}): Promise<ExtensionState> {
		return this.stateBuilder.getStateToPostToWebview(options)
	}

	/**
	 * The settings accessor of the extension host: every setting with its
	 * default applied (see SETTINGS_DEFAULTS in @roo-code/types) plus the
	 * cloud facts. Built by {@link ProviderStateBuilder}.
	 */
	getState(): Promise<ProviderState> {
		return this.stateBuilder.getState()
	}

	/**
	 * Upserts a task in the history (with this provider's origin, so the
	 * store's echo is suppressed) and by default pushes the stored item to
	 * the webview. See {@link TaskHistoryGateway.updateTaskHistory}.
	 */
	updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<void> {
		return this.taskHistory.updateTaskHistory(item, options)
	}

	/**
	 * Sends the whole history (sorted, filtered) as one `taskHistoryUpdated`
	 * message instead of the full state.
	 */
	public broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		return this.taskHistory.broadcastTaskHistoryUpdate(history)
	}

	/** All history items from the store, newest first. */
	public getTaskHistory(): Promise<HistoryItem[]> {
		return this.taskHistory.getTaskHistory()
	}

	// ContextProxy

	// @deprecated - Use `ContextProxy#setValue` instead.
	private async updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]) {
		await this.contextProxy.setValue(key, value)
	}

	// @deprecated - Use `ContextProxy#getValue` instead.
	private getGlobalState<K extends keyof GlobalState>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public async setValue<K extends keyof RooCodeSettings>(key: K, value: RooCodeSettings[K]) {
		await this.contextProxy.setValue(key, value)
	}

	public getValue<K extends keyof RooCodeSettings>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public getValues() {
		return this.contextProxy.getValues()
	}

	public async setValues(values: RooCodeSettings) {
		await this.contextProxy.setValues(values)
	}

	// dev

	async resetState() {
		const answer = await vscode.window.showInformationMessage(
			t("common:confirmation.reset_state"),
			{ modal: true },
			t("common:answers.yes"),
		)

		if (answer !== t("common:answers.yes")) {
			return
		}

		// Log out from cloud if authenticated
		if (CloudService.hasInstance()) {
			try {
				await CloudService.instance.logout()
			} catch (error) {
				this.log(
					`Failed to logout from cloud during reset: ${error instanceof Error ? error.message : String(error)}`,
				)
				// Continue with reset even if logout fails
			}
		}

		await this.contextProxy.resetAllState()
		await this.providerSettingsManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()
		await this.removeClineFromStack()
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	// logging

	public log(message: string) {
		this.outputChannel.appendLine(message)
		console.log(message)
	}

	// getters

	public get workspaceTracker(): WorkspaceTracker | undefined {
		return this._workspaceTracker
	}

	get viewLaunched() {
		return this.isViewLaunched
	}

	get messages() {
		return this.getCurrentTask()?.clineMessages || []
	}

	public getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	public getSkillsManager(): SkillsManager | undefined {
		return this.skillsManager
	}

	/**
	 * Check if the current state is compliant with MDM policy
	 * @returns true if compliant or no MDM policy exists, false if MDM policy exists and user is non-compliant
	 */
	public checkMdmCompliance(): boolean {
		if (!this.mdmService) {
			return true // No MDM service, allow operation
		}

		const compliance = this.mdmService.isCompliant()

		if (!compliance.compliant) {
			return false
		}

		return true
	}

	/**
	 * Gets the CodeIndexManager for the current active workspace
	 * @returns CodeIndexManager instance for the current workspace or the default one
	 */
	public getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
		return CodeIndexManager.getInstance(this.context)
	}

	/**
	 * Updates the code index status subscription to listen to the current workspace manager
	 */
	private updateCodeIndexStatusSubscription(): void {
		// Get the current workspace manager
		const currentManager = this.getCurrentWorkspaceCodeIndexManager()

		// If the manager hasn't changed, no need to update subscription
		if (currentManager === this.codeIndexManager) {
			return
		}

		// Dispose the old subscription if it exists
		if (this.codeIndexStatusSubscription) {
			this.codeIndexStatusSubscription.dispose()
			this.codeIndexStatusSubscription = undefined
		}

		// Update the current workspace manager reference
		this.codeIndexManager = currentManager

		// Subscribe to the new manager's progress updates if it exists
		if (currentManager) {
			this.codeIndexStatusSubscription = currentManager.onProgressUpdate((update: IndexProgressUpdate) => {
				// Only send updates if this manager is still the current one
				if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
					// Get the full status from the manager to ensure we have all fields correctly formatted
					const fullStatus = currentManager.getCurrentStatus()
					this.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: fullStatus,
					})
				}
			})

			if (this.view) {
				this.webviewDisposables.push(this.codeIndexStatusSubscription)
			}

			// Send initial status for the current workspace
			this.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: currentManager.getCurrentStatus(),
			})
		}
	}

	/**
	 * TaskProviderLike, TelemetryPropertiesProvider
	 */

	public getCurrentTask(): Task | undefined {
		if (this.clineStack.length === 0) {
			return undefined
		}

		return this.clineStack[this.clineStack.length - 1]
	}

	private logWebviewHiddenDiagnostics(): void {
		const task = this.getCurrentTask()
		if (!task || task.abort || task.abandoned) {
			return
		}
		this.log(
			`[Tumble Code] Webview hidden during active task.\n` +
				`  taskId:       ${task.taskId}\n` +
				`  messageCount: ${task.clineMessages.length}\n` +
				`  stackDepth:   ${this.clineStack.length}\n` +
				`  timestamp:    ${new Date().toISOString()}\n` +
				`If the panel appears gray after this, include this log when reporting the issue.`,
		)
	}

	// When initializing a new task, (not from history but from a tool command
	// new_task) there is no need to remove the previous task since the new
	// task is a subtask of the previous one, and when it finishes it is removed
	// from the stack and the caller is resumed in this way we can have a chain
	// of tasks, each one being a sub task of the previous one until the main
	// task is finished.
	public async createTask(
		text?: string,
		images?: string[],
		parentTask?: Task,
		options: CreateTaskOptions = {},
		configuration: RooCodeSettings = {},
	): Promise<Task> {
		if (configuration) {
			await this.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.deniedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("deniedCommands", configuration.deniedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.commandExecutionTimeout !== undefined) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update(
						"commandExecutionTimeout",
						configuration.commandExecutionTimeout,
						vscode.ConfigurationTarget.Global,
					)
			}

			if (configuration.currentApiConfigName) {
				await this.setProviderProfile(configuration.currentApiConfigName)
			}

			// Register custom modes so the CustomModesManager knows about them.
			// setValues writes to global state, but the manager overwrites that
			// when it merges .roomodes + global settings on refresh.  Persisting
			// via updateCustomMode ensures modes survive the merge cycle.
			if (configuration.customModes?.length) {
				for (const mode of configuration.customModes) {
					await this.customModesManager.updateCustomMode(mode.slug, mode)
				}
			}
		}

		const { apiConfiguration, organizationAllowList, enableCheckpoints, checkpointTimeout, experiments } =
			await this.getState()

		// Single-open-task invariant: always enforce for user-initiated top-level tasks
		if (!parentTask) {
			// Reset the subagent panel BEFORE popping the stack so the
			// broadcast still carries the about-to-be-popped task's id as
			// `sourceTaskId` (the webview scopes by currentTaskId; after the
			// pop there is no current task and the post would be dropped by
			// the scope guard). Subagents from the previous task never leak
			// into the new task's panel.
			try {
				await this.resetSubagentPanel()
			} catch {
				// Non-fatal: panel reset is best-effort.
			}
			try {
				await this.removeClineFromStack()
			} catch {
				// Non-fatal
			}
		}

		const task = new Task({
			provider: this,
			...profileTaskOptions(apiConfiguration, organizationAllowList),
			enableCheckpoints,
			checkpointTimeout,
			task: text,
			images,
			experiments,
			rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
			parentTask,
			taskNumber: this.clineStack.length + 1,
			onCreated: this.taskCreationCallback,
			initialTodos: options.initialTodos,
			// Ensure this task is present in clineStack before startTask() emits
			// its initial state update, so state.currentTaskId is available ASAP.
			startTask: false,
			...options,
		})

		await this.addClineToStack(task)
		// Gate the explicit start so callers passing `startTask: false`
		// (e.g. delegateParentAndOpenChild) can persist surrounding metadata
		// before the task loop begins. Without this, the child loop starts here
		// and the later child.start() becomes a no-op (_started guard).
		if (options.startTask !== false) {
			task.start()
		}

		this.log(
			`[createTask] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
		)

		return task
	}

	/**
	 * Create and start a HEADLESS background task (memory writer or parallel
	 * subagent); see {@link BackgroundTaskRunner.createBackgroundTask}. Pair
	 * with {@link awaitTaskCompletion} to await its result.
	 */
	public createBackgroundTask(text: string, options: BackgroundTaskOptions = {}): Promise<Task> {
		return this.backgroundTaskRunner.createBackgroundTask(text, options)
	}

	/** Look up a live headless background task (parallel subagent) by id. */
	public getBackgroundTask(taskId: string): Task | undefined {
		return this.backgroundTaskRunner.getBackgroundTask(taskId)
	}

	/**
	 * Find the CURRENT live instance of a task by id on the foreground stack
	 * (top-down). Used by a detached fan-out to deliver its report to the
	 * rehydrated instance of its parent — the original instance that launched
	 * the fan-out may have been abandoned by a task switch or in-place
	 * rehydrate while the children kept running.
	 */
	public getLiveTaskInstance(taskId: string): Task | undefined {
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				return this.clineStack[i]
			}
		}
		return undefined
	}

	/**
	 * Absolute path of the extension global storage directory (the parent of
	 * `tasks/<id>/`). Exposed so `run_parallel_tasks` can resolve its
	 * `subagents.json` sidecar path without importing storage helpers
	 * directly (keeps the tool's provider surface narrow and testable).
	 */
	public get globalStoragePath(): string {
		return this.contextProxy.globalStorageUri.fsPath
	}

	/**
	 * Atomically read a task's `HistoryItem`, apply `updater`, and write it
	 * back. Thin wrapper over `TaskHistoryStore.atomicReadAndUpdate` exposed
	 * so `run_parallel_tasks` can record `parallelChildIds` on the parent
	 * without importing the store directly. Throws if the store is missing
	 * the task; callers (the tool) wrap this in best-effort error handling.
	 */
	public atomicReadAndUpdateHistoryItem(
		taskId: string,
		updater: (current: HistoryItem) => HistoryItem,
	): Promise<HistoryItem> {
		return this.taskHistory.atomicReadAndUpdateHistoryItem(taskId, updater)
	}

	/**
	 * Adjust a memory-activity counter and push the change to the webview;
	 * see {@link BackgroundTaskRunner.setMemoryActivity}.
	 */
	public setMemoryActivity(kind: "recall" | "write", active: boolean): void {
		this.backgroundTaskRunner.setMemoryActivity(kind, active)
	}

	/**
	 * Resolve the API profile pinned to `mode` for a mode-scoped subagent;
	 * undefined means "use the current profile". See
	 * {@link ModeProfileBinding.getApiConfigurationForMode}.
	 */
	public async getApiConfigurationForMode(
		mode: string,
	): Promise<{ apiConfiguration: ProviderSettings; name: string } | undefined> {
		return this.modeProfiles.getApiConfigurationForMode(mode)
	}

	/**
	 * Await a background task's terminal state (completed, or aborted with its
	 * reason); see {@link BackgroundTaskRunner.awaitTaskCompletion}.
	 */
	public awaitTaskCompletion(task: Task, options: { signal?: AbortSignal } = {}): Promise<BackgroundTaskOutcome> {
		return this.backgroundTaskRunner.awaitTaskCompletion(task, options)
	}

	/**
	 * Surface a non-blocking toast for background-task outcomes (memory writes).
	 */
	public notifyBackgroundOutcome(message: string): void {
		this.backgroundTaskRunner.notifyBackgroundOutcome(message)
	}

	/**
	 * The memory background-writer runner (extraction + dream), consumed by
	 * `TaskLifecycle.triggerMemoryBackgroundWriters`; see
	 * {@link BackgroundTaskRunner.memorySubTaskRunner}.
	 */
	public get memorySubTaskRunner(): SubTaskRunner {
		return this.backgroundTaskRunner.memorySubTaskRunner
	}

	public async cancelTask(): Promise<void> {
		const task = this.getCurrentTask()

		if (!task) {
			return
		}

		console.log(`[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`)

		let historyItem: HistoryItem | undefined
		try {
			historyItem = await this.getHistoryItem(task.taskId)
		} catch (error) {
			// During task startup there is a short window where currentTask exists
			// but task history has not been persisted yet. Cancelling should still
			// abort safely; we just skip post-cancel rehydration in that case.
			if (error instanceof Error && error.message === "Task not found") {
				this.log(`[cancelTask] task history missing for ${task.taskId}; skipping rehydrate`)
			} else {
				throw error
			}
		}

		// Preserve parent and root task information for history item.
		// `let` because a delegated-parent detach below may clear them.
		let rootTask = task.rootTask
		let parentTask = task.parentTask

		// Mark this as a user-initiated cancellation so provider-only rehydration can occur
		task.abortReason = "user_cancelled"

		// Capture the current instance to detect if rehydrate already occurred elsewhere
		const originalInstanceId = task.instanceId

		// Immediately cancel the underlying HTTP request if one is in progress
		// This ensures the stream fails quickly rather than waiting for network timeout
		// Pass destroyClient=true to sever all HTTP connections and force client recreation.
		// This is essential for local models that may continue inference even after abort.
		task.cancelCurrentRequest(true)

		// Begin abort (non-blocking) — the abort runs concurrently while we
		// do a bounded wait for streaming to stop.  We do NOT set `abandoned`
		// before the wait: setting it prematurely would mark the task as
		// abandoned while the abort is still progressing, which can clobber a
		// to-be-successful cleanup.  Instead `abandoned` is set AFTER the
		// bounded wait concludes, regardless of whether the abort finished.
		task.abortTask()

		await pWaitFor(
			() =>
				this.getCurrentTask()! === undefined ||
				this.getCurrentTask()!.isStreaming === false ||
				this.getCurrentTask()!.didFinishAbortingStream ||
				// If only the first chunk is processed, then there's no
				// need to wait for graceful abort (closes edits, browser,
				// etc).
				this.getCurrentTask()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			// The abort is still in progress (e.g. slow stream cleanup,
			// memory-writer drain on a non-user-cancel path).  This is NOT
			// a failure — the abort was initiated and will complete in the
			// background.  We log a warning instead of an error so the
			// task is not spuriously marked as failed.
			this.log("[cancelTask] abort still in progress after 3s bound — continuing")
		})

		// Mark the original instance as abandoned NOW — after the bounded
		// wait, so it never clobbers a still-progressing abort.  The abort
		// itself was already started above; `abandoned` just prevents
		// residual activity from the old instance after rehydrate.
		task.abandoned = true

		// Defensive safeguard: if current instance already changed, skip rehydrate
		const current = this.getCurrentTask()
		if (current && current.instanceId !== originalInstanceId) {
			this.log(
				`[cancelTask] Skipping rehydrate: current instance ${current.instanceId} != original ${originalInstanceId}`,
			)
			return
		}

		if (!historyItem) {
			return
		}

		// If this is a delegated subtask, detach its parent so the parent does not
		// stay stuck in "delegated" awaiting a child that the user just cancelled.
		if (task.parentTaskId) {
			const outcome = await this.delegation.detachOnCancel(task.taskId, task.parentTaskId, historyItem)
			historyItem = outcome.childHistory
			if (outcome.dropLineage) {
				parentTask = undefined
				rootTask = undefined
			}
		}

		// Clears task again, so we need to abortTask manually above.
		try {
			await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
		} catch (error) {
			// The task's profile is no longer allowed: it stays on screen,
			// stopped, and the user learns why it cannot be resumed.
			if (!this.showAllowListViolation(error)) {
				throw error
			}
			this.log(`[cancelTask] Not rehydrating ${task.taskId}: ${(error as Error).message}`)
		}
	}

	/**
	 * Shows an organization allow-list rejection to the user. For callers of
	 * `createTaskWithHistoryItem` whose own error path would not reach the
	 * user. Returns whether `error` was such a rejection.
	 */
	private showAllowListViolation(error: unknown): boolean {
		if (!(error instanceof OrganizationAllowListViolationError)) {
			return false
		}
		vscode.window.showErrorMessage(error.message)
		return true
	}

	/**
	 * Single source of truth for resetting the parallel-subagent panel at a
	 * task boundary: clears the in-memory registry and broadcasts an empty
	 * `subagentsUpdated` so the webview panel renders nothing for the new
	 * task. Called from every entry point that begins a fresh foreground
	 * task (`createTask` for a user-initiated top-level task, `clearTask`,
	 * and `createTaskWithHistoryItem` for a rehydrated root). Mid-task
	 * re-fan-out continues to use `SubagentRegistry.beginFanOut`.
	 *
	 * The broadcast is best-effort: if the webview is not yet mounted the
	 * post is dropped silently, and the next `postStateToWebview` will carry
	 * the now-empty `subagents` slice via the state payload anyway.
	 */
	private async resetSubagentPanel(): Promise<void> {
		this.subagentRegistry.clearAll()
		// `clearAll` already posts; this second explicit post is belt-and-
		// suspenders in case a subclass overrides the registry's post hook,
		// and keeps the contract that this method always broadcasts `[]`.
		await this.postMessageToWebview({
			type: "subagentsUpdated",
			sourceTaskId: this.getCurrentTask()?.taskId,
			subagents: [],
		})
	}

	/**
	 * Rehydrate the parallel-subagent panel for a parent task being restored
	 * from history. Reads `parallelChildIds` from the parent's history item
	 * (the persisted parent→child relation written by `run_parallel_tasks`),
	 * loads the matching terminal summaries from the parent's sidecar
	 * (`tasks/<parentId>/subagents.json`), and registers them so the panel
	 * renders the historical fan-out.
	 *
	 * Graceful degradation: if `parallelChildIds` is absent (pre-fix history
	 * item) or the sidecar is missing/corrupt, the panel stays empty — the
	 * task is NOT marked corrupt and no error is thrown.
	 *
	 * Posts a single `subagentsUpdated` carrying the restored list (and the
	 * current task id as `sourceTaskId`). Called after the parent Task is on
	 * the stack so `getCurrentTask()` matches the parent we just restored.
	 */
	private async rehydrateSubagents(historyItem: HistoryItem): Promise<void> {
		const parallelChildIds = historyItem.parallelChildIds
		if (!parallelChildIds || parallelChildIds.length === 0) {
			// Pre-fix history item or a task that never fanned out — nothing
			// to restore. The panel was already cleared by
			// `resetSubagentPanel` at the top of the rehydrate path.
			return
		}
		try {
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
			const { loadSubagentSummaries } = await import("../task-persistence/subagentSummariesStore")
			const summaries = await loadSubagentSummaries(globalStoragePath, historyItem.id)
			// Only keep summaries whose taskId is in the persisted
			// parent→child list. The sidecar and `parallelChildIds` are
			// written together, but a partially-written sidecar from a
			// crashed run could carry stale entries; this guard keeps the
			// panel honest.
			const allowed = new Set(parallelChildIds)
			const restored = summaries.filter((s) => allowed.has(s.taskId))
			this.subagentRegistry.restore(historyItem.id, restored)
			await this.postMessageToWebview({
				type: "subagentsUpdated",
				sourceTaskId: this.getCurrentTask()?.taskId,
				subagents: this.subagentRegistry.list(),
			})
		} catch (error) {
			// Sidecar loading is best-effort. A missing/corrupt sidecar must
			// never break rehydration of the parent task itself.
			this.log(
				`[rehydrateSubagents] Failed to restore subagents for task ${historyItem.id} (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	// Clear the current task without treating it as a subtask.
	// This is used when the user cancels a task that is not a subtask.
	public async clearTask(): Promise<void> {
		// Reset the subagent panel before popping the stack so the broadcast
		// still carries the about-to-be-cleared task's id as `sourceTaskId`
		// (the webview scopes by currentTaskId; after the pop there is no
		// current task and the post would be dropped by the scope guard).
		await this.resetSubagentPanel()
		if (this.clineStack.length > 0) {
			const task = this.clineStack[this.clineStack.length - 1]
			console.log(`[clearTask] clearing task ${task.taskId}.${task.instanceId}`)
			await this.removeClineFromStack()
		}
	}

	public resumeTask(taskId: string): void {
		// Use the existing showTaskWithId method which handles both current and
		// historical tasks.
		this.showTaskWithId(taskId).catch((error) => {
			this.log(`Failed to resume task ${taskId}: ${error.message}`)
		})
	}

	// Modes

	public async getModes(): Promise<{ slug: string; name: string }[]> {
		try {
			const customModes = await this.customModesManager.getCustomModes()
			return [...DEFAULT_MODES, ...customModes].map(({ slug, name }) => ({ slug, name }))
		} catch (error) {
			return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }))
		}
	}

	public async getMode(): Promise<string> {
		const { mode } = await this.getState()
		return mode
	}

	public async setMode(mode: string): Promise<void> {
		await this.setValues({ mode })
	}

	// Provider Profiles

	public async getProviderProfiles(): Promise<{ name: string; provider?: string }[]> {
		const { listApiConfigMeta = [] } = await this.getState()
		return listApiConfigMeta.map((profile) => ({ name: profile.name, provider: profile.apiProvider }))
	}

	public async getProviderProfile(): Promise<string> {
		const { currentApiConfigName = "default" } = await this.getState()
		return currentApiConfigName
	}

	public async setProviderProfile(name: string): Promise<void> {
		await this.activateProviderProfile({ name })
	}

	// Telemetry

	private _appProperties?: StaticAppProperties
	private _gitProperties?: GitProperties

	private getAppProperties(): StaticAppProperties {
		if (!this._appProperties) {
			const packageJSON = this.context.extension?.packageJSON

			this._appProperties = {
				appName: packageJSON?.name ?? Package.name,
				appVersion: packageJSON?.version ?? Package.version,
				vscodeVersion: vscode.version,
				platform: process.platform,
				editorName: vscode.env.appName,
			}
		}

		return this._appProperties
	}

	public get appProperties(): StaticAppProperties {
		return this._appProperties ?? this.getAppProperties()
	}

	private getCloudProperties(): CloudAppProperties {
		let cloudIsAuthenticated: boolean | undefined

		try {
			if (CloudService.hasInstance()) {
				cloudIsAuthenticated = CloudService.instance.isAuthenticated()
			}
		} catch (error) {
			// Silently handle errors to avoid breaking telemetry collection.
			this.log(`[getTelemetryProperties] Failed to get cloud auth state: ${error}`)
		}

		return {
			cloudIsAuthenticated,
		}
	}

	private async getTaskProperties(): Promise<DynamicAppProperties & TaskProperties> {
		const { language = "en", mode, apiConfiguration } = await this.getState()

		const task = this.getCurrentTask()
		const todoList = task?.todoList
		let todos: { total: number; completed: number; inProgress: number; pending: number } | undefined

		if (todoList && todoList.length > 0) {
			todos = {
				total: todoList.length,
				completed: todoList.filter((todo) => todo.status === "completed").length,
				inProgress: todoList.filter((todo) => todo.status === "in_progress").length,
				pending: todoList.filter((todo) => todo.status === "pending").length,
			}
		}

		const apiProvider = apiConfiguration?.apiProvider

		return {
			language,
			mode,
			taskId: task?.taskId,
			parentTaskId: task?.parentTaskId,
			apiProvider: apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
			modelId: task?.api?.getModel().id,
			diffStrategy: task?.diffStrategy?.getName(),
			isSubtask: task ? !!task.parentTaskId : undefined,
			...(todos && { todos }),
		}
	}

	private async getGitProperties(): Promise<GitProperties> {
		if (!this._gitProperties) {
			this._gitProperties = await getWorkspaceGitInfo()
		}

		return this._gitProperties
	}

	public get gitProperties(): GitProperties | undefined {
		return this._gitProperties
	}

	public async getTelemetryProperties(): Promise<TelemetryProperties> {
		return {
			...this.getAppProperties(),
			...this.getCloudProperties(),
			...(await this.getTaskProperties()),
			...(await this.getGitProperties()),
		}
	}

	public get cwd() {
		return this.currentWorkspacePath || getWorkspacePath()
	}

	/**
	 * Worktree root sent with backfill uploads so the cloud web view can attribute
	 * an offline task to its project. Implements TelemetryPropertiesProvider; kept
	 * out of the per-event telemetry properties to avoid leaking an absolute path
	 * into every event.
	 */
	public getTelemetryWorkspacePath(): string | undefined {
		return this.cwd || undefined
	}

	/**
	 * Delegate the current (parent) task to a new child task and open the
	 * child. See {@link DelegationService.delegate}.
	 */
	public async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	}): Promise<Task> {
		return this.delegation.delegate(params)
	}

	/**
	 * Re-attach a detached parent to its resumed child when all evidence
	 * holds; never throws. See {@link DelegationService.reattach}.
	 */
	public async tryReattachDelegatedParent(parentTaskId: string, childTaskId: string): Promise<boolean> {
		return this.delegation.reattach(parentTaskId, childTaskId)
	}

	/**
	 * Hand a completed child's result back to its parent and reopen the
	 * parent. See {@link DelegationService.complete}.
	 */
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<boolean> {
		return this.delegation.complete(params)
	}

	/**
	 * Convert a file path to a webview-accessible URI
	 * This method safely converts file paths to URIs that can be loaded in the webview
	 *
	 * @param filePath - The absolute file path to convert
	 * @returns The webview URI string, or the original file URI if conversion fails
	 * @throws {Error} When webview is not available
	 * @throws {TypeError} When file path is invalid
	 */
	public convertToWebviewUri(filePath: string): string {
		try {
			const fileUri = vscode.Uri.file(filePath)

			// Check if we have a webview available
			if (this.view?.webview) {
				const webviewUri = this.view.webview.asWebviewUri(fileUri)
				return webviewUri.toString()
			}

			// Specific error for no webview available
			const error = new Error("No webview available for URI conversion")
			console.error(error.message)
			// Fallback to file URI if no webview available
			return fileUri.toString()
		} catch (error) {
			// More specific error handling
			if (error instanceof TypeError) {
				console.error("Invalid file path provided for URI conversion:", error)
			} else {
				console.error("Failed to convert to webview URI:", error)
			}
			// Return file URI as fallback
			return vscode.Uri.file(filePath).toString()
		}
	}
}
