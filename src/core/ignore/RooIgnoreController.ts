import os from "os"
import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"
import { logger } from "../../utils/logging"
import { analyzeCommand, type ShellWord } from "@tumble-code/core/browser"
import { expandedPath, programName, unwrapCommand } from "../auto-approval/commandWrappers"

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

/** Readers whose arguments name the files in their own syntax: the words naming what each reads. */
const READ_OPERANDS: Record<string, (args: ShellWord[]) => ShellWord[]> = {
	dd: (args) => args.filter((word) => (word.literal ?? word.raw).startsWith("if=")).map((word) => after(word, "=")),
	// `git show HEAD:secrets/key.txt`, `git cat-file -p HEAD:secrets/key.txt`
	git: (args) =>
		["show", "cat-file"].includes(args[0]?.literal ?? "")
			? args.filter((word) => (word.literal ?? word.raw).includes(":")).map((word) => after(word, ":"))
			: [],
}

/** The part of a word after the first `separator`, as written and after quote removal. */
function after(word: ShellWord, separator: string): ShellWord {
	return {
		raw: word.raw.slice(word.raw.indexOf(separator) + 1),
		literal: word.literal === null ? null : word.literal.slice(word.literal.indexOf(separator) + 1),
	}
}

/** The words a command reads files through: its operands for a reader, nothing for other commands. */
function readOperands(name: string, args: ShellWord[]): ShellWord[] {
	if (Object.hasOwn(READ_OPERANDS, name)) {
		return READ_OPERANDS[name](args)
	}
	return FILE_READING_COMMANDS.has(name) ? args : []
}

const DOT: ShellWord = { raw: ".", literal: "." }

/** The arguments that are not options; `.` added when the command searches the cwd without a path. */
function operands(args: ShellWord[], dotWhenAtMost: number): ShellWord[] {
	const found = args.filter((word) => !(word.literal ?? "").startsWith("-"))
	return found.length <= dotWhenAtMost ? [...found, DOT] : found
}

/** Whether an option is given: a short one inside a cluster (`-rn`), or a long one. */
function hasOption(args: ShellWord[], letters: string, long: readonly string[]): boolean {
	return args.some((word) => {
		const arg = word.literal ?? ""
		return long.includes(arg) || (/^-[A-Za-z]+$/.test(arg) && [...letters].some((letter) => arg.includes(letter)))
	})
}

const GREP_RECURSIVE = (args: ShellWord[]) =>
	hasOption(args, "rR", ["--recursive", "--dereference-recursive"]) ? operands(args, 1) : null
const FIND_EXEC = ["-exec", "-execdir", "-ok", "-okdir"]

/**
 * Readers of whole directories (`grep -r`, `cp -r`, `tar c`, `find -exec
 * cat`): the words naming the directories they read, or null when the
 * command reads only the files it names. What they read is not known file by
 * file, so a directory holding an ignored path asks the user.
 */
const RECURSIVE_READERS: Record<string, (args: ShellWord[]) => ShellWord[] | null> = {
	grep: GREP_RECURSIVE,
	egrep: GREP_RECURSIVE,
	fgrep: GREP_RECURSIVE,
	rg: (args) => operands(args, 1),
	cp: (args) => (hasOption(args, "rRa", ["--recursive", "--archive"]) ? operands(args, -1) : null),
	rsync: (args) => (hasOption(args, "ra", ["--recursive", "--archive"]) ? operands(args, -1) : null),
	scp: (args) => (hasOption(args, "r", []) ? operands(args, -1) : null),
	zip: (args) => (hasOption(args, "rR", ["--recurse-paths"]) ? operands(args, -1) : null),
	tar: (args) => {
		const oldStyle = args[0]?.literal && !args[0].literal.startsWith("-") ? args[0].literal : ""
		const creates = /[cru]/.test(oldStyle) || hasOption(args, "cru", ["--create", "--append", "--update"])
		return creates ? operands(args, -1) : null
	},
	find: (args) => {
		const reads = args.some(
			(word, index) =>
				FIND_EXEC.includes(word.literal ?? "") &&
				FILE_READING_COMMANDS.has(programName(args[index + 1]?.literal ?? "").toLowerCase()),
		)
		const expression = args.findIndex((word) => /^[-(!]/.test(word.literal ?? "-"))
		const starts = args.slice(0, expression === -1 ? args.length : expression)
		return reads ? (starts.length > 0 ? starts : [DOT]) : null
	},
}

/** The words naming the directories a command reads as a whole; none for other commands. */
function directoriesRead(name: string, args: ShellWord[]): ShellWord[] {
	return (Object.hasOwn(RECURSIVE_READERS, name) && RECURSIVE_READERS[name](args)) || []
}

/** Most entries looked at for an ignored path below a directory; past it the answer is yes. */
const WALK_LIMIT = 20_000

/** What a shell command reads, as far as its text tells. */
interface CommandReads {
	/** An ignored file it reads, as written. */
	ignored?: string
	/** It reads something only known when it runs (`cat "$F"`, `python3 -c`). */
	unknown: boolean
	/** Directories it reads as a whole, absolute. */
	directories: string[]
}

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

/** The entries of a directory; none when it is not one (or cannot be read). */
function entriesOf(directory: string): fsSync.Dirent[] {
	try {
		return fsSync.readdirSync(directory, { withFileTypes: true })
	} catch {
		return []
	}
}

/** One glob segment (`sec*`, `key?.txt`, `[ab]*`) as a regular expression; literal when its brackets do not pair. */
function segmentPattern(segment: string): RegExp {
	const escaped = segment.replace(/[.+^${}()|\\]/g, "\\$&")
	try {
		return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\[!/g, "[^")}$`)
	} catch {
		return new RegExp(`^${escaped.replace(/[*?[\]]/g, "\\$&")}$`)
	}
}

/**
 * The existing paths a glob names, as bash expands it: segment by segment,
 * hidden entries only for a segment starting with a dot. Relative globs are
 * matched in `base` and returned relative to it.
 */
function expandGlob(pattern: string, base: string): string[] {
	let matches = [path.isAbsolute(pattern) ? path.parse(pattern).root : ""]
	for (const segment of pattern.split(/[\\/]+/).filter(Boolean)) {
		if (!/[*?[]/.test(segment)) {
			matches = matches.map((match) => path.join(match, segment))
			continue
		}
		const regex = segmentPattern(segment)
		matches = matches.flatMap((match) =>
			entriesOf(path.resolve(base, match))
				.filter((entry) => regex.test(entry.name) && (segment.startsWith(".") || !entry.name.startsWith(".")))
				.map((entry) => path.join(match, entry.name)),
		)
	}
	return matches
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
			// The cwd itself and paths outside it are not covered by .rooignore.
			if (
				!relativePath ||
				relativePath.startsWith("../") ||
				relativePath === ".." ||
				path.isAbsolute(relativePath)
			) {
				return true
			}

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			logger.error(`Error checking .rooignore access for ${filePath}:`, error)
			return false
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns.
	 *
	 * Every command the shell would run is looked at, as the shell would see it:
	 * the commands of a chain, of a substitution and of a wrapper (`sh -c '...'`,
	 * `sudo`, `xargs`, see commandWrappers), with quotes removed. For a command
	 * that reads or copies file contents, each argument that names a path is
	 * checked, absolute paths, `-Path:value`, `dd if=`, `git show REV:path`, `~`
	 * and globs included; an argument built from an expansion
	 * (`$(pwd)/secrets/key`) is checked by what follows the expansion and as
	 * written. Commands that only name a path without reading it (`rm -rf
	 * node_modules`) are not refused.
	 *
	 * @param command - Terminal command to validate
	 * @param workingDirectory - Where the command runs, when not in the cwd
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string, workingDirectory?: string): string | undefined {
		// Always allow if no .rooignore exists
		if (!this.rooIgnoreContent) {
			return undefined
		}
		return this.commandReads(command, workingDirectory).ignored
	}

	/**
	 * Whether a command allowed by {@link validateCommand} may still read an
	 * ignored file that its text does not name: a reader of whole directories
	 * (`grep -r`, `cp -r`, `tar c`, `find -exec cat`) over a directory that
	 * holds an ignored path, interpreter code (`python3 -c`), or a reader
	 * argument only known when it runs (`cat "$F"`). Such a command is not
	 * approved automatically.
	 */
	commandMayReadIgnored(command: string, workingDirectory?: string): boolean {
		if (!this.rooIgnoreContent) {
			return false
		}
		const reads = this.commandReads(command, workingDirectory)
		return reads.unknown || reads.directories.some((directory) => this.holdsIgnoredPath(directory))
	}

	private commandReads(command: string, workingDirectory?: string): CommandReads {
		const reads: CommandReads = { unknown: false, directories: [] }
		this.collectReads(
			command,
			0,
			workingDirectory ? path.resolve(this.cwd, workingDirectory) : "",
			os.homedir(),
			reads,
		)
		return reads
	}

	private collectReads(command: string, depth: number, startDirectory: string, home: string, reads: CommandReads) {
		if (depth > 8) {
			reads.unknown = true
			return
		}
		// Where a `cd` earlier in the command moved to, relative to cwd: in
		// `cd secrets && cat key.txt` the file read is secrets/key.txt.
		let directory = startDirectory
		for (const analyzed of analyzeCommand(command).commands) {
			const [commandWord, ...args] = analyzed.words
			const name = programName(commandWord?.literal ?? commandWord?.raw ?? "")
				.toLowerCase()
				.replace(/\.exe$/, "")
			if ((name === "cd" || name === "pushd") && args[0]?.literal) {
				const target = expandedPath(args[0], home) ?? args[0].literal
				directory = path.isAbsolute(target) ? target : path.join(directory, target)
				continue
			}
			for (const arg of readOperands(name, args)) {
				const expanded = expandedPath(arg, home)
				if (expanded === null) {
					reads.unknown = true
				}
				const globbed =
					expanded !== null && arg.literal === null && /[*?[]/.test(expanded)
						? expandGlob(expanded, path.resolve(this.cwd, directory))
						: []
				const candidates = [...pathCandidates(arg), ...(expanded === arg.literal ? [] : [expanded]), ...globbed]
				for (const candidate of candidates) {
					if (
						candidate &&
						!reads.ignored &&
						!this.validateAccess(path.isAbsolute(candidate) ? candidate : path.join(directory, candidate))
					) {
						reads.ignored = candidate
					}
				}
			}
			for (const word of directoriesRead(name, args)) {
				const target = expandedPath(word, home)
				if (target === null) {
					reads.unknown = true
				} else {
					reads.directories.push(path.resolve(this.cwd, directory, target))
				}
			}
			const unwrapped = unwrapCommand(analyzed.words)
			if (unwrapped.code.length > 0) {
				reads.unknown = true
			}
			for (const inner of unwrapped.commands) {
				this.collectReads(inner, depth + 1, directory, home, reads)
			}
		}
	}

	/**
	 * Whether `directory` holds a file or folder .rooignore excludes. The
	 * .rooignore itself does not count: its text is in the prompt already.
	 */
	private holdsIgnoredPath(directory: string): boolean {
		// A directory above the cwd holds the cwd.
		const start = isWithin(this.cwd, directory) ? this.cwd : directory
		if (!isWithin(start, this.cwd)) {
			return false
		}
		const queue = [start]
		let seen = 0
		while (queue.length > 0) {
			const current = queue.shift() as string
			for (const entry of entriesOf(current)) {
				if (++seen > WALK_LIMIT) {
					return true
				}
				const absolute = path.join(current, entry.name)
				const relative = path.relative(this.cwd, absolute).toPosix()
				if (relative === ".rooignore") {
					continue
				}
				if (this.ignoreInstance.ignores(entry.isDirectory() ? `${relative}/` : relative)) {
					return true
				}
				if (entry.isDirectory()) {
					queue.push(absolute)
				}
			}
		}
		return false
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

function isWithin(filePath: string, directory: string): boolean {
	const relative = path.relative(directory, filePath)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
