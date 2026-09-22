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
		history: {
			saveClineMessages: vi.fn().mockResolvedValue(true),
			updateClineMessage: vi.fn().mockResolvedValue(undefined),
		},
		cloudSyncedMessageTimestamps: new Set<number>(),
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

	it("skips while a todo is still pending (mid-task narration must not complete)", async () => {
		const { loop } = makeLoop({
			todoList: [
				{ id: "1", content: "step 1", status: "completed" },
				{ id: "2", content: "step 2", status: "in_progress" },
				{ id: "3", content: "step 3", status: "pending" },
			],
		})

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("skipped")
		expect(executeMock).not.toHaveBeenCalled()
	})

	it("completes when the only open todo is in_progress (the text is that item's delivery)", async () => {
		// Task 01a08a32 (2026-09-10): reminder 5 "Deliver news summary to user"
		// was In Progress while the text-only turn was the summary itself; the
		// old gate forced a noToolsUsed retry that regenerated the same answer
		// through attempt_completion. See
		// ai_plans/2026-09-10_text-completion-single-result.md.
		const { loop } = makeLoop({
			todoList: [
				{ id: "1", content: "fetch articles", status: "completed" },
				{ id: "2", content: "deliver summary to user", status: "in_progress" },
			],
		})

		await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")
		expect(executeMock).toHaveBeenCalledTimes(1)
		expect(executeMock.mock.calls[0][0]).toEqual({ result: "All done. The fix is in place." })
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

	describe("merging the streamed text into the result block", () => {
		const apiReqStarted = { ts: 100, type: "say", say: "api_req_started", text: "{}" }
		const streamed = { ts: 300, type: "say", say: "text", text: "All done. The fix is in place.\n", partial: false }

		it("relabels this turn's text say as completion_result in place and passes its text as the result", async () => {
			const { loop, access } = makeLoop({
				clineMessages: [
					apiReqStarted,
					{ ts: 200, type: "say", say: "reasoning", text: "thinking" },
					{ ...streamed },
				],
				cloudSyncedMessageTimestamps: new Set([100, 200, 300]),
			})

			await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")

			// Same ts, new label: the webview swaps the row instead of appending one.
			expect(access.clineMessages[2]).toMatchObject({ ts: 300, say: "completion_result", text: streamed.text })
			expect(access.clineMessages.filter((m: any) => m.say === "text")).toHaveLength(0)
			expect(access.history.saveClineMessages).toHaveBeenCalledTimes(1)
			expect(access.history.updateClineMessage).toHaveBeenCalledWith(access.clineMessages[2])
			// The completion_result revision must reach the cloud too.
			expect(access.cloudSyncedMessageTimestamps.has(300)).toBe(false)
			expect(access.cloudSyncedMessageTimestamps.has(200)).toBe(true)
			// The relabelled message's exact text, so AttemptCompletionTool's
			// alreadyFinalized check matches and it does not say it a second time.
			expect(executeMock.mock.calls[0][0]).toEqual({ result: streamed.text })
		})

		it("never touches a text say from an earlier turn", async () => {
			const earlier = { ts: 50, type: "say", say: "text", text: "earlier narration", partial: false }
			const { loop, access } = makeLoop({
				clineMessages: [earlier, { ...apiReqStarted }],
				cloudSyncedMessageTimestamps: new Set([50, 100]),
			})

			await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")

			expect(access.clineMessages[0].say).toBe("text")
			expect(access.history.updateClineMessage).not.toHaveBeenCalled()
			expect(access.cloudSyncedMessageTimestamps.has(50)).toBe(true)
			expect(executeMock.mock.calls[0][0]).toEqual({ result: "All done. The fix is in place." })
		})

		it("leaves a still-partial text say alone", async () => {
			const { loop, access } = makeLoop({
				clineMessages: [
					{ ...apiReqStarted },
					{ ts: 300, type: "say", say: "text", text: "All done", partial: true },
				],
			})

			await expect(loop.tryTextCompletionFallback()).resolves.toBe("completed")

			expect(access.clineMessages[1].say).toBe("text")
			expect(access.history.updateClineMessage).not.toHaveBeenCalled()
			expect(executeMock.mock.calls[0][0]).toEqual({ result: "All done. The fix is in place." })
		})
	})
})
