/**
 * Time-bound claims in memory text: finding them, the references they name,
 * and the deterministic text edits the dream applies once one is resolved.
 *
 * A time-bound claim is a clause that was true only for a while: "VSIX rebuild
 * owed", "fix/x STILL unmerged", "deferred until the bench run", "jeszcze nie
 * zmergowane". Such a clause turns false silently, and a memory that keeps
 * saying it misleads every later session.
 *
 * Everything here is pure code, no model call: the dream (autoDream.ts) runs
 * on small local models, so the code finds the clauses, extracts what can be
 * checked (PR numbers, commit hashes, branch names, repo paths), gathers the
 * evidence ({@link ClaimEvidenceLookup}) and edits the text. The model only
 * answers whether the evidence resolves the clause.
 */

/**
 * Markers of a time-bound clause, English and Polish. Prefix matches on
 * purpose ("odłożon" covers "odłożone", "odłożony"). A false positive costs a
 * check and never an edit: an edit needs evidence plus the model's answer.
 */
const MARKER_SOURCES = [
	// English
	String.raw`\bowed\b`,
	String.raw`\bpending (?:merge|review|rebuild|deploy|push|release)\b`,
	String.raw`\bnot yet\b`,
	String.raw`\byet to\b`,
	String.raw`\bunmerged\b`,
	String.raw`\bunpushed\b`,
	String.raw`\bunreleased\b`,
	String.raw`\bundeployed\b`,
	String.raw`\b(?:not|never) (?:been |yet )?(?:merged|pushed|deployed|released|rebuilt|landed|installed|live|done|fixed)\b`,
	String.raw`\bstill (?:open|owed|unmerged|pending|todo|to do|needed|missing|waiting|blocked|broken|failing|not|unfixed|on)\b`,
	String.raw`\bto-?do\b`,
	String.raw`\bdeferred\b`,
	String.raw`\bpostponed\b`,
	String.raw`\bblocked (?:on|by)\b`,
	String.raw`\bwaiting (?:for|on)\b`,
	String.raw`\bawaiting\b`,
	String.raw`\bin progress\b`,
	String.raw`\bwip\b`,
	String.raw`\bparked\b`,
	String.raw`\bfollow-?up(?:s|y)?\b`,
	String.raw`\bnext (?:session|step|round)\b`,
	String.raw`\bopen:`,
	String.raw`\bremains? open\b`,
	String.raw`\bmust (?:run|rebuild|merge|push|deploy|install)\b`,
	String.raw`\bneeds? (?:a |to )?(?:rebuild|merge|push|deploy|review)\b`,
	String.raw`\bfor now\b`,
	String.raw`\btemporar(?:y|ily)\b`,
	// Polish (\b is ASCII-only in JS, so letters are fenced with \p{L})
	String.raw`(?<!\p{L})jeszcze nie(?!\p{L})`,
	String.raw`(?<!\p{L})nie ?(?:z|s)?(?:mergowan|scalon|wdrożon|wypchnię|przebudowan)`,
	String.raw`(?<!\p{L})odłożon`,
	String.raw`(?<!\p{L})odroczon`,
	String.raw`(?<!\p{L})do zrobienia(?!\p{L})`,
	String.raw`(?<!\p{L})czeka(?:my|ją|)(?!\p{L})`,
	String.raw`(?<!\p{L})w toku(?!\p{L})`,
	String.raw`(?<!\p{L})tymczasow`,
	String.raw`(?<!\p{L})na razie(?!\p{L})`,
	String.raw`(?<!\p{L})zaległ`,
	String.raw`(?<!\p{L})do przebudowania(?!\p{L})`,
]

const MARKER_RE = new RegExp(MARKER_SOURCES.join("|"), "iu")

/** The note the dream leaves on a resolved clause; a clause carrying it is never reported again. */
export const RESOLVED_MARKER = "[resolved "

/** Longer clauses are prose, not a claim the dream can settle. */
const MAX_CLAUSE_CHARS = 400

/**
 * Separators between clauses on one line: `;`, a spaced dash (hyphen, en or
 * em dash) and the space after a sentence end. The capture group keeps them in
 * `split` output so a line can be put back together.
 */
const SEPARATOR_RE = /(\s*;\s*|\s+[-\u2013\u2014]\s+|(?<=[.!?])\s+)/

const BULLET_RE = /^(?:[-*+]\s+|\d+[.)]\s+|#+\s+|>\s*)+/

/** Whether a clause reads as true only for a while. */
export function isTimeBound(clause: string): boolean {
	return MARKER_RE.test(clause) && !clause.includes(RESOLVED_MARKER)
}

/** A line cut into clauses and the separators between them: `parts[0] + seps[0] + parts[1] + ...`. */
function splitLine(line: string): { parts: string[]; seps: string[] } {
	const pieces = line.split(SEPARATOR_RE)
	const parts: string[] = []
	const seps: string[] = []
	pieces.forEach((piece, i) => (i % 2 === 0 ? parts : seps).push(piece))
	return { parts, seps }
}

/** The clause text of a part: no list bullet or heading mark in front, no surrounding space. */
function clauseOf(part: string): string {
	return part.trim().replace(BULLET_RE, "").trim()
}

/**
 * The time-bound clauses of a text, each an exact substring of it, in order,
 * without duplicates. Fenced code blocks are skipped.
 */
export function findTimeBoundClauses(text: string): string[] {
	const found: string[] = []
	let inFence = false
	for (const line of text.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence
			continue
		}
		if (inFence) continue
		for (const part of splitLine(line).parts) {
			const clause = clauseOf(part)
			if (clause && clause.length <= MAX_CLAUSE_CHARS && isTimeBound(clause) && !found.includes(clause)) {
				found.push(clause)
			}
		}
	}
	return found
}

/**
 * Something a clause names that the repository can confirm or refute: a pull
 * request number (`#654`), a commit hash, a branch name (`fix/x`) or a
 * repo-relative file path.
 */
export type ClaimRef =
	| { kind: "pr"; number: number }
	| { kind: "commit"; sha: string }
	| { kind: "branch"; name: string }
	| { kind: "file"; path: string }

const MAX_REFS = 6

const BRANCH_RE =
	/(?<![\w/.-])((?:feat|fix|chore|docs|refactor|test|perf|ci|build|release|hotfix|feature|bugfix)\/[A-Za-z0-9._/-]*[A-Za-z0-9_])/g
const PR_RE = /(?<![\w&#])#(\d{1,6})(?!\w)/g
// 7 to 40 hex digits with at least one digit and one letter, so plain numbers
// and dates never count as a commit.
const COMMIT_RE = /(?<![\w/.-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)([0-9a-f]{7,40})(?![\w-])/g
// Repo-relative only: a path after "/", "~" or ":" is absolute or part of a URL.
const FILE_RE = /(?<![\w/.:~-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?![\w/])/g

/** The references a clause names, in order of appearance, at most {@link MAX_REFS}. */
export function extractRefs(clause: string): ClaimRef[] {
	const found: Array<{ at: number; key: string; ref: ClaimRef }> = []
	const branchSpans: Array<[number, number]> = []
	for (const m of clause.matchAll(BRANCH_RE)) {
		const name = m[1]
		found.push({ at: m.index, key: `branch:${name}`, ref: { kind: "branch", name } })
		branchSpans.push([m.index, m.index + name.length])
	}
	const insideBranch = (at: number) => branchSpans.some(([from, to]) => at >= from && at < to)
	for (const m of clause.matchAll(PR_RE)) {
		const number = Number(m[1])
		found.push({ at: m.index, key: `pr:${number}`, ref: { kind: "pr", number } })
	}
	for (const m of clause.matchAll(COMMIT_RE)) {
		if (insideBranch(m.index)) continue
		found.push({ at: m.index, key: `commit:${m[1]}`, ref: { kind: "commit", sha: m[1] } })
	}
	for (const m of clause.matchAll(FILE_RE)) {
		if (insideBranch(m.index)) continue
		found.push({ at: m.index, key: `file:${m[1]}`, ref: { kind: "file", path: m[1] } })
	}
	found.sort((a, b) => a.at - b.at)
	const seen = new Set<string>()
	const refs: ClaimRef[] = []
	for (const { key, ref } of found) {
		if (seen.has(key)) continue
		seen.add(key)
		refs.push(ref)
		if (refs.length >= MAX_REFS) break
	}
	return refs
}

/** A short human label of a reference, for prompts and notes. */
export function describeRef(ref: ClaimRef): string {
	switch (ref.kind) {
		case "pr":
			return `PR #${ref.number}`
		case "commit":
			return `commit ${ref.sha}`
		case "branch":
			return `branch ${ref.name}`
		case "file":
			return `file ${ref.path}`
	}
}

/**
 * What the repository says about one reference.
 * - `landed: true`: the change is on the default branch (PR merged, commit
 *   contained, branch content already there, file present).
 * - `landed: false`: it is known NOT to be there yet.
 * - `landed: undefined`: the repository cannot tell (unknown PR, no such
 *   branch, not a git repository).
 */
export interface ClaimEvidence {
	ref: ClaimRef
	landed: boolean | undefined
	/** One plain sentence stating the fact, e.g. "PR #654 is on main as commit 8437ea7e6 (2026-09-30)." */
	text: string
}

/**
 * The git half of the dream's gate: a clause qualifies when it names at least
 * one reference and every reference it names has landed. Evidence for other
 * refs (from neighbouring clauses) is ignored.
 */
export function allRefsLanded(refs: ReadonlyArray<ClaimRef>, evidence: ReadonlyArray<ClaimEvidence>): boolean {
	if (refs.length === 0) return false
	const key = (r: ClaimRef) => `${r.kind}:${describeRef(r)}`
	const landed = new Set(evidence.filter((e) => e.landed === true).map((e) => key(e.ref)))
	return refs.every((r) => landed.has(key(r)))
}

/**
 * Remove a clause from a single-line text (a description, an index title or
 * hook) together with one neighbouring separator. Returns the text unchanged
 * when the clause is not one of its parts.
 */
export function removeClause(text: string, clause: string): string {
	const { parts, seps } = splitLine(text)
	const i = parts.findIndex((p) => clauseOf(p) === clause)
	if (i === -1) return text
	if (parts.length === 1) return ""
	if (i === 0) {
		parts.splice(0, 1)
		seps.splice(0, 1)
	} else {
		parts.splice(i, 1)
		seps.splice(i - 1, 1)
	}
	const joined = parts.map((p, k) => p + (seps[k] ?? "")).join("")
	return joined.replace(/[\s;,]+$/, "").trim()
}

/**
 * Mark a clause in a body as resolved: `fix/x STILL unmerged.` becomes
 * `fix/x STILL unmerged [resolved 2026-10-01: ...].` The note goes before the
 * trailing punctuation so the marked clause stays one clause and
 * {@link findTimeBoundClauses} skips it from then on. Returns the text
 * unchanged when the clause is absent.
 */
export function annotateClause(text: string, clause: string, note: string): string {
	const at = text.indexOf(clause)
	if (at === -1) return text
	const core = clause.replace(/[.!?;:,]+$/, "")
	const tail = clause.slice(core.length)
	// A sentence end or a "]" inside the note would split or close the marked clause.
	const safeNote = note
		.replace(/\]/g, ")")
		.replace(/[.!?;]+(\s|$)/g, ",$1")
		.replace(/,\s*$/, "")
		.trim()
	return `${text.slice(0, at)}${core} ${RESOLVED_MARKER}${safeNote}]${tail}${text.slice(at + clause.length)}`
}
