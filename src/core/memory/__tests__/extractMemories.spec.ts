import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	executeExtractMemories,
	drainPendingExtraction,
	hasMemoryWritesSince,
	resetExtractionState,
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
	})
})
