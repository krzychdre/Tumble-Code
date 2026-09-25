// npx vitest run src/core/assistant-message/__tests__/toolCallbacks.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

import { formatResponse } from "../../prompts/responses"
import { createToolCallbacks } from "../toolCallbacks"

vi.mock("../../task/Task")

/**
 * Unit tests for the one factory that builds the callbacks `presentAssistantMessage` hands
 * to a tool. The end-to-end behavior for both block kinds is pinned in
 * `presentAssistantMessage-tool-callbacks.spec.ts`; these cover what only the factory sees.
 */
describe("createToolCallbacks", () => {
	let task: any

	beforeEach(() => {
		task = {
			abort: false,
			abandoned: false,
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			userMessageContent: [],
			recordToolError: vi.fn(),
			pushToolResultToUserContent: vi.fn(),
			askSay: {
				ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
				say: vi.fn().mockResolvedValue(undefined),
			},
		}
	})

	it("records the result under the tool name it was given", () => {
		const callbacks = createToolCallbacks(task, {
			block: { type: "tool_use" },
			toolCallId: "call_1",
			toolName: "read_file",
		})

		callbacks.pushToolResult("contents")

		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			{ type: "tool_result", tool_use_id: "call_1", content: "contents" },
			{ toolName: "read_file" },
		)
	})

	it("reports through hasToolResult whether the block already delivered its result", () => {
		const callbacks = createToolCallbacks(task, {
			block: { type: "tool_use" },
			toolCallId: "call_1",
			toolName: "read_file",
		})

		expect(callbacks.hasToolResult()).toBe(false)
		callbacks.pushToolResult("contents")
		expect(callbacks.hasToolResult()).toBe(true)
	})

	it("pushes nothing when there is no tool call id, but still closes the block", () => {
		const callbacks = createToolCallbacks(task, {
			block: { type: "mcp_tool_use" },
			toolCallId: undefined,
			toolName: "use_mcp_tool",
		})

		callbacks.pushToolResult("orphan")

		expect(task.pushToolResultToUserContent).not.toHaveBeenCalled()
		expect(task.userMessageContent).toEqual([])
		expect(callbacks.hasToolResult()).toBe(true)
	})

	it("asks for the finish-subtask approval as a finishTask tool ask", async () => {
		const callbacks = createToolCallbacks(task, {
			block: { type: "tool_use" },
			toolCallId: "call_1",
			toolName: "attempt_completion",
		})

		await expect(callbacks.askFinishSubTaskApproval()).resolves.toBe(true)
		expect(task.askSay.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "finishTask" }),
			false,
			undefined,
			false,
		)
	})

	it("keeps the callbacks of two blocks independent", () => {
		const first = createToolCallbacks(task, { block: { type: "tool_use" }, toolCallId: "a", toolName: "x" })
		const second = createToolCallbacks(task, { block: { type: "tool_use" }, toolCallId: "b", toolName: "y" })

		first.pushToolResult("one")
		second.pushToolResult(formatResponse.toolDenied())

		expect(task.pushToolResultToUserContent).toHaveBeenCalledTimes(2)
		expect(first.hasToolResult()).toBe(true)
		expect(second.hasToolResult()).toBe(true)
	})
})
