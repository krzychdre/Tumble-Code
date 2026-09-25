import * as path from "path"

import * as vscode from "vscode"

import { arePathsEqual } from "../../utils/path"

import type { McpConfigSource } from "./mcpConfigSchema"

/** Something to stop: a file watcher or an event subscription. */
export interface McpDisposable {
	dispose(): void
}

/** Receives the events of one watched file; each gets the path of the file that changed. */
export interface McpFileListeners {
	onChange(filePath: string): void
	onCreate(filePath: string): void
	onDelete?(filePath: string): void
}

/**
 * Where McpConfigWatcher gets its file and workspace events from. The default
 * uses the VS Code API; tests pass a fake they can fire events through.
 */
export interface McpWatcherFactory {
	/**
	 * Watches `relativePattern` under `baseDirectory`. Returns undefined when
	 * file watching is not available (a host without the VS Code watcher API).
	 */
	watchFile(baseDirectory: string, relativePattern: string, listeners: McpFileListeners): McpDisposable | undefined
	onDidChangeWorkspaceFolders(listener: () => void): McpDisposable
}

export const vscodeWatcherFactory: McpWatcherFactory = {
	watchFile(baseDirectory, relativePattern, listeners) {
		if (!vscode.workspace.createFileSystemWatcher) {
			return undefined
		}
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(baseDirectory, relativePattern),
		)
		const subscriptions = [
			watcher.onDidChange((uri) => listeners.onChange(uri.fsPath)),
			watcher.onDidCreate((uri) => listeners.onCreate(uri.fsPath)),
		]
		const { onDelete } = listeners
		if (onDelete) {
			subscriptions.push(watcher.onDidDelete((uri) => onDelete(uri.fsPath)))
		}
		return vscode.Disposable.from(...subscriptions, watcher)
	},
	onDidChangeWorkspaceFolders(listener) {
		return vscode.workspace.onDidChangeWorkspaceFolders(() => listener())
	},
}

/** What McpConfigWatcher reports to the hub. */
export interface McpConfigWatcherListener {
	/** A settings file changed or appeared: debounced, and not while the write guard is up. */
	onConfigFileChanged(filePath: string, source: McpConfigSource): Promise<void>
	/** The project file was deleted. */
	onProjectConfigDeleted(): Promise<void>
	/** The workspace folders changed, so the project file may be another one now. */
	onWorkspaceFoldersChanged(): Promise<void>
}

/**
 * Watches the global and the project MCP settings files and the workspace
 * folders, and reports changes to its listener. A burst of change events for
 * one file becomes one report DEBOUNCE_MS after the last event; events while
 * `isWriteGuardUp()` holds are dropped, because they are the echo of the
 * hub's own write (see McpConfigStore).
 */
export class McpConfigWatcher {
	static readonly DEBOUNCE_MS = 500

	private globalWatcher?: McpDisposable
	private projectWatcher?: McpDisposable
	private workspaceFoldersSubscription?: McpDisposable
	private debounceTimers = new Map<string, NodeJS.Timeout>()

	constructor(
		private readonly factory: McpWatcherFactory,
		private readonly isWriteGuardUp: () => boolean,
		private readonly listener: McpConfigWatcherListener,
	) {}

	/** Watches the global settings file, replacing an earlier global watch. */
	watchGlobalFile(settingsPath: string): void {
		this.globalWatcher?.dispose()
		const onEvent = (filePath: string) => {
			if (arePathsEqual(filePath, settingsPath)) {
				this.debounce(settingsPath, "global")
			}
		}
		this.globalWatcher = this.factory.watchFile(path.dirname(settingsPath), path.basename(settingsPath), {
			onChange: onEvent,
			onCreate: onEvent,
		})
	}

	/**
	 * Watches `.roo/mcp.json` in the workspace folder, replacing an earlier
	 * project watch; without a folder it only stops the earlier one.
	 */
	watchProjectFile(workspaceFolder: string | undefined): void {
		this.projectWatcher?.dispose()
		this.projectWatcher = undefined
		if (workspaceFolder === undefined) {
			return
		}
		this.projectWatcher = this.factory.watchFile(workspaceFolder, ".roo/mcp.json", {
			onChange: (filePath) => this.debounce(filePath, "project"),
			onCreate: (filePath) => this.debounce(filePath, "project"),
			onDelete: () => {
				this.listener.onProjectConfigDeleted().catch(console.error)
			},
		})
	}

	watchWorkspaceFolders(): void {
		this.workspaceFoldersSubscription?.dispose()
		this.workspaceFoldersSubscription = this.factory.onDidChangeWorkspaceFolders(() => {
			this.listener.onWorkspaceFoldersChanged().catch(console.error)
		})
	}

	dispose(): void {
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer)
		}
		this.debounceTimers.clear()
		this.globalWatcher?.dispose()
		this.globalWatcher = undefined
		this.projectWatcher?.dispose()
		this.projectWatcher = undefined
		this.workspaceFoldersSubscription?.dispose()
		this.workspaceFoldersSubscription = undefined
	}

	private debounce(filePath: string, source: McpConfigSource): void {
		// The hub's own write: handling it would update the servers a second time.
		if (this.isWriteGuardUp()) {
			return
		}

		const key = `${source}-${filePath}`
		const existingTimer = this.debounceTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}
		const timer = setTimeout(() => {
			this.debounceTimers.delete(key)
			this.listener.onConfigFileChanged(filePath, source).catch(console.error)
		}, McpConfigWatcher.DEBOUNCE_MS)
		this.debounceTimers.set(key, timer)
	}
}
