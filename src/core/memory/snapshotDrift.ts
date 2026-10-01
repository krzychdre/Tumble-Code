/**
 * Snapshot drift: what a memory names that has changed in the repository
 * since the memory was written.
 *
 * A memory is a snapshot of the repository on the day it last changed. This
 * check rebuilds that day's default branch (the last commit before the
 * memory's mtime) and compares it with today's, for three things the memory
 * names:
 * 1. repo paths that existed then and are gone now (removed, or moved: the new
 *    path is named);
 * 2. code names (`RooHandler`, `remoteControlEnabled`, `MAX_DREAM_QUERIES`)
 *    found in the code then and nowhere in it now;
 * 3. dependency versions the memory states ("styled-components 6.4.4") that
 *    matched a package.json then and match none now.
 *
 * "Then versus now" is what keeps it quiet: a path from another repository, a
 * library prop or a made-up example was not in this repository then either, so
 * it never shows up. No keywords and no model are involved, so it works for
 * any language and any model.
 *
 * The findings go into one line at the top of the memory body,
 * `> Checked against main on <date> (note from <date>): ...`, which both Tumble
 * and Claude Code read with the memory (the directory can be shared). The line
 * is rewritten only when its findings change, after a copy of the file goes to
 * `.archive/`, and the memory keeps its mtime, so its snapshot day stays put.
 */

import { createHash } from "crypto"
import fs from "fs/promises"
import { join } from "path"

import { logger } from "../../utils/logging"
import { type CommandRunner, type DefaultBranch, resolveDefaultBranch, runCommand } from "./claimEvidence"
import { copyToArchive } from "./memoryFiles"
import { type MemoryHeader } from "./memoryScan"

/** The remembered "then" side, next to the memories (the scan reads `.md` files only). */
export const DRIFT_STATE_FILE = ".drift-checks.json"

const GIT_TIMEOUT_MS = 10_000
const GREP_TIMEOUT_MS = 120_000
const GREP_MAX_BYTES = 64 * 1024 * 1024
const MAX_NAMES_PER_NOTE = 80
const MAX_PATHS_PER_NOTE = 40
const MAX_FACTS_IN_LINE = 5

// --- The check line ---------------------------------------------------------

const CHECK_LINE_PREFIX = "> Checked against "
const CHECK_LINE_RE = /^\n?(> Checked against \S+ on (\d{4}-\d{2}-\d{2}) \(note from \d{4}-\d{2}-\d{2}\): ([^\n]*))\n/

/** A memory body split into its check line (if any) and the rest. */
export function splitCheckLine(body: string): { facts: string | undefined; rest: string } {
	const m = CHECK_LINE_RE.exec(body)
	if (!m) return { facts: undefined, rest: body }
	return { facts: m[3], rest: body.slice(m[0].length) }
}

/** The facts as they appear in the line: at most {@link MAX_FACTS_IN_LINE}, then "and N more". */
export function renderFacts(facts: ReadonlyArray<string>): string {
	const shown = facts.slice(0, MAX_FACTS_IN_LINE)
	const more = facts.length - shown.length
	return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`
}

/** The body with its check line replaced, added or (no facts) removed. */
export function withCheckLine(
	body: string,
	facts: ReadonlyArray<string>,
	branch: string,
	today: string,
	noteDay: string,
): string {
	const { rest } = splitCheckLine(body)
	if (facts.length === 0) return rest
	const line = `${CHECK_LINE_PREFIX}${branch} on ${today} (note from ${noteDay}): ${renderFacts(facts)}`
	return `\n${line}\n${rest.startsWith("\n") ? rest : `\n${rest}`}`
}

// --- What a memory names (pure) ---------------------------------------------

/** Repo-relative paths with a file extension; after "/", "~" or ":" a path is absolute or part of a URL. */
const PATH_RE = /(?<![\w/.:~-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?![\w/])/g

export function extractRepoPaths(text: string): string[] {
	const found = new Set<string>()
	for (const m of text.matchAll(PATH_RE)) {
		const path = m[1].replace(/^(?:\.\/)+/, "")
		if (path.split("/").some((part) => part === ".." || part === "")) continue
		found.add(path)
		if (found.size >= MAX_PATHS_PER_NOTE) break
	}
	return [...found]
}

/**
 * Whether a word reads as a name from code rather than prose: lowerCamel
 * (`remoteControlEnabled`), PascalCase with two humps (`RooHandler`),
 * SCREAMING_SNAKE (`MAX_DREAM_QUERIES`) or snake_case (`_compute_metrics`).
 */
function isCodeName(word: string, minLength: number): boolean {
	if (word.length < minLength || !/^[A-Za-z_$][\w$]*$/.test(word)) return false
	return (
		/[a-z][A-Z]/.test(word) ||
		/^[A-Z][a-z0-9]+[A-Z]/.test(word) ||
		/^[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]$/.test(word) ||
		(/[a-z]/.test(word) && /[^_]_[^_]/.test(word))
	)
}

/**
 * Code names a memory mentions: the last segment of a dotted name, in code
 * spans (4+ characters) or bare (6+ characters, the stricter shape keeps prose
 * out).
 */
export function extractCodeNames(text: string): string[] {
	const found = new Set<string>()
	const add = (token: string, minLength: number) => {
		const last = token.replace(/\(\)$/, "").split(".").pop() ?? ""
		if (isCodeName(last, minLength)) found.add(last)
	}
	for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) {
		if (!/\s/.test(m[1])) add(m[1], 4)
	}
	for (const token of text.replace(/`[^`\n]*`/g, " ").split(/[^\w$.]+/)) add(token, 6)
	return [...found].slice(0, MAX_NAMES_PER_NOTE)
}

/** "react 19.3", "vitest v5", "styled-components@6.4.4": a name and the version stated right after it. */
const VERSION_MENTION_RE = /(?<![\w@/.-])(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)(?:@|\s+v?)(\d+(?:\.\d+){0,2})(?!\w|\.\d)/gi

export interface VersionMention {
	name: string
	version: string
}

/** The versions a memory states for packages in `dependencies` (lower-case names). */
export function extractVersionMentions(text: string, dependencies: ReadonlySet<string>): VersionMention[] {
	const found = new Map<string, VersionMention>()
	for (const m of text.matchAll(VERSION_MENTION_RE)) {
		const name = m[1].toLowerCase()
		if (dependencies.has(name)) found.set(`${name}@${m[2]}`, { name, version: m[2] })
	}
	return [...found.values()]
}

/** Whether a package.json range names the stated version ("^19.3.0" names "19.3" and "19"). */
export function specMatches(spec: string, stated: string): boolean {
	const version = /(\d+(?:\.\d+){0,2})/.exec(spec)?.[1]
	if (!version || /^(?:workspace|catalog|file|link|git|https?):/.test(spec)) return false
	const have = version.split(".")
	return stated.split(".").every((part, i) => have[i] === part)
}

// --- Git ----------------------------------------------------------------------

type DependencyMap = Map<string, string[]>

interface Snapshot {
	branch: DefaultBranch & { ok: true }
	/** The default branch ref (origin/ when present). */
	ref: string
	commitAt(ms: number): Promise<string | undefined>
	trackedFiles(rev: string): Promise<Set<string> | undefined>
	namesInCode(rev: string, names: ReadonlyArray<string>): Promise<Set<string> | undefined>
	dependencies(rev: string): Promise<DependencyMap | undefined>
	/** How a path left the default branch after `since`: the path it moved to (if any) and when. */
	departure(path: string, since: string): Promise<{ movedTo?: string; when?: string }>
	/** When a code name stopped appearing after `since` (the last commit that changed its count). */
	nameDeparture(name: string, since: string): Promise<{ when?: string }>
}

/** "2026-09-28, #611" from a commit date and subject (squash "(#611)" or "Merge pull request #611"). */
function describeCommit(date: string | undefined, subject: string | undefined): string | undefined {
	if (!date) return undefined
	const pr = /\(#(\d+)\)|pull request #(\d+)/.exec(subject ?? "")
	return pr ? `${date}, #${pr[1] ?? pr[2]}` : date
}

async function openSnapshot(cwd: string, run: CommandRunner, signal: AbortSignal): Promise<Snapshot | undefined> {
	const git = (args: string[], s: AbortSignal, timeoutMs = GIT_TIMEOUT_MS, maxBytes?: number) =>
		run("git", ["-c", "log.showSignature=false", "-c", "core.quotePath=false", ...args], {
			cwd,
			timeoutMs,
			signal: s,
			maxBytes,
		})
	const branch = await resolveDefaultBranch(cwd, git, signal)
	if (!branch.ok) {
		logger.info(`[memory] snapshot drift skipped: ${branch.why}`)
		return undefined
	}
	const ref = branch.refs[0]
	const commits = new Map<number, string | undefined>()
	const trees = new Map<string, Set<string> | undefined>()
	const deps = new Map<string, DependencyMap | undefined>()

	const trackedFiles = async (rev: string) => {
		if (!trees.has(rev)) {
			const res = await git(["ls-tree", "-r", "--name-only", "-z", rev], signal, GIT_TIMEOUT_MS, GREP_MAX_BYTES)
			trees.set(rev, res.code === 0 ? new Set(res.stdout.split("\0").filter(Boolean)) : undefined)
		}
		return trees.get(rev)
	}

	return {
		branch,
		ref,
		trackedFiles,
		async commitAt(ms) {
			const seconds = Math.floor(ms / 1000)
			if (!commits.has(seconds)) {
				const res = await git(["rev-list", "-1", "--first-parent", `--before=@${seconds}`, ref], signal)
				commits.set(seconds, res.code === 0 && res.stdout.trim() ? res.stdout.trim() : undefined)
			}
			return commits.get(seconds)
		},
		async namesInCode(rev, names) {
			if (names.length === 0) return new Set()
			// One PCRE alternation is ~80x faster than many -F -w patterns (0.6 s
			// against 49 s for 594 names on this repository); git builds without
			// PCRE fall back to the slow form.
			const sorted = [...names].sort((a, b) => b.length - a.length)
			const pattern = `(?<![\\w$])(?:${sorted.map(escapeRegExp).join("|")})(?![\\w$])`
			let res = await git(
				["grep", "-I", "-P", "-o", "-h", "-e", pattern, rev, "--", ".", ":!*.md"],
				signal,
				GREP_TIMEOUT_MS,
				GREP_MAX_BYTES,
			)
			if (res.code !== 0 && res.code !== 1) {
				const fixed = names.flatMap((n) => ["-e", n])
				res = await git(
					["grep", "-I", "-F", "-w", "-o", "-h", ...fixed, rev, "--", ".", ":!*.md"],
					signal,
					GREP_TIMEOUT_MS,
					GREP_MAX_BYTES,
				)
			}
			// Exit 1 is "no match"; anything else means git could not tell.
			if (res.code === 1) return new Set()
			if (res.code !== 0) return undefined
			return new Set(res.stdout.split("\n").filter(Boolean))
		},
		async dependencies(rev) {
			if (!deps.has(rev)) {
				const files = await trackedFiles(rev)
				let map: DependencyMap | undefined
				if (files) {
					map = new Map()
					for (const file of files) {
						if (!/(?:^|\/)package\.json$/.test(file)) continue
						const res = await git(["show", `${rev}:${file}`], signal)
						if (res.code !== 0) continue
						try {
							const json = JSON.parse(res.stdout) as Record<string, unknown>
							for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
								const entries = json[field]
								if (!entries || typeof entries !== "object") continue
								for (const [name, spec] of Object.entries(entries as Record<string, unknown>)) {
									if (typeof spec !== "string") continue
									const key = name.toLowerCase()
									map.set(key, [...(map.get(key) ?? []), spec])
								}
							}
						} catch {
							// Not JSON (a template, a fixture): skip it.
						}
					}
				}
				deps.set(rev, map)
			}
			return deps.get(rev)
		},
		async departure(path, since) {
			const log = await git(["log", "-1", "--format=%H%x09%cs%x09%s", `${since}..${ref}`, "--", path], signal)
			const [hash, date, subject] = log.code === 0 ? log.stdout.trim().split("\t") : []
			if (!hash) return {}
			const when = describeCommit(date, subject)
			const show = await git(["show", "-M", "--format=", "--name-status", hash], signal)
			for (const line of show.code === 0 ? show.stdout.split("\n") : []) {
				const [status, from, to] = line.split("\t")
				if (status?.startsWith("R") && from === path && to) return { movedTo: to, when }
			}
			return { when }
		},
		async nameDeparture(name, since) {
			const log = await git(
				["log", "-1", "--format=%cs%x09%s", `-S${name}`, `${since}..${ref}`, "--", ".", ":!*.md"],
				signal,
				GREP_TIMEOUT_MS,
			)
			const [date, subject] = log.code === 0 ? log.stdout.trim().split("\t") : []
			return { when: describeCommit(date || undefined, subject) }
		},
	}
}

// --- State --------------------------------------------------------------------

/** What existed in the repository on a memory's snapshot day, among the things it names. */
interface ThenSide {
	/** `<mtimeMs>:<sha1 of the names, paths and versions>`: a change of either recomputes. */
	key: string
	/** The snapshot commit; empty when the repository had no history yet. */
	commit: string
	names: string[]
	/** Paths as resolved in the repository then (a memory may name `src/ui/x.ts` for `apps/cli/src/ui/x.ts`). */
	paths: string[]
	versions: VersionMention[]
	/** Rendered facts about things gone since, by `path:<p>` / `name:<n>`: the history lookup runs once. */
	departures?: Record<string, string>
}

type DriftState = Record<string, ThenSide>

async function readState(memoryDir: string): Promise<DriftState> {
	try {
		const parsed = JSON.parse(await fs.readFile(join(memoryDir, DRIFT_STATE_FILE), "utf-8"))
		if (parsed?.version !== 1 || typeof parsed.notes !== "object" || parsed.notes === null) return {}
		const state: DriftState = {}
		for (const [file, entry] of Object.entries(parsed.notes as Record<string, unknown>)) {
			const e = entry as Partial<ThenSide> | null
			if (
				typeof e?.key === "string" &&
				typeof e.commit === "string" &&
				Array.isArray(e.names) &&
				Array.isArray(e.paths) &&
				Array.isArray(e.versions)
			) {
				const departures = e.departures
				state[file] = {
					...(e as ThenSide),
					departures: departures && typeof departures === "object" ? departures : undefined,
				}
			}
		}
		return state
	} catch {
		return {}
	}
}

async function writeState(memoryDir: string, state: DriftState): Promise<void> {
	await fs.writeFile(
		join(memoryDir, DRIFT_STATE_FILE),
		`${JSON.stringify({ version: 1, notes: state }, null, "\t")}\n`,
		"utf-8",
	)
}

// --- The pass -----------------------------------------------------------------

// Not `---\s*`: that would swallow the blank line after the fence into the head.
const FRONTMATTER_RE = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isoDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10)
}

/** A path as the repository had it: exact, or the one tracked file ending in `/<path>`. */
function resolvePath(path: string, tracked: ReadonlySet<string>): string | undefined {
	if (tracked.has(path)) return path
	let hit: string | undefined
	for (const file of tracked) {
		if (!file.endsWith(`/${path}`)) continue
		if (hit) return undefined
		hit = file
	}
	return hit
}

interface Note {
	filename: string
	filePath: string
	mtimeMs: number
	head: string
	body: string
	names: string[]
	paths: string[]
	/** Text searched for version mentions (description and body without the check line). */
	text: string
}

/**
 * One drift pass over the memories. Returns the memory files whose check line
 * changed. Never throws for git trouble (the pass is skipped); throws
 * "aborted" when the signal fires.
 */
export async function checkSnapshotDrift(params: {
	memoryDir: string
	memories: ReadonlyArray<MemoryHeader>
	cwd: string
	signal: AbortSignal
	now?: number
	run?: CommandRunner
}): Promise<string[]> {
	const { memoryDir, cwd, signal } = params
	const run = params.run ?? runCommand
	const today = isoDate(params.now ?? Date.now())
	const aborted = () => {
		if (signal.aborted) throw new Error("aborted")
	}
	aborted()
	const snapshot = await openSnapshot(cwd, run, signal)
	if (!snapshot) return []

	const notes: Note[] = []
	for (const m of params.memories) {
		try {
			const content = await fs.readFile(m.filePath, "utf-8")
			const head = FRONTMATTER_RE.exec(content)?.[0] ?? ""
			const body = content.slice(head.length)
			const description = /^description:\s*(.*)$/m.exec(head)?.[1] ?? ""
			const text = `${description}\n${splitCheckLine(body).rest}`
			notes.push({
				filename: m.filename,
				filePath: m.filePath,
				mtimeMs: m.mtimeMs,
				head,
				body,
				names: extractCodeNames(text),
				paths: extractRepoPaths(text),
				text,
			})
		} catch {
			// Unreadable: skip it.
		}
	}

	const nowDeps = await snapshot.dependencies(snapshot.ref)
	const depNames = new Set(nowDeps?.keys() ?? [])
	const previous = await readState(memoryDir)
	const state: DriftState = {}

	// The "then" side per memory, from the state when nothing it depends on changed.
	for (const note of notes) {
		aborted()
		const versions = extractVersionMentions(note.text, depNames)
		const key = `${Math.floor(note.mtimeMs)}:${createHash("sha1")
			.update(JSON.stringify([note.names, note.paths, versions]))
			.digest("hex")}`
		const known = previous[note.filename]
		if (known?.key === key) {
			state[note.filename] = known
			continue
		}
		const then: ThenSide = { key, commit: "", names: [], paths: [], versions: [] }
		if (note.names.length + note.paths.length + versions.length > 0) {
			const commit = await snapshot.commitAt(note.mtimeMs)
			if (commit) {
				then.commit = commit
				const inCode = await snapshot.namesInCode(commit, note.names)
				if (!inCode) continue // git could not tell: try again next dream
				then.names = note.names.filter((n) => inCode.has(n))
				if (note.paths.length > 0) {
					const tracked = await snapshot.trackedFiles(commit)
					if (!tracked) continue
					then.paths = note.paths.flatMap((p) => resolvePath(p, tracked) ?? [])
				}
				if (versions.length > 0) {
					const thenDeps = await snapshot.dependencies(commit)
					then.versions = versions.filter((v) =>
						thenDeps?.get(v.name)?.some((s) => specMatches(s, v.version)),
					)
				}
			}
		}
		state[note.filename] = then
	}

	// The "now" side, once for all memories.
	const allNames = [...new Set(Object.values(state).flatMap((t) => t.names))]
	const nowNames = await snapshot.namesInCode(snapshot.ref, allNames)
	const nowFiles = await snapshot.trackedFiles(snapshot.ref)
	if (!nowNames || !nowFiles) {
		await writeState(memoryDir, state)
		return []
	}

	const changed: string[] = []
	for (const note of notes) {
		aborted()
		const then = state[note.filename]
		if (!then) continue
		const facts: string[] = []
		const departures: Record<string, string> = {}
		const remembered = async (key: string, describe: () => Promise<string>) => {
			departures[key] = then.departures?.[key] ?? (await describe())
			facts.push(departures[key])
		}
		for (const path of then.paths) {
			if (nowFiles.has(path)) continue
			await remembered(`path:${path}`, async () => {
				const gone = await snapshot.departure(path, then.commit)
				const when = gone.when ? ` (${gone.when})` : ""
				return gone.movedTo
					? `\`${path}\` moved to \`${gone.movedTo}\`${when}`
					: `\`${path}\` was removed${when}`
			})
		}
		for (const name of then.names) {
			if (nowNames.has(name)) continue
			await remembered(`name:${name}`, async () => {
				const gone = await snapshot.nameDeparture(name, then.commit)
				return `\`${name}\` is no longer in the code${gone.when ? ` (removed ${gone.when})` : ""}`
			})
		}
		then.departures = departures
		for (const v of then.versions) {
			const specs = nowDeps?.get(v.name)
			if (!specs || specs.some((s) => specMatches(s, v.version))) continue
			facts.push(`package.json now has ${v.name} ${specs[0]} (the note says ${v.version})`)
		}

		const current = splitCheckLine(note.body).facts
		const wanted = facts.length > 0 ? renderFacts(facts) : undefined
		if (current === wanted) continue
		const body = withCheckLine(note.body, facts, snapshot.branch.name, today, isoDate(note.mtimeMs))
		const stat = await fs.stat(note.filePath)
		await copyToArchive(memoryDir, note.filePath)
		await fs.writeFile(note.filePath, note.head + body, "utf-8")
		// Keep the snapshot day: the rest of the memory is as old as before.
		await fs.utimes(note.filePath, stat.atime, stat.mtime)
		changed.push(note.filePath)
	}

	await writeState(memoryDir, state)
	if (changed.length > 0) logger.info(`[memory] snapshot drift updated ${changed.length} memories`)
	return changed
}
