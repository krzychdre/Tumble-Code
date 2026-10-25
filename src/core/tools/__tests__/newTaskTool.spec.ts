// NewTaskTool with the real mode table, todo parsing and response formatting; the task, its
// provider (history and delegation) and the VS Code setting are replaced. The compact-profile
// refusal is pinned in subagents-compact-profile.spec.ts.

import * as vscode from "vscode"

import type { ToolUse } from "../../../shared/tools"
import { Package } from "../../../shared/package"
import { newTaskTool } from "../NewTaskTool"
import { parseMarkdownChecklist } from "../UpdateTodoListTool"
import { formatResponse } from "../../prompts/responses"

// A chain of history items, child -> parent, keyed by task id.
type History = Record<string, { parentTaskId?: string }>

function makeTask(opts: { mode?: string; parentTaskId?: string; history?: History; isBackground?: boolean } = {}) {
	const history = opts.history ?? {}
	const provider = {
		getState: vi.fn().mockResolvedValue({ customModes: [] }),
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
		getHistoryItem: vi.fn(async (id: string) => {
			if (!history[id]) throw new Error("Task not found")
			return history[id]
		}),
	}
	const task = {
		ask: vi.fn().mockResolvedValue({}),
		sayAndCreateMissingParamError: vi.fn(async (_tool: string, param: string) => `missing ${param}`),
		recordToolError: vi.fn(),
		consecutiveMistakeCount: 2,
		didToolFailInCurrentTurn: false,
		taskId: "current-task",
		isBackground: opts.isBackground ?? false,
		parentTaskId: opts.parentTaskId,
		apiConfiguration: {},
		getTaskMode: vi.fn().mockResolvedValue(opts.mode ?? "orchestrator"),
		providerRef: { deref: () => provider as typeof provider | undefined },
	}
	return { task, provider }
}

async function callNewTask(
	task: ReturnType<typeof makeTask>["task"],
	params: Record<string, string | undefined>,
	approve = true,
) {
	const callbacks = { askApproval: vi.fn().mockResolvedValue(approve), handleError: vi.fn(), pushToolResult: vi.fn() }
	const block = { type: "tool_use", name: "new_task", id: "call-1", params, nativeArgs: params, partial: false }
	await newTaskTool.handle(task as any, block as unknown as ToolUse<"new_task">, {
		...callbacks,
		toolCallId: "call-1",
	})
	return callbacks
}

// A chain of `levels` ancestors above "current-task": a1 (its parent) ... aN (the root).
const chainOf = (levels: number) => {
	const history: History = {}
	for (let i = 1; i <= levels; i++) {
		history[`a${i}`] = { parentTaskId: i < levels ? `a${i + 1}` : undefined }
	}
	return { parentTaskId: levels > 0 ? "a1" : undefined, history }
}

let requireTodos = false
beforeEach(() => {
	requireTodos = false
	vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
		(section?: string) =>
			({
				get: (key: string, fallback: unknown) =>
					section === Package.name && key === "newTaskRequireTodos" ? requireTodos : fallback,
			}) as any,
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("newTaskTool", () => {
	it("delegates after approval and reports the child", async () => {
		const { task, provider } = makeTask()
		const todos = "[ ] plan\n[x] read\n[-] write"

		const callbacks = await callNewTask(task, { mode: "code", message: "Do it", todos })

		const todoItems = parseMarkdownChecklist(todos)
		expect(todoItems.map((t) => t.status)).toEqual(["pending", "completed", "in_progress"])
		expect(JSON.parse(callbacks.askApproval.mock.calls[0][1])).toEqual({
			tool: "newTask",
			mode: "💻 Code",
			content: "Do it",
			todos: todoItems,
			toolCallId: "call-1",
		})
		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith({
			parentTaskId: "current-task",
			message: "Do it",
			initialTodos: todoItems,
			mode: "code",
		})
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Delegated to child task child-1")
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it.each([
		["\\\\@file", "\\@file"],
		["\\@file", "\\@file"],
		["@file and \\\\@other", "@file and \\@other"],
	])("hands %j to the child as %j (one level of escaping removed)", async (message, delivered) => {
		const { task, provider } = makeTask()

		await callNewTask(task, { mode: "code", message })

		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith(
			expect.objectContaining({ message: delivered }),
		)
	})

	it.each([
		[{ message: "x" }, "mode"],
		[{ mode: "code" }, "message"],
	])("reports %j as missing its %s and fails the turn", async (params, param) => {
		const { task, provider } = makeTask()

		const callbacks = await callNewTask(task, params)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(`missing ${param}`)
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
	})

	it.each([
		[true, undefined, false],
		[true, "", true],
		[false, undefined, true],
	])("with newTaskRequireTodos %s and todos %j delegates: %s", async (setting, todos, delegates) => {
		requireTodos = setting
		const { task, provider } = makeTask()

		const callbacks = await callNewTask(task, { mode: "code", message: "x", todos })

		expect(provider.delegateParentAndOpenChild.mock.calls.length > 0).toBe(delegates)
		if (!delegates) expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing todos")
	})

	it.each([
		[
			"inside a background subtask",
			makeTask({ isBackground: true }).task,
			"new_task is not available inside a parallel subtask.",
		],
		["for an unknown mode", makeTask().task, "Invalid mode: nope"],
	])("refuses %s", async (_, task, error) => {
		const callbacks = await callNewTask(task, { mode: "nope", message: "x" })

		expect(callbacks.pushToolResult.mock.calls[0][0]).toContain(error)
		expect(callbacks.askApproval).not.toHaveBeenCalled()
	})

	it("refuses when the provider is gone", async () => {
		const { task } = makeTask()
		task.providerRef.deref = () => undefined

		const callbacks = await callNewTask(task, { mode: "code", message: "x" })

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(formatResponse.toolError("Provider reference lost"))
	})

	it("does not delegate when the user rejects", async () => {
		const { task, provider } = makeTask()

		await callNewTask(task, { mode: "code", message: "x" }, false)

		expect(provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
	})

	it("hands a failed delegation to handleError", async () => {
		const { task, provider } = makeTask()
		const failure = new Error("no child")
		provider.delegateParentAndOpenChild.mockRejectedValue(failure)

		const callbacks = await callNewTask(task, { mode: "code", message: "x" })

		expect(callbacks.handleError).toHaveBeenCalledWith("creating new task", failure, "new_task")
	})

	it("shows the raw call while it streams", async () => {
		const { task } = makeTask()
		const block = {
			type: "tool_use",
			name: "new_task",
			id: "call-2",
			params: { mode: "code", todos: "[ ] a" },
			partial: true,
		}

		await newTaskTool.handle(task as any, block as unknown as ToolUse<"new_task">, {} as any)

		expect(task.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "newTask", mode: "code", content: "", todos: "[ ] a", toolCallId: "call-2" }),
			true,
		)
	})
})

describe("newTaskTool delegation guard", () => {
	const refusal = async (opts: Parameters<typeof makeTask>[0], targetMode: string) => {
		const { task, provider } = makeTask(opts)
		const callbacks = await callNewTask(task, { mode: targetMode, message: "Do something" })
		const delegated = provider.delegateParentAndOpenChild.mock.calls.length > 0
		return { task, provider, callbacks, delegated }
	}

	it("refuses a subtask delegating to its own mode (the ask -> ask loop)", async () => {
		const { task, callbacks, delegated } = await refusal({ mode: "ask", ...chainOf(1) }, "ask")

		expect(delegated).toBe(false)
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(3)
		// Counted as a mistake, but attempt_completion stays open.
		expect(task.didToolFailInCurrentTurn).toBe(false)
		const result = JSON.parse(callbacks.pushToolResult.mock.calls[0][0]).error as string
		expect(result).toContain('already a subtask in "ask" mode')
		expect(result).toContain("Do the work yourself in this task")
	})

	it.each([
		["the task the user started delegating to its own mode (fresh context)", { mode: "code" }, "code"],
		["orchestrator -> code -> ask", { mode: "code", ...chainOf(1) }, "ask"],
		["a child at the depth limit (5 levels below the root)", { mode: "code", ...chainOf(4) }, "ask"],
		[
			"a child whose parent is missing from the history (only known ancestors count)",
			{ mode: "code", parentTaskId: "gone" },
			"ask",
		],
	])("allows %s", async (_, opts, targetMode) => {
		expect((await refusal(opts, targetMode)).delegated).toBe(true)
	})

	it("refuses a child deeper than the limit, walking parentTaskId through the history", async () => {
		const { callbacks, delegated } = await refusal({ mode: "code", ...chainOf(5) }, "ask")

		expect(delegated).toBe(false)
		expect(callbacks.pushToolResult.mock.calls[0][0]).toContain(
			"already 5 levels of subtasks below the task the user started, which is the limit (5)",
		)
	})

	it("stops walking a chain that points back at itself", async () => {
		const history = { a1: { parentTaskId: "a2" }, a2: { parentTaskId: "a1" } }
		const { provider, delegated } = await refusal({ mode: "code", parentTaskId: "a1", history }, "ask")

		expect(provider.getHistoryItem).toHaveBeenCalledTimes(5)
		expect(delegated).toBe(false)
	})
})
