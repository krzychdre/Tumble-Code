// npx vitest core/tools/__tests__/updateTodoListTool.perTask.spec.ts
//
// DEF-C3: the list a user edits in the approval dialog ("pending todo list")
// used to be one module-level variable shared by every task. A parallel
// subagent (or any second task) that ran update_todo_list while the foreground
// task was waiting for approval replaced it, so the foreground task adopted
// the other task's list as if the user had edited it.

import type { TodoItem } from "@roo-code/types"

import { updateTodoListTool } from "../UpdateTodoListTool"

function makeTask(name: string): any {
	return {
		taskId: name,
		todoList: undefined as TodoItem[] | undefined,
		consecutiveMistakeCount: 0,
		say: vi.fn().mockResolvedValue(undefined),
		recordToolError: vi.fn(),
	}
}

function block(todos: string) {
	return {
		type: "tool_use",
		name: "update_todo_list",
		id: "call-todo",
		params: { todos },
		nativeArgs: { todos },
		partial: false,
	} as any
}

/** askApproval that stays pending until the returned `approve()` is called, like a manual approval dialog. */
function manualApproval() {
	let approve!: (value: boolean) => void
	const pending = new Promise<boolean>((resolve) => (approve = resolve))
	return { askApproval: vi.fn(() => pending), approve }
}

const contents = (todos: TodoItem[] | undefined) => (todos ?? []).map((t) => t.content)

describe("DEF-C3: update_todo_list approval is scoped to its own task", () => {
	it("a second task's auto-approved update does not replace the list the first task is waiting to approve", async () => {
		const foreground = makeTask("foreground")
		const subagent = makeTask("subagent")

		// Foreground asks the user to approve its list and waits.
		const fg = manualApproval()
		const fgPush = vi.fn()
		const fgRun = updateTodoListTool.handle(foreground, block("[ ] fg one\n[ ] fg two"), {
			askApproval: fg.askApproval,
			handleError: vi.fn(),
			pushToolResult: fgPush,
		})
		await vi.waitFor(() => expect(fg.askApproval).toHaveBeenCalled())

		// Meanwhile a parallel subagent updates its own list (auto-approved).
		const subPush = vi.fn()
		await updateTodoListTool.handle(subagent, block("[ ] sub one"), {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: subPush,
		})

		// The user approves the foreground list unchanged.
		fg.approve(true)
		await fgRun

		expect(contents(foreground.todoList)).toEqual(["fg one", "fg two"])
		expect(contents(subagent.todoList)).toEqual(["sub one"])
		// No phantom "user edited the list" for either task.
		expect(foreground.say).not.toHaveBeenCalledWith("user_edit_todos", expect.anything())
		expect(subagent.say).not.toHaveBeenCalledWith("user_edit_todos", expect.anything())
		expect(fgPush.mock.calls[0][0]).toContain("Todo list updated successfully.")
		expect(subPush.mock.calls[0][0]).toContain("Todo list updated successfully.")
	})

	it("a user edit made in one task's approval dialog is adopted by that task only", async () => {
		const foreground = makeTask("foreground")
		const subagent = makeTask("subagent")

		const fg = manualApproval()
		const sub = manualApproval()
		const fgRun = updateTodoListTool.handle(foreground, block("[ ] fg one"), {
			askApproval: fg.askApproval,
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		})
		const subRun = updateTodoListTool.handle(subagent, block("[ ] sub one"), {
			askApproval: sub.askApproval,
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		})
		await vi.waitFor(() => {
			expect(fg.askApproval).toHaveBeenCalled()
			expect(sub.askApproval).toHaveBeenCalled()
		})

		// The user edits the foreground list in its dialog, then both are approved.
		const edited: TodoItem[] = [
			{ id: "e1", content: "fg one", status: "completed" },
			{ id: "e2", content: "fg added by user", status: "pending" },
		]
		foreground.pendingTodoList = edited
		fg.approve(true)
		sub.approve(true)
		await Promise.all([fgRun, subRun])

		expect(contents(foreground.todoList)).toEqual(["fg one", "fg added by user"])
		expect(foreground.say).toHaveBeenCalledWith("user_edit_todos", expect.any(String))
		expect(contents(subagent.todoList)).toEqual(["sub one"])
		expect(subagent.say).not.toHaveBeenCalledWith("user_edit_todos", expect.anything())
		// The pending edit slot is cleared once the approval is settled.
		expect(foreground.pendingTodoList).toBeUndefined()
		expect(subagent.pendingTodoList).toBeUndefined()
	})
})
