import * as vscode from "vscode"

import { invalidateRooDirectoryCache } from "./cache"
import { logger } from "../../utils/logging"

/**
 * Keep the `.roo` lookup cache (cache.ts) in step with the disk: a file
 * created or deleted in any workspace `.roo` directory can add or remove a
 * subfolder `.roo`, so drop everything. A file changed in place cannot move a
 * directory, so edits (a memory note, a rule) do not trigger a rescan.
 *
 * Hosts whose watchers never fire (the CLI's VS Code shim) fall back on the
 * cache's time limit.
 */
export function registerRooDirectoryWatchers(): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = []

	if (!vscode.workspace?.createFileSystemWatcher) {
		return disposables
	}

	const onStructureChange = () => invalidateRooDirectoryCache()

	const watch = (pattern: vscode.GlobPattern) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)
		disposables.push(watcher, watcher.onDidCreate(onStructureChange), watcher.onDidDelete(onStructureChange))
	}

	try {
		watch("**/.roo/**")
	} catch (error) {
		logger.warn(`[roo-config] Could not watch .roo directories; lookups refresh on a timer instead: ${error}`)
	}

	// Test doubles of the watcher API return undefined from the event hooks.
	return disposables.filter((disposable) => typeof disposable?.dispose === "function")
}
