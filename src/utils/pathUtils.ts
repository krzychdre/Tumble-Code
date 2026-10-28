import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

/**
 * The path with every symlink resolved: the longest part that exists is
 * resolved on disk and the rest (a file still to be written) appended. A path
 * whose existing part cannot be resolved is returned as given.
 */
export function realPathOf(absolutePath: string): string {
	let existing = absolutePath
	const missing: string[] = []
	for (;;) {
		try {
			return path.join(fs.realpathSync.native(existing), ...missing.reverse())
		} catch {
			const parent = path.dirname(existing)
			if (parent === existing) {
				return absolutePath
			}
			missing.push(path.basename(existing))
			existing = parent
		}
	}
}

function isWithin(filePath: string, folderPath: string): boolean {
	return (
		filePath === folderPath ||
		filePath.startsWith(folderPath.endsWith(path.sep) ? folderPath : folderPath + path.sep)
	)
}

/**
 * Checks if a file path is outside all workspace folders.
 *
 * Inside means inside a workspace folder both as written and on disk: a
 * symlink in the workspace that points elsewhere (`docs -> /etc`, a link a
 * cloned repository ships) leads outside, so the path is outside.
 *
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string): boolean {
	// If there are no workspace folders, consider everything outside workspace for safety
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	// Normalize and resolve the path to handle .. and . components correctly
	const absolutePath = path.resolve(filePath)
	const folders = vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath)

	// Path is inside a workspace if it equals the workspace path or is a subfolder
	if (!folders.some((folderPath) => isWithin(absolutePath, folderPath))) {
		return true
	}

	const resolved = realPathOf(absolutePath)
	return !folders.some((folderPath) => isWithin(resolved, realPathOf(path.resolve(folderPath))))
}
