import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { byLengthAsc, Fzf } from "fzf"
import { getBinPath } from "../ripgrep"
import { runRipgrep, RIPGREP_DEFAULT_TIMEOUT_MS } from "../ripgrep/runner"
import { Package } from "../../shared/package"

export type FileResult = { path: string; type: "file" | "folder"; label?: string }

/**
 * A file listing returns what it found so far after this many ms. Generous on
 * purpose: callers such as the nested-git check of checkpoints need the full
 * list, and the line limit usually ends the run long before.
 */
export const FILE_SEARCH_TIMEOUT_MS = RIPGREP_DEFAULT_TIMEOUT_MS

export async function executeRipgrep({
	args,
	workspacePath,
	limit = 500,
	timeoutMs = FILE_SEARCH_TIMEOUT_MS,
}: {
	args: string[]
	workspacePath: string
	limit?: number
	timeoutMs?: number
}): Promise<FileResult[]> {
	const rgPath = await getBinPath(vscode.env.appRoot)

	if (!rgPath) {
		throw new Error(`ripgrep not found: ${rgPath}`)
	}

	const { lines } = await runRipgrep({ rgPath, args, limit, timeoutMs })

	const fileResults: FileResult[] = []
	const dirSet = new Set<string>() // Track unique directory paths.

	for (const line of lines) {
		const relativePath = path.relative(workspacePath, line)

		// Add the file itself.
		fileResults.push({ path: relativePath, type: "file", label: path.basename(relativePath) })

		// Extract and store all parent directory paths.
		let dirPath = path.dirname(relativePath)

		while (dirPath && dirPath !== "." && dirPath !== "/") {
			dirSet.add(dirPath)
			dirPath = path.dirname(dirPath)
		}
	}

	// Convert directory set to array of directory objects.
	const dirResults = Array.from(dirSet).map((dirPath) => ({
		path: dirPath,
		type: "folder" as const,
		label: path.basename(dirPath),
	}))

	return [...fileResults, ...dirResults]
}

/**
 * Get extra ripgrep arguments based on VSCode search configuration
 */
function getRipgrepSearchOptions(): string[] {
	const config = vscode.workspace.getConfiguration("search")
	const extraArgs: string[] = []

	// Respect VSCode's search.useIgnoreFiles setting
	if (config.get("useIgnoreFiles") === false) {
		extraArgs.push("--no-ignore")
	}

	// Respect VSCode's search.useGlobalIgnoreFiles setting
	if (config.get("useGlobalIgnoreFiles") === false) {
		extraArgs.push("--no-ignore-global")
	}

	// Respect VSCode's search.useParentIgnoreFiles setting
	if (config.get("useParentIgnoreFiles") === false) {
		extraArgs.push("--no-ignore-parent")
	}

	return extraArgs
}

export async function executeRipgrepForFiles(
	workspacePath: string,
	limit?: number,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	// Get limit from configuration if not provided
	const effectiveLimit =
		limit ?? vscode.workspace.getConfiguration(Package.name).get<number>("maximumIndexedFilesForFileSearch", 10000)

	const args = [
		"--files",
		"--follow",
		"--hidden",
		...getRipgrepSearchOptions(),
		"-g",
		"!**/node_modules/**",
		"-g",
		"!**/.git/**",
		"-g",
		"!**/out/**",
		"-g",
		"!**/dist/**",
		workspacePath,
	]

	return executeRipgrep({ args, workspacePath, limit: effectiveLimit })
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	try {
		// Get all files and directories (uses configured limit)
		const allItems = await executeRipgrepForFiles(workspacePath)

		// If no query, just return the top items
		if (!query.trim()) {
			return allItems.slice(0, limit)
		}

		// Create search items for all files AND directories
		const searchItems = allItems.map((item) => ({
			original: item,
			searchStr: `${item.path} ${item.label || ""}`,
		}))

		// Run fzf search on all items
		const fzf = new Fzf(searchItems, {
			selector: (item) => item.searchStr,
			tiebreakers: [byLengthAsc],
			limit: limit,
		})

		// Get all matching results from fzf
		const fzfResults = fzf.find(query).map((result) => result.item.original)

		// Verify types of the shortest results
		const verifiedResults = await Promise.all(
			fzfResults.map(async (result) => {
				const fullPath = path.join(workspacePath, result.path)
				// Verify if the path exists and is actually a directory (async: this
				// runs on the extension host for every keystroke of an @-mention).
				try {
					const isDirectory = (await fs.promises.lstat(fullPath)).isDirectory()
					return {
						...result,
						path: result.path.toPosix(),
						type: isDirectory ? ("folder" as const) : ("file" as const),
					}
				} catch {
					// If path doesn't exist, keep original type
					return result
				}
			}),
		)

		return verifiedResults
	} catch (error) {
		console.error("Error in searchWorkspaceFiles:", error)
		return []
	}
}
