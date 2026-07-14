// Text-only responses complete the task through the real AttemptCompletionTool
// instead of paying a full extra turn on a noToolsUsed retry. See
// ai_plans/2026-07-12_glm-agent-loop-efficiency-implementation.md (WS-5).
//
// npx vitest run core/task/__tests__/TaskApiLoop.text-completion-fallback.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskApiLoop } from "../TaskApiLoop"

const executeMock = vi.fn()

vi.mock("../../tools/AttemptCompletionTool", () => ({
	attemptCompletionTool: {
		execute: (...args: unknown[]) => executeMock(...args),
	},
}))

function makeLoop(overrides: Record<string, unknown> = {}) {
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		isPaused: false,
		apiConfiguration: { apiProvider: "anthropic" },
		api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) },
		apiConversationHistory: [],
		clineMessages: [],
		userMessageContent: [],
		streamProcessor: { assistantMessage: "All done. The fix is in place." },
		askSay: {
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		},
		providerRef: { deref: vi.fn().mockReturnValue(undefined) },
		todoList: undefined,
		...overrides,
	}
	const loop = new TaskApiLoop(access)
	return { loop: loop as any, access }
}

describe("TaskApiLoop text-completion fallback", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		executeMock.mockResolvedValue(undefined)
	})

	it("completes when the response is text-only and there are no todos", async () => {
		const { loop } = makeLoop()

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")

		expect(executeMock).toHaveBeenCalledTimes(1)
		expect(executeMock.mock.calls[0][0]).toEqual({ result: "All done. The fix is in place." })
	})

	it("skips when the text is empty", async () => {
		const { loop } = makeLoop({ streamProcessor: { assistantMessage: "   " } })

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("skipped")
		expect(executeMock).not.toHaveBeenCalled()
	})

	it("skips while todos are incomplete (mid-task narration must not complete)", async () => {
		const { loop } = makeLoop({
			todoList: [
				{ id: "1", content: "step 1", status: "completed" },
				{ id: "2", content: "step 2", status: "in_progress" },
			],
		})

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("skipped")
		expect(executeMock).not.toHaveBeenCalled()
	})

	it("completes when every todo is completed", async () => {
		const { loop } = makeLoop({
			todoList: [{ id: "1", content: "step 1", status: "completed" }],
		})

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")
		expect(executeMock).toHaveBeenCalledTimes(1)
	})

	it("skips when paused or aborted", async () => {
		const paused = makeLoop({ isPaused: true })
		await expect(paused.loop.tryTextCompletionFallback()).resolves.toBe("skipped")

		const aborted = makeLoop({ abort: true })
		await expect(aborted.loop.tryTextCompletionFallback()).resolves.toBe("skipped")

		expect(executeMock).not.toHaveBeenCalled()
	})

	it("returns feedback when the completion ask produced user feedback", async () => {
		executeMock.mockImplementation(async (_params: any, _task: any, callbacks: any) => {
			callbacks.pushToolResult("<user_message>\nplease also update the docs\n</user_message>")
		})
		const { loop, access } = makeLoop()

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("feedback")
		expect(access.userMessageContent).toEqual([
			{ type: "text", text: "<user_message>\nplease also update the docs\n</user_message>" },
		])
	})

	it("treats an empty pushToolResult (delegated subtask return) as completed", async () => {
		executeMock.mockImplementation(async (_params: any, _task: any, callbacks: any) => {
			callbacks.pushToolResult("")
		})
		const { loop } = makeLoop()

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")
	})

	it("skips when the completion tool throws", async () => {
		executeMock.mockRejectedValue(new Error("boom"))
		const { loop } = makeLoop()

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("skipped")
	})
})
