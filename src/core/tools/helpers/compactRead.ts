/**
 * `read_file` output for the compact profile (small local models, see
 * `ai_plans/2026-10-10_19-36_compact-small-model-profile.md`).
 *
 * The default output puts `  N | ` in front of every line. A 4B model copied
 * that prefix into the text of its edits, so under compact the lines come back
 * raw and the line range sits once in the header:
 *
 *     File: notes.md (lines 1-400 of 950)
 *     <raw lines>
 *     [Truncated: showing lines 1-400 of 950. Call read_file with offset=401 to read more.]
 *
 * Pure functions, no file system: `ReadFileTool` reads the file and calls them.
 */
import { MAX_LINE_LENGTH } from "../../prompts/tools/native-tools/read_file"

/** Most lines one compact read returns; a larger `limit` is capped to it. */
export const COMPACT_READ_MAX_LINES = 400

/** Most characters of file content one compact read returns, cut at a line boundary. */
export const COMPACT_READ_MAX_CHARS = 16_000

/**
 * The lines of a text file as an editor counts them: a trailing newline does
 * not start an extra line, and the `\r` of a CRLF line ending is dropped (the
 * edit tool matches on LF-normalised text anyway).
 */
export function splitFileLines(content: string): string[] {
	if (content === "") {
		return []
	}
	const lines = content.split("\n")
	if (lines[lines.length - 1] === "") {
		lines.pop()
	}
	return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
}

/**
 * The compact `limit`: the model's value when it is a positive number, capped
 * at `COMPACT_READ_MAX_LINES`, otherwise the cap itself. Small models invent
 * `limit: 2000` (strict schemas made every property required) or send null.
 */
export function compactReadLimit(limit: unknown): number {
	const value = typeof limit === "string" ? Number(limit) : limit
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return COMPACT_READ_MAX_LINES
	}
	return Math.min(Math.floor(value), COMPACT_READ_MAX_LINES)
}

/**
 * The compact `offset`: 1-based, and anything below 1 (a 0-based guess, null,
 * garbage) reads from the first line instead of failing.
 */
export function compactReadOffset(offset: unknown): number {
	const value = typeof offset === "string" ? Number(offset) : offset
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return 1
	}
	return Math.floor(value)
}

/**
 * One file (or one slice of it) in the compact format, header line included.
 *
 * @param relPath Path as the model wrote it, shown in the header.
 * @param content The whole file content.
 * @param offset 1-based first line (see `compactReadOffset`).
 * @param limit Line limit (see `compactReadLimit`).
 */
export function formatCompactRead(relPath: string, content: string, offset: number, limit: number): string {
	const lines = splitFileLines(content)
	const total = lines.length

	if (total === 0) {
		return `File: ${relPath} (empty file)`
	}

	const start = Math.max(1, Math.floor(offset))
	if (start > total) {
		return `File: ${relPath} (${total} lines)\nNote: offset ${start} is past the end of the file. Use an offset from 1 to ${total}.`
	}

	const maxLines = Math.max(1, Math.min(Math.floor(limit), COMPACT_READ_MAX_LINES))
	const shown: string[] = []
	let chars = 0
	for (let index = start - 1; index < total && shown.length < maxLines; index++) {
		let line = lines[index]
		if (line.length > MAX_LINE_LENGTH) {
			line = line.substring(0, MAX_LINE_LENGTH - 3) + "..."
		}
		const cost = line.length + 1
		// Always show at least one line, so a read never comes back without progress.
		if (shown.length > 0 && chars + cost > COMPACT_READ_MAX_CHARS) {
			break
		}
		shown.push(line)
		chars += cost
	}

	const end = start + shown.length - 1
	const header = `File: ${relPath} (lines ${start}-${end} of ${total})`
	const truncation =
		end < total
			? `\n[Truncated: showing lines ${start}-${end} of ${total}. Call read_file with offset=${end + 1} to read more.]`
			: ""

	return `${header}\n${shown.join("\n")}${truncation}`
}
