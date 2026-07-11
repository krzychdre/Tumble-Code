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
 * Runs as a sandboxed sub-Task (same `SubTaskRunner` as extractMemories) with
 * `buildConsolidationPrompt` (self-contained, ported verbatim).
 */

import { basename } from "path"

import { logger } from "../../utils/logging"
import { getAutoMemPath, isAutoMemoryEnabled } from "./paths"
import { ENTRYPOINT_NAME, MAX_ENTRYPOINT_LINES, DIR_EXISTS_GUIDANCE } from "./memoryPrompt"
import {
	readLastConsolidatedAt,
	tryAcquireConsolidationLock,
	rollbackConsolidationLock,
	countSessionsSince,
} from "./consolidationLock"
import { type SubTaskRunner, type SubTaskResult, drainInFlight } from "./extractMemories"

export { type SubTaskRunner, type SubTaskResult } from "./extractMemories"

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
	/** The sandboxed sub-Task spawner. */
	subTaskRunner: SubTaskRunner
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

/**
 * Build the consolidation prompt. Ported verbatim from
 * `services/autoDream/consolidationPrompt.ts` — it's self-contained.
 *
 * @param memoryRoot The memory directory.
 * @param transcriptDir The session transcript/project dir (informational).
 * @param extra Additional context appended to the prompt.
 */
export function buildConsolidationPrompt(memoryRoot: string, transcriptDir: string, extra: string): string {
	return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
${DIR_EXISTS_GUIDANCE}

Session transcripts: \`${transcriptDir}\` (large JSONL files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient
- \`list_files\` the memory directory to see what already exists
- Read \`${ENTRYPOINT_NAME}\` to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If \`logs/\` or \`sessions/\` subdirectories exist, review recent entries there

## Phase 2 — Gather recent signal
Sources in rough priority order:
1. **Daily logs** (\`logs/YYYY/MM/YYYY-MM-DD.md\`) if present
2. **Existing memories that drifted** — facts that contradict something you see in the codebase now
3. **Transcript search** — \`search_files with regex="<narrow term>" path="${transcriptDir}/" file_pattern="*.jsonl"\`
Don't exhaustively read transcripts.

## Phase 3 — Consolidate
For each thing worth remembering, write or update a memory file at the top level of the memory directory. Use the memory file format and type conventions from your system prompt's auto-memory section.
Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates
- Deleting contradicted facts — if today's investigation disproves an old memory, fix it at the source

## Phase 4 — Prune and index
Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.
- Remove pointers to memories that are now stale, wrong, or superseded
- Demote verbose entries: if an index line is over ~200 chars, shorten the line, move the detail
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed, say so.${extra ? `\n\n## Additional context\n\n${extra}` : ""}`
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
	const extra =
		"Tool constraints: read_file / search_files / list_files unrestricted; execute_command read-only only; write_to_file / edit_file only inside the memory directory."
	const prompt = buildConsolidationPrompt(memoryDir, context.cwd, extra)

	// Declare the promise holder first so the `finally` can deregister itself
	// without a use-before-assignment error.
	let run: Promise<void> | undefined
	run = (async () => {
		try {
			const result = await context.subTaskRunner({
				cwd: context.cwd,
				systemPrompt: buildDreamSystemPrompt(memoryDir),
				userPrompt: prompt,
				maxTurns: 10,
				signal: controller.signal,
			})
			const memoryPaths = result.writtenPaths.filter((p) => basename(p) !== ENTRYPOINT_NAME)
			if (memoryPaths.length > 0 && context.onImproved) {
				context.onImproved(memoryPaths.length, memoryPaths)
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

function buildDreamSystemPrompt(memoryDir: string): string {
	return [
		"You are the memory consolidation (dream) subagent. You review and reorganize the memory directory: merge near-duplicates, delete contradicted facts, prune stale entries, and keep the MEMORY.md index concise.",
		"",
		`Memory directory: ${memoryDir}`,
		"You may only write to files inside this directory. You may read anywhere and run read-only shell commands.",
		"",
		"Use the memory file format and the four types (user / feedback / project / reference) from your system prompt's auto-memory section.",
	].join("\n")
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
