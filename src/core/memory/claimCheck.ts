/**
 * The dream's claim check: settle time-bound clauses ("VSIX rebuild owed",
 * "fix/x STILL unmerged") that the facts found today show to be finished.
 *
 * Built for a very small, unreliable model:
 * 1. the code finds the clauses ({@link findTimeBoundClauses}) in the
 *    description, the MEMORY.md index line and the body, oldest memory first;
 * 2. the code gathers the evidence: the injected git lookup for the refs the
 *    clause names, and statements of newer memories that say the same topic is
 *    finished ({@link findNewerStatements});
 * 3. only when that evidence could resolve the clause (the gate) ONE small
 *    completion answers DONE or STILL; anything else counts as STILL;
 * 4. on DONE the code edits: the body clause gets a `[resolved <date>: ...]`
 *    note, the description and the index line drop the clause. Every edited
 *    file is copied to `.archive/` first.
 *
 * The answers are remembered in {@link CHECK_STATE_FILE}, so a STILL is not
 * asked again for two weeks unless the facts change.
 */

import { createHash } from "crypto"
import fs from "fs/promises"
import { basename, join } from "path"

import { logger } from "../../utils/logging"
import { ARCHIVE_DIR_NAME } from "./memoryFiles"
import { ENTRYPOINT_NAME } from "./memoryPrompt"
import { type MemoryHeader } from "./memoryScan"
import { type SideQuery } from "./relevance"
import {
	type ClaimEvidence,
	type ClaimRef,
	RESOLVED_MARKER,
	allRefsLanded,
	annotateClause,
	describeRef,
	extractRefs,
	findTimeBoundClauses,
	isTimeBound,
	removeClause,
	splitClauses,
} from "./timeBoundClaims"

/** Upper bound on model calls per dream for the claim check. */
export const MAX_CLAIM_QUERIES = 4
/** Upper bound on clauses that reach the evidence lookup per dream. */
const MAX_CLAIMS_EXAMINED = 40
/** The check state, next to the memories (the scan reads `.md` files only). */
export const CHECK_STATE_FILE = ".claim-checks.json"
const STILL_RECHECK_DAYS = 14
const STATE_KEEP_DAYS = 90
const MAX_NEWER_STATEMENTS = 2
const MAX_STATEMENT_CHARS = 200
const MAX_NOTE_CHARS = 120
const DAY_MS = 86_400_000

export const CLAIM_CHECK_SYSTEM_PROMPT = [
	"You check one sentence from an old note against facts found today.",
	"The sentence said that something was not finished yet (not merged, not rebuilt, still open, owed, deferred).",
	"Answer with exactly one word:",
	"",
	"DONE",
	"(the facts show that this unfinished thing is finished now)",
	"",
	"STILL",
	"(the facts do not show it, the facts are about something else, or you are not sure)",
	"",
	"Write nothing else.",
].join("\n")

/** Parse a claim-check answer; only a first word DONE counts, anything else is STILL. */
export function parseClaimVerdict(answer: string): "done" | "still" {
	const text = (typeof answer === "string" ? answer : "")
		.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
		.replace(/```[a-z]*\n?/gi, "")
		.replace(/[*#`]/g, "")
		.trim()
		.replace(/^answer\s*:\s*/i, "")
	const first = (text.split(/\s+/)[0] ?? "").replace(/[.!,;:]+$/, "")
	return first.toUpperCase() === "DONE" ? "done" : "still"
}

// Completion words: a newer clause carrying one says something got finished.
const COMPLETION_RE = new RegExp(
	String.raw`\b(?:rebuilt|merged|landed|deployed|installed|done|fixed|resolved|shipped|released|pushed|built|completed|finished)\b` +
		String.raw`|(?<!\p{L})(?:zrobion|wdrożon|przebudowan|zmergowan|scalon|naprawion)`,
	"iu",
)

// Filler plus the status vocabulary every project memory shares: two clauses
// match on their topic ("VSIX", "api image"), never on "rebuild" or "merged".
const IGNORED_WORDS = new Set(
	(
		"the and for with that this from into are was were but its not use used when what how why all one new now " +
		"has have had via per any can never always also only just than then there their them they been being will " +
		"would should could about after before over under yet until since some more most much very each other which " +
		"while where who our your you out off too get got see " +
		"rebuild rebuilds rebuilding rebuilt merge merges merging merged unmerged push pushes pushing pushed unpushed " +
		"deploy deploys deploying deployed undeployed release releases releasing released unreleased install " +
		"installing installed land landing landed build builds building built branch branches main master stack " +
		"stacked squash owed owe still review reviews reviewed follow followup followups done fix fixes fixed " +
		"resolve resolved ship shipped complete completed finish finished open opened pending need needs needed must " +
		"run todo deferred postponed wait waiting awaiting blocked progress wip parked next session step round " +
		"temporary temporarily later live local copy " +
		"jeszcze nie się jest są oraz albo ale dla przez przy tak też już razie zrobienia czeka czekają czekamy toku potem"
	).split(" "),
)
const IGNORED_PREFIXES = [
	"zrobion",
	"wdrożon",
	"przebudow",
	"zmergowan",
	"mergowan",
	"scalon",
	"naprawion",
	"odłożon",
	"odroczon",
	"zaległ",
	"tymczasow",
	"wypchnię",
]

function refText(ref: ClaimRef): string {
	switch (ref.kind) {
		case "pr":
			return `#${ref.number}`
		case "commit":
			return ref.sha
		case "branch":
			return ref.name
		case "file":
			return ref.path
	}
}

/** The topic words of a clause: each ref as one word, then the remaining words minus filler, status words and plain numbers. */
function distinctiveWords(text: string): Set<string> {
	const words = new Set<string>()
	let rest = text
	for (const ref of extractRefs(text)) {
		words.add(describeRef(ref).toLowerCase())
		rest = rest.split(refText(ref)).join(" ")
	}
	for (const word of rest.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (
			word.length >= 3 &&
			!/^\d+$/.test(word) &&
			!IGNORED_WORDS.has(word) &&
			!IGNORED_PREFIXES.some((p) => word.startsWith(p))
		) {
			words.add(word)
		}
	}
	return words
}

const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n?/

function splitFile(content: string): { head: string; body: string } {
	const fence = FRONTMATTER_RE.exec(content)
	const head = fence ? fence[0] : ""
	return { head, body: content.slice(head.length) }
}

function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

/** A memory with its full text, as {@link findNewerStatements} reads it. */
export interface MemoryText {
	filename: string
	mtimeMs: number
	content: string
}

/** A clause of a newer memory that says the topic of a claim is finished. */
export interface NewerStatement {
	filename: string
	/** The newer memory's last-change date, YYYY-MM-DD. */
	date: string
	text: string
}

/**
 * Statements of memories changed strictly after `source` that look like the
 * claim got finished: a clause (outside frontmatter and fenced code) that is
 * not time-bound itself, carries a completion word and shares the claim's
 * topic words (two, or all of them when the claim has fewer). At most two,
 * newest memory first. Pure code.
 */
export function findNewerStatements(
	clause: string,
	source: { filename: string; mtimeMs: number },
	others: ReadonlyArray<MemoryText>,
): NewerStatement[] {
	const claimWords = distinctiveWords(clause)
	const required = Math.min(2, claimWords.size)
	if (required === 0) return []
	const newer = others
		.filter((m) => m.mtimeMs > source.mtimeMs && m.filename !== source.filename)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
	const found: NewerStatement[] = []
	for (const memory of newer) {
		for (const statement of splitClauses(splitFile(memory.content).body)) {
			if (isTimeBound(statement) || !COMPLETION_RE.test(statement)) continue
			let shared = 0
			for (const word of distinctiveWords(statement)) if (claimWords.has(word)) shared++
			if (shared < required) continue
			const text = statement.slice(0, MAX_STATEMENT_CHARS)
			if (found.some((s) => s.text === text)) continue
			found.push({ filename: memory.filename, date: isoDate(memory.mtimeMs), text })
			if (found.length >= MAX_NEWER_STATEMENTS) return found
		}
	}
	return found
}

// --- Check state ---------------------------------------------------------

type CheckVerdict = "still" | "done"
type CheckEntries = Record<string, { at: string; verdict: CheckVerdict }>

/** The remembered answers; a missing or corrupt file is an empty state. */
async function readCheckState(memoryDir: string): Promise<CheckEntries> {
	const checks: CheckEntries = {}
	try {
		const parsed = JSON.parse(await fs.readFile(join(memoryDir, CHECK_STATE_FILE), "utf-8"))
		if (parsed?.version !== 1 || typeof parsed.checks !== "object" || parsed.checks === null) return checks
		for (const [key, entry] of Object.entries(parsed.checks as Record<string, unknown>)) {
			const e = entry as { at?: unknown; verdict?: unknown } | null
			if (
				typeof e?.at === "string" &&
				/^\d{4}-\d{2}-\d{2}$/.test(e.at) &&
				(e.verdict === "still" || e.verdict === "done")
			) {
				checks[key] = { at: e.at, verdict: e.verdict }
			}
		}
	} catch {
		// Missing or unreadable: start empty.
	}
	return checks
}

async function writeCheckState(memoryDir: string, checks: CheckEntries, today: string): Promise<void> {
	const kept: CheckEntries = {}
	for (const [key, entry] of Object.entries(checks)) {
		if (daysBetween(entry.at, today) <= STATE_KEEP_DAYS) kept[key] = entry
	}
	await fs.writeFile(
		join(memoryDir, CHECK_STATE_FILE),
		`${JSON.stringify({ version: 1, checks: kept }, null, "\t")}\n`,
		"utf-8",
	)
}

function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

function checkKey(filename: string, clause: string, facts: ReadonlyArray<string>): string {
	return createHash("sha1")
		.update([filename, clause, ...facts].join("\n"))
		.digest("hex")
}

// --- Frontmatter description and index line --------------------------------

const DESCRIPTION_LINE_RE = /^description:[ \t]*(.*)$/m

interface DescriptionLine {
	/** Offset of the line in the frontmatter text. */
	at: number
	line: string
	value: string
	quoted: boolean
	/** Trailing characters of the line kept as they were (a `\r`, spaces). */
	tail: string
}

function readDescription(head: string): DescriptionLine | undefined {
	const m = DESCRIPTION_LINE_RE.exec(head)
	if (!m) return undefined
	const raw = m[1].trimEnd()
	const tail = m[1].slice(raw.length)
	if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
		let value: string
		try {
			value = JSON.parse(raw)
		} catch {
			value = raw.slice(1, -1)
		}
		return { at: m.index, line: m[0], value, quoted: true, tail }
	}
	if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
		return { at: m.index, line: m[0], value: raw.slice(1, -1).replace(/''/g, "'"), quoted: true, tail }
	}
	return { at: m.index, line: m[0], value: raw, quoted: false, tail }
}

/**
 * The description line with a new value. Quoted when plain YAML would misread
 * it: the directory is shared with Claude Code, which parses frontmatter as
 * real YAML.
 */
function renderDescription(desc: DescriptionLine, value: string): string {
	const needsQuotes =
		desc.quoted ||
		value.includes(": ") ||
		value.includes(" #") ||
		value.endsWith(":") ||
		/^[-?:,[\]{}#&*!|>'"%@`\s]/.test(value)
	return `description: ${needsQuotes ? JSON.stringify(value) : value}${desc.tail}`
}

interface IndexEntry {
	lineNo: number
	/** `- [` and anything before the title. */
	lead: string
	title: string
	/** `](file.md)` */
	link: string
	/** A spaced hyphen, en or em dash, ": " or nothing. */
	sep: string
	hook: string
}

function findIndexEntry(lines: ReadonlyArray<string>, filename: string): IndexEntry | undefined {
	const link = `](${filename})`
	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo]
		const lead = /^\s*[-*]\s+\[/.exec(line)
		if (!lead) continue
		const end = line.indexOf(link, lead[0].length)
		if (end === -1) continue
		const rest = line.slice(end + link.length)
		const sep = /^(?:\s+[-\u2013\u2014]\s+|:\s+|\s*)/.exec(rest)?.[0] ?? ""
		return {
			lineNo,
			lead: lead[0],
			title: line.slice(lead[0].length, end),
			link,
			sep,
			hook: rest.slice(sep.length),
		}
	}
	return undefined
}

/** Mark the clause on every body line that still carries it unmarked; fenced code is left alone. */
function annotateBody(body: string, clause: string, note: string): string {
	const marked = `${clause.replace(/[.!?;:,]+$/, "")} ${RESOLVED_MARKER}`
	let inFence = false
	return body
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				inFence = !inFence
				return line
			}
			if (inFence || !line.includes(clause) || line.includes(marked)) return line
			return annotateClause(line, clause, note)
		})
		.join("\n")
}

// --- The pass ---------------------------------------------------------------

interface LoadedMemory extends MemoryText {
	filePath: string
}

interface RunState {
	memoryDir: string
	indexPath: string
	index: string | undefined
	backedUp: Set<string>
}

/** Copy a file into `.archive/` before its first edit in this run. */
async function backUp(run: RunState, filePath: string): Promise<void> {
	if (run.backedUp.has(filePath)) return
	const archiveDir = join(run.memoryDir, ARCHIVE_DIR_NAME)
	await fs.mkdir(archiveDir, { recursive: true })
	await fs.copyFile(filePath, join(archiveDir, `${Date.now()}_${basename(filePath)}`))
	run.backedUp.add(filePath)
}

/** Apply a DONE verdict to one memory; returns whether anything changed. */
async function resolveClause(run: RunState, memory: LoadedMemory, clause: string, note: string): Promise<boolean> {
	let changed = false
	const { head, body } = splitFile(memory.content)
	let newHead = head
	const desc = readDescription(head)
	if (desc) {
		let value = removeClause(desc.value, clause)
		if (value === "") value = annotateClause(desc.value, clause, note)
		if (value !== desc.value) {
			newHead = head.slice(0, desc.at) + renderDescription(desc, value) + head.slice(desc.at + desc.line.length)
		}
	}
	const newBody = annotateBody(body, clause, note)
	if (newHead !== head || newBody !== body) {
		await backUp(run, memory.filePath)
		const stat = await fs.stat(memory.filePath)
		memory.content = newHead + newBody
		await fs.writeFile(memory.filePath, memory.content, "utf-8")
		// Keep the note's age: the rest of it is as old as before, and a fresh
		// mtime would hide the newer notes that could settle its other clauses.
		await fs.utimes(memory.filePath, stat.atime, stat.mtime)
		changed = true
	}

	if (run.index !== undefined) {
		const lines = run.index.split("\n")
		const entry = findIndexEntry(lines, memory.filename)
		if (entry) {
			const title = removeClause(entry.title, clause) || entry.title
			let hook = removeClause(entry.hook, clause)
			if (hook === "" && entry.hook !== "") hook = annotateClause(entry.hook, clause, note)
			const line = entry.lead + title + entry.link + entry.sep + hook
			if (line !== lines[entry.lineNo]) {
				await backUp(run, run.indexPath)
				lines[entry.lineNo] = line
				run.index = lines.join("\n")
				await fs.writeFile(run.indexPath, run.index, "utf-8")
				changed = true
			}
		}
	}
	return changed
}

function indexClauses(index: string | undefined, filename: string): string[] {
	if (index === undefined) return []
	const entry = findIndexEntry(index.split("\n"), filename)
	return entry ? [...findTimeBoundClauses(entry.title), ...findTimeBoundClauses(entry.hook)] : []
}

function describeAge(mtimeMs: number, now: number): string {
	const days = Math.max(0, Math.floor((now - mtimeMs) / DAY_MS))
	return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`
}

function buildQuestion(memory: LoadedMemory, clause: string, facts: ReadonlyArray<string>, now: number): string {
	return [
		`Note file: ${memory.filename}`,
		`Sentence (the note was last changed ${isoDate(memory.mtimeMs)}, ${describeAge(memory.mtimeMs, now)}): "${clause}"`,
		`Facts found today (${isoDate(now)}):`,
		...facts.map((f) => `- ${f}`),
	].join("\n")
}

function resolutionNote(today: string, git: ReadonlyArray<ClaimEvidence>, newer: ReadonlyArray<NewerStatement>) {
	const fact = git.find((e) => e.landed === true)?.text ?? `newer note ${newer[0]?.filename ?? ""} says so`
	return `${today}: ${fact.trim()}`.replace(/\.+$/, "").slice(0, MAX_NOTE_CHARS).trimEnd()
}

/**
 * One claim-check pass over the memories, oldest first. Asks at most
 * {@link MAX_CLAIM_QUERIES} questions, only for clauses whose evidence passed
 * the gate, and edits the clauses answered DONE. Returns the memory files
 * changed (their own file or their index line).
 */
export async function verifyTimeBoundClaims(params: {
	memoryDir: string
	memories: ReadonlyArray<MemoryHeader>
	query: SideQuery
	evidence?: (refs: ReadonlyArray<ClaimRef>, signal: AbortSignal) => Promise<ClaimEvidence[]>
	signal: AbortSignal
	now?: number
}): Promise<string[]> {
	const { memoryDir, query, evidence, signal } = params
	const now = params.now ?? Date.now()
	const today = isoDate(now)
	if (signal.aborted) throw new Error("aborted")

	const loaded = await Promise.all(
		params.memories.map(async (m): Promise<LoadedMemory | undefined> => {
			try {
				const content = await fs.readFile(m.filePath, "utf-8")
				return { filename: m.filename, filePath: m.filePath, mtimeMs: m.mtimeMs, content }
			} catch {
				return undefined
			}
		}),
	)
	const memories = loaded.filter((m): m is LoadedMemory => m !== undefined).sort((a, b) => a.mtimeMs - b.mtimeMs)
	const indexPath = join(memoryDir, ENTRYPOINT_NAME)
	const run: RunState = {
		memoryDir,
		indexPath,
		index: await fs.readFile(indexPath, "utf-8").catch(() => undefined),
		backedUp: new Set(),
	}
	const checks = await readCheckState(memoryDir)
	let stateDirty = false
	let examined = 0
	let asked = 0
	const changed = new Set<string>()

	try {
		outer: for (const memory of memories) {
			const { head, body } = splitFile(memory.content)
			const clauses = [
				...findTimeBoundClauses(readDescription(head)?.value ?? ""),
				...indexClauses(run.index, memory.filename),
				...findTimeBoundClauses(body),
			].filter((c, i, all) => all.indexOf(c) === i)

			for (const clause of clauses) {
				if (asked >= MAX_CLAIM_QUERIES || examined >= MAX_CLAIMS_EXAMINED) break outer
				const refs = extractRefs(clause)
				const newer = findNewerStatements(clause, memory, memories)
				// Nothing could settle this clause: no lookup, no question.
				if (newer.length === 0 && (refs.length === 0 || !evidence)) continue
				examined++

				let git: ClaimEvidence[] = []
				if (refs.length > 0 && evidence) {
					try {
						const keys = new Set(refs.map(describeRef))
						git = (await evidence(refs, signal)).filter((e) => keys.has(describeRef(e.ref)))
					} catch (e) {
						if (signal.aborted) throw new Error("aborted")
						logger.info(
							`[memory] claim evidence lookup failed: ${e instanceof Error ? e.message : String(e)}`,
						)
					}
				}
				// The gate: a ref known NOT to have landed vetoes; otherwise every
				// ref landed or a newer note speaks about it.
				if (git.some((e) => e.landed === false)) continue
				if (!allRefsLanded(refs, git) && newer.length === 0) continue

				const facts = [
					...git.map((e) => e.text),
					...newer.map((s) => `A newer note (${s.filename}, ${s.date}) says: "${s.text}"`),
				]
				const key = checkKey(memory.filename, clause, facts)
				const prior = checks[key]
				// A DONE whose edit could not drop the clause (e.g. a whole title) is not asked again.
				if (prior?.verdict === "done") continue
				if (prior?.verdict === "still" && daysBetween(prior.at, today) < STILL_RECHECK_DAYS) continue

				if (signal.aborted) throw new Error("aborted")
				asked++
				const verdict = parseClaimVerdict(
					await query(CLAIM_CHECK_SYSTEM_PROMPT, buildQuestion(memory, clause, facts, now), signal),
				)
				checks[key] = { at: today, verdict }
				stateDirty = true
				if (
					verdict === "done" &&
					(await resolveClause(run, memory, clause, resolutionNote(today, git, newer)))
				) {
					changed.add(memory.filePath)
				}
			}
		}
	} finally {
		if (stateDirty) await writeCheckState(memoryDir, checks, today)
	}
	return [...changed]
}
