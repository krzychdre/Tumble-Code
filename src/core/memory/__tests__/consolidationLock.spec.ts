import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	readLastConsolidatedAt,
	tryAcquireConsolidationLock,
	rollbackConsolidationLock,
	countSessionsSince,
	HOLDER_STALE_MS,
} from "../consolidationLock"

describe("consolidationLock", () => {
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-lock-"))
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	describe("readLastConsolidatedAt", () => {
		it("returns 0 when the lock file is absent", async () => {
			expect(await readLastConsolidatedAt(tmpDir)).toBe(0)
		})

		it("returns the lock file mtime when present", async () => {
			await fs.writeFile(path.join(tmpDir, ".consolidate-lock"), String(process.pid))
			const at = await readLastConsolidatedAt(tmpDir)
			expect(at).toBeGreaterThan(0)
		})
	})

	describe("tryAcquireConsolidationLock", () => {
		it("acquires when no prior lock exists, returns priorMtime=0", async () => {
			const prior = await tryAcquireConsolidationLock(tmpDir)
			expect(prior).toBe(0)
			// Our PID is now in the body.
			const body = await fs.readFile(path.join(tmpDir, ".consolidate-lock"), "utf8")
			expect(body.trim()).toBe(String(process.pid))
		})

		it("re-acquires (returns null) when held by a live PID within the stale window", async () => {
			// First acquire (our PID).
			await tryAcquireConsolidationLock(tmpDir)
			// A second acquire by the same live PID: the race-guard re-read sees
			// our own PID and bails (returns null) because the mtime is fresh.
			const second = await tryAcquireConsolidationLock(tmpDir)
			expect(second).toBe(null)
		})

		it("reclaims a dead-PID lock", async () => {
			// Write a lock held by a PID that is definitely not running.
			await fs.mkdir(tmpDir, { recursive: true })
			await fs.writeFile(path.join(tmpDir, ".consolidate-lock"), "999999")
			// Touch it to a fresh mtime so it's within HOLDER_STALE_MS.
			const now = Math.floor(Date.now() / 1000)
			await fs.utimes(path.join(tmpDir, ".consolidate-lock"), now, now)
			const prior = await tryAcquireConsolidationLock(tmpDir)
			// 999999 is not a live process → reclaim succeeds.
			expect(prior).not.toBe(null)
			const body = await fs.readFile(path.join(tmpDir, ".consolidate-lock"), "utf8")
			expect(body.trim()).toBe(String(process.pid))
		})

		it("HOLDER_STALE_MS is 1 hour (PID-reuse guard)", () => {
			expect(HOLDER_STALE_MS).toBe(60 * 60 * 1000)
		})
	})

	describe("rollbackConsolidationLock", () => {
		it("unlinks the lock when priorMtime === 0 (restore no-file)", async () => {
			await fs.writeFile(path.join(tmpDir, ".consolidate-lock"), String(process.pid))
			await rollbackConsolidationLock(tmpDir, 0)
			await expect(fs.stat(path.join(tmpDir, ".consolidate-lock"))).rejects.toThrow()
		})

		it("clears the PID body and rewinds the mtime when priorMtime > 0", async () => {
			const lockPath = path.join(tmpDir, ".consolidate-lock")
			await fs.writeFile(lockPath, String(process.pid))
			const priorMtime = Math.floor((Date.now() - 50_000) / 1000) // 50s ago
			await fs.utimes(lockPath, priorMtime, priorMtime)
			await rollbackConsolidationLock(tmpDir, priorMtime * 1000)
			const body = await fs.readFile(lockPath, "utf8")
			expect(body).toBe("") // PID body cleared
			const stat = await fs.stat(lockPath)
			expect(Math.floor(stat.mtimeMs / 1000)).toBe(priorMtime)
		})
	})

	describe("countSessionsSince", () => {
		it("counts entries with lastModified > sinceMs", () => {
			const now = Date.now()
			const history = [
				{ lastModified: now - 1000 },
				{ lastModified: now - 2000 },
				{ lastModified: now - 100_000 }, // older than since
				{}, // no lastModified → excluded
			]
			expect(countSessionsSince(history, now - 50_000)).toBe(2)
		})
	})
})
