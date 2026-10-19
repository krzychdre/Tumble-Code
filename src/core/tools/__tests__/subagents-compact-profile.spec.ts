// cd src && npx vitest run core/tools/__tests__/subagents-compact-profile.spec.ts
//
// Subagents are off under a compact profile: `new_task` and `run_parallel_tasks`
// refuse a call from a task whose own profile has `compactProfile: true`, before
// any state read, approval ask or child task, and count it as a mistake. With the
// flag absent or false both tools behave as before (the full specs of the two
// tools pin that in detail; these cases only show the compact guard stays out of
// the way).

import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCheckGitRepo } = vi.hoisted(() => ({
	mockCheckGitRepo: vi.fn().mockResolvedValue(true),
}))

vi.mock("@tumble-code/core", () => ({
	worktreeService: {
		checkGitRepo: mockCheckGitRepo,
		createWorktree: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
		hasUncommittedChanges: vi.fn().mockResolvedValue(false),
		branchHasCommits: vi.fn().mockResolvedValue(false),
		deleteWorktree: vi.fn().mockResolvedValue({ success: true, message: "removed" }),
		unlockWorktree: vi.fn().mockResolvedValue(true),
		listWorktrees: vi.fn().mockResolvedValue([]),
	},
}))

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue(false) })),
	},
	window: { showErrorMessage: vi.fn() },
}))

import type { ToolUse } from "../../../shared/tools"
import { newTaskTool } from "../NewTaskTool"
import { runParallelTasksTool } from "../RunParallelTasksTool"
import { compactSubagentsOffError } from "../helpers/compactSubagents"

type Profile = { apiProvider: string; compactProfile?: boolean }

const COMPACT: Profile = { apiProvider: "openai", compactProfile: true }
const NOT_COMPACT: Profile[] = [{ apiProvider: "openai" }, { apiProvider: "openai", compactProfile: false }]

function makeProvider() {
	return {
		getState: vi.fn().mockResolvedValue({ customModes: [], mode: "code", parallelTasksMaxConcurrency: 3 }),
		getHistoryItem: vi.fn(),
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
		createBackgroundTask: vi.fn(),
		handleModeSwitch: vi.fn(),
		resolveSubagentProfile: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "openai" } }),
	}
}

function makeTask(apiConfiguration: Profile, provider = makeProvider()) {
	return {
		taskId: "parent-12345678",
		cwd: "/home/user/proj",
		abort: false,
		isBackground: false,
		apiConfiguration,
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: vi.fn(),
		checkpointSave: vi.fn(),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		getTaskMode: vi.fn().mockResolvedValue("orchestrator"),
		providerRef: { deref: () => provider },
		provider,
	}
}

function makeCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		toolCallId: "call_1",
	}
}

function newTaskBlock(partial: boolean): ToolUse<"new_task"> {
	const params = { mode: "code", message: "Write the helper." }
	return {
		type: "tool_use",
		id: "call_1",
		name: "new_task",
		params,
		partial,
		...(partial ? {} : { nativeArgs: params }),
	} as ToolUse<"new_task">
}

/** The `error` field of a `formatResponse.toolError` result, and the whole object. */
function parseToolError(result: unknown) {
	const parsed = JSON.parse(String(result))
	expect(parsed.status).toBe("error")
	return parsed
}

describe("subagents under a compact profile", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockCheckGitRepo.mockResolvedValue(true)
	})

	describe("new_task", () => {
		it("refuses: no child, no approval ask, no state read, mistake counted, turn not failed", async () => {
			const task = makeTask(COMPACT)
			const callbacks = makeCallbacks()

			await newTaskTool.handle(task as any, newTaskBlock(false), callbacks)

			expect(task.provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
			expect(task.provider.getState).not.toHaveBeenCalled()
			expect(task.provider.handleModeSwitch).not.toHaveBeenCalled()
			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(task.ask).not.toHaveBeenCalled()
			expect(task.checkpointSave).not.toHaveBeenCalled()
			expect(task.consecutiveMistakeCount).toBe(1)
			expect(task.recordToolError).toHaveBeenCalledWith("new_task")
			// attempt_completion must stay open: the refusal tells the model to call it.
			expect(task.didToolFailInCurrentTurn).toBe(false)

			expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
			const result = parseToolError(callbacks.pushToolResult.mock.calls[0][0])
			expect(result.error).toBe(
				"new_task refused: subagents are off for this profile (compact mode). " +
					"Do the work yourself with your own tools, then call attempt_completion.",
			)
			// No minimal example of the refused tool: it would invite another call.
			expect(result.minimal_valid_example).toBeUndefined()
		})

		it("counts every repeated refusal, so a looping model reaches the mistake limit", async () => {
			const task = makeTask(COMPACT)

			for (let i = 0; i < 3; i++) {
				await newTaskTool.handle(task as any, newTaskBlock(false), makeCallbacks())
			}

			expect(task.consecutiveMistakeCount).toBe(3)
			expect(task.provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
		})

		it("shows no newTask card while the call streams", async () => {
			const task = makeTask(COMPACT)

			await newTaskTool.handle(task as any, newTaskBlock(true), makeCallbacks())

			expect(task.ask).not.toHaveBeenCalled()
		})

		it.each(NOT_COMPACT)("without the flag (%o) shows the streaming card and delegates", async (profile) => {
			const task = makeTask(profile)
			const partialCallbacks = makeCallbacks()

			await newTaskTool.handle(task as any, newTaskBlock(true), partialCallbacks)

			expect(task.ask).toHaveBeenCalledTimes(1)
			expect(task.ask.mock.calls[0][0]).toBe("tool")
			expect(JSON.parse(task.ask.mock.calls[0][1])).toMatchObject({ tool: "newTask", mode: "code" })

			const callbacks = makeCallbacks()
			await newTaskTool.handle(task as any, newTaskBlock(false), callbacks)

			expect(callbacks.askApproval).toHaveBeenCalledTimes(1)
			expect(task.provider.delegateParentAndOpenChild).toHaveBeenCalledTimes(1)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("Delegated to child task child-1")
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("a background subtask on a compact profile still gets the background refusal", async () => {
			const task = { ...makeTask(COMPACT), isBackground: true }
			const callbacks = makeCallbacks()

			await newTaskTool.handle(task as any, newTaskBlock(false), callbacks)

			expect(String(callbacks.pushToolResult.mock.calls[0][0])).toContain(
				"not available inside a parallel subtask",
			)
			expect(task.consecutiveMistakeCount).toBe(0)
		})
	})

	describe("run_parallel_tasks", () => {
		const params = { subtasks: [{ message: "task A" }, { message: "task B" }] }

		it("refuses: no child, no approval ask, no state read, mistake counted, turn not failed", async () => {
			const task = makeTask(COMPACT)
			const callbacks = makeCallbacks()

			await runParallelTasksTool.execute(params, task as any, callbacks)

			expect(task.provider.createBackgroundTask).not.toHaveBeenCalled()
			expect(task.provider.getState).not.toHaveBeenCalled()
			expect(mockCheckGitRepo).not.toHaveBeenCalled()
			expect(callbacks.askApproval).not.toHaveBeenCalled()
			expect(task.consecutiveMistakeCount).toBe(1)
			expect(task.recordToolError).toHaveBeenCalledWith("run_parallel_tasks")
			expect(task.didToolFailInCurrentTurn).toBe(false)

			const result = parseToolError(callbacks.pushToolResult.mock.calls[0][0])
			expect(result.error).toBe(compactSubagentsOffError("run_parallel_tasks"))
			expect(result.error).toBe(
				"run_parallel_tasks refused: subagents are off for this profile (compact mode). " +
					"Do the work yourself with your own tools, then call attempt_completion.",
			)
			expect(result.minimal_valid_example).toBeUndefined()
		})

		it("has no streaming card to hide (its partial handler is a no-op)", async () => {
			const task = makeTask(COMPACT)
			const block = {
				type: "tool_use",
				id: "call_1",
				name: "run_parallel_tasks",
				params: {},
				partial: true,
			} as ToolUse<"run_parallel_tasks">

			await runParallelTasksTool.handle(task as any, block, makeCallbacks())

			expect(task.ask).not.toHaveBeenCalled()
		})

		it.each(NOT_COMPACT)("without the flag (%o) reaches the approval ask", async (profile) => {
			const task = makeTask(profile)
			const callbacks = makeCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await runParallelTasksTool.execute(params, task as any, callbacks)

			expect(callbacks.askApproval).toHaveBeenCalledTimes(1)
			expect(JSON.parse(callbacks.askApproval.mock.calls[0][1])).toMatchObject({
				tool: "runParallelTasks",
				count: 2,
			})
			expect(task.provider.createBackgroundTask).not.toHaveBeenCalled()
			expect(task.consecutiveMistakeCount).toBe(0)
		})
	})
})
