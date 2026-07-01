/**
 * autoDream consolidation lock — the lock-as-timestamp primitive.
 *
 * Ported from Claude Code's `services/autoDream/consolidationLock.ts`. The lock
 * file (`.consolidate-lock`) lives inside the memory dir and has a dual
 * purpose: its mtime IS `lastConsolidatedAt`, and its body is the holder's PID.
 *
 * Correctness properties:
 * - **Race guard**: two reclaimers both write → last wins the PID → loser bails
 *   on re-read.
 * - **Dead-PID reclaim**: if the holder PID is no longer running, reclaim.
 * - **Stale-PID reclaim**: even if the PID is live, if the lock is older than
 *   `HOLDER_STALE_MS` (1h), reclaim (guards against PID reuse).
 * - **Rollback clears the PID body**: on fork failure, rewind the mtime to the
 *   pre-acquire value so the time-gate re-passes, AND clear the PID body so our
 *   still-running process doesn't look like a holder. `priorMtime === 0` →
 *   unlink (restore no-file).
 */

import fs from "fs/promises"
import { join } from "path"
import { execFileSync } from "child_process"

import { logger } from "../../utils/logging"

const LOCK_FILE = ".consolidate-lock"
/** Stale past this even if the PID is live (PID reuse guard). */
export const HOLDER_STALE_MS = 60 * 60 * 1000 // 1 hour

function lockPath(memoryDir: string): string {
	return join(memoryDir, LOCK_FILE)
}

/** mtime of the lock file = lastConsolidatedAt. 0 if absent. Per-turn cost: one stat. */
export async function readLastConsolidatedAt(memoryDir: string): Promise<number> {
	try {
		const s = await fs.stat(lockPath(memoryDir))
		return s.mtimeMs
	} catch {
		return 0
	}
}

/** Best-effort check whether a process with the given PID is running. */
function isProcessRunning(pid: number): boolean {
	if (!pid || pid <= 0) return false
	try {
		// `process.kill(pid, 0)` throws if the process doesn't exist (or no permission).
		// We treat EPERM as "running" (the process exists, we just can't signal it).
		process.kill(pid, 0)
		return true
	} catch (e) {
		const code = (e as NodeJS.ErrnoException)?.code
		return code === "EPERM"
	}
}

/**
 * Try to acquire the consolidation lock.
 *
 * @returns the pre-acquire mtime (for {@link rollbackConsolidationLock}) on
 *   success, or `null` if the lock is held by a live/recent PID (loser of a
 *   race, or a genuine holder).
 */
export async function tryAcquireConsolidationLock(memoryDir: string): Promise<number | null> {
	const path = lockPath(memoryDir)
	let mtimeMs: number | undefined
	let holderPid: number | undefined
	try {
		const [s, raw] = await Promise.all([fs.stat(path), fs.readFile(path, "utf8")])
		mtimeMs = s.mtimeMs
		const parsed = parseInt(raw.trim(), 10)
		holderPid = Number.isFinite(parsed) ? parsed : undefined
	} catch {
		/* ENOENT — no prior lock */
	}

	if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
		if (holderPid !== undefined && isProcessRunning(holderPid)) {
			return null // held by a live PID
		}
		// Dead PID or unparseable body — reclaim.
	}

	await fs.mkdir(memoryDir, { recursive: true })
	await fs.writeFile(path, String(process.pid))

	// Two reclaimers both write → last wins the PID. Loser bails on re-read.
	let verify: string
	try {
		verify = await fs.readFile(path, "utf8")
	} catch {
		return null
	}
	if (parseInt(verify.trim(), 10) !== process.pid) return null

	return mtimeMs ?? 0 // pre-acquire mtime for rollback
}

/**
 * Rollback the lock on fork failure: rewind the mtime to `priorMtime` so the
 * time-gate re-passes, and clear the PID body so our still-running process
 * doesn't look like a holder.
 *
 * `priorMtime === 0` → unlink (restore the no-file state).
 */
export async function rollbackConsolidationLock(memoryDir: string, priorMtime: number): Promise<void> {
	const path = lockPath(memoryDir)
	try {
		if (priorMtime === 0) {
			await fs.unlink(path)
			return
		}
		await fs.writeFile(path, "") // clear PID body
		const t = Math.floor(priorMtime / 1000) // utimes wants seconds
		await fs.utimes(path, t, t)
	} catch (e) {
		logger.error(
			`[memory] rollbackConsolidationLock failed — next trigger delayed to minHours: ${
				e instanceof Error ? e.message : String(e)
			}`,
		)
	}
}

/**
 * Optimistically stamp the lock mtime (manual `/dream` entry). No completion
 * hook, so the auto-trigger won't immediately re-fire.
 */
export async function recordConsolidation(memoryDir: string): Promise<void> {
	const path = lockPath(memoryDir)
	try {
		await fs.mkdir(memoryDir, { recursive: true })
		// Touch: create if absent, update mtime if present.
		const now = Math.floor(Date.now() / 1000)
		try {
			await fs.utimes(path, now, now)
		} catch (e) {
			if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
				await fs.writeFile(path, String(process.pid))
			} else {
				throw e
			}
		}
	} catch (e) {
		logger.error(`[memory] recordConsolidation failed: ${e instanceof Error ? e.message : String(e)}`)
	}
}

/**
 * Count sessions (task-history entries) touched after `sinceMs`.
 *
 * Uses Roo's TaskHistoryStore shape (`{ lastModified: number }[]`) directly
 * instead of porting Claude Code's `listCandidates`. This is a skip-gate, so
 * undercounting worktree sessions (which live under a different cwd) is safe —
 * it only delays a dream, never causes a wrong one. The current session is
 * excluded by the caller.
 */
export function countSessionsSince(taskHistory: ReadonlyArray<{ lastModified?: number }>, sinceMs: number): number {
	return taskHistory.filter((t) => typeof t.lastModified === "number" && t.lastModified > sinceMs).length
}

// Re-export for tests that need to simulate a "live PID" without a real process.
export const _isProcessRunning = isProcessRunning
export { execFileSync as _execFileSync }
