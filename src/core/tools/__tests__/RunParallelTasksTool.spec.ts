import { describe, it, expect, vi, beforeEach } from "vitest"

import { EventEmitter } from "events"

import { RooCodeEventName } from "@roo-code/types"

// Mock worktreeService before importing the tool. vi.hoisted ensures the
// mock functions are available when the hoisted vi.mock factory runs.
const { mockCheckGitRepo, mockCreateWorktree } = vi.hoisted(() => ({
	mockCheckGitRepo: vi.fn().mockResolvedValue(true),
	mockCreateWorktree: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
}))
vi.mock("@roo-code/core", () => ({
	worktreeService: {
		checkGitRepo: mockCheckGitRepo,
		createWorktree: mockCreateWorktree,
	},
}))

// Mock formatResponse to keep output predictable.
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
	},
}))

import {
	validateParallelParams,
	runWithConcurrency,
	formatParallelResults,
	worktreeNamesFor,
	runParallelTasksTool,
	type ParallelSubtaskResult,
} from "../RunParallelTasksTool"
import { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"

// ---------------------------------------------------------------------------
// Helpers for execute() tests
// ---------------------------------------------------------------------------

/** A minimal fake provider that records calls and lets tests control outcomes. */
function makeFakeProvider() {
	const children: FakeChild[] = []
	const provider = {
		children,
		createBackgroundTask: vi.fn().mockImplementation(() => {
			const child = new FakeChild()
			children.push(child)
			return Promise.resolve(child)
		}),
		awaitTaskCompletion: vi
			.fn()
			.mockImplementation((child: FakeChild, options: { signal?: AbortSignal }) => child.await(options)),
	}
	return provider as unknown as {
		children: FakeChild[]
		createBackgroundTask: ReturnType<typeof vi.fn>
		awaitTaskCompletion: ReturnType<typeof vi.fn>
	}
}

/** A stub Task-like object returned by createBackgroundTask. */
class FakeChild {
	taskId = `child-${Math.random().toString(36).slice(2, 8)}`
	abortTask = vi.fn().mockResolvedValue(undefined)
	await(options: { signal?: AbortSignal }): Promise<{
		completed: boolean
		lastMessage?: string
		writtenPaths: string[]
	}> {
		return new Promise((resolve) => {
			let settled = false
			const done = (completed: boolean) => {
				if (settled) return
				settled = true
				resolve({ completed, writtenPaths: [] })
			}
			// If a signal is provided and it aborts, resolve as not-completed.
			if (options.signal) {
				if (options.signal.aborted) {
					done(false)
					return
				}
				options.signal.addEventListener("abort", () => done(false), { once: true })
			}
			// Default: never resolves unless signal fires or child.complete() is called.
			// Tests that want the normal path will call child.complete().
			this._resolveNormal = () => done(true)
		})
	}
	_resolveNormal: (() => void) | null = null
	complete() {
		this._resolveNormal?.()
	}
}

/** A minimal fake parent Task: an EventEmitter with the fields execute() reads. */
function makeFakeParentTask(provider: unknown, overrides: Record<string, unknown> = {}): Task {
	const bus = new EventEmitter() as unknown as Task
	const task = Object.assign(bus, {
		taskId: "parent-12345678",
		cwd: "/home/user/myproj",
		abort: false,
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		providerRef: { deref: () => provider },
	}) as Task
	return Object.assign(task, overrides) as Task
}

function makeCallbacks(overrides: Partial<ToolCallbacks> = {}): ToolCallbacks & {
	pushToolResult: ReturnType<typeof vi.fn>
	askApproval: ReturnType<typeof vi.fn>
	handleError: ReturnType<typeof vi.fn>
} {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		...overrides,
	} as unknown as ToolCallbacks & {
		pushToolResult: ReturnType<typeof vi.fn>
		askApproval: ReturnType<typeof vi.fn>
		handleError: ReturnType<typeof vi.fn>
	}
}

// ---------------------------------------------------------------------------
// Pure helper tests (existing)
// ---------------------------------------------------------------------------

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
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 0 })).toMatchObject({
				maxConcurrency: 3,
			})
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

		it("omits cancelled clause when there are no cancellations", () => {
			const results: ParallelSubtaskResult[] = [
				{ index: 0, mode: "code", status: "completed", message: "ok" },
				{ index: 1, mode: "code", status: "failed", error: "boom" },
			]
			const out = formatParallelResults(results)
			expect(out).toContain("1 completed, 1 failed")
			expect(out).not.toContain("cancelled")
		})

		it("includes cancelled count and per-subtask CANCELLED block", () => {
			const results: ParallelSubtaskResult[] = [
				{ index: 0, mode: "code", status: "completed", message: "ok" },
				{
					index: 1,
					mode: "code",
					status: "cancelled",
					worktreePath: "/wt/b",
					branch: "worktree/parallel-x-2",
				},
			]
			const out = formatParallelResults(results)
			expect(out).toContain("1 completed, 0 failed, 1 cancelled")
			expect(out).toContain("### Subtask 2 — CANCELLED (code mode)")
			expect(out).toContain("Cancelled before completion.")
			expect(out).toContain("worktree: /wt/b")
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

// ---------------------------------------------------------------------------
// execute() integration tests
// ---------------------------------------------------------------------------

describe("RunParallelTasksTool.execute", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCheckGitRepo.mockResolvedValue(true)
		mockCreateWorktree.mockResolvedValue({ success: true, message: "ok" })
	})

	it("pre-aborted parent: starts nothing, no worktree created", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider, { abort: true })
		const callbacks = makeCallbacks()

		await runParallelTasksTool.execute({ subtasks: [{ message: "do thing" }] }, parent, callbacks)

		expect(mockCreateWorktree).not.toHaveBeenCalled()
		expect(provider.createBackgroundTask).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		const result = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(result).toContain("cancelled")
	})

	it("normal path: 2 subtasks complete, report has no cancelled text", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		// Start execute; it will be pending on awaitTaskCompletion.
		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		// Wait for both children to be spawned.
		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children.forEach((c) => c.complete())
		await execPromise

		expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("2 parallel subtask(s)")
		expect(report).toContain("2 completed")
		expect(report).not.toContain("cancelled")
	})

	it("cancel propagation: parent emits TaskAborted mid-run, both subtasks CANCELLED", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		// Wait for both children to be spawned.
		await vi.waitFor(() => expect(provider.children.length).toBe(2))

		// Emit TaskAborted on the parent — this fires the AbortController.
		parent.emit(RooCodeEventName.TaskAborted)

		await execPromise

		expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("CANCELLED")
		// Both subtasks should be cancelled.
		const cancelledMatches = report.match(/CANCELLED/g)
		expect(cancelledMatches).toHaveLength(2)
		expect(report).toContain("2 cancelled")
	})

	it("cleans up the TaskAborted listener after execution", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute({ subtasks: [{ message: "task A" }] }, parent, callbacks)

		await vi.waitFor(() => expect(provider.children.length).toBe(1))
		provider.children[0].complete()
		await execPromise

		// Listener count for TaskAborted should be zero after execution.
		const emitter = parent as unknown as EventEmitter
		expect(emitter.listenerCount(RooCodeEventName.TaskAborted)).toBe(0)
	})
})
