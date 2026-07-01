import fs from "fs/promises"
import os from "os"
import path from "path"

import { executeAutoDream, buildConsolidationPrompt, resetAutoDreamState, type AutoDreamConfig } from "../autoDream"
import { initMemoryPaths, resetMemoryPaths } from "../paths"
import * as lock from "../consolidationLock"

describe("autoDream gate cascade", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"
	const baseConfig: AutoDreamConfig = { enabled: true, minHours: 24, minSessions: 5 }
	const noopRunner = async () => ({ writtenPaths: [] as string[] })

	afterEach(async () => {
		resetAutoDreamState()
		resetMemoryPaths()
		vi.useRealTimers()
		if (tmpBase) await fs.rm(tmpBase, { recursive: true, force: true })
	})

	async function setup(lastConsolidatedAt: number) {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-dream-"))
		initMemoryPaths(tmpBase, () => ({}))
		const memDir = path.join(tmpBase, "memory", "projects", "_fake_cwd", "memory")
		await fs.mkdir(memDir, { recursive: true })
		if (lastConsolidatedAt > 0) {
			const lockPath = path.join(memDir, ".consolidate-lock")
			await fs.writeFile(lockPath, "999999") // dead PID
			const t = Math.floor(lastConsolidatedAt / 1000)
			await fs.utimes(lockPath, t, t)
		}
		return memDir
	}

	it("skips when auto-dream is disabled", async () => {
		vi.setSystemTime(Date.now())
		await setup(Date.now())
		let improved = 0
		await executeAutoDream({
			cwd,
			isMainAgent: true,
			config: { ...baseConfig, enabled: false },
			taskHistory: [],
			subTaskRunner: noopRunner,
			onImproved: (n) => (improved = n),
		})
		expect(improved).toBe(0)
	})

	it("skips for sub-agents (isMainAgent=false)", async () => {
		vi.setSystemTime(Date.now())
		await setup(Date.now())
		let improved = 0
		await executeAutoDream({
			cwd,
			isMainAgent: false,
			config: baseConfig,
			taskHistory: [],
			subTaskRunner: noopRunner,
			onImproved: (n) => (improved = n),
		})
		expect(improved).toBe(0)
	})

	it("skips when the time-gate hasn't passed (< minHours)", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 10 * 3_600_000) // 10h ago — under the 24h gate
		let improved = 0
		await executeAutoDream({
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: noopRunner,
			onImproved: (n) => (improved = n),
		})
		expect(improved).toBe(0)
	})

	it("skips when the session-gate hasn't passed (< minSessions)", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 48 * 3_600_000) // 48h ago — time-gate passed
		// Reset the scan throttle so this run can scan.
		resetAutoDreamState()
		let improved = 0
		await executeAutoDream({
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 2 }, () => ({ lastModified: now - 1000 })), // 2 < 5
			currentTaskId: "current",
			subTaskRunner: noopRunner,
			onImproved: (n) => (improved = n),
		})
		expect(improved).toBe(0)
	})

	it("rolls back the lock on sub-Task failure (non-abort)", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		const memDir = await setup(now - 48 * 3_600_000)
		resetAutoDreamState()
		// Spy on rollback to confirm it's invoked on failure.
		const rollbackSpy = vi.spyOn(lock, "rollbackConsolidationLock").mockResolvedValue(undefined)
		const failingRunner = async () => {
			throw new Error("dream failed")
		}
		await executeAutoDream({
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: failingRunner,
			onImproved: () => {},
		})
		expect(rollbackSpy).toHaveBeenCalled()
		rollbackSpy.mockRestore()
	})

	it("buildConsolidationPrompt is self-contained and names the memory dir", () => {
		const prompt = buildConsolidationPrompt("/mem/dir/", "/transcripts", "extra context")
		expect(prompt).toContain("# Dream: Memory Consolidation")
		expect(prompt).toContain("/mem/dir/")
		expect(prompt).toContain("/transcripts")
		expect(prompt).toContain("Phase 1 — Orient")
		expect(prompt).toContain("Phase 4 — Prune and index")
		expect(prompt).toContain("extra context")
	})
})
