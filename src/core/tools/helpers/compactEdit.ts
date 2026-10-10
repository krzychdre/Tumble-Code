/**
 * Lenient matching of the `edit` tool under the compact profile (small local
 * models, see `ai_plans/2026-10-10_19-36_compact-small-model-profile.md`).
 *
 * A 4B model copied the `  N | ` prefix of the old read_file output into its
 * edits and got whitespace wrong. The chain below keeps the strict rule first
 * (one exact match), then forgives exactly those two mistakes, and still
 * insists on a single match unless `replace_all` is set: a looser match never
 * picks one of several places on its own.
 *
 * 1. exact match;
 * 2. old_string with line-number prefixes stripped (new_string too), exact match;
 * 3. whole lines equal after trimming trailing whitespace, then after trimming
 *    both ends and collapsing inner whitespace (new_string re-indented to the
 *    matched lines);
 * 4. a substring whose whitespace runs may differ in length.
 *
 * Pure functions on LF-normalised text; the caller restores the file's line
 * endings.
 */
import { distance } from "fastest-levenshtein"

import { escapeRegExp } from "@tumble-code/core/browser"

import { splitFileLines } from "./compactRead"
import { replaceLiteral } from "./replaceLiteral"

export type LineEnding = "\r\n" | "\n"

/** CRLF when the file uses it anywhere, as `edit_file` decides. */
export function detectLineEnding(content: string): LineEnding {
	return content.includes("\r\n") ? "\r\n" : "\n"
}

export function normalizeToLF(content: string): string {
	return content.replace(/\r\n/g, "\n")
}

export function restoreLineEnding(contentLF: string, eol: LineEnding): string {
	return eol === "\n" ? contentLF : contentLF.replace(/\n/g, "\r\n")
}

// ─── Line-number prefixes ───────────────────────────────────────────────────

/**
 * The `  12 | ` prefix as a model copies it into an edit: spaces around the
 * pipe optional, one space after it belongs to the prefix (the rest is the
 * line's own indentation). `||` is not a prefix.
 */
const LOOSE_LINE_NUMBER_PREFIX = /^[ \t]*\d+[ \t]*\|(?!\|)[ \t]?/

function nonEmptyLines(text: string): string[] {
	return text.split("\n").filter((line) => line.trim() !== "")
}

/**
 * True when all or nearly all (at least 80%) non-empty lines of `text` start
 * with a line-number prefix.
 */
export function hasLineNumberPrefixes(text: string): boolean {
	const lines = nonEmptyLines(normalizeToLF(text))
	const prefixed = lines.filter((line) => LOOSE_LINE_NUMBER_PREFIX.test(line)).length
	return prefixed > 0 && prefixed >= Math.ceil(lines.length * 0.8)
}

/** Removes the line-number prefix from every line that has one (LF text). */
export function stripLineNumberPrefixes(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(LOOSE_LINE_NUMBER_PREFIX, ""))
		.join("\n")
}

// ─── Matching ───────────────────────────────────────────────────────────────

export type CompactMatchStrategy = "exact" | "line_numbers" | "whitespace"

/** A match as 1-based, inclusive file lines, for error texts. */
export interface MatchLines {
	startLine: number
	endLine: number
}

export type CompactReplaceResult =
	| {
			kind: "replaced"
			content: string
			count: number
			strategy: CompactMatchStrategy
			strippedLineNumbers: boolean
	  }
	| { kind: "multiple"; count: number; matches: MatchLines[] }
	| { kind: "none"; searched: string }

function countOccurrences(content: string, search: string): number[] {
	const positions: number[] = []
	if (search === "") {
		return positions
	}
	let position = content.indexOf(search)
	while (position !== -1) {
		positions.push(position)
		position = content.indexOf(search, position + search.length)
	}
	return positions
}

/** 1-based line of a character offset. */
function lineAt(content: string, offset: number): number {
	let line = 1
	for (let index = content.indexOf("\n"); index !== -1 && index < offset; index = content.indexOf("\n", index + 1)) {
		line++
	}
	return line
}

function charMatchLines(content: string, start: number, length: number): MatchLines {
	const startLine = lineAt(content, start)
	const matched = content.slice(start, start + length)
	const inner = matched.endsWith("\n") ? matched.slice(0, -1) : matched
	return { startLine, endLine: startLine + (inner.match(/\n/g)?.length ?? 0) }
}

function exactReplace(
	content: string,
	search: string,
	replacement: string,
	replaceAll: boolean,
): CompactReplaceResult | undefined {
	const positions = countOccurrences(content, search)
	if (positions.length === 0) {
		return undefined
	}
	if (positions.length > 1 && !replaceAll) {
		return {
			kind: "multiple",
			count: positions.length,
			matches: positions.map((position) => charMatchLines(content, position, search.length)),
		}
	}
	return {
		kind: "replaced",
		content: replaceLiteral(content, search, replacement, { all: replaceAll }),
		count: positions.length,
		strategy: "exact",
		strippedLineNumbers: false,
	}
}

const trimTrailing = (line: string) => line.replace(/[ \t]+$/, "")
const collapseWhitespace = (line: string) => line.trim().replace(/\s+/g, " ")

function leadingWhitespace(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? ""
}

/** Splits `text` into lines; a trailing newline does not add an empty last line. */
function toLines(text: string): { lines: string[]; endsWithNewline: boolean } {
	const endsWithNewline = text.endsWith("\n")
	const lines = text.split("\n")
	if (endsWithNewline) {
		lines.pop()
	}
	return { lines, endsWithNewline }
}

/** Start indices of non-overlapping windows of `fileLines` equal to `oldLines` under `normalize`. */
function findLineWindows(fileLines: string[], oldLines: string[], normalize: (line: string) => string): number[] {
	const target = oldLines.map(normalize)
	const normalized = fileLines.map(normalize)
	const starts: number[] = []
	for (let index = 0; index + target.length <= normalized.length; ) {
		let equal = true
		for (let offset = 0; offset < target.length; offset++) {
			if (normalized[index + offset] !== target[offset]) {
				equal = false
				break
			}
		}
		if (equal) {
			starts.push(index)
			index += target.length
		} else {
			index++
		}
	}
	return starts
}

/**
 * new_string's lines moved by the indentation difference between old_string
 * and the matched file lines (measured on the first non-blank old line). A
 * line that does not start with old_string's indentation is shortened by the
 * same amount when that is possible, else left as written.
 */
function reindent(newLines: string[], oldIndent: string, fileIndent: string): string[] {
	if (oldIndent === fileIndent) {
		return newLines
	}
	return newLines.map((line) => {
		if (line.trim() === "") {
			return line
		}
		const lead = leadingWhitespace(line)
		if (lead.startsWith(oldIndent)) {
			return fileIndent + line.slice(oldIndent.length)
		}
		if (oldIndent.startsWith(lead)) {
			const removed = oldIndent.length - lead.length
			return fileIndent.slice(0, Math.max(0, fileIndent.length - removed)) + line.slice(lead.length)
		}
		return line
	})
}

function lineReplace(
	content: string,
	search: string,
	replacement: string,
	replaceAll: boolean,
	normalize: (line: string) => string,
	adjustIndentation: boolean,
): CompactReplaceResult | undefined {
	const old = toLines(search)
	const firstContentLine = old.lines.findIndex((line) => line.trim() !== "")
	if (firstContentLine === -1) {
		// Blank lines alone would match almost anywhere.
		return undefined
	}

	// The file keeps its trailing newline: the last element of the split is "" then.
	const fileLines = content.split("\n")
	const starts = findLineWindows(fileLines, old.lines, normalize)
	if (starts.length === 0) {
		return undefined
	}
	if (starts.length > 1 && !replaceAll) {
		return {
			kind: "multiple",
			count: starts.length,
			matches: starts.map((start) => ({ startLine: start + 1, endLine: start + old.lines.length })),
		}
	}

	const replacementLines = (() => {
		if (replacement === "") {
			return []
		}
		const lines = replacement.split("\n")
		if (old.endsWithNewline && replacement.endsWith("\n")) {
			lines.pop()
		}
		return lines
	})()

	const oldIndent = leadingWhitespace(old.lines[firstContentLine])
	const result = [...fileLines]
	// Back to front, so earlier indices stay valid.
	for (const start of [...starts].reverse()) {
		const fileIndent = leadingWhitespace(fileLines[start + firstContentLine])
		const lines = adjustIndentation ? reindent(replacementLines, oldIndent, fileIndent) : replacementLines
		result.splice(start, old.lines.length, ...lines)
	}

	return {
		kind: "replaced",
		content: result.join("\n"),
		count: starts.length,
		strategy: "whitespace",
		strippedLineNumbers: false,
	}
}

/**
 * A substring match where each whitespace run of old_string matches any run
 * of whitespace (spaces and tabs, or any whitespace where old_string's run
 * holds a newline). Leading and trailing whitespace of old_string is left out
 * of the pattern, and the same text is dropped from new_string, so the
 * replacement neither swallows nor duplicates the file's neighbouring text.
 */
function regexReplace(
	content: string,
	search: string,
	replacement: string,
	replaceAll: boolean,
): CompactReplaceResult | undefined {
	const core = search.trim()
	if (core === "") {
		return undefined
	}
	const leading = search.slice(0, search.indexOf(core))
	const trailing = search.slice(search.indexOf(core) + core.length)
	let inserted = replacement
	if (leading && inserted.startsWith(leading)) {
		inserted = inserted.slice(leading.length)
	}
	if (trailing && inserted.endsWith(trailing)) {
		inserted = inserted.slice(0, inserted.length - trailing.length)
	}

	const pattern = (core.match(/\s+|\S+/g) ?? [])
		.map((part) => (/^\s+$/.test(part) ? (part.includes("\n") ? "\\s+" : "[ \\t]+") : escapeRegExp(part)))
		.join("")
	const found = Array.from(content.matchAll(new RegExp(pattern, "g")))
	if (found.length === 0) {
		return undefined
	}
	if (found.length > 1 && !replaceAll) {
		return {
			kind: "multiple",
			count: found.length,
			matches: found.map((match) => charMatchLines(content, match.index ?? 0, match[0].length)),
		}
	}
	return {
		kind: "replaced",
		content: content.replace(new RegExp(pattern, replaceAll ? "g" : ""), () => inserted),
		count: found.length,
		strategy: "whitespace",
		strippedLineNumbers: false,
	}
}

/**
 * The compact edit chain on LF-normalised text (see the module comment).
 *
 * @returns the new content, the matches when old_string is not unique, or the
 *   text that was searched last (prefixes stripped) for the closest-snippet
 *   error.
 */
export function compactReplace(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): CompactReplaceResult {
	const exact = exactReplace(content, oldString, newString, replaceAll)
	if (exact) {
		return exact
	}

	const candidates: Array<{ search: string; replacement: string; stripped: boolean }> = []
	if (hasLineNumberPrefixes(oldString)) {
		const search = stripLineNumberPrefixes(oldString)
		if (search.trim() !== "") {
			candidates.push({ search, replacement: stripLineNumberPrefixes(newString), stripped: true })
		}
	}
	candidates.push({ search: oldString, replacement: newString, stripped: false })

	const attempts: Array<(search: string, replacement: string) => CompactReplaceResult | undefined> = [
		(search, replacement) =>
			search === oldString ? undefined : exactReplace(content, search, replacement, replaceAll),
		(search, replacement) => lineReplace(content, search, replacement, replaceAll, trimTrailing, false),
		(search, replacement) => lineReplace(content, search, replacement, replaceAll, collapseWhitespace, true),
		(search, replacement) => regexReplace(content, search, replacement, replaceAll),
	]

	for (const attempt of attempts) {
		for (const candidate of candidates) {
			const result = attempt(candidate.search, candidate.replacement)
			if (!result) {
				continue
			}
			if (result.kind !== "replaced") {
				return result
			}
			return {
				...result,
				strategy: candidate.stripped && result.strategy === "exact" ? "line_numbers" : result.strategy,
				strippedLineNumbers: candidate.stripped,
			}
		}
	}

	return { kind: "none", searched: candidates[0].search }
}

// ─── Closest snippet ────────────────────────────────────────────────────────

/** Old_string lines compared when looking for the closest snippet. */
const SNIPPET_COMPARED_LINES = 12
/** File lines scanned for the closest snippet. */
const SNIPPET_SCANNED_LINES = 20_000
/** Characters of a line compared (longer lines are cut for the distance). */
const SNIPPET_COMPARED_CHARS = 200

export interface ClosestSnippet {
	/** 1-based first line of the window. */
	startLine: number
	/** The window's lines, raw (no line numbers, no `\r`). */
	lines: string[]
	/** Index into `lines` of the line most like old_string's line at the same position. */
	bestLine: number
}

function lineSimilarity(a: string, b: string): number {
	if (a === b) {
		return 1
	}
	const left = a.slice(0, SNIPPET_COMPARED_CHARS)
	const right = b.slice(0, SNIPPET_COMPARED_CHARS)
	const longest = Math.max(left.length, right.length)
	return longest === 0 ? 1 : 1 - distance(left, right) / longest
}

/**
 * The window of the file most like old_string, line by line (Levenshtein
 * similarity of whitespace-collapsed lines, averaged over the window). The
 * earliest window wins a tie.
 */
export function findClosestSnippet(content: string, searched: string): ClosestSnippet | undefined {
	const fileLines = splitFileLines(content)
	if (fileLines.length === 0) {
		return undefined
	}
	const oldLines = toLines(normalizeToLF(searched)).lines.slice(0, SNIPPET_COMPARED_LINES)
	if (oldLines.length === 0) {
		return undefined
	}

	const scanned = fileLines.slice(0, SNIPPET_SCANNED_LINES).map(collapseWhitespace)
	const target = oldLines.map(collapseWhitespace)
	const window = Math.min(target.length, scanned.length)

	let bestStart = 0
	let bestScore = -1
	for (let start = 0; start + window <= scanned.length; start++) {
		let score = 0
		for (let offset = 0; offset < window; offset++) {
			score += lineSimilarity(target[offset], scanned[start + offset])
		}
		if (score > bestScore) {
			bestScore = score
			bestStart = start
		}
	}

	const lines = fileLines.slice(bestStart, bestStart + window)
	let bestLine = 0
	let bestLineScore = -1
	lines.forEach((line, offset) => {
		if (line.trim() === "") {
			return
		}
		const score = lineSimilarity(target[offset], scanned[bestStart + offset])
		if (score > bestLineScore) {
			bestLineScore = score
			bestLine = offset
		}
	})

	return { startLine: bestStart + 1, lines, bestLine }
}

/**
 * The last `count` lines of the file, trailing blank lines skipped, with the
 * 1-based number of the first one. Their text joined by "\n" occurs in the
 * LF-normalised file, so it is a valid old_string for appending.
 */
export function lastLines(content: string, count: number): { startLine: number; lines: string[] } {
	const fileLines = splitFileLines(content)
	let end = fileLines.length
	while (end > 0 && fileLines[end - 1].trim() === "") {
		end--
	}
	const start = Math.max(0, end - count)
	return { startLine: start + 1, lines: fileLines.slice(start, end) }
}

/**
 * The lines of a match plus the nearest non-blank line above it (within three
 * lines; below it when there is none above), as an example of an old_string
 * that tells the matches apart.
 */
export function matchWithContext(content: string, match: MatchLines): string {
	const fileLines = splitFileLines(content)
	let start = match.startLine - 1
	let end = Math.min(fileLines.length, match.endLine)
	const above = fileLines.slice(Math.max(0, start - 3), start)
	const aboveIndex = above.map((line) => line.trim() !== "").lastIndexOf(true)
	if (aboveIndex !== -1) {
		start = start - above.length + aboveIndex
	} else {
		const below = fileLines.slice(end, end + 3)
		const belowIndex = below.findIndex((line) => line.trim() !== "")
		if (belowIndex !== -1) {
			end = end + belowIndex + 1
		}
	}
	return fileLines.slice(start, end).join("\n")
}
