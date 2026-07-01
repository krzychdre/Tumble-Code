import { describe, it, expect } from "vitest"

import {
	validateParallelParams,
	runWithConcurrency,
	formatParallelResults,
	worktreeNamesFor,
	type ParallelSubtaskResult,
} from "../RunParallelTasksTool"

describe("RunParallelTasksTool helpers", () => {
	describe("validateParallelParams", () => {
		it("rejects missing / empty subtasks", () => {
			expect(validateParallelParams(undefined)).toEqual({ ok: false, error: expect.any(String) })
			expect(validateParallelParams({ subtasks: [] })).toEqual({ ok: false, error: expect.any(String) })
		})

		it("rejects a subtask without a message", () => {
			const r = validateParallelParams({ subtasks: [{ message: "  " } as never] })
			expect(r.ok).toBe(false)
		})

		it("normalizes mode to 'code' by default and clamps concurrency to subtask count", () => {
			const r = validateParallelParams({
				subtasks: [{ message: "a" }, { message: "b", mode: "debug" }],
				maxConcurrency: 10,
			})
			expect(r).toEqual({
				ok: true,
				subtasks: [
					{ message: "a", mode: "code" },
					{ message: "b", mode: "debug" },
				],
				maxConcurrency: 2, // clamped to subtasks.length
			})
		})

		it("defaults concurrency to 3 for invalid values", () => {
			const many = Array.from({ length: 5 }, (_, i) => ({ message: `m${i}` }))
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 0 })).toMatchObject({ maxConcurrency: 3 })
			expect(validateParallelParams({ subtasks: many, maxConcurrency: null })).toMatchObject({
				maxConcurrency: 3,
			})
		})
	})

	describe("runWithConcurrency", () => {
		it("runs every item, preserving input order in results", async () => {
			const out = await runWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)
			expect(out).toEqual([10, 20, 30, 40])
		})

		it("never exceeds the concurrency limit", async () => {
			let active = 0
			let peak = 0
			await runWithConcurrency(
				Array.from({ length: 8 }, (_, i) => i),
				3,
				async (i) => {
					active++
					peak = Math.max(peak, active)
					await new Promise((r) => setTimeout(r, 5))
					active--
					return i
				},
			)
			expect(peak).toBeLessThanOrEqual(3)
			expect(peak).toBeGreaterThan(1)
		})
	})

	describe("formatParallelResults", () => {
		it("summarizes counts and renders each subtask block", () => {
			const results: ParallelSubtaskResult[] = [
				{
					index: 0,
					mode: "code",
					status: "completed",
					worktreePath: "/wt/a",
					branch: "worktree/parallel-x-1",
					message: "did the thing",
				},
				{ index: 1, mode: "debug", status: "failed", worktreePath: "/wt/b", error: "boom" },
			]
			const out = formatParallelResults(results)
			expect(out).toContain("1 completed, 1 failed")
			expect(out).toContain("### Subtask 1 — COMPLETED (code mode)")
			expect(out).toContain("did the thing")
			expect(out).toContain("### Subtask 2 — FAILED (debug mode)")
			expect(out).toContain("Failed: boom")
		})
	})

	describe("worktreeNamesFor", () => {
		it("derives deterministic worktree path + branch from parent id and index", () => {
			const a = worktreeNamesFor("/home/u/myproj", "abcdef1234567890", 0)
			const b = worktreeNamesFor("/home/u/myproj", "abcdef1234567890", 0)
			expect(a).toEqual(b) // deterministic
			expect(a.branch).toBe("worktree/parallel-abcdef12-1")
			expect(a.worktreePath).toContain("myproj-abcdef12-1")
		})
	})
})
