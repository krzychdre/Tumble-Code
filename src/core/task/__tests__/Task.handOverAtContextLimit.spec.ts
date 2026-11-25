// cd src && ./node_modules/.bin/vitest run core/task/__tests__/Task.handOverAtContextLimit.spec.ts

import { Task } from "../Task"

const MESSAGE = "Its context window was 85% full, so it handed its work over."

// A delegated task at its context limit returns to its parent with its last words and open TODO items.
describe("Task#handOverAtContextLimit", () => {
	function child(isBackground: boolean, reopened: boolean) {
		const provider = { reopenParentFromDelegation: vi.fn().mockResolvedValue(reopened) }
		const task = {
			taskId: "child-1",
			parentTaskId: "parent-1",
			isBackground,
			contextHandoff: true,
			abortReason: undefined as string | undefined,
			clineMessages: [
				{ ts: 1, type: "say", say: "text", text: "Wired the parser; the build is next." },
				{ ts: 2, type: "say", say: "text", text: "partial", partial: true },
			],
			todoList: [{ id: "1", content: "run the build", status: "pending" }],
			providerRef: { deref: () => provider },
			stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
			say: vi.fn().mockResolvedValue(undefined),
			abortTask: vi.fn().mockResolvedValue(undefined),
		}
		return { task, provider }
	}

	const handOver = (task: object) => Task.prototype.handOverAtContextLimit.call(task as unknown as Task, MESSAGE)

	it("stops a subagent with reason context", async () => {
		const { task, provider } = child(true, true)

		await handOver(task)

		expect(task.stopBackgroundTask).toHaveBeenCalledWith("context", MESSAGE)
		expect(provider.reopenParentFromDelegation).not.toHaveBeenCalled()
	})

	it("returns a new_task child's last words and open TODO items to its parent", async () => {
		const { task, provider } = child(false, true)

		await handOver(task)

		expect(provider.reopenParentFromDelegation).toHaveBeenCalledWith({
			parentTaskId: "parent-1",
			childTaskId: "child-1",
			completionResultSummary: "Wired the parser; the build is next.",
			notes: expect.stringContaining("TODO items it left open:\n\n- run the build"),
		})
		expect(task.abortTask).not.toHaveBeenCalled()
	})

	it("aborts a new_task child whose parent no longer waits, with the reason shown", async () => {
		const { task } = child(false, false)

		await handOver(task)

		expect(task.say).toHaveBeenCalledWith("error", `Task stopped: ${MESSAGE}`)
		expect(task.abortReason).toBe("context")
		expect(task.abortTask).toHaveBeenCalled()
	})
})
