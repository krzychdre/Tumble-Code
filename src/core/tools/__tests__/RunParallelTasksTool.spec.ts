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

import {
	MAX_PARALLEL_TASKS_MAX_CONCURRENCY,
	PARALLEL_TASKS_NO_LIMIT,
	TaskStatus,
	TumbleCodeEventName,
} from "@tumble-code/types"

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
		backgroundTaskRunner: {
			createBackgroundTask: vi.fn().mockImplementation(() => {
				const child = new FakeChild()
				children.push(child)
				return Promise.resolve(child)
			}),
			awaitTaskCompletion: vi
				.fn()
				.mockImplementation((child: FakeChild, options: { signal?: AbortSignal }) => child.await(options)),
			resolveSubagentProfile: vi.fn().mockImplementation(async (mode: string) => ({
				apiConfiguration: { apiProvider: "fake", mode },
				name: `p-${mode}`,
			})),
		},
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
		backgroundTaskRunner: {
			createBackgroundTask: ReturnType<typeof vi.fn>
			awaitTaskCompletion: ReturnType<typeof vi.fn>
			resolveSubagentProfile: ReturnType<typeof vi.fn>
		}
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
		atomicReadAndUpdateHistoryItem: ReturnType<typeof vi.fn>
		globalStoragePath: string
	}
}

type FakeProvider = ReturnType<typeof makeFakeProvider>

/**
 * Resolves once every subagent of the fan-out ended and its sidecar was written. Subagents that end together
 * contend for the sidecar's file lock, whose retries back off for up to 2.5 s; the 1 s default of waitFor is too
 * short for that on a slow runner.
 */
async function settled(provider: FakeProvider, fanOuts = 1): Promise<void> {
	await vi.waitFor(() => expect(provider.subagentRegistry.endFanOut).toHaveBeenCalledTimes(fanOuts), {
		timeout: 10_000,
	})
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

/** An explicit user cancel of the parent, the way ClineProvider.cancelTask fires it. */
function userCancel(parent: Task) {
	;(parent as any).abort = true
	;(parent as any).abortReason = "user_cancelled"
	parent.emit(TumbleCodeEventName.TaskAborted)
}

/** Abandonment abort (task switch / in-place rehydrate): TaskAborted fires WITHOUT a user cancel. */
function abandon(parent: Task) {
	;(parent as any).abort = true
	;(parent as any).abandoned = true
	parent.emit(TumbleCodeEventName.TaskAborted)
}

/** A live (rehydrated) instance of the parent that finished results can be queued into. */
const liveParentInstance = (taskStatus: TaskStatus, addMessage: ReturnType<typeof vi.fn>) => ({
	abort: false,
	taskStatus,
	messageQueueService: { addMessage },
})

/** Options shared by the launchFanOut/runFanOut/refusedResult helpers below. */
interface FanOutOptions {
	/** Reuse a provider from an earlier fan-out (a second call of the same parent). */
	provider?: FakeProvider
	/** State overrides for the fresh provider (ignored when `provider` is given). */
	state?: Record<string, unknown>
	/** A pre-made parent task (a second call of the same parent). */
	task?: Task
	/** Overrides for the fake parent task. */
	parent?: Record<string, unknown>
	subtasks?: { message: string; mode?: string }[]
	maxConcurrency?: number
	/** How many children to wait for; defaults to the subtask count (a reused provider starts with more). */
	waitForChildren?: number
	/** Configure the provider before the call starts. */
	setup?: (provider: FakeProvider) => unknown
	/** How the children end once they all exist; completes them all by default. */
	end?: (children: FakeChild[], parent: Task) => void
}

/**
 * Starts one run_parallel_tasks call on a fake provider and waits for every
 * child to spawn. Tests that act mid-run use this; the rest use runFanOut.
 */
async function launchFanOut({
	state = {},
	provider = makeFakeProvider(state),
	task,
	parent: parentOverrides = {},
	subtasks = [{ message: "task A" }, { message: "task B" }],
	maxConcurrency,
	waitForChildren = subtasks.length,
	setup,
}: FanOutOptions = {}) {
	await setup?.(provider)
	const callbacks = makeCallbacks()
	const parent = task ?? makeFakeParentTask(provider, parentOverrides)
	const execPromise = runParallelTasksTool.execute({ subtasks, maxConcurrency }, parent, callbacks)
	await vi.waitFor(() => expect(provider.children.length).toBe(waitForChildren))
	return { provider, parent, callbacks, execPromise }
}

/**
 * Runs one fan-out to its settled end: launchFanOut, `end` the children
 * (complete all by default), then await the tool call and the workers.
 */
async function runFanOut({ end = (children) => children.forEach((c) => c.complete()), ...start }: FanOutOptions = {}) {
	const { provider, parent, callbacks, execPromise } = await launchFanOut(start)
	end(provider.children, parent)
	await execPromise
	await settled(provider)
	return { provider, parent, callbacks }
}

/**
 * Runs a call that must be refused before anything starts (no worktree, no
 * child) and returns the tool result pushed to the model.
 */
async function refusedResult({
	state = {},
	parent: parentOverrides = {},
	setup,
}: Pick<FanOutOptions, "state" | "parent" | "setup"> = {}) {
	const provider = makeFakeProvider(state)
	setup?.(provider)
	const callbacks = makeCallbacks()
	await runParallelTasksTool.execute(
		{ subtasks: [{ message: "task A" }, { message: "task B" }] },
		makeFakeParentTask(provider, parentOverrides),
		callbacks,
	)
	expect(mockCreateWorktree).not.toHaveBeenCalled()
	expect(provider.backgroundTaskRunner.createBackgroundTask).not.toHaveBeenCalled()
	expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
	return { provider, callbacks, result: String(callbacks.pushToolResult.mock.calls[0][0]) }
}

// ---------------------------------------------------------------------------
// Pure helper tests (existing)
// ---------------------------------------------------------------------------

describe("RunParallelTasksTool helpers", () => {
	describe("validateParallelParams", () => {
		it("rejects missing / empty subtasks", () => {
			expect(validateParallelParams(undefined, 3)).toEqual({ ok: false, error: expect.any(String) })
			expect(validateParallelParams({ subtasks: [] }, 3)).toEqual({ ok: false, error: expect.any(String) })
		})

		// One subtask is how a follow-up starts after a result, while the
		// other subagents keep running.
		it("accepts a single subtask", () => {
			expect(validateParallelParams({ subtasks: [{ message: "just one job" }] }, 3)).toEqual({
				ok: true,
				subtasks: [{ message: "just one job", mode: "code" }],
				maxConcurrency: 1,
			})
		})

		it("rejects a subtask without a message", () => {
			const r = validateParallelParams({ subtasks: [{ message: "  " } as never, { message: "ok" }] }, 3)
			expect(r.ok).toBe(false)
		})

		it("normalizes mode to 'code' by default and clamps concurrency to subtask count", () => {
			const r = validateParallelParams(
				{
					subtasks: [{ message: "a" }, { message: "b", mode: "debug" }],
					maxConcurrency: 10,
				},
				3,
			)
			expect(r).toEqual({
				ok: true,
				subtasks: [
					{ message: "a", mode: "code" },
					{ message: "b", mode: "debug" },
				],
				maxConcurrency: 2, // clamped to subtasks.length
			})
		})

		it("normalizes maxConcurrency against the user's cap", () => {
			const many = Array.from({ length: 10 }, (_, i) => ({ message: `m${i}` }))
			// Invalid values (0, null) and values below 2 fall back to the cap:
			// "parallel with concurrency 1" is nonsense, so it means the cap.
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 0 }, 3)).toMatchObject({
				maxConcurrency: 3,
			})
			expect(validateParallelParams({ subtasks: many, maxConcurrency: null }, 3)).toMatchObject({
				maxConcurrency: 3,
			})
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 1 }, 4)).toMatchObject({
				maxConcurrency: 4,
			})
			// The model may lower concurrency below the cap, but never exceed it.
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 8 }, 2)).toMatchObject({
				maxConcurrency: 2,
			})
			expect(validateParallelParams({ subtasks: many, maxConcurrency: 2 }, 4)).toMatchObject({
				maxConcurrency: 2,
			})
			// No value means the user's cap, also above or below the built-in default of 3.
			expect(validateParallelParams({ subtasks: many }, 8)).toMatchObject({ maxConcurrency: 8 })
			expect(validateParallelParams({ subtasks: many }, 2)).toMatchObject({ maxConcurrency: 2 })
		})

		it("rejects architect/orchestrator subtask modes with a corrective error", () => {
			for (const mode of ["architect", "orchestrator"]) {
				const r = validateParallelParams(
					{
						subtasks: [{ message: "plan the system", mode }, { message: "ok" }],
					},
					3,
				)
				expect(r.ok).toBe(false)
				if (!r.ok) {
					expect(r.error).toContain(`"${mode}"`)
					expect(r.error).toContain("do the")
				}
			}
			// Lightweight modes stay allowed.
			expect(
				validateParallelParams(
					{
						subtasks: [
							{ message: "q", mode: "ask" },
							{ message: "r", mode: "ask" },
						],
					},
					3,
				).ok,
			).toBe(true)
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

		it("a subagent over its request budget: its last message is the partial report, no restart", () => {
			const text = describeSubtaskFailure({
				abortReason: "budget",
				failureMessage: "It used its budget of 15 requests in council-explorer mode.",
			})
			expect(text).toMatch(/^Stopped at its request budget: It used its budget of 15 requests/)
			expect(text).toContain("partial report")
			expect(text).toContain("do not start the same subtask again")
			expect(text).not.toContain("Stopped as stuck")
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
		const { callbacks, result } = await refusedResult({ state: { parallelTasksMaxConcurrency: 1 } })
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(result).toContain("disabled")
		expect(result).toContain("new_task")
	})

	it("background caller (subtask): refused — no nested fan-outs", async () => {
		const { callbacks, result } = await refusedResult({
			parent: { isBackground: true, recordToolError: vi.fn() },
		})
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(result).toContain("not available inside a parallel subtask")
	})

	it("pre-aborted parent: starts nothing, no worktree created", async () => {
		const { result } = await refusedResult({ parent: { abort: true } })
		expect(result).toContain("cancelled")
	})

	it("returns on the first result: the rest keeps running and is collected later", async () => {
		const { provider, callbacks, execPromise } = await launchFanOut()
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
		const { callbacks } = await runFanOut({ subtasks: [{ message: "follow-up" }] })
		const report = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(report).toContain("Started 1 subagent(s)")
		expect(report).toContain("Every subagent has reported")
	})

	it("puts a completed subagent's last message on its panel row", async () => {
		const { provider } = await runFanOut({
			subtasks: [{ message: "job" }],
			setup: (p) =>
				p.backgroundTaskRunner.awaitTaskCompletion.mockResolvedValueOnce({
					completed: true,
					lastMessage: "done",
					writtenPaths: [],
				}),
		})
		expect(provider.subagentRegistry.markTerminal).toHaveBeenCalledWith(
			provider.children[0].taskId,
			"completed",
			"done",
		)
	})

	it("a second fan-out of the same parent numbers its subagents after the first one's", async () => {
		const provider = makeFakeProvider()
		const parent = makeFakeParentTask(provider)
		const first = await launchFanOut({ provider, task: parent })
		provider.children[0].complete()
		await first.execPromise

		const second = await launchFanOut({
			provider,
			task: parent,
			subtasks: [{ message: "task C" }],
			waitForChildren: 3,
		})
		provider.children[2].complete()
		await second.execPromise

		const report = second.callbacks.pushToolResult.mock.calls[0][0] as string
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

	it("runs at most maxConcurrency subagents of one call at once", async () => {
		const { provider, execPromise } = await launchFanOut({
			state: { parallelTasksMaxConcurrency: 8 },
			subtasks: [{ message: "a" }, { message: "b" }, { message: "c" }],
			maxConcurrency: 2,
			waitForChildren: 2,
		})
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(provider.children.length).toBe(2)

		provider.children[0].complete()
		await execPromise
		await vi.waitFor(() => expect(provider.children.length).toBe(3))
		provider.children.slice(1).forEach((c) => c.complete())
		await settled(provider)
	})

	it("starts every subtask of the call at once when the cap is No limit", async () => {
		const { provider, execPromise } = await launchFanOut({
			state: { parallelTasksMaxConcurrency: PARALLEL_TASKS_NO_LIMIT },
			subtasks: Array.from({ length: MAX_PARALLEL_TASKS_MAX_CONCURRENCY + 1 }, (_, i) => ({
				message: `t${i}`,
			})),
		})
		expect(provider.backgroundSubagents.slots.waiting).toBe(0)

		provider.children.forEach((c) => c.complete())
		await execPromise
		await settled(provider)
	})

	// The slot pool enforces the per-call bound, so a subtask that waits for
	// its full profile holds none of the call's slots: a later subtask on
	// another profile starts in its place.
	it("starts a later subtask while an earlier one waits for its profile", async () => {
		const { provider, execPromise } = await launchFanOut({
			state: { parallelTasksMaxConcurrency: 8, currentApiConfigName: "main" },
			subtasks: [
				{ message: "a", mode: "ask" },
				{ message: "b", mode: "ask" },
				{ message: "c", mode: "code" },
			],
			maxConcurrency: 2,
			waitForChildren: 2,
			setup: (p) =>
				p.backgroundTaskRunner.resolveSubagentProfile.mockImplementation(async (mode: string) => ({
					apiConfiguration: {
						apiProvider: "fake",
						mode,
						maxConcurrentRequests: mode === "ask" ? 1 : undefined,
					},
					name: `p-${mode}`,
				})),
		})
		expect(provider.backgroundTaskRunner.createBackgroundTask.mock.calls.map((call) => call[0])).toEqual(["a", "c"])

		provider.children[0].complete()
		await execPromise
		await vi.waitFor(() => expect(provider.children.length).toBe(3))
		expect(provider.backgroundTaskRunner.createBackgroundTask.mock.calls[2][0]).toBe("b")
		provider.children.slice(1).forEach((c) => c.complete())
		await settled(provider)
	})

	it("resolves the subagent's profile before it takes a slot and runs it on that profile", async () => {
		const { provider } = await runFanOut({ subtasks: [{ message: "q", mode: "ask" }] })
		expect(provider.backgroundTaskRunner.resolveSubagentProfile).toHaveBeenCalledWith("ask")
		expect(provider.backgroundTaskRunner.createBackgroundTask.mock.calls[0][1]).toMatchObject({
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
			const { provider, execPromise } = await launchFanOut({
				state: { parallelTasksMaxConcurrency: 8, currentApiConfigName: "main" },
				subtasks: [{ message: "a" }, { message: "b" }, { message: "c" }],
				maxConcurrency: 8,
				waitForChildren: 2,
				setup: (p) => p.backgroundTaskRunner.resolveSubagentProfile.mockImplementation(profileWithLimit(2)),
			})
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
			const { provider, execPromise } = await launchFanOut({
				state: { parallelTasksMaxConcurrency: 8 },
				subtasks: [{ message: "a" }, { message: "b" }],
				maxConcurrency: 8,
				waitForChildren: 1,
				parent: { taskApiConfigName: "shared" },
				setup: (p) => p.backgroundTaskRunner.resolveSubagentProfile.mockImplementation(profileWithLimit(2)),
			})
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(provider.children.length).toBe(1)

			provider.children[0].complete()
			await execPromise
			await vi.waitFor(() => expect(provider.children.length).toBe(2))
			provider.children[1].complete()
			await settled(provider)
		})

		it("refuses before approval when the profile leaves no slot for subagents", async () => {
			const { callbacks, result } = await refusedResult({
				parent: { taskApiConfigName: "shared" },
				setup: (p) => p.backgroundTaskRunner.resolveSubagentProfile.mockImplementation(profileWithLimit(1)),
			})
			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(result).toContain('API profile "shared" allows 1 request(s) at once')
			expect(result).toContain("Do this work directly in this task")
		})
	})

	it("a user message ends the wait: the subagents keep running", async () => {
		const { provider, parent, callbacks, execPromise } = await launchFanOut()
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
		const failure =
			'API error 401 (invalid or missing API key) from provider "openai", model "gpt-x". Provider message: Incorrect API key provided.'
		const { provider, callbacks, execPromise } = await launchFanOut()
		// Fail the first subtask and let the tool report it while #2 still runs.
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
		const { provider, parent, callbacks } = await runFanOut({ end: (_children, parent) => userCancel(parent) })
		expect(callbacks.pushToolResult.mock.calls[0][0]).toContain("this task was stopped")
		for (const child of provider.children) {
			expect(provider.subagentRegistry.markTerminal).toHaveBeenCalledWith(child.taskId, "cancelled", undefined)
		}
		expect(provider.backgroundSubagents.hasWork("parent-12345678")).toBe(false)
	})

	it("abandonment abort (no user_cancelled) DETACHES: children keep running and finish", async () => {
		const { provider } = await runFanOut({
			end: (children, parent) => {
				abandon(parent)
				children.forEach((c) => c.complete())
			},
		})
		provider.children.forEach((c) => expect(c.abortTask).not.toHaveBeenCalled())

		const unread = provider.backgroundSubagents.takeUnread("parent-12345678")
		expect(unread.map((f) => f.result.status)).toEqual(["completed", "completed"])
	})

	it("a detached fan-out queues its results into the live parent instance waiting at resume", async () => {
		const addMessage = vi.fn()
		const { provider } = await runFanOut({
			setup: (p) => p.getLiveTaskInstance.mockReturnValue(liveParentInstance(TaskStatus.Resumable, addMessage)),
			end: (children, parent) => {
				abandon(parent)
				children.forEach((c) => c.complete())
			},
		})

		expect(provider.getLiveTaskInstance).toHaveBeenCalledWith("parent-12345678")
		const queued = addMessage.mock.calls.map(([text]) => text as string).join("\n")
		expect(queued).toContain("arrived while this task was waiting")
		expect(count(queued, /: COMPLETED/g)).toBe(2)
		expect(provider.backgroundSubagents.unreadCount("parent-12345678")).toBe(0)
	})

	it("results stay unread while the live parent instance is busy", async () => {
		const addMessage = vi.fn()
		const { provider, execPromise } = await launchFanOut({
			setup: (p) => p.getLiveTaskInstance.mockReturnValue(liveParentInstance(TaskStatus.Running, addMessage)),
		})
		provider.children[0].complete()
		await execPromise
		provider.children[1].complete()
		await settled(provider)

		expect(addMessage).not.toHaveBeenCalled()
		expect(provider.backgroundSubagents.unreadCount("parent-12345678")).toBe(1)
	})

	it("user-cancelled fan-out does NOT queue a report into the rehydrated instance", async () => {
		const addMessage = vi.fn()
		await runFanOut({
			setup: (p) => p.getLiveTaskInstance.mockReturnValue(liveParentInstance(TaskStatus.Resumable, addMessage)),
			end: (_children, parent) => userCancel(parent),
		})
		// Cancelled on purpose: no auto-resume injection.
		expect(addMessage).not.toHaveBeenCalled()
	})

	it("cleans up the TaskAborted listener once every subagent ended", async () => {
		const { provider, parent, execPromise } = await launchFanOut()
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
		const { provider } = await runFanOut({ parent: { rootTaskId } })

		const opts = provider.backgroundTaskRunner.createBackgroundTask.mock.calls[0][1] as {
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
		const { provider } = await runFanOut({ state: { autoApprovalEnabled: true, alwaysAllowExecute: false } })

		expect(provider.backgroundTaskRunner.createBackgroundTask).toHaveBeenCalledTimes(2)
		const opts = provider.backgroundTaskRunner.createBackgroundTask.mock.calls[0][1] as {
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
		const parentHistoryItem = {
			id: "parent-12345678",
			number: 1,
			ts: 0,
			task: "parent",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}

		it("records each child in the parent's parallelChildIds (deduped) without delegating the parent", async () => {
			// Seed the parent HistoryItem (the fake auto-creates one if
			// absent) so the assertions see a record we know.
			const { provider } = await runFanOut({
				setup: (p) => p.historyItems.set("parent-12345678", { ...parentHistoryItem, status: "active" }),
			})

			const item = provider.historyItems.get("parent-12345678") as Record<string, unknown>
			const recorded = item.parallelChildIds as string[]
			expect(recorded).toHaveLength(2)
			// Both child ids present, in spawn order, deduped.
			expect(recorded).toEqual(expect.arrayContaining([provider.children[0].taskId, provider.children[1].taskId]))
			expect(new Set(recorded).size).toBe(2)
			// Parallel fan-out, not foreground delegation: the parent keeps working.
			expect(item.status).toBe("active")
			expect(item.awaitingChildId).toBeUndefined()
			expect(item.delegatedToId).toBeUndefined()

			// The updater itself uses Array.from(new Set(...)), so even a
			// pre-existing duplicate in the record is collapsed.
			const [, updater] = provider.atomicReadAndUpdateHistoryItem.mock.calls[0] as [string, (c: any) => any]
			const after = updater({ ...parentHistoryItem, parallelChildIds: ["dup", "dup"] })
			expect((after.parallelChildIds as string[]).filter((x) => x === "dup")).toHaveLength(1)
		})

		it("writes the subagents.json sidecar as subagents end, keeping earlier runs", async () => {
			const { provider } = await runFanOut({
				setup: async (p) => {
					p.globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-sidecar-"))
					const sidecarDir = path.join(p.globalStoragePath, "tasks", "parent-12345678")
					await fs.mkdir(sidecarDir, { recursive: true })
					await fs.writeFile(
						path.join(sidecarDir, "subagents.json"),
						JSON.stringify([
							{ taskId: "child-old", parentTaskId: "parent-12345678", runId: "r0", index: 0 },
						]),
					)
					p.subagentRegistry.snapshot.mockReturnValue([
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
				},
			})

			const sidecarPath = path.join(provider.globalStoragePath, "tasks", "parent-12345678", "subagents.json")
			const parsed = JSON.parse(await fs.readFile(sidecarPath, "utf8"))
			expect(parsed.map((row: { taskId: string }) => row.taskId)).toEqual(["child-old", "child-x"])
			expect(provider.subagentRegistry.snapshot).toHaveBeenCalledWith("parent-12345678")
		})

		it("gives every placeholder and child of one call the same run id", async () => {
			const { provider } = await runFanOut()
			const queuedRuns = provider.subagentRegistry.registerQueued.mock.calls.map(([row]) => row.runId)
			const childRuns = provider.backgroundTaskRunner.createBackgroundTask.mock.calls.map(
				([, opts]) => opts.subagentInfo.runId,
			)
			expect(queuedRuns[0]).toEqual(expect.any(String))
			expect(new Set([...queuedRuns, ...childRuns])).toEqual(new Set([queuedRuns[0]]))
		})

		// The registry keeps an in-progress fan-out's rows across task switches;
		// it must learn when the fan-out is over, after the sidecar is written.
		it("ends the fan-out in the registry after the sidecar is written", async () => {
			const { provider, execPromise } = await launchFanOut()
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
			const { provider } = await runFanOut({
				setup: async (p) => {
					p.globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-transcript-"))
				},
				end: ([first, second]) => {
					first.clineMessages = [{ ts: 1, type: "say", say: "text", text: "did A" }]
					first.complete()
					second.failWithApiError("model gone")
				},
			})

			const legacyDir = path.join(provider.globalStoragePath, "tasks", "parent-12345678", "subagents")
			await expect(fs.access(legacyDir)).rejects.toThrow()
		})

		it("survives a sidecar write failure (best-effort, does not throw)", async () => {
			const { provider, callbacks } = await runFanOut({
				// globalStoragePath points at a FILE, so the sidecar mkdir
				// fails with ENOTDIR — deterministic, unlike an unwritable
				// dir (whose cross-process lock-file paths can hang).
				setup: async (p) => {
					const blocker = await fs.mkdtemp(path.join(os.tmpdir(), "rpt-block-"))
					p.globalStoragePath = path.join(blocker, "i-am-a-file")
					await fs.writeFile(p.globalStoragePath, "", "utf8")
					p.subagentRegistry.snapshot.mockReturnValue([])
				},
			})

			// The sidecar write failed, but the tool completes and reports normally.
			expect(callbacks.pushToolResult).toHaveBeenCalledOnce()
			expect(count(modelSaw(provider, callbacks), /: COMPLETED/g)).toBe(2)
		})

		it("survives an atomicReadAndUpdateHistoryItem failure (best-effort)", async () => {
			const { callbacks } = await runFanOut({
				setup: (p) => p.atomicReadAndUpdateHistoryItem.mockRejectedValue(new Error("store down")),
			})
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
			const { provider, callbacks } = await runFanOut()
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
			const { provider, callbacks } = await runFanOut()
			expect(mockDeleteWorktree).not.toHaveBeenCalled()
			const report = modelSaw(provider, callbacks)
			expect(report).not.toContain("cleaned up")
			expect(report).toContain("worktree:")
		})

		// The children never complete; a user cancel of the parent ends them,
		// so finalize runs the cleanup decision on a cancelled subtask.
		it.each([
			{ label: "with uncommitted changes → NOT deleted", hasChanges: true, expectedDeletes: 0 },
			{ label: "clean + commitless → deleted", hasChanges: false, expectedDeletes: 2 },
		])("cancelled subtask $label", async ({ hasChanges, expectedDeletes }) => {
			mockHasUncommittedChanges.mockResolvedValue(hasChanges)
			await runFanOut({ end: (_children, parent) => userCancel(parent) })
			expect(mockDeleteWorktree).toHaveBeenCalledTimes(expectedDeletes)
		})

		it("deleteWorktree returning success:false → cleaned falsy, no throw", async () => {
			mockDeleteWorktree.mockResolvedValue({ success: false, message: "busy" })
			const { provider, callbacks } = await runFanOut()
			const report = modelSaw(provider, callbacks)
			expect(count(report, /: COMPLETED/g)).toBe(2)
			expect(report).not.toContain("cleaned up")
			expect(report).toContain("worktree:")
		})

		it("creates each worktree locked by this process and unlocks it when the subtask ends", async () => {
			mockBranchHasCommits.mockResolvedValue(true)
			await runFanOut()
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
			for (const fanOuts of [1, 2]) {
				const { execPromise } = await launchFanOut({ provider, task: parent, waitForChildren: 2 * fanOuts })
				provider.children.forEach((c) => c.complete())
				await execPromise
				await settled(provider, fanOuts)
				// Run ids are millisecond timestamps: let the clock move between runs.
				await new Promise((resolve) => setTimeout(resolve, 2))
			}

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
			await runFanOut()
			expect(mockDeleteWorktree.mock.calls[0]).toEqual(["/home/user/myproj", "/home/user/.roo/worktrees/orphan"])
			expect(mockDeleteWorktree.mock.invocationCallOrder[0]).toBeLessThan(
				mockCreateWorktree.mock.invocationCallOrder[0],
			)
		})
	})
})
