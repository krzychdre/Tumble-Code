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
				messages: [{ toolUses: [{ name: "read_file", input: { file_path: "/workspace/foo.ts" } }] }] as any,
				subTaskRunner: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
			const userPrompt = runner.mock.calls[0][0].userPrompt as string
			expect(userPrompt).not.toContain("## Recent conversation")
		})
	})

	describe("drainPendingExtraction", () => {
		it("resolves immediately when nothing is in flight", async () => {
			await expect(drainPendingExtraction(1000)).resolves.toBeUndefined()
		})
	})
})
