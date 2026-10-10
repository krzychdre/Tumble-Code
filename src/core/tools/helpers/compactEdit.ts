/**
 * Lenient matching of the `edit` tool under the compact profile (small local
 * models, see `ai_plans/2026-10-10_19-36_compact-small-model-profile.md`).
 *
 * A 4B model copied the `  N | ` prefix of the old read_file output into its
 * edits and got whitespace wrong. The chain below keeps the strict rule first
 * (one exact match), then forgives exactly those two mistakes. The rule behind
 * every step: a wrong edit reported as success is far worse than a refused
 * one, so a looser step gives up whenever it is not sure, and the caller
 * quotes the file so the model can copy the exact text.
 *
 * old_string as sent:
 * 1. exact match;
 * 2. whole lines equal after trimming trailing whitespace;
 * 3. whole lines equal after trimming both ends and collapsing inner
 *    whitespace (new_string re-indented only when that is unambiguous, see
 *    `reindent`);
 * 4. a substring whose in-line whitespace runs may differ in length (line
 *    breaks and the indentation after them must be the file's).
 * Steps 2 to 4 are one decision: they must agree on a single place (each finds
 * at most one, and those it finds lie inside each other), and the strictest
 * one that can make the replacement safely makes it.
 *
 * Only when all of that finds nothing and old_string carries line-number
 * prefixes: old_string with the prefixes stripped (new_string too), matching
 * whole lines only, never a substring inside a line:
 * 5. lines equal; 6. equal up to trailing whitespace; 7. as in 3.
 *
 * A single match is required unless `replace_all` is set; overlapping matches
 * count. Whitespace means spaces and tabs (a BOM or a no-break space is text).
 * Matching runs on the file without its BOM and with LF line endings; the
 * replacement is mapped back onto the original bytes, so everything outside
 * the replaced region stays byte-identical (BOM, CRLF or mixed line endings)
 * and new_string takes the line ending of the region it replaces.
 */
import { distance } from "fastest-levenshtein"

import { escapeRegExp } from "@tumble-code/core/browser"

import { splitFileLines } from "./compactRead"

const BOM = "\uFEFF"

export function normalizeToLF(content: string): string {
	return content.replace(/\r\n/g, "\n")
}

function withoutBom(text: string): string {
	return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

/** The text the compact edit matches on and quotes in its errors: no BOM, LF line endings. */
export function toMatchText(content: string): string {
	return normalizeToLF(withoutBom(content))
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

// ─── The file as matched ────────────────────────────────────────────────────

/** The file as matched (`text`: no BOM, LF) and what it takes to map an offset back. */
interface SourceText {
	bom: string
	/** The file without its BOM, line endings as on disk. */
	raw: string
	text: string
	/** Offsets in `text` of the newlines that are CRLF in `raw`, ascending. */
	crlf: number[]
}

function toSourceText(content: string): SourceText {
	const bom = content.startsWith(BOM) ? BOM : ""
	const raw = content.slice(bom.length)
	const crlf: number[] = []
	for (let index = raw.indexOf("\r\n"); index !== -1; index = raw.indexOf("\r\n", index + 2)) {
		// Each earlier CRLF loses its "\r" in `text`.
		crlf.push(index - crlf.length)
	}
	return { bom, raw, text: normalizeToLF(raw), crlf }
}

/** How many CRLF newlines lie before `offset` of `text`. */
function crlfBefore(source: SourceText, offset: number): number {
	let low = 0
	let high = source.crlf.length
	while (low < high) {
		const middle = (low + high) >> 1
		if (source.crlf[middle] < offset) {
			low = middle + 1
		} else {
			high = middle
		}
	}
	return low
}

function rawOffset(source: SourceText, offset: number): number {
	return offset + crlfBefore(source, offset)
}

/**
 * The line ending of the region `[start, end)` of `text`: that of its first
 * line break, else of the break that ends its line, else of the one before it.
 */
function regionLineEnding(source: SourceText, start: number, end: number): "\r\n" | "\n" {
	let newline = source.text.indexOf("\n", start)
	if (newline === -1 && start > 0) {
		newline = source.text.lastIndexOf("\n", start - 1)
	}
	return newline !== -1 && source.crlf[crlfBefore(source, newline)] === newline ? "\r\n" : "\n"
}

/** A replacement of `[start, end)` of the matched text by `text` (LF). */
interface Splice {
	start: number
	end: number
	text: string
}

/** The original file with `splices` (ascending) applied; every other byte is kept. */
function applySplices(source: SourceText, splices: Splice[]): string {
	let result = source.bom
	let position = 0
	for (const splice of splices) {
		const start = Math.max(position, rawOffset(source, splice.start))
		const eol = regionLineEnding(source, splice.start, splice.end)
		result += source.raw.slice(position, start) + (eol === "\n" ? splice.text : splice.text.replace(/\n/g, eol))
		position = Math.max(start, rawOffset(source, splice.end))
	}
	return result + source.raw.slice(position)
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
	/**
	 * Nothing matched (`searched` is what was looked for, prefixes stripped),
	 * or one place matched but the replacement could not be made safely
	 * (`snippet` quotes that place's exact file lines).
	 */
	| { kind: "none"; searched: string; snippet?: ClosestSnippet }

/** One place old_string matched, with the replacement it would get. */
interface Candidate {
	/** Offsets in the matched text. */
	start: number
	end: number
	lines: MatchLines
	/** The replacement of this match, or undefined when it cannot be made safely. */
	build: () => Splice | undefined
}

interface Tier {
	strategy: CompactMatchStrategy
	stripped: boolean
	candidates: Candidate[]
}

/** The matched text split into lines (a trailing newline adds no empty line) with their offsets. */
interface FileLines {
	text: string
	lines: string[]
	starts: number[]
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

function toFileLines(text: string): FileLines {
	const { lines } = toLines(text)
	const starts: number[] = []
	let offset = 0
	for (const line of lines) {
		starts.push(offset)
		offset += line.length + 1
	}
	return { text, lines, starts }
}

/** 1-based line of a character offset (the line a newline ends counts as its line). */
function lineAt(file: FileLines, offset: number): number {
	let low = 0
	let high = file.starts.length
	while (low < high) {
		const middle = (low + high) >> 1
		if (file.starts[middle] <= offset) {
			low = middle + 1
		} else {
			high = middle
		}
	}
	return Math.max(1, low)
}

/** The lines of the characters `[start, end)`; a newline at the end does not reach the next line. */
function charMatchLines(file: FileLines, start: number, end: number): MatchLines {
	return { startLine: lineAt(file, start), endLine: lineAt(file, Math.max(start, end - 1)) }
}

const isContentLine = (line: string) => /[^ \t]/.test(line)
const keepLine = (line: string) => line
const trimTrailing = (line: string) => line.replace(/[ \t]+$/, "")
const collapseWhitespace = (line: string) => line.replace(/^[ \t]+|[ \t]+$/g, "").replace(/[ \t]+/g, " ")

function leadingWhitespace(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? ""
}

/** Every occurrence of `search`, overlapping ones included. */
function exactCandidates(file: FileLines, search: string, replacement: string): Candidate[] {
	const { text } = file
	const candidates: Candidate[] = []
	if (search === "") {
		return candidates
	}
	for (let start = text.indexOf(search); start !== -1; start = text.indexOf(search, start + 1)) {
		const end = start + search.length
		candidates.push({
			start,
			end,
			lines: charMatchLines(file, start, end),
			build: () => ({ start, end, text: replacement }),
		})
	}
	return candidates
}

/**
 * The single indentation character (" " or "\t") of the matched file lines,
 * else of the whole file; "none" when neither is indented, "mixed" when both
 * characters occur.
 */
function indentationCharacter(matched: string[], file: string[]): " " | "\t" | "none" | "mixed" {
	for (const indents of [matched, file.map(leadingWhitespace)]) {
		const characters = new Set(indents.join(""))
		if (characters.size > 1) {
			return "mixed"
		}
		if (characters.size === 1) {
			return characters.has("\t") ? "\t" : " "
		}
	}
	return "none"
}

/**
 * new_string's lines moved into the indentation of the matched file lines, or
 * undefined when that is not certain.
 *
 * Each indentation of old_string (non-blank lines) must stand for one
 * indentation of the file, deeper ones for deeper ones: sorted by length, both
 * sides form one chain where each level extends the one before. A new line at
 * one of those levels takes the file's indentation for it. A new line deeper
 * than a known level keeps the extra indentation only when the steps between
 * the levels are the same text on both sides and the extra indentation uses
 * the file's indentation character. Anything else (a level old_string does
 * not have, mixed tabs and spaces) refuses.
 */
function reindent(
	oldLines: string[],
	matchedLines: string[],
	newLines: string[],
	fileLines: string[],
): string[] | undefined {
	const levels = new Map<string, string>()
	for (let index = 0; index < oldLines.length; index++) {
		if (!isContentLine(oldLines[index])) {
			continue
		}
		const from = leadingWhitespace(oldLines[index])
		const to = leadingWhitespace(matchedLines[index])
		if ((levels.get(from) ?? to) !== to) {
			return undefined
		}
		levels.set(from, to)
	}
	if ([...levels].every(([from, to]) => from === to)) {
		// old_string is indented as the file is, so new_string is in the file's frame already.
		return newLines
	}

	const keys = [...levels.keys()].sort((a, b) => a.length - b.length)
	let sameSteps = true
	for (let index = 1; index < keys.length; index++) {
		const [outer, inner] = [keys[index - 1], keys[index]]
		const [outerTo, innerTo] = [levels.get(outer)!, levels.get(inner)!]
		if (!inner.startsWith(outer) || innerTo.length <= outerTo.length || !innerTo.startsWith(outerTo)) {
			return undefined
		}
		sameSteps &&= inner.slice(outer.length) === innerTo.slice(outerTo.length)
	}

	const character = indentationCharacter([...levels.values()], fileLines)
	const result: string[] = []
	for (const line of newLines) {
		if (!isContentLine(line)) {
			result.push(line)
			continue
		}
		const indent = leadingWhitespace(line)
		const known = levels.get(indent)
		if (known !== undefined) {
			result.push(known + line.slice(indent.length))
			continue
		}
		const base = [...keys].reverse().find((key) => indent.startsWith(key))
		if (base === undefined || !sameSteps || character === "mixed") {
			return undefined
		}
		const extra = indent.slice(base.length)
		const extraCharacters = new Set(extra)
		if (extraCharacters.size !== 1 || (character !== "none" && !extraCharacters.has(character))) {
			return undefined
		}
		result.push(levels.get(base)! + line.slice(base.length))
	}
	return result
}

/** The splice that puts `lines` in place of file lines `start` to `start + count - 1`. */
function lineSplice(file: FileLines, start: number, count: number, lines: string[]): Splice {
	const first = file.starts[start]
	const last = start + count - 1
	const lastEnd = file.starts[last] + file.lines[last].length
	if (lines.length > 0) {
		return { start: first, end: lastEnd, text: lines.join("\n") }
	}
	// Deleted lines take one line break with them: the one after, else the one before.
	if (lastEnd < file.text.length) {
		return { start: first, end: lastEnd + 1, text: "" }
	}
	return { start: Math.max(0, first - 1), end: lastEnd, text: "" }
}

/** Every window of whole file lines equal to old_string's lines under `normalize`, overlapping ones included. */
function lineCandidates(
	file: FileLines,
	oldText: string,
	newText: string,
	normalize: (line: string) => string,
): Candidate[] {
	// Blank lines at the edges of old_string that new_string repeats are context, not
	// part of the change: matching them as lines would rewrite the file's blank lines.
	let search = oldText
	let replacement = newText
	const leading = search.match(/^(?:[ \t]*\n)+/)?.[0] ?? ""
	if (leading && replacement.startsWith(leading) && replacement.length > leading.length) {
		search = search.slice(leading.length)
		replacement = replacement.slice(leading.length)
	}
	const trailing = search.match(/(?:\n[ \t]*)+$/)?.[0] ?? ""
	if (trailing && replacement.endsWith(trailing) && replacement.length > trailing.length) {
		search = search.slice(0, search.length - trailing.length)
		replacement = replacement.slice(0, replacement.length - trailing.length)
	}

	const old = toLines(search)
	if (!old.lines.some(isContentLine)) {
		// Blank lines alone would match almost anywhere.
		return []
	}
	const target = old.lines.map(normalize)
	const normalized = file.lines.map(normalize)
	const count = target.length
	const newLines = (() => {
		if (replacement === "") {
			return []
		}
		const lines = replacement.split("\n")
		if (old.endsWithNewline && replacement.endsWith("\n")) {
			lines.pop()
		}
		return lines
	})()

	const candidates: Candidate[] = []
	for (let start = 0; start + count <= normalized.length; start++) {
		if (!target.every((line, offset) => normalized[start + offset] === line)) {
			continue
		}
		const last = start + count - 1
		candidates.push({
			start: file.starts[start],
			end: file.starts[last] + file.lines[last].length,
			lines: { startLine: start + 1, endLine: last + 1 },
			build: () => {
				const lines = reindent(old.lines, file.lines.slice(start, start + count), newLines, file.lines)
				return lines && lineSplice(file, start, count, lines)
			},
		})
	}
	return candidates
}

const EDGE_WHITESPACE = /^[ \t\n]*/

/**
 * Every substring (overlapping ones included) equal to old_string where each
 * in-line whitespace run may differ in length. Line breaks must match one for
 * one, and the indentation after a line break must be the file's, so the
 * lines of new_string after its first are in the file's frame. Leading and
 * trailing whitespace of old_string is left out of the pattern, and the same
 * text is dropped from new_string, so the replacement neither swallows nor
 * duplicates the file's neighbouring text. A new_string with more lines than
 * a single-line old_string cannot be placed safely (its indentation is not
 * known), so such a match only counts as a place.
 */
function regexCandidates(file: FileLines, search: string, replacement: string): Candidate[] {
	const { text } = file
	const leading = search.match(EDGE_WHITESPACE)![0]
	const rest = search.slice(leading.length)
	const core = rest.replace(/[ \t\n]+$/, "")
	if (core === "") {
		return []
	}
	const trailing = rest.slice(core.length)
	let inserted = replacement
	if (leading && inserted.startsWith(leading)) {
		inserted = inserted.slice(leading.length)
	}
	if (trailing && inserted.endsWith(trailing)) {
		inserted = inserted.slice(0, inserted.length - trailing.length)
	}
	const placeable = !inserted.includes("\n") || core.includes("\n")

	const pattern = (core.match(/[ \t\n]+|[^ \t\n]+/g) ?? [])
		.map((part) => {
			if (!/^[ \t\n]/.test(part)) {
				return escapeRegExp(part)
			}
			if (!part.includes("\n")) {
				return "[ \\t]+"
			}
			const pieces = part.split("\n")
			return "[ \\t]*\\n".repeat(pieces.length - 1) + escapeRegExp(pieces[pieces.length - 1])
		})
		.join("")
	const regex = new RegExp(pattern, "g")

	const candidates: Candidate[] = []
	for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
		const start = match.index
		const end = start + match[0].length
		candidates.push({
			start,
			end,
			lines: charMatchLines(file, start, end),
			build: () => (placeable ? { start, end, text: inserted } : undefined),
		})
		regex.lastIndex = start + 1
	}
	return candidates
}

const contains = (outer: Candidate, inner: Candidate) => outer.start <= inner.start && inner.end <= outer.end

/** The places of `candidates`, left to right, a candidate inside another one dropped. */
function distinctPlaces(candidates: Candidate[]): Candidate[] {
	// Sorted by start, longest first: a candidate lies inside an earlier one exactly when
	// it ends no later than the furthest end so far.
	const sorted = [...candidates].sort((a, b) => a.start - b.start || b.end - a.end)
	const places: Candidate[] = []
	let furthest = -1
	for (const candidate of sorted) {
		if (candidate.end > furthest) {
			places.push(candidate)
			furthest = candidate.end
		}
	}
	return places
}

/** Left to right, the candidates that do not overlap an earlier kept one. */
function nonOverlapping(candidates: Candidate[]): Candidate[] {
	const kept: Candidate[] = []
	for (const candidate of [...candidates].sort((a, b) => a.start - b.start)) {
		if (kept.length === 0 || candidate.start >= kept[kept.length - 1].end) {
			kept.push(candidate)
		}
	}
	return kept
}

/** The quote for a place that matched but could not be replaced safely: its exact file lines. */
function placeSnippet(text: string, place: Candidate): ClosestSnippet {
	const lines = splitFileLines(text).slice(place.lines.startLine - 1, place.lines.endLine)
	return { startLine: place.lines.startLine, lines, bestLine: Math.max(0, lines.findIndex(isContentLine)) }
}

type Decision = { kind: "apply"; tier: Tier; splices: Splice[] } | CompactReplaceResult

/**
 * One step of the chain over `tiers`, strictest first. Without replace_all the
 * tiers must agree on one place: each matches at most once, and every match
 * lies inside every other. The strictest tier whose replacement can be made
 * safely makes it; when none can, the place is quoted instead.
 */
function decide(text: string, tiers: Tier[], replaceAll: boolean, searched: string): Decision | undefined {
	const all = tiers.flatMap((tier) => tier.candidates)
	if (all.length === 0) {
		return undefined
	}
	if (!replaceAll) {
		const single = tiers.every((tier) => tier.candidates.length <= 1)
		if (!single || !all.every((a) => all.every((b) => contains(a, b) || contains(b, a)))) {
			const places = distinctPlaces(all)
			return { kind: "multiple", count: places.length, matches: places.map((place) => place.lines) }
		}
	}

	let refused: Candidate | undefined
	for (const tier of tiers) {
		const chosen = replaceAll ? nonOverlapping(tier.candidates) : tier.candidates
		if (chosen.length === 0) {
			continue
		}
		const splices: Splice[] = []
		for (const candidate of chosen) {
			const splice = candidate.build()
			if (!splice) {
				refused ??= candidate
				break
			}
			splices.push(splice)
		}
		if (splices.length === chosen.length) {
			return { kind: "apply", tier, splices }
		}
	}
	return { kind: "none", searched, snippet: placeSnippet(text, refused!) }
}

/**
 * The compact edit chain (see the module comment) on the file as read from
 * disk (BOM and line endings as they are); old_string and new_string may use
 * CRLF or LF.
 *
 * @returns the new file content, the matches when old_string is not unique,
 *   or the text that was searched (prefixes stripped) for the closest-snippet
 *   error, with the exact lines of the place when one matched but could not be
 *   replaced safely.
 */
export function compactReplace(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): CompactReplaceResult {
	const source = toSourceText(content)
	const { text } = source
	const search = toMatchText(oldString)
	const replacement = toMatchText(newString)

	const prefixed = hasLineNumberPrefixes(search)
	const stripped = prefixed ? stripLineNumberPrefixes(search) : ""
	const searched = prefixed && stripped.trim() !== "" ? stripped : search
	if (search === "") {
		return { kind: "none", searched }
	}

	const file = toFileLines(text)
	const steps: Array<() => Tier[]> = [
		() => [{ strategy: "exact", stripped: false, candidates: exactCandidates(file, search, replacement) }],
		() => [
			{
				strategy: "whitespace",
				stripped: false,
				candidates: lineCandidates(file, search, replacement, trimTrailing),
			},
			{
				strategy: "whitespace",
				stripped: false,
				candidates: lineCandidates(file, search, replacement, collapseWhitespace),
			},
			{ strategy: "whitespace", stripped: false, candidates: regexCandidates(file, search, replacement) },
		],
	]
	if (searched !== search) {
		const strippedReplacement = stripLineNumberPrefixes(replacement)
		steps.push(() => [
			{
				strategy: "line_numbers",
				stripped: true,
				candidates: lineCandidates(file, searched, strippedReplacement, keepLine),
			},
			{
				strategy: "whitespace",
				stripped: true,
				candidates: lineCandidates(file, searched, strippedReplacement, trimTrailing),
			},
			{
				strategy: "whitespace",
				stripped: true,
				candidates: lineCandidates(file, searched, strippedReplacement, collapseWhitespace),
			},
		])
	}

	for (const step of steps) {
		const decision = decide(text, step(), replaceAll, searched)
		if (!decision) {
			continue
		}
		if (decision.kind !== "apply") {
			return decision
		}
		return {
			kind: "replaced",
			content: applySplices(source, decision.splices),
			count: decision.splices.length,
			strategy: decision.tier.strategy,
			strippedLineNumbers: decision.tier.stripped,
		}
	}

	return { kind: "none", searched }
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
