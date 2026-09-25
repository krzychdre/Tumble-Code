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

/**
 * Directories the file listing never descends into (the `-g` excludes below). A watcher
 * event under one of them cannot change the list, so it does not invalidate the cache.
 */
const EXCLUDED_DIRECTORIES = ["node_modules", ".git", "out", "dist"]

/** The ripgrep arguments and line limit of a workspace file listing, from the current settings. */
function fileListingRequest(workspacePath: string, limit?: number): { args: string[]; limit: number } {
	// Get limit from configuration if not provided
	const effectiveLimit =
		limit ?? vscode.workspace.getConfiguration(Package.name).get<number>("maximumIndexedFilesForFileSearch", 10000)

	const args = [
		"--files",
		"--follow",
		"--hidden",
		...getRipgrepSearchOptions(),
		...EXCLUDED_DIRECTORIES.flatMap((dir) => ["-g", `!**/${dir}/**`]),
		workspacePath,
	]

	return { args, limit: effectiveLimit }
}

export async function executeRipgrepForFiles(
	workspacePath: string,
	limit?: number,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	const request = fileListingRequest(workspacePath, limit)
	return executeRipgrep({ args: request.args, workspacePath, limit: request.limit })
}

/**
 * How long a cached workspace file list is trusted without any watcher event. The watcher
 * (see `noteWorkspaceFileEvent`) is the main invalidation; this is the backstop for what it
 * cannot see: `files.watcherExclude`, targets of followed symlinks, a global gitignore, a
 * workspace root outside the watched folders.
 */
export const WORKSPACE_FILE_LIST_TTL_MS = 30_000

/** Distinct workspace roots kept at once (a task can run in a directory of its own). */
const MAX_CACHED_WORKSPACES = 8

/** File names ripgrep reads ignore rules from: a change to one can change the whole list. */
const IGNORE_FILE_NAMES = new Set([".gitignore", ".ignore", ".rgignore"])

type FileSearchItem = { original: FileResult; searchStr: string }

/**
 * A walked file list plus its fuzzy finders. Building an `Fzf` converts every entry to code
 * points, which on a large list costs more than the match itself, so a finder is built once
 * per result limit and each query only runs `find` on it.
 */
class WorkspaceFileList {
	private readonly finders = new Map<number, Fzf<FileSearchItem[]>>()

	constructor(readonly items: FileSearchItem[]) {}

	finder(limit: number): Fzf<FileSearchItem[]> {
		let finder = this.finders.get(limit)
		if (!finder) {
			finder = new Fzf(this.items, {
				selector: (item) => item.searchStr,
				tiebreakers: [byLengthAsc],
				limit,
			})
			this.finders.set(limit, finder)
		}
		return finder
	}
}

interface CachedFileList {
	/** The ripgrep arguments and limit the list was made with; other settings mean a new walk. */
	requestKey: string
	/** Pending while the walk runs, so concurrent queries on a cold cache share it. */
	items: Promise<WorkspaceFileList>
	/** `Infinity` until the walk finishes: a running walk never expires. */
	expiresAt: number
}

/** Keyed by the resolved workspace root. Map order is insertion order, oldest first. */
const workspaceFileLists = new Map<string, CachedFileList>()

/**
 * The file list of a workspace for the @-mention search, walked at most once per root until
 * a watcher event or the time to live invalidates it. Every query used to spawn a full
 * `rg --files` walk; the fuzzy match still runs per query, on this list.
 */
function getWorkspaceFileList(workspacePath: string): Promise<WorkspaceFileList> {
	const root = path.resolve(workspacePath)
	const request = fileListingRequest(workspacePath)
	const requestKey = JSON.stringify(request)

	const cached = workspaceFileLists.get(root)
	if (cached && cached.requestKey === requestKey && Date.now() < cached.expiresAt) {
		return cached.items
	}

	const entry: CachedFileList = {
		requestKey,
		items: Promise.resolve(new WorkspaceFileList([])),
		expiresAt: Infinity,
	}
	entry.items = executeRipgrep({ args: request.args, workspacePath, limit: request.limit }).then(
		(results) => {
			// An event that arrived during the walk already removed this entry; the callers
			// waiting on it still get the list, the next query walks again.
			if (workspaceFileLists.get(root) === entry) {
				entry.expiresAt = Date.now() + WORKSPACE_FILE_LIST_TTL_MS
			}
			return new WorkspaceFileList(
				results.map((item) => ({ original: item, searchStr: `${item.path} ${item.label || ""}` })),
			)
		},
		(error) => {
			// A failed walk is not kept: the next query tries again.
			if (workspaceFileLists.get(root) === entry) {
				workspaceFileLists.delete(root)
			}
			throw error
		},
	)

	workspaceFileLists.delete(root)
	workspaceFileLists.set(root, entry)
	if (workspaceFileLists.size > MAX_CACHED_WORKSPACES) {
		const oldest = workspaceFileLists.keys().next().value
		if (oldest !== undefined) {
			workspaceFileLists.delete(oldest)
		}
	}

	return entry.items
}

/**
 * Tells the file list cache about a file system event, from the watcher `WorkspaceTracker`
 * already runs for the whole workspace.
 *
 * - `create` / `delete` (a rename is both) drop the list of every cached root that contains
 *   the path, unless the path is under a directory the listing excludes (a build writing
 *   into `dist` or `node_modules` would otherwise empty the cache all the time).
 * - `change` only matters for an ignore file; since a parent directory's ignore file
 *   applies too, it drops every cached list.
 */
export function noteWorkspaceFileEvent(kind: "create" | "delete" | "change", fsPath: string): void {
	if (workspaceFileLists.size === 0) {
		return
	}

	if (IGNORE_FILE_NAMES.has(path.basename(fsPath))) {
		workspaceFileLists.clear()
		return
	}

	if (kind === "change") {
		return
	}

	const changed = path.resolve(fsPath)
	for (const root of Array.from(workspaceFileLists.keys())) {
		const relative = path.relative(root, changed)
		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
			continue
		}
		const parentDirectories = relative.split(path.sep).slice(0, -1)
		if (parentDirectories.some((dir) => EXCLUDED_DIRECTORIES.includes(dir))) {
			continue
		}
		workspaceFileLists.delete(root)
	}
}

/** Drops every cached workspace file list. */
export function clearWorkspaceFileListCache(): void {
	workspaceFileLists.clear()
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	try {
		// All files and directories (uses the configured limit), walked once per workspace
		// and shared by the queries that follow.
		const fileList = await getWorkspaceFileList(workspacePath)

		// If no query, just return the top items
		if (!query.trim()) {
			return fileList.items.slice(0, limit).map((item) => ({ ...item.original }))
		}

		// Run the fuzzy match for this query on the (cached) list
		const fzfResults = fileList
			.finder(limit)
			.find(query)
			.map((result) => result.item.original)

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
					// If path doesn't exist, keep original type (a copy: the original is cached)
					return { ...result }
				}
			}),
		)

		return verifiedResults
	} catch (error) {
		console.error("Error in searchWorkspaceFiles:", error)
		return []
	}
}
