// AttemptCompletionTool with the real response formatting; the task, its provider (history,
// delegation, background subagents), telemetry and the VS Code setting are replaced.

import * as vscode from "vscode"
import { TumbleCodeEventName, TelemetryEventName, type TodoItem } from "@tumble-code/types"

import type { ToolUse } from "../../../shared/tools"
import { attemptCompletionTool, type AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { formatResponse } from "../../prompts/responses"
import type { Task } from "../../task/Task"
import { logger } from "../../../utils/logging"

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }))
vi.mock("@tumble-code/telemetry", () => ({ TelemetryService: { instance: { capture: mockCapture } } }))

type FakeTask = Record<string, any>

function makeTask(overrides: FakeTask = {}): FakeTask {
	return {
		taskId: "task_1",
		consecutiveMistakeCount: 2,
		didToolFailInCurrentTurn: false,
		isBackground: false,
		todoList: undefined,
		clineMessages: [],
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing result"),
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
		emitFinalTokenUsageUpdate: vi.fn(),
		emit: vi.fn(),
		getTokenUsage: vi.fn().mockReturnValue({}),
		toolUsage: {},
		providerRef: { deref: () => undefined },
		...overrides,
	}
}

function makeCallbacks() {
	return {
		askApproval: vi.fn(),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		askFinishSubTaskApproval: vi.fn().mockResolvedValue(true),
		toolDescription: vi.fn(),
	} satisfies AttemptCompletionCallbacks
}

const block = (params: Record<string, string>, partial = false) =>
	({
		type: "tool_use",
		name: "attempt_completion",
		params,
		nativeArgs: params,
		partial,
	}) as ToolUse<"attempt_completion">

async function complete(task: FakeTask, params: Record<string, string> = { result: "done" }) {
	const callbacks = makeCallbacks()
	await attemptCompletionTool.handle(task as unknown as Task, block(params), callbacks)
	return callbacks
}

const askedForAcceptance = (task: FakeTask) =>
	task.ask.mock.calls.some((call: unknown[]) => call[0] === "completion_result" && call[2] === false)

let preventCompletionWithOpenTodos = false
beforeEach(() => {
	mockCapture.mockReset()
	preventCompletionWithOpenTodos = false
	vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
		() =>
			({
				get: (key: string, fallback: unknown) =>
					key === "preventCompletionWithOpenTodos" ? preventCompletionWithOpenTodos : fallback,
			}) as any,
	)
	vi.spyOn(logger, "error").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("attemptCompletionTool", () => {
	const todos = (...statuses: TodoItem["status"][]) =>
		statuses.map((status, i) => ({ id: `${i}`, content: `todo ${i}`, status }))

	it.each([
		[true, undefined, true],
		[true, [], true],
		[true, todos("completed", "completed"), true],
		[true, todos("completed", "pending"), false],
		[true, todos("in_progress"), false],
		[false, todos("pending", "in_progress"), true],
	])("with preventCompletionWithOpenTodos %s and todos %j completes: %s", async (setting, todoList, completes) => {
		preventCompletionWithOpenTodos = setting
		const task = makeTask({ todoList })

		const callbacks = await complete(task)

		expect(askedForAcceptance(task)).toBe(completes)
		if (!completes) {
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)
			expect(task.consecutiveMistakeCount).toBe(3)
		}
	})

	it("refuses while a tool failed in this turn", async () => {
		const task = makeTask({ didToolFailInCurrentTurn: true })

		const callbacks = await complete(task)

		const [[type, message]] = task.say.mock.calls
		expect(type).toBe("error")
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(formatResponse.toolError(message))
		expect(task.ask).not.toHaveBeenCalled()
	})

	it("reports a missing result", async () => {
		const task = makeTask()

		const callbacks = await complete(task, { result: "" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing result")
		expect(task.consecutiveMistakeCount).toBe(3)
	})

	it("shows the result, waits for acceptance and reports the task completed", async () => {
		const task = makeTask()
		task.ask.mockImplementation(async () => {
			// TaskLifecycle reads this flag when the user abandons the open ask.
			expect(task.awaitingCompletionAcceptance).toBe(true)
			return { response: "yesButtonClicked" }
		})

		const callbacks = await complete(task)

		expect(task.say).toHaveBeenCalledWith("completion_result", "done", undefined, false)
		expect(task.awaitingCompletionAcceptance).toBe(false)
		expect(task.consecutiveMistakeCount).toBe(0)
		expect(task.emitFinalTokenUsageUpdate).toHaveBeenCalled()
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.TASK_COMPLETED, { taskId: "task_1" })
		expect(task.emit).toHaveBeenCalledWith(TumbleCodeEventName.TaskCompleted, "task_1", {}, {})
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("returns the user's feedback instead of completing", async () => {
		const image = "data:image/png;base64,AAAA"
		const task = makeTask()
		task.ask.mockResolvedValue({ response: "messageResponse", text: "what about 3+3?", images: [image] })

		const callbacks = await complete(task)

		expect(task.say).toHaveBeenCalledWith("user_feedback", "what about 3+3?", [image])
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolResult("<user_message>\nwhat about 3+3?\n</user_message>", [image]),
		)
		expect(mockCapture).not.toHaveBeenCalled()
		expect(task.emit).not.toHaveBeenCalled()
	})

	it("clears the acceptance flag when the ask fails, and hands the error on", async () => {
		const task = makeTask()
		const failure = new Error("aborted")
		task.ask.mockRejectedValue(failure)

		const callbacks = await complete(task)

		expect(task.awaitingCompletionAcceptance).toBe(false)
		expect(callbacks.handleError).toHaveBeenCalledWith("inspecting site", failure, "attempt_completion")
	})

	describe("while streaming", () => {
		// Mirrors how Task updates a partial message of the same type in place.
		function recordingTask() {
			const messages: any[] = []
			const upsert = (kind: "say" | "ask", type: string, text: string | undefined, partial?: boolean) => {
				const last = messages.at(-1)
				if (last?.type === kind && last[kind] === type && last.partial) {
					last.text = text ?? ""
					last.partial = partial === true
				} else {
					messages.push({ type: kind, [kind]: type, text: text ?? "", partial: partial === true })
				}
			}
			const task = makeTask({ clineMessages: messages })
			task.say.mockImplementation(async (type: string, text?: string, _images?: unknown, partial?: boolean) =>
				upsert("say", type, text, partial),
			)
			task.ask.mockImplementation(async (type: string, text?: string, partial?: boolean) => {
				upsert("ask", type, text, partial)
				return { response: "yesButtonClicked" }
			})
			return { task, messages }
		}

		it("streams the result as a partial completion_result", async () => {
			const { task, messages } = recordingTask()

			await attemptCompletionTool.handle(
				task as unknown as Task,
				block({ result: "Half" }, true),
				makeCallbacks(),
			)

			expect(messages).toEqual([{ type: "say", say: "completion_result", text: "Half", partial: true }])
		})

		it("finalizes the result once, even after a command streamed with it", async () => {
			const { task, messages } = recordingTask()
			const handle = (params: Record<string, string>, partial: boolean) =>
				attemptCompletionTool.handle(task as unknown as Task, block(params, partial), makeCallbacks())

			await handle({ result: "All done.", command: "echo hello" }, true)
			await handle({ result: "All done.", command: "echo hello world" }, true)
			await handle({ result: "All done.", command: "echo hello world" }, false)

			const finalized = messages.filter((m) => m.say === "completion_result" && !m.partial)
			expect(finalized).toEqual([{ type: "say", say: "completion_result", text: "All done.", partial: false }])
			expect(messages.find((m) => m.ask === "command")?.text).toBe("echo hello world")
		})
	})

	describe("background subagents gate", () => {
		const withSubagents = (running: number, unread: number) =>
			makeTask({
				providerRef: {
					deref: () => ({
						backgroundSubagents: {
							hasWork: () => running + unread > 0,
							running: () => Array.from({ length: running }),
							unreadCount: () => unread,
						},
					}),
				},
			})

		it.each([
			["subagents still running", 2, 0],
			["results not read yet", 0, 1],
		])("refuses to complete with %s and points at wait_for_subagents", async (_label, running, unread) => {
			const task = withSubagents(running, unread)

			const callbacks = await complete(task)

			expect(task.consecutiveMistakeCount).toBe(3)
			const error = JSON.parse(callbacks.pushToolResult.mock.calls[0][0]).error as string
			expect(error).toContain(
				`${running} subagent(s) are still running and ${unread} finished subagent result(s)`,
			)
			expect(error).toContain("Call wait_for_subagents")
			expect(task.ask).not.toHaveBeenCalled()
		})

		it("completes once every subagent reported", async () => {
			const task = withSubagents(0, 0)

			await complete(task)

			expect(askedForAcceptance(task)).toBe(true)
		})
	})

	// A delegated subtask must return its result to the parent (reopenParentFromDelegation) rather
	// than finalize the whole task. The gate keys on the durable `awaitingChildId` signal, so a
	// background-drain save that clobbers the parent status "delegated" -> "active" does not break
	// the return. See ai_plans/archive/2026-06/2026-06-08_delegated-subtask-no-return.md.
	describe("subtask delegation gate", () => {
		const CHILD_ID = "task_1"
		const PARENT_ID = "parent_1"

		function delegated(
			parentHistory: { status?: string; awaitingChildId?: string },
			options: { tryReattach?: boolean; childHistory?: Record<string, unknown> | Error; reopened?: boolean } = {},
		) {
			const provider = {
				getHistoryItem: vi.fn(async (id: string) => {
					if (id !== CHILD_ID) return { id: PARENT_ID, ...parentHistory }
					if (options.childHistory instanceof Error) throw options.childHistory
					return options.childHistory ?? { id: CHILD_ID, status: "active" }
				}),
				reopenParentFromDelegation: vi.fn().mockResolvedValue(options.reopened ?? true),
				tryReattachDelegatedParent: vi.fn().mockResolvedValue(options.tryReattach ?? false),
			}
			const task = makeTask({ parentTaskId: PARENT_ID, providerRef: { deref: () => provider } })
			return { task, provider }
		}

		it.each([
			[
				"the parent is delegated and awaits this child",
				{ status: "delegated", awaitingChildId: CHILD_ID },
				false,
			],
			// The state a late background-usage-drain save leaves the parent in.
			[
				"the parent status drifted to active but still awaits this child",
				{ status: "active", awaitingChildId: CHILD_ID },
				false,
			],
			["the detached parent can be re-attached", { status: "active", awaitingChildId: undefined }, true],
		])("returns to the parent when %s", async (_, parentHistory, tryReattach) => {
			const { task, provider } = delegated(parentHistory, { tryReattach })

			const callbacks = await complete(task, { result: "child done" })

			expect(provider.reopenParentFromDelegation).toHaveBeenCalledWith({
				parentTaskId: PARENT_ID,
				childTaskId: CHILD_ID,
				completionResultSummary: "child done",
			})
			// Re-attach is tried only when the gate fails.
			expect(provider.tryReattachDelegatedParent.mock.calls.length > 0).toBe(!parentHistory.awaitingChildId)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("")
			expect(task.emit).toHaveBeenCalledWith(TumbleCodeEventName.TaskCompleted, CHILD_ID, {}, {})
			expect(askedForAcceptance(task)).toBe(false)
		})

		it("reports a denied return and stops", async () => {
			const { task, provider } = delegated({ status: "delegated", awaitingChildId: CHILD_ID })
			const callbacks = makeCallbacks()
			callbacks.askFinishSubTaskApproval.mockResolvedValue(false)

			await attemptCompletionTool.handle(task as unknown as Task, block({ result: "x" }), callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(formatResponse.toolDenied())
			expect(provider.reopenParentFromDelegation).not.toHaveBeenCalled()
			expect(askedForAcceptance(task)).toBe(false)
		})

		it.each([
			["the parent was detached and cannot be re-attached", { status: "active" }, {}],
			[
				"the parent was detached during the approval gap",
				{ status: "delegated", awaitingChildId: CHILD_ID },
				{ reopened: false },
			],
			[
				"the child already completed",
				{ status: "delegated", awaitingChildId: CHILD_ID },
				{ childHistory: { status: "completed" } },
			],
			[
				"the child has an unexpected status",
				{ status: "delegated", awaitingChildId: CHILD_ID },
				{ childHistory: { status: "delegated" } },
			],
			[
				"the child's history cannot be read",
				{ status: "delegated", awaitingChildId: CHILD_ID },
				{ childHistory: new Error("gone") },
			],
			// Reopened from history a parallel subagent has parentTaskId as lineage only.
			[
				"the child is a parallel subagent reopened from history",
				{ status: "active", awaitingChildId: CHILD_ID },
				{ childHistory: { isSubagent: true } },
			],
		])("finalizes the task itself when %s", async (_, parentHistory, options) => {
			const { task, provider } = delegated(parentHistory, options)

			await complete(task)

			expect(askedForAcceptance(task)).toBe(true)
			expect(provider.reopenParentFromDelegation.mock.calls.length).toBe("reopened" in options ? 1 : 0)
		})

		it("never enters delegation for a live background task", async () => {
			const { task, provider } = delegated({ status: "delegated", awaitingChildId: CHILD_ID })
			task.isBackground = true

			await complete(task)

			expect(provider.getHistoryItem).not.toHaveBeenCalled()
			expect(askedForAcceptance(task)).toBe(true)
		})
	})
})
