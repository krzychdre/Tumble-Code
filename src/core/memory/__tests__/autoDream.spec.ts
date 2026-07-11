import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	executeAutoDream,
	drainPendingDreams,
	buildConsolidationPrompt,
	resetAutoDreamState,
	type AutoDreamConfig,
} from "../autoDream"
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

describe("autoDream double-fire guard (MEM-3)", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"
	const baseConfig: AutoDreamConfig = { enabled: true, minHours: 24, minSessions: 5 }

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

	it("invokes the sub-task runner exactly ONCE when called twice rapidly (don't await the first)", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 48 * 3_600_000) // time-gate passed
		resetAutoDreamState()

		// Mock the lock so both callers would pass (both see dead PID / no lock).
		const acquireSpy = vi.spyOn(lock, "tryAcquireConsolidationLock").mockResolvedValue(0)
		const rollbackSpy = vi.spyOn(lock, "rollbackConsolidationLock").mockResolvedValue(undefined)

		// Runner that blocks until we resolve it — so the first dream stays
		// in flight while the second call happens.
		let resolveFirst!: () => void
		const firstPromise = new Promise<void>((r) => (resolveFirst = r))
		const runner = vi.fn(async () => {
			await firstPromise
			return { writtenPaths: [] as string[] }
		})

		const ctx = {
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: runner,
			onImproved: () => {},
		}

		// Fire first dream — don't await; it stays in flight.
		void executeAutoDream(ctx)
		// Give the first call a tick to register in the in-flight set.
		await new Promise((r) => setTimeout(r, 10))

		// Fire second dream — should be blocked by the re-entry guard.
		void executeAutoDream(ctx)
		await new Promise((r) => setTimeout(r, 10))

		// Runner should have been called exactly ONCE — the second call bailed.
		expect(runner).toHaveBeenCalledTimes(1)

		// Release the first dream and let it settle.
		resolveFirst()
		await new Promise((r) => setTimeout(r, 10))

		acquireSpy.mockRestore()
		rollbackSpy.mockRestore()
	})

	it("releases the guard so a later call runs again after the first dream settles", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 48 * 3_600_000)
		resetAutoDreamState()

		const acquireSpy = vi.spyOn(lock, "tryAcquireConsolidationLock").mockResolvedValue(0)
		const rollbackSpy = vi.spyOn(lock, "rollbackConsolidationLock").mockResolvedValue(undefined)

		const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))

		const ctx = {
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: runner,
			onImproved: () => {},
		}

		// First dream — let it complete fully.
		await executeAutoDream(ctx)
		expect(runner).toHaveBeenCalledTimes(1)

		// Reset scan throttle so the second call can pass the gates.
		// (lastSessionScanAt was set by the first call.)
		resetAutoDreamState()

		// Second dream — should run now that the guard released.
		await executeAutoDream(ctx)
		expect(runner).toHaveBeenCalledTimes(2)

		acquireSpy.mockRestore()
		rollbackSpy.mockRestore()
	})
})

describe("drainPendingDreams (MEM-2)", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"
	const baseConfig: AutoDreamConfig = { enabled: true, minHours: 24, minSessions: 5 }

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

	it("resolves immediately when nothing is in flight", async () => {
		await expect(drainPendingDreams(1000)).resolves.toBeUndefined()
	})

	it("aborts in-flight controllers when the timeout fires", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 48 * 3_600_000)
		resetAutoDreamState()

		const acquireSpy = vi.spyOn(lock, "tryAcquireConsolidationLock").mockResolvedValue(0)
		const rollbackSpy = vi.spyOn(lock, "rollbackConsolidationLock").mockResolvedValue(undefined)

		let aborted = false
		// Runner that never resolves on its own — only the abort signal can end it.
		const runner = vi.fn(
			(params: { signal: AbortSignal }) =>
				new Promise<any>((_resolve, reject) => {
					params.signal.addEventListener("abort", () => {
						aborted = true
						reject(new Error("aborted"))
					})
				}),
		)

		void executeAutoDream({
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: runner,
			onImproved: () => {},
		})
		// Give the dream a tick to register the controller.
		await new Promise((r) => setTimeout(r, 10))

		await drainPendingDreams(20)
		expect(aborted).toBe(true)

		// Give the abort handler a tick to settle the promise and clean up.
		await new Promise((r) => setTimeout(r, 10))

		acquireSpy.mockRestore()
		rollbackSpy.mockRestore()
	})

	it("does not abort when dreams complete before the timeout", async () => {
		const now = Date.now()
		vi.setSystemTime(now)
		await setup(now - 48 * 3_600_000)
		resetAutoDreamState()

		const acquireSpy = vi.spyOn(lock, "tryAcquireConsolidationLock").mockResolvedValue(0)
		const rollbackSpy = vi.spyOn(lock, "rollbackConsolidationLock").mockResolvedValue(undefined)

		let aborted = false
		const runner = vi.fn(async (params: { signal: AbortSignal }) => {
			params.signal.addEventListener("abort", () => {
				aborted = true
			})
			return { writtenPaths: [] as string[] }
		})

		void executeAutoDream({
			cwd,
			isMainAgent: true,
			config: baseConfig,
			taskHistory: Array.from({ length: 10 }, () => ({ lastModified: now - 1000 })),
			currentTaskId: "current",
			subTaskRunner: runner,
			onImproved: () => {},
		})
		// Wait long enough for the runner to resolve naturally.
		await new Promise((r) => setTimeout(r, 50))
		await drainPendingDreams(1000)
		expect(aborted).toBe(false)

		acquireSpy.mockRestore()
		rollbackSpy.mockRestore()
	})
})
