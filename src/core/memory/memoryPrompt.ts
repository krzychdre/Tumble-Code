/**
 * The memory behavioral prompt builder.
 *
 * Ported from Claude Code's `memdir/memdir.ts`:
 * - `buildMemoryLines()` — the full behavioral prompt body.
 * - `truncateEntrypointContent()` — line/byte caps for the MEMORY.md index.
 * - `loadMemoryPrompt()` / `loadMemoryIndex()` — the dispatchers used by the
 *   system-prompt section.
 *
 * Tool names are mapped to Roo's equivalents (`write_to_file`, `search_files`,
 * `list_files`, `edit_file`). The "Searching past context" section always emits
 * the `search_files` tool form — Roo always has it, so the embedded-shell
 * branch from Claude Code is dropped.
 */

import fs from "fs/promises"

import {
	MEMORY_TYPES,
	TYPES_SECTION_INDIVIDUAL,
	WHAT_NOT_TO_SAVE_SECTION,
	WHEN_TO_ACCESS_SECTION,
	TRUSTING_RECALL_SECTION,
	MEMORY_FRONTMATTER_EXAMPLE,
} from "./memoryTypes"
import {
	ensureMemoryDirExists,
	getAutoMemPath,
	getAutoMemEntrypoint,
	isAutoMemoryEnabled,
	isMemoryPathsInitialized,
} from "./paths"

export const ENTRYPOINT_NAME = "MEMORY.md"
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000

export const DIR_EXISTS_GUIDANCE =
	"This directory already exists — write to it directly with the write_to_file tool (do not run mkdir or check for its existence)."

export interface EntrypointTruncation {
	content: string
	lineCount: number
	byteCount: number
	wasLineTruncated: boolean
	wasByteTruncated: boolean
}

/**
 * Truncate the MEMORY.md index content to the line cap (200) then the byte cap
 * (25KB), cutting at the last complete line under the byte limit. Appends a
 * warning describing which cap fired so the model knows the index was clipped.
 */
export function truncateEntrypointContent(raw: string): EntrypointTruncation {
	const trimmed = raw.trim()
	const contentLines = trimmed.split("\n")
	const lineCount = contentLines.length
	const byteCount = trimmed.length

	const wasLineTruncated = lineCount > MAX_ENTRYPOINT_LINES
	const wasByteTruncated = byteCount > MAX_ENTRYPOINT_BYTES

	if (!wasLineTruncated && !wasByteTruncated) {
		return { content: trimmed, lineCount, byteCount, wasLineTruncated, wasByteTruncated }
	}

	let truncated = wasLineTruncated ? contentLines.slice(0, MAX_ENTRYPOINT_LINES).join("\n") : trimmed

	if (truncated.length > MAX_ENTRYPOINT_BYTES) {
		const cutAt = truncated.lastIndexOf("\n", MAX_ENTRYPOINT_BYTES)
		truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_ENTRYPOINT_BYTES)
	}

	const reasons: string[] = []
	if (wasLineTruncated) reasons.push(`over ${MAX_ENTRYPOINT_LINES} lines`)
	if (wasByteTruncated) reasons.push(`over ${MAX_ENTRYPOINT_BYTES} bytes`)
	const reason = reasons.join(" and ")

	return {
		content:
			truncated +
			`\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
		lineCount,
		byteCount,
		wasLineTruncated,
		wasByteTruncated,
	}
}

/**
 * The "Searching past context" section — grep recipes for the memory dir and
 * (as a last resort) session transcripts. Roo always has `search_files`, so we
 * emit the tool form unconditionally; the embedded-shell branch is dropped.
 */
export function buildSearchingPastContextSection(autoMemDir: string, projectDir: string): string[] {
	const memSearch = `search_files with regex="<search term>" path="${autoMemDir}" file_pattern="*.md"`
	const transcriptSearch = `search_files with regex="<search term>" path="${projectDir}/" file_pattern="*.jsonl"`
	return [
		"## Searching past context",
		"",
		"When looking for past context:",
		"1. Search topic files in your memory directory:",
		"```",
		memSearch,
		"```",
		"2. Session transcript logs (last resort — large files, slow):",
		"```",
		transcriptSearch,
		"```",
		"Use narrow search terms (error messages, file paths, function names) rather than broad keywords.",
		"",
	]
}

/**
 * Build the full memory behavioral prompt as an array of lines.
 *
 * @param displayName Section heading (e.g. "auto memory").
 * @param memoryDir The memory directory path (with trailing separator).
 * @param projectDir The workspace cwd, for the transcript-search recipe.
 * @param extraGuidelines Optional additional guideline lines.
 */
export function buildMemoryLines(
	displayName: string,
	memoryDir: string,
	projectDir: string,
	extraGuidelines?: string[],
): string[] {
	const howToSave = [
		"## How to save memories",
		"",
		"Saving a memory is a two-step process:",
		"",
		"**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:",
		"",
		...MEMORY_FRONTMATTER_EXAMPLE,
		"",
		`**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
		"",
		`- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
		"- Keep the name, description, and type fields in memory files up-to-date with the content",
		"- Organize memory semantically by topic, not chronologically",
		"- Update or remove memories that turn out to be wrong or outdated",
		"- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.",
	]

	const lines: string[] = [
		`# ${displayName}`,
		"",
		`You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
		"",
		"You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
		"",
		"If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.",
		"",
		...TYPES_SECTION_INDIVIDUAL,
		...WHAT_NOT_TO_SAVE_SECTION,
		"",
		...howToSave,
		"",
		...WHEN_TO_ACCESS_SECTION,
		"",
		...TRUSTING_RECALL_SECTION,
		"",
		"## Memory and other forms of persistence",
		"Memory is one of several persistence mechanisms available to you. It should not be used for persisting information that is only useful within the scope of the current conversation.",
		"- When to use or update a plan instead of memory: if the information is about the structured steps of the current task, use a Plan rather than saving this information to memory.",
		"- When to use or update tasks instead of memory: if the information is about tracking progress on a multi-step task, use tasks instead of saving to memory.",
		"",
		...(extraGuidelines ?? []),
		"",
	]

	lines.push(...buildSearchingPastContextSection(memoryDir, projectDir))
	return lines
}

/**
 * Load (and build) the memory behavioral prompt for `cwd`.
 *
 * Returns "" when memory is disabled, so the system-prompt section can treat
 * the result as an optional insert. Eagerly ensures the memory dir exists so
 * the model can write to it without a `mkdir` turn.
 */
export async function loadMemoryPrompt(cwd: string): Promise<string> {
	// Graceful degradation: if the path module isn't initialized (e.g. in
	// tests, or before extension activation) treat memory as disabled rather
	// than throw — a missing init must never break the system prompt.
	if (!isMemoryPathsInitialized() || !isAutoMemoryEnabled()) return ""
	const autoDir = getAutoMemPath(cwd)
	await ensureMemoryDirExists(autoDir)
	return buildMemoryLines("auto memory", autoDir, cwd).join("\n")
}

/**
 * Load the truncated `MEMORY.md` index content for `cwd`.
 *
 * Returns "" when memory is disabled or the index doesn't exist yet (the model
 * creates it on first save). The returned string is prefixed with a header so
 * the system prompt identifies it as the user's persistent auto-memory.
 */
export async function loadMemoryIndex(cwd: string): Promise<string> {
	// Same graceful-degradation guard as loadMemoryPrompt.
	if (!isMemoryPathsInitialized() || !isAutoMemoryEnabled()) return ""
	const entrypoint = getAutoMemEntrypoint(cwd)
	let content = ""
	try {
		content = await fs.readFile(entrypoint, "utf-8")
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code
		if (!code || code !== "ENOENT") {
			// Non-fatal: an unreadable index just means no index content this turn.
		}
		return ""
	}
	if (!content.trim()) return ""
	const t = truncateEntrypointContent(content)
	return `\nContents of ${entrypoint} (user's auto-memory, persists across conversations):\n\n${t.content}`
}
