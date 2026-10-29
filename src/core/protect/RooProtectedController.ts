import os from "os"
import path from "path"
import ignore, { Ignore } from "ignore"
import { analyzeCommand, type ShellWord } from "@tumble-code/core/browser"
import { logger } from "../../utils/logging"
import { realPathOf } from "../../utils/pathUtils"
import { expandedPath, programName, unwrapCommand } from "../auto-approval/commandWrappers"

export const SHIELD_SYMBOL = "\u{1F6E1}"

/** Where else the protection applies, beyond the task's cwd. */
export interface ProtectionScope {
	/**
	 * More directories the protected patterns are matched in: the workspace
	 * folders (a task whose cwd is a subfolder can reach `../.roo/mcp.json`)
	 * and the home directory (`~/.roo`, `~/.vscode`).
	 */
	roots?: string[]
	/** Directories protected as a whole: VS Code's user settings and extension storage. */
	protectedDirectories?: string[]
}

/** Commands that only read the files they name: a protected path among their arguments is no write. */
const READ_ONLY_COMMANDS = new Set([
	"echo",
	"printf",
	"test",
	"[",
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
	"wc",
	"ls",
	"stat",
	"file",
	"diff",
	"cmp",
	"nl",
	"jq",
	"bat",
	"get-content",
	"gc",
	"type",
	"select-string",
	"sls",
])

/** An output redirection operator, alone or attached to its file: `>`, `>>`, `2>`, `&>`, `>|`, `<>`. */
const OUTPUT_REDIRECTION = /^(?:\d*|&)(?:>>?\|?|<>)/

/**
 * Controls write access to Roo configuration files by enforcing protection patterns.
 * Prevents auto-approved modifications to sensitive Roo configuration files.
 */
export class RooProtectedController {
	private cwd: string
	private ignoreInstance: Ignore
	private roots: string[]
	private protectedDirectories: string[]
	/** Text that names a protected location inside interpreter code (`open('.roo/mcp.json', 'w')`). */
	private protectedMarkers: string[]

	// Predefined list of protected Roo configuration patterns
	private static readonly PROTECTED_PATTERNS = [
		".rooignore",
		".roomodes",
		".roorules*",
		".clinerules*",
		".roo/**",
		".vscode/**",
		"*.code-workspace",
		".rooprotected", // For future use
		"AGENTS.md",
		"AGENT.md",
	]

	constructor(cwd: string, scope: ProtectionScope = {}) {
		this.cwd = cwd
		// Initialize ignore instance with protected patterns
		this.ignoreInstance = ignore()
		this.ignoreInstance.add(RooProtectedController.PROTECTED_PATTERNS)
		this.roots = [...new Set([cwd, ...(scope.roots ?? [])].map((root) => path.resolve(root)))]
		this.protectedDirectories = (scope.protectedDirectories ?? []).map((dir) => path.resolve(dir))
		const home = os.homedir()
		this.protectedMarkers = [
			...RooProtectedController.PROTECTED_PATTERNS.map((pattern) => pattern.replace(/\/?\*+/g, "")),
			"mcp_settings.json",
			...this.protectedDirectories.flatMap((dir) => [
				dir,
				...(isWithin(dir, home) ? [path.relative(home, dir)] : []),
			]),
		]
	}

	/**
	 * Check if a file is write-protected: it matches a protected pattern
	 * relative to the cwd, a workspace folder or the home directory, or lies in
	 * a protected directory; as written and with symlinks resolved, so a link
	 * (`docs -> .roo`) leads to the same answer as its target.
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is write-protected, false otherwise
	 */
	isWriteProtected(filePath: string): boolean {
		try {
			const absolutePath = path.resolve(this.cwd, filePath)
			for (const candidate of new Set([absolutePath, realPathOf(absolutePath)])) {
				if (this.protectedDirectories.some((dir) => isWithin(candidate, dir))) {
					return true
				}
				for (const root of this.roots) {
					const relativePath = path.relative(root, candidate)
					// Outside this root (the ignore library throws RangeError on such paths).
					if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
						continue
					}
					if (this.ignoreInstance.ignores(relativePath.toPosix())) {
						return true
					}
				}
			}
			return false
		} catch (error) {
			// If there's an error processing the path, err on the side of caution
			logger.error(`Error checking protection for ${filePath}:`, error)
			return true
		}
	}

	/**
	 * Whether a shell command may write a protected file: a protected path is
	 * the target of an output redirection, or an argument of a command that is
	 * not a plain reader (`cp`, `tee`, `sed -i`, `python`, ...), or interpreter
	 * code (`python3 -c`, `node -e`) names a protected location. Looks into
	 * every command of a chain, substitution and wrapper (`sh -c`, `sudo`).
	 * `cat AGENTS.md` is no write; `cat > .roo/mcp.json` is. Relative paths are
	 * taken from `workingDirectory`, where the command runs (the cwd by
	 * default); `~` and `$HOME` are the home directory. A target only known
	 * when the command runs (`> "$OUT"`) may be protected.
	 */
	isCommandWriteProtected(command: string, workingDirectory: string = this.cwd): boolean {
		return this.findProtectedWrite(command, path.resolve(this.cwd, workingDirectory), os.homedir(), 0)
	}

	/** `directory` is null after a `cd` to a place only known when the command runs. */
	private findProtectedWrite(command: string, startDirectory: string | null, home: string, depth: number): boolean {
		if (depth > 8) {
			return true
		}
		// A `cd` earlier in the chain moves where later relative paths point:
		// `cd .roo && echo x > mcp.json` writes .roo/mcp.json.
		let directory = startDirectory
		for (const analyzed of analyzeCommand(command).commands) {
			const [commandWord, ...args] = analyzed.words
			const name = programName(commandWord?.literal ?? commandWord?.raw ?? "").toLowerCase()
			if ((name === "cd" || name === "pushd") && args[0]) {
				directory = resolveIn(directory, expandedPath(args[0], home))
				continue
			}
			const inPlace = args.some(
				(word) => /^-[A-Za-z]*i/.test(word.literal ?? "") || word.literal === "--in-place",
			)
			const readOnly = READ_ONLY_COMMANDS.has(name) || ((name === "sed" || name === "perl") && !inPlace)

			for (let i = 0; i < args.length; i++) {
				const value = args[i].literal ?? args[i].raw.replace(/["']/g, "")
				const redirection = OUTPUT_REDIRECTION.exec(value)
				let target: ShellWord | undefined
				if (redirection) {
					const length = redirection[0].length
					target =
						value.length > length
							? { raw: args[i].raw.slice(length), literal: args[i].literal?.slice(length) ?? null }
							: args[++i]
				} else if (!readOnly && !value.startsWith("-")) {
					target = args[i]
				}
				if (target) {
					const file = resolveIn(directory, expandedPath(target, home))
					if (file === null || this.isWriteProtected(file)) {
						return true
					}
				}
			}
			const unwrapped = unwrapCommand(analyzed.words)
			if (
				unwrapped.code.some(
					(code) => code === null || this.protectedMarkers.some((marker) => code.includes(marker)),
				)
			) {
				return true
			}
			if (unwrapped.commands.some((inner) => this.findProtectedWrite(inner, directory, home, depth + 1))) {
				return true
			}
		}
		return false
	}

	/**
	 * Get set of write-protected files from a list
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Set of protected file paths
	 */
	getProtectedFiles(paths: string[]): Set<string> {
		const protectedFiles = new Set<string>()

		for (const filePath of paths) {
			if (this.isWriteProtected(filePath)) {
				protectedFiles.add(filePath)
			}
		}

		return protectedFiles
	}

	/**
	 * Filter an array of paths, marking which ones are protected
	 * @param paths - Array of paths to check (relative to cwd)
	 * @returns Array of objects with path and protection status
	 */
	annotatePathsWithProtection(paths: string[]): Array<{ path: string; isProtected: boolean }> {
		return paths.map((filePath) => ({
			path: filePath,
			isProtected: this.isWriteProtected(filePath),
		}))
	}

	/**
	 * Get display message for protected file operations
	 */
	getProtectionMessage(): string {
		return "This is a Roo configuration file and requires approval for modifications"
	}

	/**
	 * Get formatted instructions about protected files for the LLM
	 * @returns Formatted instructions about file protection
	 */
	getInstructions(): string {
		const patterns = RooProtectedController.PROTECTED_PATTERNS.join(", ")
		return `# Protected Files\n\n(The following Roo configuration file patterns are write-protected and always require approval for modifications, regardless of autoapproval settings. When using list_files, you'll notice a ${SHIELD_SYMBOL} next to files that are write-protected.)\n\nProtected patterns: ${patterns}`
	}

	/**
	 * Get the list of protected patterns (for testing/debugging)
	 */
	static getProtectedPatterns(): readonly string[] {
		return RooProtectedController.PROTECTED_PATTERNS
	}
}

/** `target` resolved in `directory`; null when either is only known when the command runs. */
function resolveIn(directory: string | null, target: string | null): string | null {
	if (target === null || (directory === null && !path.isAbsolute(target))) {
		return null
	}
	return directory === null ? target : path.resolve(directory, target)
}

function isWithin(filePath: string, directory: string): boolean {
	const relative = path.relative(directory, filePath)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
