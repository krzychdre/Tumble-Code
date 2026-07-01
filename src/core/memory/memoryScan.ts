/**
 * Memory directory scan — enumerate topic files with frontmatter + mtime.
 *
 * Ported from Claude Code's `memdir/memoryScan.ts`. Uses `fs.readdir({
 * recursive: true })` (Node 18.17+) and a bounded frontmatter read (first 30
 * lines). Caps the result at `MAX_MEMORY_FILES` (most recent first).
 */

import fs from "fs/promises"
import { basename, join } from "path"

import { type MemoryType, parseMemoryType } from "./memoryTypes"
import { parseFrontmatter } from "./frontmatter"

export interface MemoryHeader {
	/** Path relative to the memory dir (e.g. "user_role.md"). */
	filename: string
	/** Absolute path to the file. */
	filePath: string
	/** Last-modified time in ms. */
	mtimeMs: number
	/** Frontmatter `description`, or null if absent. */
	description: string | null
	/** Frontmatter `type` narrowed to the 4-type union, or undefined. */
	type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30

/**
 * Read the first `maxLines` lines of a file (UTF-8) plus its mtime.
 *
 * A simple `readFile` + slice is fine for memory files (they're small). The
 * upstream `readFileInRange` streaming path only matters for multi-GB files,
 * which memory topic files never are.
 */
async function readHeadAndMtime(
	filePath: string,
	maxLines: number,
	signal?: AbortSignal,
): Promise<{ content: string; mtimeMs: number }> {
	const [data, stat] = await Promise.all([
		fs.readFile(filePath, { encoding: "utf-8", signal: signal as any }),
		fs.stat(filePath),
	])
	const lines = data.split("\n", maxLines)
	const content = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : data
	return { content, mtimeMs: stat.mtimeMs }
}

/**
 * Scan the memory directory for topic `.md` files (skipping `MEMORY.md`),
 * parse frontmatter, and return headers sorted by mtime descending, capped at
 * `MAX_MEMORY_FILES`.
 *
 * Per-file errors are swallowed (`Promise.allSettled` filter) — a corrupt
 * memory file shouldn't break recall for the rest.
 */
export async function scanMemoryFiles(memoryDir: string, signal?: AbortSignal): Promise<MemoryHeader[]> {
	try {
		const entries = await fs.readdir(memoryDir, { recursive: true })
		const mdFiles = (entries as string[]).filter((f) => f.endsWith(".md") && basename(f) !== "MEMORY.md")

		const headerResults = await Promise.allSettled(
			mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
				const filePath = join(memoryDir, relativePath)
				const { content, mtimeMs } = await readHeadAndMtime(filePath, FRONTMATTER_MAX_LINES, signal)
				const { data } = parseFrontmatter(content, filePath)
				return {
					filename: relativePath,
					filePath,
					mtimeMs,
					description: data.description ?? null,
					type: parseMemoryType(data.type),
				}
			}),
		)

		return headerResults
			.filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === "fulfilled")
			.map((r) => r.value)
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, MAX_MEMORY_FILES)
	} catch {
		return []
	}
}

/** Format a list of headers as a manifest line list for the ranker prompt. */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
	return memories
		.map((m) => {
			const tag = m.type ? `[${m.type}] ` : ""
			const ts = new Date(m.mtimeMs).toISOString()
			return m.description ? `- ${tag}${m.filename} (${ts}): ${m.description}` : `- ${tag}${m.filename} (${ts})`
		})
		.join("\n")
}
