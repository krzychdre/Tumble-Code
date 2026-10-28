import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"
import { logger } from "../../utils/logging"
import { analyzeCommand, type ShellWord } from "@tumble-code/core/browser"
import { programName, unwrapCommand } from "../auto-approval/commandWrappers"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/** Commands that read or copy the contents of the files they name. */
const FILE_READING_COMMANDS = new Set([
	// Unix
	"cat",
	"less",
	"more",
	"head",
	"tail",
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"awk",
	"sed",
	"nl",
	"tac",
	"rev",
	"cut",
	"sort",
	"uniq",
	"paste",
	"diff",
	"cmp",
	"strings",
	"base64",
	"xxd",
	"od",
	"hexdump",
	"jq",
	"yq",
	"bat",
	"view",
	"vi",
	"vim",
	"nano",
	"cp",
	"mv",
	"scp",
	"rsync",
	"tar",
	"zip",
	"gzip",
	"openssl",
	// PowerShell commands and aliases, cmd
	"get-content",
	"gc",
	"type",
	"select-string",
	"sls",
	"copy-item",
	"copy",
	"more.com",
])

/** A Windows cmd switch such as `/?`, `/b` or `/s`, not a path. */
const CMD_SWITCH = /^\/[A-Za-z?]{1,2}$/
/** A leading redirection operator attached to its file: `<file`, `2>file`, `&>file`. */
const REDIRECTION = /^(?:\d*|&)(?:<|>>?|<>)/
/** One leading expansion: `$(...)`, `${...}`, `$NAME` or a backtick substitution. */
const LEADING_EXPANSION = /^(?:\$\([^)]*\)|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|`[^`]*`)/

/**
 * The paths an argument may name, as the command will use it: its value
 * after quote removal, the value of a `-Name:value` option, and for a word
 * with an expansion what follows the expansion (relative to cwd) and the
 * word as written (a glob such as `secrets/*` matches like a path).
 */
function pathCandidates(word: ShellWord): string[] {
	const value = word.literal
	if (value !== null) {
		if (CMD_SWITCH.test(value)) {
			return []
		}
		if (value.startsWith("-")) {
			// A PowerShell `-Path:secrets/key`, or a flag with no path.
			const colon = value.indexOf(":")
			return colon > 0 ? [value.slice(colon + 1)].filter(Boolean) : []
		}
		const target = value.replace(REDIRECTION, "")
		return target ? [target] : []
	}
	const raw = word.raw.replace(/["']/g, "").replace(REDIRECTION, "")
	let rest = raw
	while (LEADING_EXPANSION.test(rest)) {
		rest = rest.replace(LEADING_EXPANSION, "")
	}
	const candidates = [raw]
	if (rest !== raw && rest) {
		candidates.push(rest.replace(/^[\\/]+/, ""))
	}
	return candidates.filter(Boolean)
}

/** The real path of `absolutePath` (symlinks followed), or `absolutePath` itself when it cannot be resolved. */
function resolveRealPath(absolutePath: string): string {
	try {
		return fsSync.realpathSync(absolutePath)
	} catch {
		return absolutePath
	}
}

/**
 * {@link resolveRealPath} for many paths at once (API P6). Node's
 * `realpathSync` checks every component of the path, about 8 file-system calls
 * per path, although the paths of one listing share their directories. The
 * parent directory is resolved once per `realDirectories` map, and only the
 * entry itself is checked for a symlink. Same result as `resolveRealPath`.
 */
function resolveWithDirectoryCache(absolutePath: string, realDirectories: Map<string, string | null>): string {
	const directory = path.dirname(absolutePath)
	if (directory === absolutePath) {
		return resolveRealPath(absolutePath)
	}

	let realDirectory = realDirectories.get(directory)
	if (realDirectory === undefined) {
		try {
			realDirectory = fsSync.realpathSync(directory)
		} catch {
			realDirectory = null
		}
		realDirectories.set(directory, realDirectory)
	}

	// The directory cannot be resolved: neither can the entry, the answer is the input.
	if (realDirectory === null) {
		return absolutePath
	}

	try {
		if (fsSync.lstatSync(absolutePath).isSymbolicLink()) {
			return resolveRealPath(absolutePath)
		}
	} catch {
		// The entry does not exist: realpathSync fails on it too.
		return absolutePath
	}

	return path.join(realDirectory, path.basename(absolutePath))
}

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .rooignore files.
 */
export class RooIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	rooIgnoreContent: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.rooIgnoreContent = undefined
		// Set up file watcher for .rooignore
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadRooIgnore()
	}

	/**
	 * Set up the file watcher for .rooignore changes
	 */
	private setupFileWatcher(): void {
		const rooignorePattern = new vscode.RelativePattern(this.cwd, ".rooignore")
		const fileWatcher = vscode.workspace.createFileSystemWatcher(rooignorePattern)

		// Watch for changes and updates
		this.disposables.push(
			fileWatcher.onDidChange(() => {
				this.loadRooIgnore()
			}),
			fileWatcher.onDidCreate(() => {
				this.loadRooIgnore()
			}),
			fileWatcher.onDidDelete(() => {
				this.loadRooIgnore()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Load custom patterns from .rooignore if it exists
	 */
	private async loadRooIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			const ignorePath = path.join(this.cwd, ".rooignore")
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				this.rooIgnoreContent = content
				this.ignoreInstance.add(content)
				this.ignoreInstance.add(".rooignore")
			} else {
				this.rooIgnoreContent = undefined
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			logger.error("Unexpected error loading .rooignore:", error)
		}
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * Automatically resolves symlinks
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string, realDirectories?: Map<string, string | null>): boolean {
		// Always allow access if .rooignore does not exist
		if (!this.rooIgnoreContent) {
			return true
		}
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Follow symlinks to get the real path. If that fails (file doesn't
			// exist, broken symlink, etc.), use the original path.
			const realPath = realDirectories
				? resolveWithDirectoryCache(absolutePath, realDirectories)
				: resolveRealPath(absolutePath)

			// Convert real path to relative for .rooignore checking
			const relativePath = path.relative(this.cwd, realPath).toPosix()

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// Allow access to files outside cwd or on errors (backward compatibility)
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns.
	 *
	 * Every command the shell would run is looked at, as the shell would see it:
	 * the commands of a chain, of a substitution and of a wrapper (`sh -c '...'`,
	 * `sudo`, `xargs`, see commandWrappers), with quotes removed. For a command
	 * that reads or copies file contents, each argument that names a path is
	 * checked, absolute paths and `-Path:value` included; an argument built from
	 * an expansion (`$(pwd)/secrets/key`, `secrets/*`) is checked by what follows
	 * the expansion and as written. Commands that only name a path without
	 * reading it (`rm -rf node_modules`) are not refused.
	 *
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no .rooignore exists
		if (!this.rooIgnoreContent) {
			return undefined
		}
		return this.findIgnoredRead(command, 0)
	}

	private findIgnoredRead(command: string, depth: number): string | undefined {
		if (depth > 8) {
			return undefined
		}
		// Where a `cd` earlier in the command moved to, relative to cwd: in
		// `cd secrets && cat key.txt` the file read is secrets/key.txt.
		let directory = ""
		for (const analyzed of analyzeCommand(command).commands) {
			const [commandWord, ...args] = analyzed.words
			const name = programName(commandWord?.literal ?? commandWord?.raw ?? "").toLowerCase()
			if ((name === "cd" || name === "pushd") && args[0]?.literal) {
				directory = path.join(directory, args[0].literal)
				continue
			}
			if (FILE_READING_COMMANDS.has(name.replace(/\.exe$/, ""))) {
				for (const arg of args) {
					for (const candidate of pathCandidates(arg)) {
						if (
							!this.validateAccess(
								path.isAbsolute(candidate) ? candidate : path.join(directory, candidate),
							)
						) {
							return candidate
						}
					}
				}
			}
			for (const inner of unwrapCommand(analyzed.words).commands) {
				const found = this.findIgnoredRead(inner, depth + 1)
				if (found) {
					return found
				}
			}
		}
		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			// Real paths of the parent directories, resolved once for this call.
			const realDirectories = new Map<string, string | null>()
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p, realDirectories),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			logger.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Get formatted instructions about the .rooignore file for the LLM
	 * @returns Formatted instructions or undefined if .rooignore doesn't exist
	 */
	getInstructions(): string | undefined {
		if (!this.rooIgnoreContent) {
			return undefined
		}

		return `# .rooignore\n\n(The following is provided by a root-level .rooignore file where the user has specified files and directories that should not be accessed. When using list_files, you'll notice a ${LOCK_TEXT_SYMBOL} next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n${this.rooIgnoreContent}\n.rooignore`
	}
}
