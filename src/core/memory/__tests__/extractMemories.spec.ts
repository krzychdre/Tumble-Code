import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	executeExtractMemories,
	drainPendingExtraction,
	hasMemoryWritesSince,
	resetExtractionState,
	_inFlightExtractionsCount,
	_cursorKeys,
} from "../extractMemories"
import { initMemoryPaths, resetMemoryPaths, getAutoMemPath } from "../paths"

describe("extractMemories", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"

	beforeEach(async () => {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-extract-"))
		initMemoryPaths(tmpBase, () => ({}))
		// Pre-create the memory dir so scanMemoryFiles doesn't no-op on ENOENT.
		await fs.mkdir(getAutoMemPath(cwd), { recursive: true })
		resetExtractionState()
	})

	afterEach(async () => {
		resetExtractionState()
		resetMemoryPaths()
		await fs.rm(tmpBase, { recursive: true, force: true })
	})

	describe("hasMemoryWritesSince", () => {
		it("returns true when a tool_use wrote to an isAutoMemPath target", () => {
			const memDir = getAutoMemPath(cwd)
			const messages = [
				{ toolUses: [{ name: "write_to_file", input: { file_path: path.join(memDir, "x.md") } }] },
			]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(true)
		})

		it("returns false for writes outside the memory dir", () => {
			const messages = [{ toolUses: [{ name: "write_to_file", input: { file_path: "/workspace/src/foo.ts" } }] }]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(false)
		})

		it("returns false when there are no tool uses", () => {
			expect(hasMemoryWritesSince([{ toolUses: [] }] as any, cwd, 0)).toBe(false)
			expect(hasMemoryWritesSince([] as any, cwd, 0)).toBe(false)
		})
	})

	describe("executeExtractMemories", () => {
		it("skips for sub-agents (isMainAgent=false)", async () => {
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: false,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }],
				subTaskRunner: runner,
			})
			expect(runner).not.toHaveBeenCalled()
		})

		it("skips when the main agent already wrote a memory (mutual exclusion)", async () => {
			const memDir = getAutoMemPath(cwd)
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			const messages = [
				{ toolUses: [{ name: "write_to_file", input: { file_path: path.join(memDir, "user.md") } }] },
			]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				subTaskRunner: runner,
			})
			expect(runner).not.toHaveBeenCalled() // skipped due to direct write
		})

		it("runs the sub-Task and reports saved memories when the main agent didn't write", async () => {
			const memDir = getAutoMemPath(cwd)
			const writtenPath = path.join(memDir, "feedback.md")
			const runner = vi.fn(async () => ({ writtenPaths: [writtenPath, path.join(memDir, "MEMORY.md")] }))
			let saved = 0
			let savedPaths: string[] = []
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file", input: { file_path: "/workspace/foo.ts" } }] }] as any,
				subTaskRunner: runner,
				onSaved: (n, p) => {
					saved = n
					savedPaths = p
				},
			})
			expect(runner).toHaveBeenCalled()
			expect(saved).toBe(1) // MEMORY.md filtered out of the count
			expect(savedPaths).toEqual([writtenPath])
		})

		it("embeds the provided transcript into the extraction prompt", async () => {
			const runner = vi.fn(async (_params: { userPrompt: string }) => ({ writtenPaths: [] as string[] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file", input: { file_path: "/workspace/foo.ts" } }] }] as any,
				transcript: "User: remember my name is Ada\n\nAssistant: noted",
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
			const userPrompt = runner.mock.calls[0][0].userPrompt as string
			expect(userPrompt).toContain("## Recent conversation")
			expect(userPrompt).toContain("remember my name is Ada")
		})

		it("omits the transcript section when no transcript is provided", async () => {
			const runner = vi.fn(async (_params: { userPrompt: string }) => ({ writtenPaths: [] as string[] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file", input: { file_path: "/workspace/foo.ts" } }] }] as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
			const userPrompt = runner.mock.calls[0][0].userPrompt as string
			expect(userPrompt).not.toContain("## Recent conversation")
		})

		it("per-task cursor: short task after long task still extracts (regression)", async () => {
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			// Task "a" with 60 messages extracts successfully (cursor → 60).
			const longMessages = Array.from({ length: 60 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: longMessages as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
			// Task "b" with 25 messages — old code computed 25 − 60 ≤ 0 and skipped.
			const shortMessages = Array.from({ length: 25 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "b",
				messages: shortMessages as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(2)
		})

		it("same-task double-fire: second call with unchanged messages early-returns", async () => {
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			const messages = [{ toolUses: [{ name: "read_file" }] }]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				subTaskRunner: runner,
			})
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
		})

		it("mutual-exclusion advance is per-task: advancing task a does not block task b", async () => {
			const memDir = getAutoMemPath(cwd)
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			// Task "a" wrote a memory directly → cursor advances, runner not called.
			const messagesA = [
				{ toolUses: [{ name: "write_to_file", input: { file_path: path.join(memDir, "user.md") } }] },
			]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messagesA as any,
				subTaskRunner: runner,
			})
			expect(runner).not.toHaveBeenCalled()
			// Task "b" has no direct writes → still extracts.
			const messagesB = [{ toolUses: [{ name: "read_file" }] }]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "b",
				messages: messagesB as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
		})

		it("cursor snapshots message length at T0, not T1 (messages added mid-run are not skipped)", async () => {
			// Use a live array that gets a message appended mid-run.
			const messages: any[] = [{ toolUses: [{ name: "read_file" }] }]
			const lengthBefore = messages.length
			const runner = vi.fn(async () => {
				// Simulate a message arriving while the sub-task runs.
				messages.push({ toolUses: [{ name: "read_file" }] })
				return { writtenPaths: [] as string[] }
			})
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "cursor-snap",
				messages: messages as any,
				subTaskRunner: runner,
			})
			// The cursor should be the PRE-run length (1), not the post-run length (2).
			// Re-invoke with the same messages — if cursor was set to 2, newMessageCount
			// would be 0 and the runner would NOT be called. If cursor was set to 1,
			// newMessageCount is 1 and the runner IS called.
			const runner2 = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "cursor-snap",
				messages: messages as any,
				subTaskRunner: runner2,
			})
			expect(runner2).toHaveBeenCalledTimes(1)
			expect(lengthBefore).toBe(1)
			expect(messages.length).toBe(2)
		})

		it("LRU eviction: recently-read cursor survives when newer cursors fill the map", async () => {
			const runner = vi.fn(async () => ({ writtenPaths: [] as string[] }))
			// Task "A" with 10 messages extracts successfully (cursor → 10).
			const messagesA = Array.from({ length: 10 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "A",
				messages: messagesA as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)

			// Task "B" with 1 message extracts (cursor → 1). Now B is more recent than A.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "B",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})

			// Touch/READ A's cursor by running another extraction for A (messages
			// unchanged → early-returns, but getCursor refreshes recency).
			// After this, A is the MRU and B is the LRU.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "A",
				messages: messagesA as any,
				subTaskRunner: runner,
			})

			// Fill the map to capacity: A + B + 62 others = 64 entries.
			for (let i = 0; i < 62; i++) {
				await executeExtractMemories({
					cwd,
					isMainAgent: true,
					taskId: `other-${i}`,
					messages: [{ toolUses: [{ name: "read_file" }] }] as any,
					subTaskRunner: runner,
				})
			}
			// Map is now full (64). A was touched after B, so B is the LRU.
			// Add one more → eviction. LRU evicts B; FIFO evicts A.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "overflow",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})

			// A's cursor must have SURVIVED — it was recently read (LRU), so B
			// (the true LRU) was evicted instead. Pre-fix (FIFO), A was evicted
			// because it was inserted first despite the recent read.
			expect(_cursorKeys()).toContain("A")
			expect(_cursorKeys()).not.toContain("B")
		})
	})

	describe("drainPendingExtraction", () => {
		it("resolves immediately when nothing is in flight", async () => {
			await expect(drainPendingExtraction(1000)).resolves.toBeUndefined()
		})

		it("aborts in-flight controllers when the timeout fires", async () => {
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
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})
			// Give the extraction a tick to register the controller.
			await new Promise((r) => setTimeout(r, 10))
			await drainPendingExtraction(20)
			expect(aborted).toBe(true)
		})

		it("does not abort when extractions complete before the timeout", async () => {
			let aborted = false
			const runner = vi.fn(async (params: { signal: AbortSignal }) => {
				params.signal.addEventListener("abort", () => {
					aborted = true
				})
				return { writtenPaths: [] as string[] }
			})
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})
			// Wait long enough for the runner to resolve naturally.
			await new Promise((r) => setTimeout(r, 50))
			await drainPendingExtraction(1000)
			expect(aborted).toBe(false)
		})

		it("awaited post-abort settle: registry is empty when drain returns (abort-responsive work)", async () => {
			// Runner that resolves ONLY when its abort signal fires — simulating
			// abort-responsive work. Pre-fix the drain returned while the registry
			// was still non-empty (the finally cleanup hadn't run yet).
			const runner = vi.fn(
				(params: { signal: AbortSignal }) =>
					new Promise<any>((_resolve, reject) => {
						params.signal.addEventListener("abort", () => {
							reject(new Error("aborted"))
						})
					}),
			)
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})
			// Give the extraction a tick to register the controller.
			await new Promise((r) => setTimeout(r, 10))
			expect(_inFlightExtractionsCount()).toBe(1)

			// Main timeout (20ms) fires → abort → grace period lets it settle.
			await drainPendingExtraction(20)

			// Post-fix: the grace await gives the finally block time to run,
			// so the registry is empty when drain returns.
			expect(_inFlightExtractionsCount()).toBe(0)
		})

		it("never hangs forever: drain returns even if a promise never settles after abort", async () => {
			// Runner that NEVER settles — not even on abort. The drain must
			// still return after main-timeout + grace (it must not hang).
			const runner = vi.fn(
				(_params: { signal: AbortSignal }) =>
					new Promise<any>(() => {
						// intentionally never resolves or rejects
					}),
			)
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				subTaskRunner: runner,
			})
			// Give the extraction a tick to register.
			await new Promise((r) => setTimeout(r, 10))

			// Use short real timeouts to keep the test fast: 20ms main + 50ms grace.
			const start = Date.now()
			await drainPendingExtraction(20, 50)
			const elapsed = Date.now() - start
			// Drain returned — it didn't hang. Elapsed should be roughly
			// main-timeout + grace (within a generous tolerance).
			expect(elapsed).toBeGreaterThanOrEqual(20)
			expect(elapsed).toBeLessThan(500)
		})
	})
})
