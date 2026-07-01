/**
 * Relevant-memory surfacing: read selected memories, dedup, account for the
 * cumulative session byte budget.
 *
 * Ported from Claude Code's `utils/attachments.ts` memory pieces. The
 * Roo-side attachment format is a hidden user message wrapped in
 * `<system-reminder>` tags (the same envelope Roo uses for environment
 * details).
 *
 * CRITICAL INVARIANT — mark-after-filter ordering: `readMemoriesForSurfacing`
 * MUST NOT write to `readFileState`. The dedup write happens in
 * {@link filterDuplicateMemoryAttachments} AFTER the filter runs. An earlier
 * upstream version wrote during the prefetch, which made the filter see every
 * selected path as "already in context" and drop everything (self-referential
 * filter). The regression test in `surfacing.spec.ts` guards this ordering.
 */

import fs from "fs/promises"
import { stat as fsStat } from "fs/promises"

import { memoryAge, memoryFreshnessText } from "./memoryAge"

/** Per-file line cap when surfacing. */
export const MAX_MEMORY_LINES = 200
/** Per-file byte cap — keeps a single injection bounded (5 × 4KB = 20KB/turn). */
export const MAX_MEMORY_BYTES = 4096
/** Cumulative session cap — once hit, prefetching stops entirely. */
export const MAX_SESSION_BYTES = 60 * 1024

export interface RelevantMemory {
	/** Absolute path to the memory file. */
	path: string
	/** Truncated file content (frontmatter + body up to the caps). */
	content: string
	/** mtime in ms. */
	mtimeMs: number
	/** Pre-formatted header (staleness note + "Memory: <path>:" line). */
	header: string
	/** If truncated, the line count that was read; otherwise undefined. */
	limit?: number
}

/**
 * FileStateCache mirror — only the shape surfacing/dedup use. The real type
 * lives in the Task layer; we keep a structural copy to avoid importing the
 * whole Task module into this leaf.
 */
export interface FileStateEntry {
	content: string
	timestamp: number
	offset?: number
	limit?: number
}
export type FileStateCache = Map<string, FileStateEntry>

/**
 * Build the per-memory header: the staleness caveat (for memories >1 day old)
 * plus a `Memory: <path>:` or `Memory (saved <age>): <path>:` line.
 */
export function memoryHeader(filePath: string, mtimeMs: number): string {
	const staleness = memoryFreshnessText(mtimeMs)
	return staleness ? `${staleness}\n\nMemory: ${filePath}:` : `Memory (saved ${memoryAge(mtimeMs)}): ${filePath}:`
}

/**
 * Read and truncate a set of selected memory files for surfacing.
 *
 * This function is PURE with respect to `readFileState` — it intentionally
 * does NOT mutate the cache. Dedup marking is deferred to
 * {@link filterDuplicateMemoryAttachments} so the filter can see the pre-mark
 * state. Do not "optimize" by marking here.
 */
export async function readMemoriesForSurfacing(
	selected: ReadonlyArray<{ path: string; mtimeMs: number }>,
	signal?: AbortSignal,
): Promise<RelevantMemory[]> {
	const results = await Promise.all(
		selected.map(async ({ path: filePath, mtimeMs }): Promise<RelevantMemory | null> => {
			try {
				const content = await fs.readFile(filePath, { encoding: "utf-8", signal: signal as any })
				const lines = content.split("\n")
				const truncatedByLines = lines.length > MAX_MEMORY_LINES
				let body = truncatedByLines ? lines.slice(0, MAX_MEMORY_LINES).join("\n") : content
				let limit: number | undefined
				if (truncatedByLines) limit = MAX_MEMORY_LINES
				const truncatedByBytes = body.length > MAX_MEMORY_BYTES
				if (truncatedByBytes) {
					const cutAt = body.lastIndexOf("\n", MAX_MEMORY_BYTES)
					body = body.slice(0, cutAt > 0 ? cutAt : MAX_MEMORY_BYTES)
					limit = limit ?? MAX_MEMORY_LINES
				}
				const truncated = truncatedByLines || truncatedByBytes
				if (truncated) {
					body =
						body +
						`\n\n> This memory file was truncated (over ${MAX_MEMORY_LINES} lines or ${MAX_MEMORY_BYTES} bytes). Use the read_file tool to view the complete file at: ${filePath}`
				}
				return { path: filePath, content: body, mtimeMs, header: memoryHeader(filePath, mtimeMs), limit }
			} catch {
				return null
			}
		}),
	)
	return results.filter((r): r is RelevantMemory => r !== null)
}

/**
 * Walk the conversation messages and tally already-surfaced memories.
 *
 * `MAX_SESSION_BYTES` is the cumulative throttle: once a session has surfaced
 * ~60KB of memory, prefetching stops (the most-relevant memories are already
 * in context). Scanning messages (rather than tracking in a side table) means
 * compaction naturally resets the counter — old attachments are gone, so
 * re-surfacing is valid.
 *
 * @param messages The conversation messages, each optionally carrying a
 *   `memories` array (the Roo-side attachment shape).
 */
export function collectSurfacedMemories(
	messages: ReadonlyArray<{ type: string; attachment?: { type: string; memories?: RelevantMemory[] } }>,
): { paths: Set<string>; totalBytes: number } {
	const paths = new Set<string>()
	let totalBytes = 0
	for (const m of messages) {
		if (m.type === "attachment" && m.attachment?.type === "relevant_memories") {
			for (const mem of m.attachment.memories ?? []) {
				paths.add(mem.path)
				totalBytes += mem.content.length
			}
		}
	}
	return { paths, totalBytes }
}

/**
 * Filter prefetched memory attachments to exclude memories the model already
 * has in context via read_file/write_to_file/edit_file (any iteration this
 * turn) or a previous turn's memory surfacing — both tracked in the cumulative
 * `readFileState`.
 *
 * The mark-after-filter ordering is load-bearing: the write to `readFileState`
 * happens AFTER the filter, never during `readMemoriesForSurfacing`. Writing
 * during the prefetch would make the filter see every selected path as
 * "already in context" and drop them all (self-referential filter).
 */
export function filterDuplicateMemoryAttachments(
	memories: RelevantMemory[],
	readFileState: FileStateCache,
): RelevantMemory[] {
	const filtered = memories.filter((m) => !readFileState.has(m.path))
	for (const m of filtered) {
		readFileState.set(m.path, { content: m.content, timestamp: m.mtimeMs, offset: undefined, limit: m.limit })
	}
	return filtered
}

/**
 * Wrap a surfaced memory as a hidden `<system-reminder>` user message text,
 * matching Roo's environment-details envelope so the model treats it as
 * injected context rather than a user instruction.
 */
export function wrapMemoryAsSystemReminder(memory: RelevantMemory): string {
	return `<system-reminder>\n${memory.header}\n\n${memory.content}\n</system-reminder>`
}

/**
 * Re-stat a memory file's mtime. Used to refresh the header after the model
 * edits a memory (so a re-surface shows the new age).
 */
export async function getMemoryMtime(filePath: string): Promise<number> {
	try {
		const s = await fsStat(filePath)
		return s.mtimeMs
	} catch {
		return 0
	}
}
