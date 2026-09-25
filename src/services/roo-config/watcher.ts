import * as vscode from "vscode"

import { invalidateRooDirectoryCache } from "./cache"
import { getGlobalRooDirectory } from "./index"

/**
 * Keep the `.roo` lookup cache (cache.ts) in step with the disk.
 *
 * - A file created or deleted in any workspace `.roo` directory can add or
 *   remove a subfolder `.roo`, or a command: drop everything.
 * - A file changed in place cannot move a directory, but it can edit a
 *   command's text or front matter: drop the command lists only. Editing a
 *   memory note or a rule therefore does not trigger a workspace rescan.
 * - The global ~/.roo/commands lies outside the workspace, so it gets its own
 *   watcher.
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
	const onContentChange = () => invalidateRooDirectoryCache("commands")

	const watch = (pattern: vscode.GlobPattern) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern)
		disposables.push(
			watcher,
			watcher.onDidCreate(onStructureChange),
			watcher.onDidDelete(onStructureChange),
			watcher.onDidChange(onContentChange),
		)
	}

	try {
		watch("**/.roo/**")

		if (vscode.RelativePattern && vscode.Uri) {
			watch(new vscode.RelativePattern(vscode.Uri.file(getGlobalRooDirectory()), "{commands,commands/**}"))
		}
	} catch (error) {
		console.warn(`[roo-config] Could not watch .roo directories; lookups refresh on a timer instead: ${error}`)
	}

	// Test doubles of the watcher API return undefined from the event hooks.
	return disposables.filter((disposable) => typeof disposable?.dispose === "function")
}
