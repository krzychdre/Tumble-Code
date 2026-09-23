/**
 * Truncate text and return truncation info
 */
export function truncateText(
	text: string,
	maxLines: number = 10,
): { text: string; truncated: boolean; totalLines: number; hiddenLines: number } {
	const lines = text.split("\n")
	const totalLines = lines.length

	if (lines.length <= maxLines) {
		return { text, truncated: false, totalLines, hiddenLines: 0 }
	}

	const truncatedText = lines.slice(0, maxLines).join("\n")
	return {
		text: truncatedText,
		truncated: true,
		totalLines,
		hiddenLines: totalLines - maxLines,
	}
}

/**
 * Sanitize content for terminal display
 * - Replaces tabs with spaces
 * - Strips carriage returns
 */
export function sanitizeContent(text: string): string {
	return text.replace(/\t/g, "    ").replace(/\r/g, "")
}

/**
 * Format diff stats as a colored string representation
 */
export function formatDiffStats(stats: { added: number; removed: number }): { added: string; removed: string } {
	return {
		added: `+${stats.added}`,
		removed: `-${stats.removed}`,
	}
}

/**
 * Get a friendly display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
	const displayNames: Record<string, string> = {
		// File read operations
		readFile: "Read",
		read_file: "Read",
		skill: "Load Skill",
		listFilesTopLevel: "List Files",
		listFilesRecursive: "List Files (Recursive)",
		list_files: "List Files",

		// File write operations
		editedExistingFile: "Edit",
		appliedDiff: "Diff",
		apply_diff: "Diff",
		newFileCreated: "Create File",
		write_to_file: "Write File",
		writeToFile: "Write File",

		// Search operations
		searchFiles: "Search Files",
		search_files: "Search Files",
		codebaseSearch: "Codebase Search",
		codebase_search: "Codebase Search",

		// Command operations
		execute_command: "Execute Command",
		executeCommand: "Execute Command",

		// Mode operations
		switchMode: "Switch Mode",
		switch_mode: "Switch Mode",
		newTask: "New Task",
		new_task: "New Task",
		finishTask: "Finish Task",

		// Completion operations
		attempt_completion: "Task Complete",
		attemptCompletion: "Task Complete",
		ask_followup_question: "Question",
		askFollowupQuestion: "Question",

		// TODO operations
		update_todo_list: "Update TODO List",
		updateTodoList: "Update TODO List",

		// MCP server tools and resources
		use_mcp_server: "MCP",
	}

	return displayNames[toolName] || toolName
}

/**
 * Format a file path for display, optionally with workspace indicator
 */
export function formatPath(path: string, isOutsideWorkspace?: boolean, isProtected?: boolean): string {
	let result = path
	const badges: string[] = []

	if (isOutsideWorkspace) {
		badges.push("outside workspace")
	}

	if (isProtected) {
		badges.push("protected")
	}

	if (badges.length > 0) {
		result += ` (${badges.join(", ")})`
	}

	return result
}

/**
 * Parse diff content into structured hunks for rendering
 */
export interface DiffHunk {
	header: string
	lines: Array<{
		type: "context" | "added" | "removed" | "header"
		content: string
		lineNumber?: number
	}>
}

/** A unified-diff hunk header, e.g. `@@ -1,15 +1,19 @@`. */
const UNIFIED_HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m

/** Opening marker of a SEARCH/REPLACE block; the trailing `>` is tolerated. */
const SEARCH_MARKER = /^<<<<<<< SEARCH>?\s*$/
const SEPARATOR_MARKER = /^=======\s*$/
const REPLACE_MARKER = /^>>>>>>> REPLACE\s*$/
const FENCE_MARKER = /^-------\s*$/
const START_LINE_MARKER = /^:start_line:\s*(\d+)\s*$/
const END_LINE_MARKER = /^:end_line:\s*(\d+)\s*$/

/**
 * Drop the backslash the diff strategy prepends to a marker that occurs inside
 * the payload. Mirrors `unescapeMarkers` in
 * `src/core/diff/strategies/multi-search-replace.ts`.
 */
function unescapeDiffMarker(line: string): string {
	return /^\\(?:<<<<<<<|=======|>>>>>>>|-------|:end_line:|:start_line:)/.test(line) ? line.slice(1) : line
}

export function parseDiff(diffContent: string): DiffHunk[] {
	const hunks: DiffHunk[] = []
	const lines = diffContent.split("\n")

	let currentHunk: DiffHunk | null = null

	for (const line of lines) {
		if (line.startsWith("@@")) {
			// New hunk header
			if (currentHunk) {
				hunks.push(currentHunk)
			}
			currentHunk = { header: line, lines: [] }
		} else if (currentHunk) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				currentHunk.lines.push({ type: "added", content: line.substring(1) })
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				currentHunk.lines.push({ type: "removed", content: line.substring(1) })
			} else if (line.startsWith(" ") || line === "") {
				currentHunk.lines.push({ type: "context", content: line.substring(1) || "" })
			}
		}
	}

	if (currentHunk) {
		hunks.push(currentHunk)
	}

	return hunks
}

/**
 * Parse the SEARCH/REPLACE block format produced by `apply_diff` into the same
 * hunk shape as `parseDiff`, so both render through one code path.
 *
 * The grammar (see `src/core/diff/strategies/multi-search-replace.ts`) is:
 *
 *     <<<<<<< SEARCH
 *     :start_line:17        (optional)
 *     :end_line:19          (optional)
 *     -------               (optional fence)
 *     ...lines to remove...
 *     =======
 *     ...lines to add...
 *     >>>>>>> REPLACE
 *
 * This is a line-based state machine rather than a port of the core's regex on
 * purpose: while the model streams its answer the closing `>>>>>>> REPLACE` has
 * not arrived yet, and the regex (which anchors on it) matches nothing. A
 * block still open at the end of the input is emitted as a hunk so the dynamic
 * tail shows the edit as it is being written.
 */
export function parseSearchReplaceDiff(diffContent: string): DiffHunk[] {
	const hunks: DiffHunk[] = []
	let current: DiffHunk | null = null
	let state: "outside" | "meta" | "search" | "replace" = "outside"

	for (const line of diffContent.split("\n")) {
		if (SEARCH_MARKER.test(line)) {
			// A new block while one is still open means the previous one was
			// truncated; keep what it had and start the new one.
			if (current) {
				hunks.push(current)
			}
			current = { header: "", lines: [] }
			state = "meta"
			continue
		}

		if (!current) {
			continue
		}

		if (state === "meta") {
			const startLine = line.match(START_LINE_MARKER)
			if (startLine) {
				current.header = `@@ line ${startLine[1]} @@`
				continue
			}
			if (END_LINE_MARKER.test(line)) {
				continue
			}
			if (FENCE_MARKER.test(line)) {
				state = "search"
				continue
			}
			// No fence: the block goes straight into its search body, and this
			// line is already part of it.
			state = "search"
		}

		if (state === "search") {
			if (SEPARATOR_MARKER.test(line)) {
				state = "replace"
			} else {
				current.lines.push({ type: "removed", content: unescapeDiffMarker(line) })
			}
			continue
		}

		if (REPLACE_MARKER.test(line)) {
			hunks.push(current)
			current = null
			state = "outside"
			continue
		}
		current.lines.push({ type: "added", content: unescapeDiffMarker(line) })
	}

	// A block left open by a diff that is still streaming.
	if (current) {
		hunks.push(current)
	}

	return hunks.filter((hunk) => hunk.lines.length > 0)
}

/**
 * Parse whichever diff dialect the payload happens to be in.
 *
 * `apply_diff` sends SEARCH/REPLACE blocks in `diff`, while `write_to_file` and
 * the editor-backed edits send a unified diff in `content`. Anything that is
 * neither returns no hunks, so the caller falls back to printing it raw.
 *
 * The unified test matches a full `@@ -n,m +n,m @@` header rather than a bare
 * `@@`, so file content that merely mentions `@@` is not mistaken for a diff.
 */
export function parseAnyDiff(diffContent: string): DiffHunk[] {
	if (!isDiffText(diffContent)) {
		return []
	}
	return diffContent.includes("<<<<<<< SEARCH") ? parseSearchReplaceDiff(diffContent) : parseDiff(diffContent)
}

/**
 * Whether the text is a diff at all, regardless of how much of it has arrived.
 * Callers use this to decide whether printing the text raw would be useful: a
 * half-streamed SEARCH block parses into no hunks yet, but dumping its
 * `<<<<<<< SEARCH` scaffolding on screen helps nobody.
 */
export function isDiffText(diffContent: string): boolean {
	if (!diffContent) {
		return false
	}
	return diffContent.includes("<<<<<<< SEARCH") || UNIFIED_HUNK_HEADER.test(diffContent)
}
