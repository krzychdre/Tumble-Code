import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { VectorStoreSearchResult } from "./interfaces"
import { IndexingState } from "./interfaces/manager"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import fs from "fs/promises"
import ignore from "ignore"
import path from "path"
import { t } from "../../i18n"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { isTransientConnectionError } from "./shared/validation-helpers"

export class CodeIndexManager {
	// --- Singleton Implementation ---
	private static instances = new Map<string, CodeIndexManager>() // Map workspace path to instance

	// Auto-retry tuning for transient connection failures (e.g. a local llama.cpp /
	// Ollama / Qdrant server that is intermittently down). Exponential backoff capped so
	// a permanently-unavailable service is retried at most once every few minutes.
	private static readonly AUTO_RETRY_INITIAL_DELAY_MS = 5_000
	private static readonly AUTO_RETRY_MAX_DELAY_MS = 300_000

	// Specialized class instances
	private _configManager: CodeIndexConfigManager | undefined
	private readonly _stateManager: CodeIndexStateManager
	private _serviceFactory: CodeIndexServiceFactory | undefined
	private _orchestrator: CodeIndexOrchestrator | undefined
	private _searchService: CodeIndexSearchService | undefined
	private _cacheManager: CacheManager | undefined

	// Flag to prevent race conditions during error recovery
	private _isRecoveringFromError = false

	// --- Auto-retry state ---
	// Kept across recoverFromError() so retries can re-initialize without the webview.
	private _contextProxy: ContextProxy | undefined
	private _retryTimer: ReturnType<typeof setTimeout> | undefined
	private _retryAttempt = 0
	private _stateSubscription: vscode.Disposable | undefined

	public static getInstance(context: vscode.ExtensionContext, workspacePath?: string): CodeIndexManager | undefined {
		// Resolve the workspace folder to get both fsPath and the real URI
		let folder: vscode.WorkspaceFolder | undefined

		if (workspacePath) {
			folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === workspacePath)
		} else {
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
			}
			if (!folder) {
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					return undefined
				}
				folder = workspaceFolders[0]
			}
			workspacePath = folder.uri.fsPath
		}

		if (!CodeIndexManager.instances.has(workspacePath)) {
			// folder may be undefined when workspacePath was provided but doesn't match
			// any workspace folder (e.g. cwd passed from a tool). Fall back to file:// URI.
			const folderUri =
				folder?.uri ??
				({
					fsPath: workspacePath,
					scheme: "file",
					authority: "",
					path: workspacePath,
					toString: () => `file://${workspacePath}`,
				} as unknown as vscode.Uri)
			CodeIndexManager.instances.set(workspacePath, new CodeIndexManager(workspacePath, folderUri, context))
		}
		return CodeIndexManager.instances.get(workspacePath)!
	}

	public static getAllInstances(): CodeIndexManager[] {
		return Array.from(CodeIndexManager.instances.values())
	}

	public static disposeAll(): void {
		for (const instance of CodeIndexManager.instances.values()) {
			instance.dispose()
		}
		CodeIndexManager.instances.clear()
	}

	private readonly workspacePath: string
	private readonly _folderUri: vscode.Uri
	private readonly context: vscode.ExtensionContext

	// Private constructor for singleton pattern
	private constructor(workspacePath: string, folderUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.workspacePath = workspacePath
		this._folderUri = folderUri
		this.context = context
		this._stateManager = new CodeIndexStateManager()

		// Watch state transitions to drive automatic recovery from transient connection
		// failures. onProgressUpdate may be a no-op in some test doubles, hence the guard.
		this._stateSubscription = this._stateManager.onProgressUpdate?.((status) =>
			this._onIndexStateChanged(status.systemStatus, status.message),
		)
	}

	// --- Public API ---

	/**
	 * Returns the workspaceState key for per-folder indexing enablement,
	 * keyed by the real workspace folder URI so local/remote schemes cannot collide.
	 */
	private _workspaceEnabledKey(): string {
		return "codeIndexWorkspaceEnabled:" + this._folderUri.toString(true)
	}

	public get isWorkspaceEnabled(): boolean {
		const explicit = this.context.workspaceState.get<boolean | undefined>(this._workspaceEnabledKey(), undefined)
		if (explicit !== undefined) return explicit
		return this.autoEnableDefault
	}

	public async setWorkspaceEnabled(enabled: boolean): Promise<void> {
		await this.context.workspaceState.update(this._workspaceEnabledKey(), enabled)
	}

	public get autoEnableDefault(): boolean {
		return this.context.globalState.get("codeIndexAutoEnableDefault", true)
	}

	public async setAutoEnableDefault(enabled: boolean): Promise<void> {
		await this.context.globalState.update("codeIndexAutoEnableDefault", enabled)
	}

	public get onProgressUpdate() {
		return this._stateManager.onProgressUpdate
	}

	private assertInitialized() {
		if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
			throw new Error("CodeIndexManager not initialized. Call initialize() first.")
		}
	}

	public get state(): IndexingState {
		if (!this.isFeatureEnabled) {
			return "Standby"
		}
		this.assertInitialized()
		return this._orchestrator!.state
	}

	public get isFeatureEnabled(): boolean {
		return this._configManager?.isFeatureEnabled ?? false
	}

	public get isFeatureConfigured(): boolean {
		return this._configManager?.isFeatureConfigured ?? false
	}

	public get isInitialized(): boolean {
		try {
			this.assertInitialized()
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Initializes the manager with configuration and dependent services.
	 * Must be called before using any other methods.
	 * @returns Object indicating if a restart is needed
	 */
	public async initialize(contextProxy: ContextProxy): Promise<{ requiresRestart: boolean }> {
		// Remember the proxy so automatic retries can re-initialize without the webview.
		this._contextProxy = contextProxy

		// 1. ConfigManager Initialization and Configuration Loading
		if (!this._configManager) {
			this._configManager = new CodeIndexConfigManager(contextProxy)
		}
		// Load configuration once to get current state and restart requirements
		const { requiresRestart } = await this._configManager.loadConfiguration()

		// 2. Check if feature is enabled
		if (!this.isFeatureEnabled) {
			if (this._orchestrator) {
				this._orchestrator.stopWatcher()
			}
			return { requiresRestart }
		}

		// 3. Check if workspace is available
		const workspacePath = this.workspacePath
		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "No workspace folder open")
			return { requiresRestart }
		}

		// 4. Check workspace-level enablement (before creating expensive services)
		if (!this.isWorkspaceEnabled) {
			this._stateManager.setSystemState("Standby", "Indexing not enabled for this workspace")
			return { requiresRestart }
		}

		// 5. CacheManager Initialization
		if (!this._cacheManager) {
			this._cacheManager = new CacheManager(this.context, this.workspacePath)
			await this._cacheManager.initialize()
		}

		// 6. Determine if Core Services Need Recreation
		const needsServiceRecreation = !this._serviceFactory || requiresRestart

		if (needsServiceRecreation) {
			await this._recreateServices()
		}

		// 7. Handle Indexing Start/Restart
		const shouldStartOrRestartIndexing =
			requiresRestart ||
			(needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

		if (shouldStartOrRestartIndexing) {
			this._orchestrator?.startIndexing()
		}

		return { requiresRestart }
	}

	/**
	 * Initiates the indexing process (initial scan and starts watcher).
	 * Automatically recovers from error state if needed before starting.
	 *
	 * @important This method should NEVER be awaited as it starts a long-running background process.
	 * The indexing will continue asynchronously and progress will be reported through events.
	 */
	public async startIndexing(): Promise<void> {
		if (!this.isFeatureEnabled || !this.isWorkspaceEnabled) {
			return
		}

		// Check if we're in error state and recover if needed
		const currentStatus = this.getCurrentStatus()
		if (currentStatus.systemStatus === "Error") {
			await this.recoverFromError()

			// After recovery, we need to reinitialize since recoverFromError clears all services
			// This will be handled by the caller (webviewMessageHandler) checking isInitialized
			return
		}

		this.assertInitialized()
		await this._orchestrator!.startIndexing()
	}

	/**
	 * Stops any in-progress indexing operation and the file watcher.
	 */
	public stopIndexing(): void {
		// A user-initiated stop must cancel any pending automatic retry.
		this._cancelAutoRetry()
		if (this._orchestrator) {
			this._orchestrator.stopIndexing()
		}
	}

	/**
	 * Stops the file watcher and potentially cleans up resources.
	 */
	public stopWatcher(): void {
		if (!this.isFeatureEnabled) {
			return
		}
		if (this._orchestrator) {
			this._orchestrator.stopWatcher()
		}
	}

	/**
	 * Recovers from error state by clearing the error and resetting internal state.
	 * This allows the manager to be re-initialized after a recoverable error.
	 *
	 * This method clears all service instances (configManager, serviceFactory, orchestrator, searchService)
	 * to force a complete re-initialization on the next operation. This ensures a clean slate
	 * after recovering from errors such as network failures or configuration issues.
	 *
	 * @remarks
	 * - Safe to call even when not in error state (idempotent)
	 * - Does not restart indexing automatically - call initialize() after recovery
	 * - Service instances will be recreated on next initialize() call
	 * - Prevents race conditions from multiple concurrent recovery attempts
	 */
	public async recoverFromError(): Promise<void> {
		// Prevent race conditions from multiple rapid recovery attempts
		if (this._isRecoveringFromError) {
			return
		}

		this._isRecoveringFromError = true
		try {
			// Clear error state
			this._stateManager.setSystemState("Standby", "")
		} catch (error) {
			// Log error but continue with recovery - clearing service instances is more important
			console.error("Failed to clear error state during recovery:", error)
		} finally {
			// Force re-initialization by clearing service instances
			// This ensures a clean slate even if state update failed
			this._configManager = undefined
			this._serviceFactory = undefined
			this._orchestrator = undefined
			this._searchService = undefined

			// Reset the flag after recovery is complete
			this._isRecoveringFromError = false
		}
	}

	// --- Automatic retry on transient connection failures ---

	/**
	 * Reacts to indexing state transitions to drive automatic recovery.
	 * - On a transient connection `Error` (while the feature is enabled & configured),
	 *   schedules a retry with exponential backoff.
	 * - On any progress/success (`Indexing`/`Indexed`), resets the backoff and cancels
	 *   any pending retry, since the service is healthy again.
	 */
	private _onIndexStateChanged(systemStatus: IndexingState, message?: string): void {
		if (systemStatus === "Indexing" || systemStatus === "Indexed") {
			this._retryAttempt = 0
			this._cancelAutoRetry()
			return
		}

		if (systemStatus !== "Error") {
			return
		}

		// Only auto-retry recoverable connection failures, and only while the feature is
		// actually meant to be running. Permanent misconfigurations (bad key, invalid
		// model/endpoint) are left in Error for the user to fix.
		if (!this.isFeatureEnabled || !this.isWorkspaceEnabled || !this.isFeatureConfigured) {
			return
		}
		if (!isTransientConnectionError(message)) {
			return
		}

		this._scheduleAutoRetry()
	}

	/**
	 * Schedules a single auto-retry using exponential backoff. No-op if one is already
	 * pending (the state subscription can fire multiple times for the same failure).
	 */
	private _scheduleAutoRetry(): void {
		if (this._retryTimer) {
			return
		}

		const delay = Math.min(
			CodeIndexManager.AUTO_RETRY_MAX_DELAY_MS,
			CodeIndexManager.AUTO_RETRY_INITIAL_DELAY_MS * 2 ** this._retryAttempt,
		)
		this._retryAttempt++

		console.log(
			`[CodeIndexManager] Connection error detected. Scheduling automatic reindex retry in ${Math.round(
				delay / 1000,
			)}s (attempt ${this._retryAttempt}).`,
		)

		this._retryTimer = setTimeout(() => {
			this._retryTimer = undefined
			void this._performAutoRetry()
		}, delay)
	}

	/**
	 * Cancels any pending auto-retry and resets the backoff counter.
	 */
	private _cancelAutoRetry(): void {
		if (this._retryTimer) {
			clearTimeout(this._retryTimer)
			this._retryTimer = undefined
		}
		this._retryAttempt = 0
	}

	/**
	 * Performs one automatic retry: recovers from the error state and re-initializes,
	 * which re-validates the embedder connection and (on success) restarts indexing.
	 * A repeated failure simply re-enters the Error state and the subscription schedules
	 * the next retry with a larger backoff.
	 */
	private async _performAutoRetry(): Promise<void> {
		// Bail if things changed while we were waiting.
		if (!this.isFeatureEnabled || !this.isWorkspaceEnabled || !this.isFeatureConfigured) {
			this._retryAttempt = 0
			return
		}
		const currentStatus = this._stateManager.getCurrentStatus().systemStatus
		if (currentStatus === "Indexing" || currentStatus === "Indexed") {
			// Already healthy again — nothing to do.
			this._retryAttempt = 0
			return
		}
		if (!this._contextProxy) {
			console.warn("[CodeIndexManager] Cannot auto-retry indexing: no context proxy available.")
			return
		}

		try {
			// Clear the error and rebuild services, then re-initialize. initialize() will
			// recreate services and auto-start indexing when appropriate.
			await this.recoverFromError()
			await this.initialize(this._contextProxy)
		} catch (error) {
			// Expected when the service is still unreachable — _recreateServices() has
			// already set the Error state, so the subscription will reschedule.
			console.warn(
				`[CodeIndexManager] Automatic reindex retry failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * Cleans up the manager instance.
	 */
	public dispose(): void {
		this.stopIndexing()
		this._cancelAutoRetry()
		this._stateSubscription?.dispose()
		this._stateSubscription = undefined
		this._stateManager.dispose()
	}

	/**
	 * Clears all index data by stopping the watcher, clearing the Qdrant collection,
	 * and deleting the cache file.
	 */
	public async clearIndexData(): Promise<void> {
		if (!this.isFeatureEnabled) {
			return
		}
		this.assertInitialized()
		await this._orchestrator!.clearIndexData()
		await this._cacheManager!.clearCacheFile()
	}

	// --- Private Helpers ---

	public getCurrentStatus() {
		const status = this._stateManager.getCurrentStatus()
		return {
			...status,
			workspacePath: this.workspacePath,
			workspaceEnabled: this.isWorkspaceEnabled,
			autoEnableDefault: this.autoEnableDefault,
		}
	}

	public async searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]> {
		if (!this.isFeatureEnabled) {
			return []
		}
		this.assertInitialized()
		return this._searchService!.searchIndex(query, directoryPrefix)
	}

	/**
	 * Private helper method to recreate services with current configuration.
	 * Used by both initialize() and handleSettingsChange().
	 */
	private async _recreateServices(): Promise<void> {
		// Stop watcher if it exists
		if (this._orchestrator) {
			this.stopWatcher()
		}
		// Clear existing services to ensure clean state
		this._orchestrator = undefined
		this._searchService = undefined

		// (Re)Initialize service factory
		this._serviceFactory = new CodeIndexServiceFactory(
			this._configManager!,
			this.workspacePath,
			this._cacheManager!,
		)

		const ignoreInstance = ignore()
		const workspacePath = this.workspacePath

		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "")
			return
		}

		// Create .gitignore instance
		const ignorePath = path.join(workspacePath, ".gitignore")
		try {
			const content = await fs.readFile(ignorePath, "utf8")
			ignoreInstance.add(content)
			ignoreInstance.add(".gitignore")
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading .gitignore:", error)
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "_recreateServices",
			})
		}

		// Create RooIgnoreController instance
		const rooIgnoreController = new RooIgnoreController(workspacePath)
		await rooIgnoreController.initialize()

		// (Re)Create shared service instances
		const { embedder, vectorStore, scanner, fileWatcher } = this._serviceFactory.createServices(
			this.context,
			this._cacheManager!,
			ignoreInstance,
			rooIgnoreController,
		)

		// Validate embedder configuration before proceeding
		const validationResult = await this._serviceFactory.validateEmbedder(embedder)
		if (!validationResult.valid) {
			const errorMessage = validationResult.error || "Embedder configuration validation failed"
			this._stateManager.setSystemState("Error", errorMessage)
			throw new Error(errorMessage)
		}

		// (Re)Initialize orchestrator
		this._orchestrator = new CodeIndexOrchestrator(
			this._configManager!,
			this._stateManager,
			this.workspacePath,
			this._cacheManager!,
			vectorStore,
			scanner,
			fileWatcher,
		)

		// (Re)Initialize search service
		this._searchService = new CodeIndexSearchService(
			this._configManager!,
			this._stateManager,
			embedder,
			vectorStore,
		)

		// Clear any error state after successful recreation
		this._stateManager.setSystemState("Standby", "")
	}

	/**
	 * Handle code index settings changes.
	 * This method should be called when code index settings are updated
	 * to ensure the CodeIndexConfigManager picks up the new configuration.
	 * If the configuration changes require a restart, the service will be restarted.
	 */
	public async handleSettingsChange(): Promise<void> {
		if (this._configManager) {
			const { requiresRestart } = await this._configManager.loadConfiguration()

			const isFeatureEnabled = this.isFeatureEnabled
			const isFeatureConfigured = this.isFeatureConfigured

			// If feature is disabled, stop the service (including any active scan).
			// stopIndexing() also cancels any pending automatic retry.
			if (!isFeatureEnabled) {
				this.stopIndexing()
				this._stateManager.setSystemState("Standby", "Code indexing is disabled")
				return
			}

			if (requiresRestart && isFeatureEnabled && isFeatureConfigured) {
				try {
					// Ensure cacheManager is initialized before recreating services
					if (!this._cacheManager) {
						this._cacheManager = new CacheManager(this.context, this.workspacePath)
						await this._cacheManager.initialize()
					}

					// Recreate services with new configuration
					await this._recreateServices()
				} catch (error) {
					// Error state already set in _recreateServices
					console.error("Failed to recreate services:", error)
					TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
						location: "handleSettingsChange",
					})
					// Re-throw the error so the caller knows validation failed
					throw error
				}
			}
		}
	}
}
