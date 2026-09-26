/**
 * autoDream — periodic memory consolidation.
 *
 * Ported from Claude Code's `services/autoDream/autoDream.ts`. Runs (best-effort,
 * fire-and-forget) after a task completes, gated on:
 * 1. auto-dream enabled + auto-memory enabled;
 * 2. **Time gate**: hours since `lastConsolidatedAt` ≥ `minHours` (default 24);
 * 3. **Session gate**: task-history entries with mtime > `lastConsolidatedAt`
 *    ≥ `minSessions` (default 5); undercounting is safe (it's a skip-gate);
 * 4. **Lock**: `tryAcquireConsolidationLock` (cross-process mutual exclusion).
 *
 * The scan throttle (10 min) prevents re-scanning every turn while the
 * session-gate is pending. On failure (non-abort), the lock mtime is rolled
 * back so the time-gate re-passes immediately; the scan throttle becomes the
 * effective backoff. On abort (user kill), no double-rollback — the killer
 * already rolled back.
 *
 * The consolidation itself is small and mostly deterministic, so it works on
 * small local models (the earlier design ran a 10-turn agent that re-sent a
 * 25-60k token prompt on every turn):
 * 1. the code picks at most {@link MAX_DREAM_QUERIES} pairs of memories that
 *    look like the same topic (same type, overlapping name + description words);
 * 2. for each pair ONE small completion answers KEEP, DROP 1/2 or MERGE with
 *    the merged text; a merge that loses too much text is refused;
 * 3. the code repairs the MEMORY.md index (dead links out, unindexed files in).
 * A folded or dropped memory moves to `.archive/`, it is never deleted.
 */

import fs from "fs/promises"

import { logger } from "../../utils/logging"
import { getAutoMemPath, isAutoMemoryEnabled } from "./paths"
import {
	readLastConsolidatedAt,
	tryAcquireConsolidationLock,
	rollbackConsolidationLock,
	countSessionsSince,
} from "./consolidationLock"
import { drainInFlight } from "./extractMemories"
import { type MemoryHeader, scanMemoryFiles } from "./memoryScan"
import { archiveMemory, rewriteMemoryBody, syncMemoryIndex } from "./memoryFiles"
import { type SideQuery } from "./relevance"

/** Scan throttle: don't re-check the session gate more often than this. */
const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000 // 10 min

export interface AutoDreamConfig {
	enabled: boolean
	minHours: number
	minSessions: number
}

export interface AutoDreamContext {
	cwd: string
	/** Whether this is the main agent (sub-agents are excluded). */
	isMainAgent: boolean
	/** The dream config (from settings). */
	config: AutoDreamConfig
	/** The task-history entries (for the session gate). */
	taskHistory: ReadonlyArray<{ lastModified?: number }>
	/** The current session's task id — excluded from the session count. */
	currentTaskId?: string
	/** The one-shot completion each merge decision asks. */
	query: SideQuery
	/** Called with an "Improved N memories" notice on success (may be a no-op). */
	onImproved?: (count: number, paths: string[]) => void
}

// Module-scoped scan throttle state (mirrors the upstream closure).
let lastSessionScanAt = 0

// Module-scoped in-flight state — mirrors extractMemories.ts so the two
// read identically. Used by drainPendingDreams (MEM-2) to await/abort
// in-flight dreams on shutdown instead of orphaning them.
let inFlightDreams = new Set<Promise<void>>()
const inFlightDreamControllers = new Set<AbortController>()

// Per-memory-dir re-entry guard (MEM-3): prevents double-fired dreams from
// racing through the PID lock when both see no lock / a dead PID and both
// write the same process.pid. This is in-process re-entry protection
// complementing the cross-process PID lock.
const activeDreamDirs = new Set<string>()

/** Reset module state — for tests only. */
export function resetAutoDreamState(): void {
	lastSessionScanAt = 0
	inFlightDreams = new Set()
	inFlightDreamControllers.clear()
	activeDreamDirs.clear()
}

/** @internal — test only */
export function _inFlightDreamsCount(): number {
	return inFlightDreams.size
}

/** Upper bound on model calls per dream. */
export const MAX_DREAM_QUERIES = 3
/** Word-overlap (Jaccard) at or above which two memories are a merge candidate. */
export const MERGE_CANDIDATE_SIMILARITY = 0.35
/** A merge must keep at least this share of the longer original's text. */
const MIN_MERGED_SHARE = 0.6
const MAX_BODY_CHARS_IN_PROMPT = 3000

// Filler plus the status vocabulary project memories share ("MERGED to main
// via squash", "branch pushed"): on a real 77-memory store these words alone
// paired unrelated topics.
const STOPWORDS = new Set(
	(
		"the and for with that this from into not are was but its use user feedback project reference " +
		"when what how why all one new now has have via per any can never always " +
		"merged main branch branches pushed stack stacked squash live deployed copy after before still see " +
		"fixed open done local"
	).split(" "),
)

/** Topic words of a memory: name + description, minus filler, status words and anything with a digit (dates, PR and branch numbers). */
function topicWords(memory: MemoryHeader): Set<string> {
	const text = `${memory.filename.replace(/\.md$/, "")} ${memory.description ?? ""}`.toLowerCase()
	return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/\d/.test(w)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0
	let shared = 0
	for (const w of a) if (b.has(w)) shared++
	return shared / (a.size + b.size - shared)
}

/**
 * Pairs of memories that probably cover one topic, most similar first, each
 * memory in at most one pair. Pure code, no model call.
 */
export function findMergeCandidates(
	memories: ReadonlyArray<MemoryHeader>,
	limit: number = MAX_DREAM_QUERIES,
): Array<[MemoryHeader, MemoryHeader]> {
	const words = memories.map(topicWords)
	const scored: Array<{ i: number; j: number; score: number }> = []
	for (let i = 0; i < memories.length; i++) {
		for (let j = i + 1; j < memories.length; j++) {
			const ti = memories[i].type
			const tj = memories[j].type
			if (ti && tj && ti !== tj) continue
			const score = jaccard(words[i], words[j])
			if (score >= MERGE_CANDIDATE_SIMILARITY) scored.push({ i, j, score })
		}
	}
	scored.sort((a, b) => b.score - a.score)
	const used = new Set<number>()
	const pairs: Array<[MemoryHeader, MemoryHeader]> = []
	for (const { i, j } of scored) {
		if (pairs.length >= limit) break
		if (used.has(i) || used.has(j)) continue
		used.add(i)
		used.add(j)
		// Older first: a merge keeps the older file, whose name other notes link to.
		const [a, b] =
			memories[i].mtimeMs <= memories[j].mtimeMs ? [memories[i], memories[j]] : [memories[j], memories[i]]
		pairs.push([a, b])
	}
	return pairs
}

export const DREAM_SYSTEM_PROMPT = [
	"You tidy a memory store. You get two memory files that may cover the same topic.",
	"Answer with exactly one of these:",
	"",
	"KEEP",
	"(they are about different things, or you are not sure)",
	"",
	"DROP 1",
	"or",
	"DROP 2",
	"(that file says nothing the other one does not, or the other, newer file replaces it)",
	"",
	"MERGE",
	"<one-line summary>",
	"<merged text: every fact from both files; when they disagree, the newer file wins>",
	"",
	"Write nothing else.",
].join("\n")

function stripFrontmatter(content: string): string {
	return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim()
}

export type DreamVerdict =
	| { kind: "keep" }
	| { kind: "drop"; which: 1 | 2 }
	| { kind: "merge"; description: string; body: string }

/** Parse a dream answer; anything unrecognised is KEEP (the safe default). */
export function parseDreamVerdict(answer: string): DreamVerdict {
	const text = (typeof answer === "string" ? answer : "")
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/```[a-z]*\n?/gi, "")
		.trim()
	const lines = text.split("\n")
	const first = (lines[0] ?? "").replace(/[*#`]/g, "").trim().toUpperCase()
	const drop = /^DROP\s*(?:FILE\s*)?([12])\b/.exec(first)
	if (drop) return { kind: "drop", which: drop[1] === "1" ? 1 : 2 }
	if (/^MERGE\b/.test(first)) {
		const rest = lines.slice(1).map((l) => l.trimEnd())
		while (rest.length > 0 && !rest[0].trim()) rest.shift()
		const description = (rest[0] ?? "").replace(/^(?:summary|description)\s*:\s*/i, "").trim()
		const body = rest.slice(1).join("\n").trim()
		if (description && body) return { kind: "merge", description, body }
	}
	return { kind: "keep" }
}

async function decidePair(
	memoryDir: string,
	pair: [MemoryHeader, MemoryHeader],
	query: SideQuery,
	signal: AbortSignal,
): Promise<string[]> {
	const [a, b] = pair
	const [bodyA, bodyB] = await Promise.all(
		pair.map(async (m) => stripFrontmatter(await fs.readFile(m.filePath, "utf-8"))),
	)
	// A body cut for the prompt cannot be merged without losing its tail.
	const truncated = bodyA.length > MAX_BODY_CHARS_IN_PROMPT || bodyB.length > MAX_BODY_CHARS_IN_PROMPT
	const show = (n: number, m: MemoryHeader, body: string) =>
		[
			`File ${n}: ${m.filename} (last changed ${new Date(m.mtimeMs).toISOString().slice(0, 10)})`,
			`Summary: ${m.description ?? ""}`,
			body.slice(0, MAX_BODY_CHARS_IN_PROMPT),
		].join("\n")
	const answer = await query(DREAM_SYSTEM_PROMPT, `${show(1, a, bodyA)}\n\n${show(2, b, bodyB)}`, signal)
	const verdict = parseDreamVerdict(answer)
	if (verdict.kind === "drop") {
		const dropped = verdict.which === 1 ? a : b
		await archiveMemory(memoryDir, dropped)
		return [dropped.filePath]
	}
	if (verdict.kind === "merge") {
		if (truncated || verdict.body.length < MIN_MERGED_SHARE * Math.max(bodyA.length, bodyB.length)) {
			logger.info(`[memory] autoDream refused a lossy merge of ${a.filename} and ${b.filename}`)
			return []
		}
		await rewriteMemoryBody(a, verdict.body, verdict.description)
		await archiveMemory(memoryDir, b)
		return [a.filePath, b.filePath]
	}
	return []
}

/**
 * One consolidation pass: merge decisions on the candidate pairs, then the
 * index repair. Returns the memory files changed (archived ones included).
 */
export async function consolidateMemories(memoryDir: string, query: SideQuery, signal: AbortSignal): Promise<string[]> {
	const changed: string[] = []
	for (const pair of findMergeCandidates(await scanMemoryFiles(memoryDir, signal))) {
		if (signal.aborted) throw new Error("aborted")
		changed.push(...(await decidePair(memoryDir, pair, query, signal)))
	}
	await syncMemoryIndex(memoryDir, await scanMemoryFiles(memoryDir, signal))
	return changed
}

/**
 * Run the auto-dream gate cascade + consolidation. Fire-and-forget by the
 * caller (the lifecycle hook calls with `void`).
 *
 * Returns the number of memories improved (0 if the gate was closed or the
 * dream wrote nothing).
 */
export async function executeAutoDream(context: AutoDreamContext): Promise<void> {
	if (!isAutoMemoryEnabled() || !context.isMainAgent || !context.config.enabled) return

	const memoryDir = getAutoMemPath(context.cwd)

	// MEM-3: in-process re-entry guard. If a dream for this memory dir is
	// already in flight, bail immediately — prevents double-fired dreams from
	// racing through the PID lock (both callers see no lock / a dead PID,
	// both write the same process.pid, both pass verification). This is
	// in-process protection complementing the cross-process PID lock.
	if (activeDreamDirs.has(memoryDir)) return

	const lastAt = await readLastConsolidatedAt(memoryDir)
	const hoursSince = (Date.now() - lastAt) / 3_600_000
	if (hoursSince < context.config.minHours) return

	// Scan throttle: once the time-gate passes, it keeps passing every turn
	// (the mtime doesn't advance). Cap the session-gate scan to every 10 min.
	const now = Date.now()
	if (now - lastSessionScanAt < SESSION_SCAN_INTERVAL_MS) return
	lastSessionScanAt = now

	const sessionsSince = countSessionsSince(context.taskHistory, lastAt)
	// The current session's task is always recent; exclude it (best-effort).
	const effectiveSessions = context.currentTaskId ? Math.max(0, sessionsSince - 1) : sessionsSince
	if (effectiveSessions < context.config.minSessions) return

	const priorMtime = await tryAcquireConsolidationLock(memoryDir)
	if (priorMtime === null) return // held by another process

	// Re-check the re-entry guard after the async lock acquisition — a
	// double-fired caller may have already entered between the initial check
	// and the lock acquire. This closes the narrow race window.
	if (activeDreamDirs.has(memoryDir)) {
		await rollbackConsolidationLock(memoryDir, priorMtime)
		return
	}

	activeDreamDirs.add(memoryDir)

	const controller = new AbortController()

	// Declare the promise holder first so the `finally` can deregister itself
	// without a use-before-assignment error.
	const run: Promise<void> | undefined = (async () => {
		try {
			const changed = await consolidateMemories(memoryDir, context.query, controller.signal)
			if (changed.length > 0 && context.onImproved) {
				context.onImproved(changed.length, changed)
			}
		} catch (e) {
			if (controller.signal.aborted) {
				// Killed (e.g. by drainPendingDreams or a UI kill action).
				// Do NOT double-rollback — the killer already handled cleanup.
				return
			}
			logger.error(`[memory] autoDream failed: ${e instanceof Error ? e.message : String(e)}`)
			// Roll back the lock mtime so the time-gate re-passes; the scan
			// throttle becomes the effective backoff (next attempt ≥ 10 min later).
			await rollbackConsolidationLock(memoryDir, priorMtime)
		} finally {
			activeDreamDirs.delete(memoryDir)
			if (run) inFlightDreams.delete(run)
			inFlightDreamControllers.delete(controller)
		}
	})()
	// Registered together so the `finally` above always deregisters both.
	inFlightDreamControllers.add(controller)
	inFlightDreams.add(run)
}

/**
 * Await in-flight dreams with a soft timeout. Called on shutdown alongside
 * {@link drainPendingExtraction}. The timeout is `.unref()`'d so it never
 * blocks process exit. When the timeout fires with dreams still pending,
 * abort their controllers so live sub-tasks are cancelled instead of
 * orphaned (MEM-2). After aborting, a bounded grace period (5s) is awaited
 * so aborted work can settle and deregister before the drain returns.
 */
export async function drainPendingDreams(timeoutMs: number = 60_000, graceMs: number = 5_000): Promise<void> {
	await drainInFlight(inFlightDreams, inFlightDreamControllers, timeoutMs, graceMs)
}
