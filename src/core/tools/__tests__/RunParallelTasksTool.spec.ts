import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest"

import { EventEmitter } from "events"
import * as fs from "fs/promises"
import { mkdtempSync, rmSync } from "fs"
import * as path from "path"
import * as os from "os"

// Storage root for every fake provider in this file. Created eagerly so the
// synchronous `makeFakeProvider` helper can carve out a subdirectory per
// provider, and removed once the suite finishes.
const tmpStorageRoot = mkdtempSync(path.join(os.tmpdir(), "rpt-storage-"))
afterAll(() => {
	rmSync(tmpStorageRoot, { recursive: true, force: true })
})

import { TaskStatus, TumbleCodeEventName } from "@tumble-code/types"

// Mock worktreeService before importing the tool. vi.hoisted ensures the
// mock functions are available when the hoisted vi.mock factory runs.
const {
	mockCheckGitRepo,
	mockCreateWorktree,
	mockHasUncommittedChanges,
	mockBranchHasCommits,
	mockDeleteWorktree,
	mockUnlockWorktree,
	mockListWorktrees,
} = vi.hoisted(() => ({
	mockCheckGitRepo: vi.fn().mockResolvedValue(true),
	mockCreateWorktree: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
	mockHasUncommittedChanges: vi.fn().mockResolvedValue(false),
	mockBranchHasCommits: vi.fn().mockResolvedValue(false),
	mockDeleteWorktree: vi.fn().mockResolvedValue({ success: true, message: "removed" }),
	mockUnlockWorktree: vi.fn().mockResolvedValue(true),
	mockListWorktrees: vi.fn().mockResolvedValue([]),
}))
vi.mock("@tumble-code/core", () => ({
	worktreeService: {
		checkGitRepo: mockCheckGitRepo,
		createWorktree: mockCreateWorktree,
		hasUncommittedChanges: mockHasUncommittedChanges,
		branchHasCommits: mockBranchHasCommits,
		deleteWorktree: mockDeleteWorktree,
		unlockWorktree: mockUnlockWorktree,
		listWorktrees: mockListWorktrees,
	},
}))

// `vscode` is pulled in transitively via `subagentSummariesStore` →
// `utils/storage` (`getStorageBasePath` reads vscode.workspace config).
// Mock it so the positive sidecar-write test can use a real temp dir as the
// storage base (empty custom path → default path = globalStoragePath arg).
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(""),
		}),
	},
	window: { showErrorMessage: vi.fn() },
}))

// Mock formatResponse to keep output predictable.
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((text: string) => text),
	},
}))

import {
	validateParallelParams,
	runWithConcurrency,
	describeSubtaskFailure,
	worktreeNamesFor,
	subtaskLockReason,
	subtaskLockOwner,
	sweepOrphanedSubtaskWorktrees,
	runParallelTasksTool,
} from "../RunParallelTasksTool"
import { formatParallelResults, type FinishedSubagent, type ParallelSubtaskResult } from "../helpers/subagentResults"
import { BackgroundSubagents } from "../../webview/BackgroundSubagents"
import { MessageQueueService } from "../../message-queue/MessageQueueService"
import { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"

// ---------------------------------------------------------------------------
// Helpers for execute() tests
// ---------------------------------------------------------------------------

/**
 * A minimal fake provider that records calls and lets tests control outcomes.
 * Now exposes the persistence surface (`atomicReadAndUpdateHistoryItem` +
 * `globalStoragePath`) required by `run_parallel_tasks`' new sidecar/relation
 * persistence. `atomicReadAndUpdateHistoryItem` records every call and
 * mutates an in-memory record so tests can assert what was persisted.
 */
function makeFakeProvider(state: Record<string, unknown> = {}) {
	const children: FakeChild[] = []
	// In-memory HistoryItem store keyed by task id. Tests seed entries for
	// the parent task; `atomicReadAndUpdateHistoryItem` reads + writes here.
	const historyItems = new Map<string, Record<string, unknown>>()
	const atomicReadAndUpdateHistoryItem = vi
		.fn()
		.mockImplementation(async (taskId: string, updater: (c: any) => any) => {
			const current = historyItems.get(taskId) ?? {
				id: taskId,
				number: 1,
				ts: 0,
				task: "parent",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}
			const updated = updater(current)
			historyItems.set(taskId, updated)
			return updated
		})
	const subagentRegistry = {
		beginFanOut: vi.fn(),
		endFanOut: vi.fn(),
		registerQueued: vi.fn(),
		markTerminal: vi.fn(),
		get: vi.fn().mockReturnValue(undefined),
		snapshot: vi.fn().mockReturnValue([]),
	}
	const getLiveTaskInstance = vi.fn().mockReturnValue(undefined)
	const provider = {
		children,
		historyItems,
		createBackgroundTask: vi.fn().mockImplementation(() => {
			const child = new FakeChild()
			children.push(child)
			return Promise.resolve(child)
		}),
		awaitTaskCompletion: vi
			.fn()
			.mockImplementation((child: FakeChild, options: { signal?: AbortSignal }) => child.await(options)),
		getState: vi.fn().mockResolvedValue({
			autoApprovalEnabled: true,
			alwaysAllowExecute: false,
			allowedCommands: [],
			deniedCommands: [],
			...state,
		}),
		subagentRegistry,
		getLiveTaskInstance,
		backgroundSubagents: new BackgroundSubagents({ getLiveTaskInstance }),
		resolveSubagentProfile: vi.fn().mockImplementation(async (mode: string) => ({
			apiConfiguration: { apiProvider: "fake", mode },
			name: `p-${mode}`,
		})),
		atomicReadAndUpdateHistoryItem,
		// A per-provider temp dir, so the best-effort sidecar write that every
		// fan-out performs hits the real fs without polluting the workspace.
		// An empty string here would resolve to a *relative* path and create
		// `src/tasks/<parentTaskId>/subagents.json` in the repo.
		globalStoragePath: mkdtempSync(path.join(tmpStorageRoot, "provider-")),
	}
	return provider as unknown as {
		children: FakeChild[]
		historyItems: Map<string, Record<string, unknown>>
		createBackgroundTask: ReturnType<typeof vi.fn>
		awaitTaskCompletion: ReturnType<typeof vi.fn>
		getState: ReturnType<typeof vi.fn>
		subagentRegistry: {
			beginFanOut: ReturnType<typeof vi.fn>
			endFanOut: ReturnType<typeof vi.fn>
			registerQueued: ReturnType<typeof vi.fn>
			markTerminal: ReturnType<typeof vi.fn>
			snapshot: ReturnType<typeof vi.fn>
		}
		getLiveTaskInstance: ReturnType<typeof vi.fn>
		backgroundSubagents: BackgroundSubagents
		resolveSubagentProfile: ReturnType<typeof vi.fn>
		atomicReadAndUpdateHistoryItem: ReturnType<typeof vi.fn>
		globalStoragePath: string
	}
}

type FakeProvider = ReturnType<typeof makeFakeProvider>

/** Resolves once every subagent of the fan-out ended and its sidecar was written. */
async function settled(provider: FakeProvider, fanOuts = 1): Promise<void> {
	await vi.waitFor(() => expect(provider.subagentRegistry.endFanOut).toHaveBeenCalledTimes(fanOuts))
}

/**
 * Everything the parent model got about the fan-out: the tool result, then
 * the results still unread after the fan-out settled (the next
 * wait_for_subagents would return them).
 */
function modelSaw(provider: FakeProvider, callbacks: { pushToolResult: ReturnType<typeof vi.fn> }): string {
	const first = String(callbacks.pushToolResult.mock.calls[0][0])
	const rest = provider.backgroundSubagents.takeUnread("parent-12345678")
	return rest.length > 0 ? `${first}\n${formatParallelResults(rest)}` : first
}

function count(text: string, pattern: RegExp): number {
	return (text.match(pattern) ?? []).length
}

/** A stub Task-like object returned by createBackgroundTask. */
class FakeChild {
	taskId = `child-${Math.random().toString(36).slice(2, 8)}`
	clineMessages: Array<{ ts: number; type: string; say?: string; text?: string }> = []
	abortTask = vi.fn().mockResolvedValue(undefined)
	await(options: { signal?: AbortSignal }): Promise<{
		completed: boolean
		lastMessage?: string
		writtenPaths: string[]
		abortReason?: string
		failureMessage?: string
	}> {
		return new Promise((resolve) => {
			let settled = false
			const done = (completed: boolean, failure?: { abortReason: string; failureMessage: string }) => {
				if (settled) return
				settled = true
				resolve({ completed, writtenPaths: [], ...failure })
			}
			this._fail = (failureMessage: string) => done(false, { abortReason: "streaming_failed", failureMessage })
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
	_fail: ((failureMessage: string) => void) | null = null
	complete() {
		this._resolveNormal?.()
	}
	/** End the child the way a 401/403/404 fail-fast does (TaskApiLoop). */
	failWithApiError(failureMessage: string) {
		this._fail?.(failureMessage)
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
		messageQueueService: new MessageQueueService(),
		say: vi.fn().mockResolvedValue(undefined),
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

		// One subtask is how a follow-up starts after a result, while the
		// other subagents keep running.
		it("accepts a single subtask", () => {
			expect(validateParallelParams({ subtasks: [{ message: "just one job" }] })).toEqual({
				ok: true,
				subtasks: [{ message: "just one job", mode: "code" }],
				maxConcurrency: 1,
			})
		})

		it("rejects a subtask without a message", () => {
			const r = validateParallelParams({ subtasks: [{ message: "  " } as never, { message: "ok" }] })
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

		it("rejects architect/orchestrator subtask modes with a corrective error", () => {
			for (const mode of ["architect", "orchestrator"]) {
				const r = validateParallelParams({
					subtasks: [{ message: "plan the system", mode }, { message: "ok" }],
				})
				expect(r.ok).toBe(false)
				if (!r.ok) {
					expect(r.error).toContain(`"${mode}"`)
					expect(r.error).toContain("do the")
				}
			}
			// Lightweight modes stay allowed.
			expect(
				validateParallelParams({
					subtasks: [
						{ message: "q", mode: "ask" },
						{ message: "r", mode: "ask" },
					],
				}).ok,
			).toBe(true)
		})

		it("clamps the requested concurrency to the user's configured cap", () => {
			const many = Array.from({ length: 10 }, (_, i) => ({ message: `m${i}` }))
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 8 }, 2)).toMatchObject({
				maxConcurrency: 2,
			})
			// The model may lower concurrency below the cap, but never under 2
			// (a sequential "parallel" run is nonsense; invalid means the cap).
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 2 }, 4)).toMatchObject({
				maxConcurrency: 2,
			})
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 1 }, 4)).toMatchObject({
				maxConcurrency: 4,
			})
			// No value means the user's cap, also above the built-in default of 3.
			expect(validateParallelParams({ subtasks: many }, 8)).toMatchObject({ maxConcurrency: 8 })
			// Default request under a cap tighter than the built-in default.
			expect(validateParallelParams({ subtasks: many }, 2)).toMatchObject({ maxConcurrency: 2 })
			// A nonsensical cap falls back to the built-in default.
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 8 }, 0)).toMatchObject({
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
		const asFinished = (results: ParallelSubtaskResult[]): FinishedSubagent[] =>
			results.map((result) => ({
				number: result.index + 1,
				description: `job ${result.index + 1}`,
				mode: result.mode,
				result,
			}))

		it("names each subagent's task", () => {
			const out = formatParallelResults(
				asFinished([{ index: 0, mode: "ask", status: "completed", message: "x" }]),
			)
			expect(out).toContain("1 subagent(s) finished")
			expect(out).toContain("- task: job 1")
		})

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
			const out = formatParallelResults(asFinished(results))
			expect(out).toContain("1 completed, 1 failed")
			expect(out).toContain("### Subagent #1: COMPLETED (code mode)")
			expect(out).toContain("did the thing")
			expect(out).toContain("### Subagent #2: FAILED (debug mode)")
			expect(out).toContain("Failed: boom")
		})

		it("omits cancelled clause when there are no cancellations", () => {
			const results: ParallelSubtaskResult[] = [
				{ index: 0, mode: "code", status: "completed", message: "ok" },
				{ index: 1, mode: "code", status: "failed", error: "boom" },
			]
			const out = formatParallelResults(asFinished(results))
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
			const out = formatParallelResults(asFinished(results))
			expect(out).toContain("1 completed, 0 failed, 1 cancelled")
			expect(out).toContain("### Subagent #2: CANCELLED (code mode)")
			expect(out).toContain("Cancelled before completion.")
			expect(out).toContain("worktree: /wt/b")
		})

		it("shows a failed subtask's last message, so the parent sees how far it got", () => {
			const results: ParallelSubtaskResult[] = [
				{ index: 0, mode: "code", status: "failed", error: "Stopped as stuck", message: "Solver done." },
				{ index: 1, mode: "code", status: "failed", error: "boom" },
			]
			const out = formatParallelResults(asFinished(results))
			expect(out).toContain("Its last message before it stopped:\n\nSolver done.")
			expect(out.match(/Its last message/g)).toHaveLength(1)
		})

		it("shows 'cleaned up (no changes)' for cleaned subtasks", () => {
			const results: ParallelSubtaskResult[] = [
				{
					index: 0,
					mode: "code",
					status: "completed",
					worktreePath: "/wt/a",
					branch: "worktree/parallel-x-1",
					message: "done",
					cleaned: true,
				},
			]
			const out = formatParallelResults(asFinished(results))
			expect(out).toContain("cleaned up (no changes)")
			expect(out).not.toContain("/wt/a")
		})
	})

	describe("describeSubtaskFailure", () => {
		it("a stuck subagent: says what it kept doing and points at its worktree", () => {
			const text = describeSubtaskFailure({
				abortReason: "stuck",
				failureMessage: "It kept calling read_file with the same arguments.",
			})
			expect(text).toMatch(/^Stopped as stuck: It kept calling read_file/)
			expect(text).toContain("worktree")
			expect(text).not.toContain("Retrying will not help")
		})

		it("an API failure: tells the parent that retrying will not help", () => {
			const text = describeSubtaskFailure({ abortReason: "streaming_failed", failureMessage: "API error 401." })
			expect(text).toMatch(/^API error 401\. Retrying will not help/)
		})

		it("no recorded reason: never the bare 'aborted before completion'", () => {
			const text = describeSubtaskFailure({})
			expect(text).not.toContain("aborted before completion")
			expect(text).toContain("worktree")
		})
	})

	describe("worktreeNamesFor", () => {
		it("derives worktree path + branch from parent id, run id and index", () => {
			const a = worktreeNamesFor("/home/u/myproj", "abcdef1234567890", "run1", 0)
			expect(a.branch).toBe("worktree/parallel-abcdef12-run1-1")
			expect(a.worktreePath).toContain("myproj-abcdef12-run1-1")
		})

		it("a second run of the same parent gets different names", () => {
			const first = worktreeNamesFor("/home/u/myproj", "abcdef1234567890", "run1", 0)
			const retry = worktreeNamesFor("/home/u/myproj", "abcdef1234567890", "run2", 0)
			expect(retry.branch).not.toBe(first.branch)
			expect(retry.worktreePath).not.toBe(first.worktreePath)
		})
	})

	describe("subtask worktree lock", () => {
		it("round-trips the owning pid", () => {
			expect(subtaskLockOwner(subtaskLockReason(4242))).toBe(4242)
		})

		it("ignores locks that are not ours", () => {
			expect(subtaskLockOwner(undefined)).toBeUndefined()
			expect(subtaskLockOwner("on a USB stick")).toBeUndefined()
			expect(subtaskLockOwner(subtaskLockReason(4242).replace("4242", "x"))).toBeUndefined()
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
		mockHasUncommittedChanges.mockResolvedValue(false)
		mockBranchHasCommits.mockResolvedValue(false)
		mockDeleteWorktree.mockResolvedValue({ success: true, message: "removed" })
		mockUnlockWorktree.mockResolvedValue(true)
		mockListWorktrees.mockResolvedValue([])
	})

	it("cap below 2 (feature Off): refused before validation/approval", async () => {
		const provider = makeFakeProvider({ parallelTasksMaxConcurrency: 1 })
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		await runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(provider.createBackgroundTask).not.toHaveBeenCalled()
		const result = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(result).toContain("disabled")
		expect(result).toContain("new_task")
	})

	it("background caller (subtask): refused — no nested fan-outs", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider, { isBackground: true, recordToolError: vi.fn() })
		const callbacks = makeCallbacks()

		await runParallelTasksTool.execute(
			{ subtasks: [{ message: "nested" }, { message: "nested 2" }] },
			parent,
			callbacks,
		)

		expect(mockCreateWorktree).not.toHaveBeenCalled()
		expect(provider.createBackgroundTask).not.toHaveBeenCalled()
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		const result = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(result).toContain("not available inside a parallel subtask")
	})

	it("pre-aborted parent: starts nothing, no worktree created", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider, { abort: true })
		const callbacks = makeCallbacks()

		await runParallelTasksTool.execute(
			{ subtasks: [{ message: "do thing" }, { message: "other thing" }] },
			parent,
			callbacks,
		)

		expect(mockCreateWorktree).not.toHaveBeenCalled()
		expect(provider.createBackgroundTask).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		const result = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(result).toContain("cancelled")
	})

	it("returns on the first result: the rest keeps running and is collected later", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children[0].complete()
		await execPromise

		expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("Started 2 subagent(s) in the background: #1, #2.")
		expect(report).toContain("### Subagent #1: COMPLETED (code mode)")
		expect(report).toContain("Still running (1):")
		expect(report).toContain("- #2 task B (code mode)")
		expect(report).toContain("call wait_for_subagents")
		expect(report).not.toContain("cancelled")
		expect(provider.backgroundSubagents.running("parent-12345678")).toHaveLength(1)

		provider.children[1].complete()
		await settled(provider)
		const later = provider.backgroundSubagents.takeUnread("parent-12345678")
		expect(later.map((f) => [f.number, f.result.status])).toEqual([[2, "completed"]])
	})

	it("accepts a single subtask (a follow-up started after a result)", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute({ subtasks: [{ message: "follow-up" }] }, parent, callbacks)
		await vi.waitFor(() => expect(provider.children.length).toBe(1))
		provider.children[0].complete()
		await execPromise

		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("Started 1 subagent(s)")
		expect(report).toContain("Every subagent has reported")
	})

	it("a second fan-out of the same parent numbers its subagents after the first one's", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const first = makeCallbacks()
		const firstRun = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			first,
		)
		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children[0].complete()
		await firstRun

		const second = makeCallbacks()
		const secondRun = runParallelTasksTool.execute({ subtasks: [{ message: "task C" }] }, parent, second)
		await vi.waitFor(() => expect(provider.children.length).toBe(3))
		provider.children[2].complete()
		await secondRun

		const report = second.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("Started 1 subagent(s) in the background: #3.")
		expect(report).toContain("### Subagent #3: COMPLETED")
		expect(report).toContain("- #2 task B (code mode)")

		provider.children[1].complete()
		await settled(provider, 2)
	})

	// The slot pool is per provider: two fan-outs share the user's cap
	// instead of each getting all of it.
	it("caps the subagents running at once across two fan-outs", async () => {
		const provider = makeFakeProvider({ parallelTasksMaxConcurrency: 2 })
		const parentA = makeFakeParentTask(provider)
		const parentB = makeFakeParentTask(provider, { taskId: "parent-bbbbbbbb" })

		const runA = runParallelTasksTool.execute(
			{ subtasks: [{ message: "a1" }, { message: "a2" }] },
			parentA,
			makeCallbacks(),
		)
		const runB = runParallelTasksTool.execute(
			{ subtasks: [{ message: "b1" }, { message: "b2" }] },
			parentB,
			makeCallbacks(),
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(provider.children.length).toBe(2)
		expect(provider.backgroundSubagents.slots.waiting).toBe(2)

		provider.children[0].complete()
		await vi.waitFor(() => expect(provider.children.length).toBe(3))
		provider.children.slice(1).forEach((c) => c.complete())
		await vi.waitFor(() => expect(provider.children.length).toBe(4))
		provider.children[3].complete()
		await Promise.all([runA, runB])
		await settled(provider, 2)
		expect(provider.backgroundSubagents.slots.running).toBe(0)
	})

	it("resolves the subagent's profile before it takes a slot and runs it on that profile", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "q", mode: "ask" }] },
			parent,
			makeCallbacks(),
		)
		await vi.waitFor(() => expect(provider.children.length).toBe(1))
		provider.children[0].complete()
		await execPromise

		expect(provider.resolveSubagentProfile).toHaveBeenCalledWith("ask")
		expect(provider.createBackgroundTask.mock.calls[0][1]).toMatchObject({
			apiConfiguration: { apiProvider: "fake", mode: "ask" },
			apiConfigName: "p-ask",
		})
	})

	describe("maxConcurrentRequests of the subagent's profile", () => {
		const profileWithLimit = (limit: number) => async (mode: string) => ({
			apiConfiguration: { apiProvider: "fake", mode, maxConcurrentRequests: limit },
			name: "shared",
		})

		it("runs no more subagents on a profile than its limit allows", async () => {
			const provider = makeFakeProvider({ parallelTasksMaxConcurrency: 8, currentApiConfigName: "main" })
			provider.resolveSubagentProfile.mockImplementation(profileWithLimit(2))
			const parent = makeFakeParentTask(provider)
			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "a" }, { message: "b" }, { message: "c" }], maxConcurrency: 8 },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(provider.children.length).toBe(2)

			provider.children[0].complete()
			await execPromise
			await vi.waitFor(() => expect(provider.children.length).toBe(3))
			provider.children[1].complete()
			provider.children[2].complete()
			await settled(provider)
		})

		it("counts the parent when it runs on the same profile", async () => {
			const provider = makeFakeProvider({ parallelTasksMaxConcurrency: 8 })
			provider.resolveSubagentProfile.mockImplementation(profileWithLimit(2))
			const parent = makeFakeParentTask(provider, { taskApiConfigName: "shared" })
			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "a" }, { message: "b" }], maxConcurrency: 8 },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(1))
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(provider.children.length).toBe(1)

			provider.children[0].complete()
			await execPromise
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children[1].complete()
			await settled(provider)
		})

		it("refuses before approval when the profile leaves no slot for subagents", async () => {
			const provider = makeFakeProvider()
			provider.resolveSubagentProfile.mockImplementation(profileWithLimit(1))
			const parent = makeFakeParentTask(provider, { taskApiConfigName: "shared" })
			const callbacks = makeCallbacks()

			await runParallelTasksTool.execute({ subtasks: [{ message: "a" }] }, parent, callbacks)

			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(provider.createBackgroundTask).not.toHaveBeenCalled()
			const result = String(callbacks.pushToolResult.mock.calls[0][0])
			expect(result).toContain('API profile "shared" allows 1 request(s) at once')
			expect(result).toContain("Do this work directly in this task")
		})
	})

	it("a user message ends the wait: the subagents keep running", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)
		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		parent.messageQueueService.addMessage("how is it going?")
		await execPromise

		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("<user_message>\nhow is it going?\n</user_message>")
		expect(report).toContain("2 subagent(s) keep running")
		expect(parent.say).toHaveBeenCalledWith("user_feedback", "how is it going?", undefined)
		provider.children.forEach((c) => expect(c.abortTask).not.toHaveBeenCalled())

		provider.children.forEach((c) => c.complete())
		await settled(provider)
		expect(provider.backgroundSubagents.unreadCount("parent-12345678")).toBe(2)
	})

	it("a subtask that failed fast on an API error reports that error to the parent", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()
		const failure =
			'API error 401 (invalid or missing API key) from provider "openai", model "gpt-x". Provider message: Incorrect API key provided.'

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)
		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children[0].failWithApiError(failure)
		await execPromise
		provider.children[1].complete()
		await settled(provider)

		const report = modelSaw(provider, callbacks)
		expect(report).toContain("0 completed, 1 failed")
		expect(report).toContain(`Failed: ${failure}`)
		expect(report).toContain("Retrying will not help")
		expect(report).not.toContain("subtask aborted before completion")
		expect(count(report, /: COMPLETED/g)).toBe(1)
		expect(provider.subagentRegistry.markTerminal).toHaveBeenCalledWith(
			provider.children[0].taskId,
			"failed",
			expect.stringContaining(failure),
		)
	})

	it("cancel propagation: a user cancel of the parent cancels every subtask, no results are kept", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))

		// An explicit user cancel: abortReason is set before the abort event
		// (matching ClineProvider.cancelTask) - this fires the AbortController.
		;(parent as any).abort = true
		;(parent as any).abortReason = "user_cancelled"
		parent.emit(TumbleCodeEventName.TaskAborted)

		await execPromise
		await settled(provider)

		expect(callbacks.pushToolResult.mock.calls[0][0]).toContain("this task was stopped")
		for (const child of provider.children) {
			expect(provider.subagentRegistry.markTerminal).toHaveBeenCalledWith(child.taskId, "cancelled")
		}
		expect(provider.backgroundSubagents.hasWork("parent-12345678")).toBe(false)
	})

	it("abandonment abort (no user_cancelled) DETACHES: children keep running and finish", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))

		// Abandonment (task switch / in-place rehydrate): TaskAborted fires
		// WITHOUT abortReason = "user_cancelled" - the fan-out must survive.
		;(parent as any).abort = true
		;(parent as any).abandoned = true
		parent.emit(TumbleCodeEventName.TaskAborted)
		await execPromise
		provider.children.forEach((c) => expect(c.abortTask).not.toHaveBeenCalled())

		provider.children.forEach((c) => c.complete())
		await settled(provider)

		const unread = provider.backgroundSubagents.takeUnread("parent-12345678")
		expect(unread.map((f) => f.result.status)).toEqual(["completed", "completed"])
	})

	it("a detached fan-out queues its results into the live parent instance waiting at resume", async () => {
		const provider = makeFakeProvider()
		const addMessage = vi.fn()
		provider.getLiveTaskInstance.mockReturnValue({
			abort: false,
			taskStatus: TaskStatus.Resumable,
			messageQueueService: { addMessage },
		})
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		// Parent abandoned mid-run (rehydrated elsewhere).
		;(parent as any).abort = true
		;(parent as any).abandoned = true
		parent.emit(TumbleCodeEventName.TaskAborted)
		await execPromise
		provider.children.forEach((c) => c.complete())
		await settled(provider)

		expect(provider.getLiveTaskInstance).toHaveBeenCalledWith("parent-12345678")
		const queued = addMessage.mock.calls.map(([text]) => text as string).join("\n")
		expect(queued).toContain("arrived while this task was waiting")
		expect(count(queued, /: COMPLETED/g)).toBe(2)
		expect(provider.backgroundSubagents.unreadCount("parent-12345678")).toBe(0)
	})

	it("results stay unread while the live parent instance is busy", async () => {
		const provider = makeFakeProvider()
		const addMessage = vi.fn()
		provider.getLiveTaskInstance.mockReturnValue({
			abort: false,
			taskStatus: TaskStatus.Running,
			messageQueueService: { addMessage },
		})
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)
		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children[0].complete()
		await execPromise
		provider.children[1].complete()
		await settled(provider)

		expect(addMessage).not.toHaveBeenCalled()
		expect(provider.backgroundSubagents.unreadCount("parent-12345678")).toBe(1)
	})

	it("user-cancelled fan-out does NOT queue a report into the rehydrated instance", async () => {
		const provider = makeFakeProvider()
		const addMessage = vi.fn()
		provider.getLiveTaskInstance.mockReturnValue({
			abort: false,
			taskStatus: TaskStatus.Resumable,
			messageQueueService: { addMessage },
		})
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		;(parent as any).abort = true
		;(parent as any).abortReason = "user_cancelled"
		parent.emit(TumbleCodeEventName.TaskAborted)
		await execPromise
		await settled(provider)

		// Cancelled on purpose: no auto-resume injection.
		expect(addMessage).not.toHaveBeenCalled()
	})

	it("cleans up the TaskAborted listener once every subagent ended", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children[0].complete()
		await execPromise
		const emitter = parent as unknown as EventEmitter
		// The fan-out still runs: a user cancel must still reach it.
		expect(emitter.listenerCount(TumbleCodeEventName.TaskAborted)).toBe(1)

		provider.children[1].complete()
		await settled(provider)
		expect(emitter.listenerCount(TumbleCodeEventName.TaskAborted)).toBe(0)
	})

	// The subagent's history item sits under the fan-out parent in the parent's
	// workspace (the history list filters by workspace; the worktree would hide it).
	it.each([
		["a top-level parent", undefined, "parent-12345678"],
		["a delegated parent", "root-1", "root-1"],
	])("passes the history placement of each subagent for %s", async (_label, rootTaskId, expectedRoot) => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider, { rootTaskId })
		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			makeCallbacks(),
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children.forEach((c) => c.complete())
		await execPromise
		await settled(provider)

		const opts = provider.createBackgroundTask.mock.calls[0][1] as {
			workspacePath: string
			subagentInfo: Record<string, unknown>
		}
		expect(opts.subagentInfo).toMatchObject({
			parentTaskId: "parent-12345678",
			rootTaskId: expectedRoot,
			workspace: "/home/user/myproj",
			index: 0,
		})
		expect(opts.workspacePath).not.toBe("/home/user/myproj")
	})

	it("passes a real approval policy (not blanket approve) to createBackgroundTask", async () => {
		// State: no commands auto-approved, so a command ask should be denied.
		const provider = makeFakeProvider({ autoApprovalEnabled: true, alwaysAllowExecute: false })
		const parent = makeFakeParentTask(provider)
		const callbacks = makeCallbacks()

		const execPromise = runParallelTasksTool.execute(
			{ subtasks: [{ message: "task A" }, { message: "task B" }] },
			parent,
			callbacks,
		)

		await vi.waitFor(() => expect(provider.children.length).toBe(2))
		provider.children.forEach((c) => c.complete())
		await execPromise
		await settled(provider)

		expect(provider.createBackgroundTask).toHaveBeenCalledTimes(2)
		const opts = provider.createBackgroundTask.mock.calls[0][1] as {
			autoApprovalOverride?: (ask: string, text?: string, isProtected?: boolean) => Promise<string>
		}
		expect(typeof opts.autoApprovalOverride).toBe("function")

		// Read-only tool ask → approve (policy recognises reads as safe).
		const readOnlyTool = JSON.stringify({ tool: "readFile", path: "/anywhere" })
		expect(await opts.autoApprovalOverride!("tool", readOnlyTool, false)).toBe("approve")

		// Command ask with no allowed commands → undefined (delegates to
		// checkAutoApproval which returns "ask" when alwaysAllowExecute is
		// false; the ask then surfaces interactively in the subagents panel,
		// bounded by the TaskAskSay fallback which denies it unanswered).
		expect(await opts.autoApprovalOverride!("command", "rm -rf /tmp", false)).toBeUndefined()
	})

	// ---------------------------------------------------------------------------
	// parallelChildIds + subagents.json sidecar persistence
	// ---------------------------------------------------------------------------

	describe("parallel-subagent persistence", () => {
		it("records each child's taskId in the parent HistoryItem.parallelChildIds", async () => {
			const provider = makeFakeProvider()
			// Seed a parent HistoryItem so atomicReadAndUpdate has a record
			// to read; the fake provider auto-creates one if absent, but
			// seeding lets us assert the field was added, not created fresh.
			provider.historyItems.set("parent-12345678", {
				id: "parent-12345678",
				number: 1,
				ts: 0,
				task: "parent",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			// Each child is spawned; the persistence call happens right
			// after createBackgroundTask, so by the time both children exist
			// both parallelChildIds writes should have fired.
			await vi.waitFor(() => expect(provider.atomicReadAndUpdateHistoryItem).toHaveBeenCalledTimes(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			const parentItem = provider.historyItems.get("parent-12345678") as Record<string, unknown>
			expect(parentItem.parallelChildIds).toBeDefined()
			const recorded = parentItem.parallelChildIds as string[]
			expect(recorded).toHaveLength(2)
			// Order: the first child spawned is recorded first. Both child
			// ids must be present (deduped).
			expect(recorded).toEqual(expect.arrayContaining([provider.children[0].taskId, provider.children[1].taskId]))
		})

		it("dedupes parallelChildIds (no duplicates even if the updater is called twice for the same id)", async () => {
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			// Two distinct children → two distinct ids, no duplicates.
			const parentItem = provider.historyItems.get("parent-12345678") as Record<string, unknown>
			const recorded = parentItem.parallelChildIds as string[]
			expect(recorded).toHaveLength(2)
			expect(new Set(recorded).size).toBe(2)

			// The updater itself uses Array.from(new Set(...)), so even a
			// pre-existing duplicate in the record is collapsed.
			const calls = provider.atomicReadAndUpdateHistoryItem.mock.calls as Array<[string, (c: any) => any]>
			const [, updater] = calls[0]
			const withDup = {
				id: "parent-12345678",
				number: 1,
				ts: 0,
				task: "p",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				parallelChildIds: ["dup", "dup"],
			} as any
			const after = updater(withDup)
			expect((after.parallelChildIds as string[]).filter((x) => x === "dup")).toHaveLength(1)
		})

		it("does NOT set status: delegated / awaitingChildId on the parent (parallel, not foreground delegation)", async () => {
			const provider = makeFakeProvider()
			provider.historyItems.set("parent-12345678", {
				id: "parent-12345678",
				number: 1,
				ts: 0,
				task: "parent",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "active",
			})
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			const parentItem = provider.historyItems.get("parent-12345678") as Record<string, unknown>
			expect(parentItem.status).toBe("active")
			expect(parentItem.awaitingChildId).toBeUndefined()
			expect(parentItem.delegatedToId).toBeUndefined()
		})

		it("writes the subagents.json sidecar as subagents end, keeping earlier runs", async () => {
			const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-sidecar-"))
			const provider = makeFakeProvider()
			provider.globalStoragePath = tmpRoot
			const sidecarDir = path.join(tmpRoot, "tasks", "parent-12345678")
			await fs.mkdir(sidecarDir, { recursive: true })
			await fs.writeFile(
				path.join(sidecarDir, "subagents.json"),
				JSON.stringify([{ taskId: "child-old", parentTaskId: "parent-12345678", runId: "r0", index: 0 }]),
			)
			provider.subagentRegistry.snapshot.mockReturnValue([
				{
					taskId: "child-x",
					parentTaskId: "parent-12345678",
					index: 0,
					mode: "code",
					description: "task A",
					status: "completed",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
					startedAt: 1,
					lastActivityAt: 2,
				},
			])
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			// The sidecar is written at <tmpRoot>/tasks/<parentTaskId>/subagents.json
			const sidecarPath = path.join(tmpRoot, "tasks", "parent-12345678", "subagents.json")
			const exists = await fs
				.access(sidecarPath)
				.then(() => true)
				.catch(() => false)
			expect(exists).toBe(true)
			const raw = await fs.readFile(sidecarPath, "utf8")
			const parsed = JSON.parse(raw)
			expect(parsed.map((row: { taskId: string }) => row.taskId)).toEqual(["child-old", "child-x"])
			expect(provider.subagentRegistry.snapshot).toHaveBeenCalledWith("parent-12345678")
		})

		it("gives every placeholder and child of one call the same run id", async () => {
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			const queuedRuns = provider.subagentRegistry.registerQueued.mock.calls.map(([row]) => row.runId)
			const childRuns = provider.createBackgroundTask.mock.calls.map(([, opts]) => opts.subagentInfo.runId)
			expect(queuedRuns[0]).toEqual(expect.any(String))
			expect(new Set([...queuedRuns, ...childRuns])).toEqual(new Set([queuedRuns[0]]))
		})

		// The registry keeps an in-progress fan-out's rows across task switches;
		// it must learn when the fan-out is over, after the sidecar is written.
		it("ends the fan-out in the registry after the sidecar is written", async () => {
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			expect(provider.subagentRegistry.endFanOut).not.toHaveBeenCalled()
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			expect(provider.subagentRegistry.endFanOut).toHaveBeenCalledWith("parent-12345678")
			expect(provider.subagentRegistry.endFanOut.mock.invocationCallOrder[0]).toBeGreaterThan(
				provider.subagentRegistry.snapshot.mock.invocationCallOrder[0],
			)
		})

		// A finished child keeps its own task directory (its history item
		// points at it), so the panel reads its messages there; the old copy
		// under the parent is no longer written.
		it("does not copy finished children's messages under the parent", async () => {
			const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-transcript-"))
			const provider = makeFakeProvider()
			provider.globalStoragePath = tmpRoot
			const parent = makeFakeParentTask(provider)

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			const [first, second] = provider.children
			first.clineMessages = [{ ts: 1, type: "say", say: "text", text: "did A" }]
			first.complete()
			second.failWithApiError("model gone")
			await execPromise
			await settled(provider)

			const legacyDir = path.join(tmpRoot, "tasks", "parent-12345678", "subagents")
			await expect(fs.access(legacyDir)).rejects.toThrow()
		})

		it("survives a sidecar write failure (best-effort, does not throw)", async () => {
			// Make globalStoragePath point at a FILE, not a directory, so
			// `getTaskDirectoryPath`'s `mkdir(<file>/tasks/<id>)` fails with
			// ENOTDIR. This deterministically exercises the best-effort error
			// handling in `persistSubagentSummariesSidecar` without invoking
			// real cross-process lock-file paths (which would hang on
			// unwritable dirs like /proc).
			const blocker = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-block-"))
			const blockerFile = path.join(blocker, "i-am-a-file")
			await fs.writeFile(blockerFile, "", "utf8")
			const provider = makeFakeProvider()
			provider.globalStoragePath = blockerFile
			provider.subagentRegistry.snapshot.mockReturnValue([])
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			// The sidecar write failed (ENOTDIR), but the tool still
			// completes normally and pushes its report.
			expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
			expect(count(modelSaw(provider, callbacks), /: COMPLETED/g)).toBe(2)
		})

		it("survives an atomicReadAndUpdateHistoryItem failure (best-effort)", async () => {
			const provider = makeFakeProvider()
			provider.atomicReadAndUpdateHistoryItem.mockRejectedValue(new Error("store down"))
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			// The fan-out completes despite the persistence failure; only
			// historical rehydration of this run would be affected.
			expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
		})
	})

	// ---------------------------------------------------------------------------
	// Worktree cleanup tests
	// ---------------------------------------------------------------------------

	describe("worktree cleanup", () => {
		it("completed subtask with no changes and no commits → cleaned up", async () => {
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			expect(mockHasUncommittedChanges).toHaveBeenCalled()
			expect(mockBranchHasCommits).toHaveBeenCalled()
			expect(mockDeleteWorktree).toHaveBeenCalledWith(
				"/home/user/myproj",
				expect.stringMatching(/myproj-parent-1-\w+-1$/),
			)
			const report = modelSaw(provider, callbacks)
			expect(report).toContain("cleaned up (no changes)")
			expect(count(report, /: COMPLETED/g)).toBe(2)
		})

		it("completed subtask WITH commits → worktree kept", async () => {
			mockBranchHasCommits.mockResolvedValue(true)
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			expect(mockDeleteWorktree).not.toHaveBeenCalled()
			const report = modelSaw(provider, callbacks)
			expect(report).not.toContain("cleaned up")
			expect(report).toContain("worktree:")
		})

		it("failed subtask with uncommitted changes → NOT deleted", async () => {
			mockHasUncommittedChanges.mockResolvedValue(true)
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			// Don't call complete() — child will resolve as not-completed when signal fires.
			// Instead, user-cancel the parent to make the child resolve.
			;(parent as any).abort = true
			;(parent as any).abortReason = "user_cancelled"
			parent.emit(TumbleCodeEventName.TaskAborted)
			await execPromise
			await settled(provider)

			expect(mockDeleteWorktree).not.toHaveBeenCalled()
		})

		it("failed subtask clean + commitless → deleted", async () => {
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			;(parent as any).abort = true
			;(parent as any).abortReason = "user_cancelled"
			parent.emit(TumbleCodeEventName.TaskAborted)
			await execPromise
			await settled(provider)

			expect(mockDeleteWorktree).toHaveBeenCalledTimes(2)
		})

		it("deleteWorktree returning success:false → cleaned falsy, no throw", async () => {
			mockDeleteWorktree.mockResolvedValue({ success: false, message: "busy" })
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			// Should not throw, status still completed.
			const report = modelSaw(provider, callbacks)
			expect(count(report, /: COMPLETED/g)).toBe(2)
			expect(report).not.toContain("cleaned up")
			expect(report).toContain("worktree:")
		})

		it("creates each worktree locked by this process and unlocks it when the subtask ends", async () => {
			mockBranchHasCommits.mockResolvedValue(true)
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const callbacks = makeCallbacks()

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				callbacks,
			)

			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			for (const [, options] of mockCreateWorktree.mock.calls) {
				expect(options.lockReason).toBe(subtaskLockReason(process.pid))
			}
			const created = mockCreateWorktree.mock.calls.map(([, options]) => options.path)
			const unlocked = mockUnlockWorktree.mock.calls.map(([, worktreePath]) => worktreePath)
			expect(unlocked.sort()).toEqual(created.sort())
		})

		it("a retry by the same parent never reuses the first run's branches", async () => {
			mockBranchHasCommits.mockResolvedValue(true)
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)
			const runOnce = async (run: number) => {
				const before = provider.children.length
				const execPromise = runParallelTasksTool.execute(
					{ subtasks: [{ message: "task A" }, { message: "task B" }] },
					parent,
					makeCallbacks(),
				)
				await vi.waitFor(() => expect(provider.children.length).toBe(before + 2))
				provider.children.slice(before).forEach((c) => c.complete())
				await execPromise
				await settled(provider, run)
			}

			await runOnce(1)
			// Run ids are millisecond timestamps: make sure the clock moved.
			await new Promise((resolve) => setTimeout(resolve, 2))
			await runOnce(2)

			const branches = mockCreateWorktree.mock.calls.map(([, options]) => options.branch)
			expect(branches).toHaveLength(4)
			expect(new Set(branches).size).toBe(4)
		})
	})

	describe("orphaned worktree sweep", () => {
		const DEAD_PID = 999_999
		let killSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
				if (pid === DEAD_PID) throw Object.assign(new Error("no such process"), { code: "ESRCH" })
				return true
			}) as typeof process.kill)
		})

		afterEach(() => {
			killSpy.mockRestore()
		})

		const worktree = (name: string, lockReason?: string) => ({
			path: `/home/user/.roo/worktrees/${name}`,
			branch: `worktree/parallel-${name}`,
			commitHash: "abc",
			isCurrent: false,
			isBare: false,
			isDetached: false,
			isLocked: lockReason !== undefined,
			lockReason,
		})

		it("removes a clean worktree whose owning process is gone", async () => {
			mockListWorktrees.mockResolvedValue([worktree("orphan", subtaskLockReason(DEAD_PID))])

			await sweepOrphanedSubtaskWorktrees("/home/user/myproj")

			expect(mockUnlockWorktree).toHaveBeenCalledWith("/home/user/myproj", "/home/user/.roo/worktrees/orphan")
			expect(mockDeleteWorktree).toHaveBeenCalledWith("/home/user/myproj", "/home/user/.roo/worktrees/orphan")
		})

		it("unlocks but keeps an orphan with changes", async () => {
			mockHasUncommittedChanges.mockResolvedValue(true)
			mockListWorktrees.mockResolvedValue([worktree("orphan", subtaskLockReason(DEAD_PID))])

			await sweepOrphanedSubtaskWorktrees("/home/user/myproj")

			expect(mockUnlockWorktree).toHaveBeenCalledTimes(1)
			expect(mockDeleteWorktree).not.toHaveBeenCalled()
		})

		it("leaves running, unlocked and foreign-locked worktrees alone", async () => {
			mockListWorktrees.mockResolvedValue([
				worktree("running", subtaskLockReason(process.pid)),
				worktree("kept-for-review"),
				worktree("user-lock", "on a USB stick"),
			])

			await sweepOrphanedSubtaskWorktrees("/home/user/myproj")

			expect(mockUnlockWorktree).not.toHaveBeenCalled()
			expect(mockDeleteWorktree).not.toHaveBeenCalled()
		})

		it("runs before a fan-out creates its worktrees", async () => {
			mockListWorktrees.mockResolvedValue([worktree("orphan", subtaskLockReason(DEAD_PID))])
			const provider = makeFakeProvider()
			const parent = makeFakeParentTask(provider)

			const execPromise = runParallelTasksTool.execute(
				{ subtasks: [{ message: "task A" }, { message: "task B" }] },
				parent,
				makeCallbacks(),
			)
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children.forEach((c) => c.complete())
			await execPromise
			await settled(provider)

			expect(mockDeleteWorktree.mock.calls[0]).toEqual(["/home/user/myproj", "/home/user/.roo/worktrees/orphan"])
			expect(mockDeleteWorktree.mock.invocationCallOrder[0]).toBeLessThan(
				mockCreateWorktree.mock.invocationCallOrder[0],
			)
		})
	})
})
