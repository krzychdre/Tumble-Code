import { parsePatch, createTwoFilesPatch, OMIT_HEADERS } from "diff"

/**
 * Diff utilities for backend (extension) use.
 * Source of truth for diff normalization and stats.
 */

export interface DiffStats {
	added: number
	removed: number
}

/**
 * Remove non-semantic diff noise like "No newline at end of file"
 */
export function sanitizeUnifiedDiff(diff: string): string {
	if (!diff) return diff
	return diff.replace(/\r\n/g, "\n").replace(/(^|\n)[ \t]*(?:\\ )?No newline at end of file[ \t]*(?=\n|$)/gi, "$1")
}

/**
 * parsePatch, retried without empty lines when it rejects the patch.
 *
 * sanitizeUnifiedDiff blanks the "\ No newline at end of file" marker out of
 * our own patches instead of deleting the line, and chat history keeps those
 * patches. jsdiff 5 counted the empty line as context; jsdiff 6+ checks the
 * hunk line counts and throws, which lost the +/- counts of every edit to a
 * file without a trailing newline. The retry only runs after a strict parse
 * failed, so well-formed patches (context lines start with a space) are
 * parsed exactly as before.
 * Keep in sync with webview-ui/src/utils/parseUnifiedDiff.ts.
 */
function parsePatchTolerant(diff: string): ReturnType<typeof parsePatch> {
	try {
		return parsePatch(diff)
	} catch (error) {
		const withoutEmptyLines = diff.replace(/\r?\n(?=\r?\n|$)/g, "")
		if (withoutEmptyLines === diff) throw error
		return parsePatch(withoutEmptyLines + "\n")
	}
}

/**
 * Compute +/− counts from a unified diff (ignores headers/hunk lines)
 */
export function computeUnifiedDiffStats(diff?: string): DiffStats | null {
	if (!diff) return null

	try {
		const patches = parsePatchTolerant(diff)
		if (!patches || patches.length === 0) return null

		let added = 0
		let removed = 0

		for (const p of patches) {
			for (const h of (p as any).hunks ?? []) {
				for (const l of h.lines ?? []) {
					const ch = (l as string)[0]
					if (ch === "+") added++
					else if (ch === "-") removed++
				}
			}
		}

		if (added > 0 || removed > 0) return { added, removed }
		return { added: 0, removed: 0 }
	} catch {
		// If parsing fails for any reason, signal no stats
		return null
	}
}

/**
 * Compute diff stats from any supported diff format (unified or search-replace)
 * Tries unified diff format first, then falls back to search-replace format
 */
export function computeDiffStats(diff?: string): DiffStats | null {
	if (!diff) return null
	return computeUnifiedDiffStats(diff)
}

/**
 * Build a unified diff for a brand new file (all content lines are additions).
 * Trailing newline is ignored for line counting and emission.
 */
export function convertNewFileToUnifiedDiff(content: string, filePath?: string): string {
	const newFileName = filePath || "file"
	// Normalize EOLs; rely on library for unified patch formatting
	const normalized = (content || "").replace(/\r\n/g, "\n")
	// Old file is empty (/dev/null), new file has content; zero context to show all lines as additions.
	// The file headers are written here: jsdiff 9 would C-quote and octal-escape
	// names with non-ASCII or special characters ("src/za\305\274..."), and this
	// patch is shown as is in the chat, the CLI and the cloud task view.
	const hunks = createTwoFilesPatch("/dev/null", newFileName, "", normalized, undefined, undefined, {
		context: 0,
		headerOptions: OMIT_HEADERS,
	})
	const header = `${"=".repeat(67)}\n--- /dev/null\n+++ ${newFileName}\n`
	return header + (hunks === "\n" ? "" : hunks)
}
