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
	// Not "deferred-tools": a hyphen after a marker makes it part of a name.
	String.raw`\bdeferred\b(?!-)`,
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
	// "is STALE vs main", not "a stale closure".
	String.raw`\b(?:is|are|still|now) (?:\w+ )?(?:stale|outdated)\b`,
	String.raw`\b(?:stale|outdated) (?:vs|against|compared)\b`,
	// Polish (\b is ASCII-only in JS, so letters are fenced with \p{L})
	String.raw`(?<!\p{L})jeszcze nie(?!\p{L})`,
	String.raw`(?<!\p{L})nie ?(?:(?:jest|są|był\p{L}*|został\p{L}*) )?(?:z|s)?(?:mergowan|scalon|wdrożon|wypchnię|przebudowan)`,
	String.raw`(?<!\p{L})dopóki(?!\p{L})`,
	String.raw`(?<!\p{L})odłożon`,
	String.raw`(?<!\p{L})odroczon`,
	String.raw`(?<!\p{L})do zrobienia(?!\p{L})`,
	String.raw`(?<!\p{L})czeka(?:my|ją|)(?!\p{L})`,
	String.raw`(?<!\p{L})w toku(?!\p{L})`,
	String.raw`(?<!\p{L})na razie(?!\p{L})`,
	String.raw`(?<!\p{L})zaległ`,
	String.raw`(?<!\p{L})do przebudowania(?!\p{L})`,
]

const MARKER_RE = new RegExp(MARKER_SOURCES.join("|"), "iu")
const MARKER_GLOBAL_RE = new RegExp(MARKER_SOURCES.join("|"), "giu")

/**
 * The markers git can settle: something is not merged or not pushed yet.
 * "VSIX rebuild owed for #570" names a merged PR, but the rebuild is what is
 * owed, and git knows nothing about it.
 */
const MERGE_MARKER_RE = new RegExp(
	[
		String.raw`\bun(?:merged|pushed)\b`,
		String.raw`\b(?:not|never) (?:been |yet )?(?:merged|pushed|landed)\b`,
		String.raw`\bpending merge\b`,
		String.raw`\bneeds? (?:a |to )?(?:merge|push)\b`,
		String.raw`\bmust (?:merge|push)\b`,
		String.raw`(?<!\p{L})nie ?(?:z|s)?(?:mergowan|scalon|wypchnię)`,
	].join("|"),
	"giu",
)

/**
 * Words saying something got finished, unless negated ("not merged", "nie
 * zmergowane"). A clause carrying one reports the past ("MERGED as #156,
 * branch looked unmerged", "follow-up item, completed 2026-09-26"), so it is
 * not a time-bound claim, and a newer clause carrying one can settle a claim.
 */
const COMPLETION_RE = new RegExp(
	String.raw`(?<!(?:not|never|n't|to be)\s+(?:(?:been|yet|be)\s+)?)\b(?:rebuilt|merged|landed|deployed|installed|done|fixed|resolved|shipped|released|pushed|completed|finished|closed)\b` +
		String.raw`|(?<!\p{L})(?<!nie\s(?:(?:jest|są|był\p{L}*|został\p{L}*)\s)?)(?:zrobion|wdrożon|przebudowan|zmergowan|scalon|naprawion)`,
	"iu",
)

/** A state kept on purpose ("intentionally unmerged", "celowo") is not waiting for anything. */
const PERMANENT_RE =
	/\b(?:intentionally|deliberately|by design|on purpose)\b|(?<!\p{L})(?:celowo|z założenia)(?!\p{L})/iu

/** Whether a text carries a time-bound marker at all, completion words or not. */
export function hasTimeBoundMarker(text: string): boolean {
	return MARKER_RE.test(text)
}

/** Whether a text says, without negation, that something got finished. */
export function hasCompletionWord(text: string): boolean {
	return COMPLETION_RE.test(text)
}

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
	return (
		MARKER_RE.test(clause) &&
		!clause.includes(RESOLVED_MARKER) &&
		!COMPLETION_RE.test(clause) &&
		!PERMANENT_RE.test(clause)
	)
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
 * The clauses of a text, line by line, each an exact substring of it without
 * the list bullet or heading mark in front. Fenced code blocks are skipped.
 */
export function splitClauses(text: string): string[] {
	const clauses: string[] = []
	let inFence = false
	for (const line of text.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence
			continue
		}
		if (inFence) continue
		for (const part of splitLine(line).parts) {
			const clause = clauseOf(part)
			if (clause) clauses.push(clause)
		}
	}
	return clauses
}

/**
 * The time-bound clauses of a text, each an exact substring of it, in order,
 * without duplicates. Fenced code blocks are skipped.
 */
export function findTimeBoundClauses(text: string): string[] {
	const found: string[] = []
	for (const clause of splitClauses(text)) {
		if (clause.length <= MAX_CLAUSE_CHARS && isTimeBound(clause) && !found.includes(clause)) {
			found.push(clause)
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

interface LocatedRef {
	at: number
	end: number
	key: string
	ref: ClaimRef
}

/** Every reference occurrence of a clause with its span, in order of appearance. */
function locateRefs(clause: string): LocatedRef[] {
	const found: LocatedRef[] = []
	const branchSpans: Array<[number, number]> = []
	for (const m of clause.matchAll(BRANCH_RE)) {
		const name = m[1]
		// "docs/a.md" is a file: branch names do not end in a file extension.
		if (/\.[a-z]{1,5}$/i.test(name)) continue
		found.push({ at: m.index, end: m.index + name.length, key: `branch:${name}`, ref: { kind: "branch", name } })
		branchSpans.push([m.index, m.index + name.length])
	}
	const insideBranch = (at: number) => branchSpans.some(([from, to]) => at >= from && at < to)
	for (const m of clause.matchAll(PR_RE)) {
		const number = Number(m[1])
		found.push({ at: m.index, end: m.index + m[0].length, key: `pr:${number}`, ref: { kind: "pr", number } })
	}
	for (const m of clause.matchAll(COMMIT_RE)) {
		if (insideBranch(m.index)) continue
		found.push({
			at: m.index,
			end: m.index + m[1].length,
			key: `commit:${m[1]}`,
			ref: { kind: "commit", sha: m[1] },
		})
	}
	for (const m of clause.matchAll(FILE_RE)) {
		if (insideBranch(m.index)) continue
		found.push({ at: m.index, end: m.index + m[1].length, key: `file:${m[1]}`, ref: { kind: "file", path: m[1] } })
	}
	return found.sort((a, b) => a.at - b.at)
}

function uniqueRefs(found: ReadonlyArray<LocatedRef>): ClaimRef[] {
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

/** The references a clause names, in order of appearance, at most {@link MAX_REFS}. */
export function extractRefs(clause: string): ClaimRef[] {
	return uniqueRefs(locateRefs(clause))
}

/** At most this many words may stand between a marker and the reference it is about. */
const MAX_WORDS_TO_MARKER = 2

/**
 * The references a clause's marker is about: those at most
 * {@link MAX_WORDS_TO_MARKER} words from a marker ("fix/x STILL unmerged",
 * "#12 is not merged"). In "branch STILL unmerged, now CONFLICTS with #654"
 * #654 is a different change, not the unmerged one. With `mergeOnly` only the
 * markers git can settle count (not merged, not pushed), and file refs never
 * count. Pure code.
 */
export function refsNearMarker(clause: string, mergeOnly = false): ClaimRef[] {
	const markers = [...clause.matchAll(mergeOnly ? MERGE_MARKER_RE : MARKER_GLOBAL_RE)].map(
		(m) => [m.index, m.index + m[0].length] as const,
	)
	const wordsBetween = (from: number, to: number) =>
		from >= to
			? 0
			: clause
					.slice(from, to)
					.split(/\s+/)
					.filter((w) => /[\p{L}\p{N}]/u.test(w)).length
	const near = locateRefs(clause).filter(
		(r) =>
			!(mergeOnly && r.ref.kind === "file") &&
			markers.some(
				([at, end]) => (r.end <= at ? wordsBetween(r.end, at) : wordsBetween(end, r.at)) <= MAX_WORDS_TO_MARKER,
			),
	)
	return uniqueRefs(near)
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
 * The git half of the dream's gate: a clause qualifies when it names a PR,
 * commit or branch and every reference it names has landed. A file that exists
 * says nothing about whether the work around it is finished, so file refs
 * alone never qualify. Evidence for other refs (from neighbouring clauses) is
 * ignored.
 */
export function allRefsLanded(refs: ReadonlyArray<ClaimRef>, evidence: ReadonlyArray<ClaimEvidence>): boolean {
	if (!refs.some((r) => r.kind !== "file")) return false
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
 * Drop a resolved clause from a single-line text. When the only time-bound
 * part of the clause is a parenthetical, only that goes: "cleared in
 * d55078ec7 (not pushed)" keeps "cleared in d55078ec7", which is still true.
 * Otherwise the whole clause goes ({@link removeClause}).
 */
export function dropResolvedClause(text: string, clause: string): string {
	const marked = [...clause.matchAll(/\s*\([^()]*\)/g)].filter((m) => MARKER_RE.test(m[0]))
	if (marked.length > 0 && text.includes(clause)) {
		let rest = clause
		for (const m of marked) rest = rest.replace(m[0], "")
		rest = rest.trim()
		if (rest && !MARKER_RE.test(rest)) return text.replace(clause, rest)
	}
	return removeClause(text, clause)
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
