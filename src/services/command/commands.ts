import fs from "fs/promises"
import * as path from "path"
import { Dirent } from "fs"
import matter from "gray-matter"
import { memoizeRooDirectoryLookup } from "../roo-config/cache"
import { RooDirectoryResolver } from "../roo-config/RooDirectoryResolver"
import { getBuiltInCommands, getBuiltInCommand } from "./built-in-commands"

/**
 * Maximum depth for resolving symlinks to prevent cyclic symlink loops
 */
const MAX_DEPTH = 5

export interface Command {
	name: string
	content: string
	source: "global" | "project" | "built-in"
	filePath: string
	description?: string
	argumentHint?: string
	mode?: string
}

/**
 * Information about a resolved command file
 */
interface CommandFileInfo {
	/** Original path (symlink path if symlinked, otherwise the file path) */
	originalPath: string
	/** Resolved path (target of symlink if symlinked, otherwise the file path) */
	resolvedPath: string
}

/**
 * Recursively resolve a symbolic link and collect command file info
 */
async function resolveCommandSymLink(symlinkPath: string, fileInfo: CommandFileInfo[], depth: number): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}
	try {
		// Get the symlink target
		const linkTarget = await fs.readlink(symlinkPath)
		// Resolve the target path (relative to the symlink location)
		const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget)

		// Check if the target is a file (use lstat to detect nested symlinks)
		const stats = await fs.lstat(resolvedTarget)
		if (stats.isFile()) {
			// Only include markdown files
			if (isMarkdownFile(resolvedTarget)) {
				// For symlinks to files, store the symlink path as original and target as resolved
				fileInfo.push({ originalPath: symlinkPath, resolvedPath: resolvedTarget })
			}
		} else if (stats.isDirectory()) {
			// Read the target directory and process its entries
			const entries = await fs.readdir(resolvedTarget, { withFileTypes: true })
			const directoryPromises: Promise<void>[] = []
			for (const entry of entries) {
				directoryPromises.push(resolveCommandDirectoryEntry(entry, resolvedTarget, fileInfo, depth + 1))
			}
			await Promise.all(directoryPromises)
		} else if (stats.isSymbolicLink()) {
			// Handle nested symlinks
			await resolveCommandSymLink(resolvedTarget, fileInfo, depth + 1)
		}
	} catch {
		// Skip invalid symlinks
	}
}

/**
 * Recursively resolve directory entries and collect command file paths
 */
async function resolveCommandDirectoryEntry(
	entry: Dirent,
	dirPath: string,
	fileInfo: CommandFileInfo[],
	depth: number,
): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}

	const fullPath = path.resolve(entry.parentPath || dirPath, entry.name)
	if (entry.isFile()) {
		// Only include markdown files
		if (isMarkdownFile(entry.name)) {
			// Regular file - both original and resolved paths are the same
			fileInfo.push({ originalPath: fullPath, resolvedPath: fullPath })
		}
	} else if (entry.isSymbolicLink()) {
		// Await the resolution of the symbolic link
		await resolveCommandSymLink(fullPath, fileInfo, depth + 1)
	}
}

/**
 * Try to resolve a symlinked command file
 */
async function tryResolveSymlinkedCommand(filePath: string): Promise<string | undefined> {
	try {
		const lstat = await fs.lstat(filePath)
		if (lstat.isSymbolicLink()) {
			// Get the symlink target
			const linkTarget = await fs.readlink(filePath)
			// Resolve the target path (relative to the symlink location)
			const resolvedTarget = path.resolve(path.dirname(filePath), linkTarget)

			// Check if the target is a file
			const stats = await fs.stat(resolvedTarget)
			if (stats.isFile()) {
				return resolvedTarget
			}
		}
	} catch {
		// Not a symlink or invalid symlink
	}
	return undefined
}

/**
 * The command directories, lowest precedence first (global, then project).
 * Built-in commands rank below both.
 */
async function getCommandDirectories(cwd: string): Promise<Array<{ dir: string; source: "global" | "project" }>> {
	const dirs = await RooDirectoryResolver.list(cwd, { kind: "commands" })
	return dirs.map(({ path: dir, source }) => ({
		dir,
		source: source === "global" ? ("global" as const) : ("project" as const),
	}))
}

/**
 * Get all available commands from built-in, global, and project directories
 * Priority order: project > global > built-in (later sources override earlier ones)
 *
 * The chat input asks for this list on every keystroke while the slash menu is
 * open, so the parsed list is memoized per working directory and dropped by the
 * `.roo` file watchers (see roo-config/cache.ts).
 */
export async function getCommands(cwd: string): Promise<Command[]> {
	const commands = await memoizeRooDirectoryLookup("commands", cwd, () => loadCommands(cwd))
	return [...commands]
}

async function loadCommands(cwd: string): Promise<Command[]> {
	const commands = new Map<string, Command>()

	// Add built-in commands first (lowest priority)
	const builtInCommands = await getBuiltInCommands()
	for (const command of builtInCommands) {
		commands.set(command.name, command)
	}

	// Global commands override built-in ones, project commands override both.
	for (const { dir, source } of await getCommandDirectories(cwd)) {
		await scanCommandDirectory(dir, source, commands)
	}

	return Array.from(commands.values())
}

/**
 * Get a specific command by name (optimized to avoid scanning all commands)
 * Priority order: project > global > built-in, the same order getCommands uses
 */
export async function getCommand(cwd: string, name: string): Promise<Command | undefined> {
	// Try the directories from the highest precedence down, without scanning all commands
	const dirs = await getCommandDirectories(cwd)

	for (const { dir, source } of dirs.reverse()) {
		const command = await tryLoadCommand(dir, name, source)
		if (command) {
			return command
		}
	}

	// Check built-in commands if not found in project or global (lowest priority)
	return await getBuiltInCommand(name)
}

/**
 * Try to load a specific command from a directory (supports symlinks)
 */
async function tryLoadCommand(
	dirPath: string,
	name: string,
	source: "global" | "project",
): Promise<Command | undefined> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return undefined
		}

		// Try to find the command file directly
		const commandFileName = `${name}.md`
		const filePath = path.join(dirPath, commandFileName)

		// Check if this is a regular file first
		let resolvedPath = filePath
		let content: string | undefined

		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch {
			// File doesn't exist or can't be read - try resolving as symlink
			const symlinkedPath = await tryResolveSymlinkedCommand(filePath)
			if (symlinkedPath) {
				try {
					content = await fs.readFile(symlinkedPath, "utf-8")
					resolvedPath = symlinkedPath
				} catch {
					// Symlink target can't be read
					return undefined
				}
			} else {
				return undefined
			}
		}

		if (!content) {
			return undefined
		}

		let parsed
		let description: string | undefined
		let argumentHint: string | undefined
		let mode: string | undefined
		let commandContent: string

		try {
			// Try to parse frontmatter with gray-matter
			parsed = matter(content)
			description =
				typeof parsed.data.description === "string" && parsed.data.description.trim()
					? parsed.data.description.trim()
					: undefined
			argumentHint =
				typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
					? parsed.data["argument-hint"].trim()
					: undefined
			mode = typeof parsed.data.mode === "string" && parsed.data.mode.trim() ? parsed.data.mode.trim() : undefined
			commandContent = parsed.content.trim()
		} catch {
			// If frontmatter parsing fails, treat the entire content as command content
			description = undefined
			argumentHint = undefined
			mode = undefined
			commandContent = content.trim()
		}

		return {
			name,
			content: commandContent,
			source,
			filePath: resolvedPath,
			description,
			argumentHint,
			mode,
		}
	} catch {
		// Directory doesn't exist or can't be read
		return undefined
	}
}

/**
 * Get command names for autocomplete
 */
export async function getCommandNames(cwd: string): Promise<string[]> {
	const commands = await getCommands(cwd)
	return commands.map((cmd) => cmd.name)
}

/**
 * Scan a specific command directory (supports symlinks)
 */
async function scanCommandDirectory(
	dirPath: string,
	source: "global" | "project",
	commands: Map<string, Command>,
): Promise<void> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return
		}

		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		// Collect all command files, including those from symlinks
		const fileInfo: CommandFileInfo[] = []
		const initialPromises: Promise<void>[] = []

		for (const entry of entries) {
			initialPromises.push(resolveCommandDirectoryEntry(entry, dirPath, fileInfo, 0))
		}

		// Wait for all files to be resolved
		await Promise.all(initialPromises)

		// Process each collected file
		for (const { originalPath, resolvedPath } of fileInfo) {
			// Command name comes from the original path (symlink name if symlinked)
			const commandName = getCommandNameFromFile(path.basename(originalPath))

			try {
				const content = await fs.readFile(resolvedPath, "utf-8")

				let parsed
				let description: string | undefined
				let argumentHint: string | undefined
				let mode: string | undefined
				let commandContent: string

				try {
					// Try to parse frontmatter with gray-matter
					parsed = matter(content)
					description =
						typeof parsed.data.description === "string" && parsed.data.description.trim()
							? parsed.data.description.trim()
							: undefined
					argumentHint =
						typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
							? parsed.data["argument-hint"].trim()
							: undefined
					mode =
						typeof parsed.data.mode === "string" && parsed.data.mode.trim()
							? parsed.data.mode.trim()
							: undefined
					commandContent = parsed.content.trim()
				} catch {
					// If frontmatter parsing fails, treat the entire content as command content
					description = undefined
					argumentHint = undefined
					mode = undefined
					commandContent = content.trim()
				}

				// A later directory overrides an earlier one (and every directory
				// overrides the built-in commands). This used to be
				// `source === "project" || !commands.has(name)`, a leftover from
				// before built-in commands existed: it let a built-in command
				// shadow ~/.roo/commands/<same name>.md in this list while
				// getCommand ran the global file.
				commands.set(commandName, {
					name: commandName,
					content: commandContent,
					source,
					filePath: resolvedPath,
					description,
					argumentHint,
					mode,
				})
			} catch (error) {
				console.warn(`Failed to read command file ${resolvedPath}:`, error)
			}
		}
	} catch {
		// Directory doesn't exist or can't be read - this is fine
	}
}

/**
 * Extract command name from filename (strip .md extension only)
 */
export function getCommandNameFromFile(filename: string): string {
	if (filename.toLowerCase().endsWith(".md")) {
		return filename.slice(0, -3)
	}
	return filename
}

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
	return filename.toLowerCase().endsWith(".md")
}
