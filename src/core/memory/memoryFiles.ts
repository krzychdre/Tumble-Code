/**
 * Deterministic memory-file operations for the background writers.
 *
 * The writers used to be agents that edited the memory directory through
 * read_file / write_to_file. Now the model only answers a small question and
 * this module does every file operation: naming, frontmatter, the MEMORY.md
 * index line, appending to an existing memory, archiving a merged one. A weak
 * model cannot produce a malformed file or a write outside the memory
 * directory, because it never writes a file.
 *
 * Nothing is deleted: a memory the dream folds into another one moves to
 * {@link ARCHIVE_DIR_NAME}, which the scan skips. The directory can be shared
 * with Claude Code (the agent-interchange memory dir), so a wrong merge by a
 * small model must stay recoverable.
 */

import fs from "fs/promises"
import { basename, join } from "path"

import { type MemoryType } from "./memoryTypes"
import { type MemoryHeader } from "./memoryScan"
import { ENTRYPOINT_NAME } from "./memoryPrompt"

export const ARCHIVE_DIR_NAME = ".archive"

const MAX_SLUG_CHARS = 60
const MAX_DESCRIPTION_CHARS = 200

/** A memory as the model proposed it, before it becomes a file. */
export interface MemoryDraft {
	type: MemoryType
	/** The model's short name; slugified before use. */
	name: string
	/** One-line summary (frontmatter `description`, index hook). */
	description: string
	body: string
}

/** Lowercase `[a-z0-9_]` slug, or "" when nothing usable is left. */
export function slugifyMemoryName(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/\.md$/, "")
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, MAX_SLUG_CHARS)
		.replace(/_+$/, "")
}

/** The file name for a new memory: `<type>_<slug>.md`, the convention of the existing files. */
export function memoryFileName(type: MemoryType, slug: string): string {
	return slug.startsWith(`${type}_`) ? `${slug}.md` : `${type}_${slug}.md`
}

function oneLine(text: string, max = MAX_DESCRIPTION_CHARS): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length <= max ? flat : flat.slice(0, max).trimEnd()
}

export function renderMemoryFile(draft: MemoryDraft, slug: string): string {
	return [
		"---",
		`name: ${slug}`,
		`description: ${oneLine(draft.description)}`,
		`type: ${draft.type}`,
		"---",
		"",
		draft.body.trim(),
		"",
	].join("\n")
}

/**
 * The existing memory a draft names, if any. The model is told to reuse a
 * file name to add to a memory; accept it with or without the type prefix
 * and the `.md` suffix.
 */
export function findExistingMemory(
	draft: MemoryDraft,
	existing: ReadonlyArray<MemoryHeader>,
): MemoryHeader | undefined {
	const slug = slugifyMemoryName(draft.name)
	if (!slug) return undefined
	const candidates = new Set([slug, slugifyMemoryName(memoryFileName(draft.type, slug))])
	return existing.find((m) => candidates.has(slugifyMemoryName(m.filename)))
}

/**
 * Write one draft: append it to the memory it names, or create a new file and
 * index it. Returns the absolute path written, or undefined when the draft had
 * no usable name.
 */
export async function saveMemoryDraft(
	memoryDir: string,
	draft: MemoryDraft,
	existing: ReadonlyArray<MemoryHeader>,
	today: string,
): Promise<string | undefined> {
	const match = findExistingMemory(draft, existing)
	if (match) {
		const addition = [draft.description, draft.body]
			.map((s) => s.trim())
			.filter((s, i, all) => s && all.indexOf(s) === i)
			.join("\n")
		await fs.appendFile(match.filePath, `\n\nUpdate ${today}: ${addition}\n`, "utf-8")
		return match.filePath
	}
	const slug = slugifyMemoryName(draft.name)
	if (!slug) return undefined
	const filename = memoryFileName(draft.type, slug)
	const filePath = join(memoryDir, filename)
	await fs.mkdir(memoryDir, { recursive: true })
	// `wx`: never clobber a file the scan missed (e.g. past the scan cap).
	try {
		await fs.writeFile(filePath, renderMemoryFile(draft, slug), { encoding: "utf-8", flag: "wx" })
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
		await fs.appendFile(filePath, `\n\nUpdate ${today}: ${draft.body.trim()}\n`, "utf-8")
		return filePath
	}
	await appendIndexLine(memoryDir, filename, slug, draft.description)
	return filePath
}

export function indexLine(filename: string, title: string, description: string): string {
	return `- [${title}](${filename}) - ${oneLine(description, 150)}`
}

async function readIndex(memoryDir: string): Promise<string> {
	try {
		return await fs.readFile(join(memoryDir, ENTRYPOINT_NAME), "utf-8")
	} catch {
		return ""
	}
}

async function appendIndexLine(memoryDir: string, filename: string, title: string, description: string) {
	const current = await readIndex(memoryDir)
	if (linkedFiles(current).has(filename)) return
	const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n"
	await fs.writeFile(
		join(memoryDir, ENTRYPOINT_NAME),
		`${current}${separator}${indexLine(filename, title, description)}\n`,
		"utf-8",
	)
}

const INDEX_LINK_RE = /\]\(([^)\s]+\.md)\)/

function linkedFiles(index: string): Set<string> {
	const files = new Set<string>()
	for (const line of index.split("\n")) {
		const m = INDEX_LINK_RE.exec(line)
		if (m) files.add(m[1])
	}
	return files
}

/**
 * Keep MEMORY.md in step with the files: drop index lines whose file is gone
 * and add a line for each memory the index does not mention. Lines are never
 * rewritten, so hand-written hooks survive. Returns the number of lines
 * removed plus added.
 */
export async function syncMemoryIndex(memoryDir: string, memories: ReadonlyArray<MemoryHeader>): Promise<number> {
	const current = await readIndex(memoryDir)
	const present = new Set(memories.map((m) => m.filename))
	let changes = 0
	const kept = current.split("\n").filter((line) => {
		const m = /^\s*[-*]\s/.test(line) ? INDEX_LINK_RE.exec(line) : null
		if (m && !present.has(m[1])) {
			changes++
			return false
		}
		return true
	})
	const linked = linkedFiles(current)
	const missing = memories
		.filter((m) => !linked.has(m.filename))
		.map((m) => indexLine(m.filename, basename(m.filename, ".md"), m.description ?? ""))
	changes += missing.length
	if (changes === 0) return 0
	let text = kept.join("\n").replace(/\n+$/, "")
	if (missing.length > 0) text = `${text}${text ? "\n" : ""}${missing.join("\n")}`
	await fs.writeFile(join(memoryDir, ENTRYPOINT_NAME), `${text}\n`, "utf-8")
	return changes
}

/** Move a memory into the archive directory (recoverable, invisible to the scan). */
export async function archiveMemory(memoryDir: string, memory: MemoryHeader): Promise<void> {
	const archiveDir = join(memoryDir, ARCHIVE_DIR_NAME)
	await fs.mkdir(archiveDir, { recursive: true })
	const target = join(archiveDir, `${Date.now()}_${basename(memory.filename)}`)
	await fs.rename(memory.filePath, target)
}

/** Overwrite a memory's body, keeping its frontmatter unless a new description is given. */
export async function rewriteMemoryBody(memory: MemoryHeader, body: string, description?: string): Promise<void> {
	const content = await fs.readFile(memory.filePath, "utf-8")
	const fence = /^---\s*\n[\s\S]*?\n---\s*\n?/.exec(content)
	let head = fence ? fence[0] : ""
	if (head && description) {
		head = head.replace(/^description:.*$/m, `description: ${oneLine(description)}`)
	}
	await fs.writeFile(memory.filePath, `${head}${head ? "\n" : ""}${body.trim()}\n`, "utf-8")
}
