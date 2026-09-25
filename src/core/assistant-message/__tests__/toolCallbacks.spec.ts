// npx vitest run src/core/assistant-message/__tests__/toolCallbacks.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

import { formatResponse } from "../../prompts/responses"
import { BaseTool } from "../../tools/BaseTool"
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

	describe("the error a tool reports reaches the model without its stack trace", () => {
		/**
		 * A real `BaseTool` whose `execute` throws: the safety net in `BaseTool.handle`
		 * routes the throw to `handleError`, which is the path every tool failure ends on.
		 */
		class ThrowingTool extends BaseTool<"read_file"> {
			readonly name = "read_file" as const
			constructor(private readonly error: unknown) {
				super()
			}
			async execute(): Promise<void> {
				throw this.error
			}
		}

		function toolResultText(): string {
			const [[toolResult]] = task.pushToolResultToUserContent.mock.calls
			return String(toolResult.content)
		}

		beforeEach(() => {
			vi.spyOn(console, "error").mockImplementation(() => {})
		})

		it("sends only the message of an Error thrown inside a tool", async () => {
			const error = new Error("ENOENT: no such file or directory, open 'missing.ts'")
			error.stack = `Error: ${error.message}\n    at ThrowingTool.execute (/home/someone/project/src/core/tools/ReadFileTool.ts:42:13)`
			const callbacks = createToolCallbacks(task, {
				block: { type: "tool_use" },
				toolCallId: "call_1",
				toolName: "read_file",
			})

			await new ThrowingTool(error).handle(
				task,
				{ type: "tool_use", name: "read_file", params: {}, nativeArgs: {}, partial: false } as any,
				callbacks,
			)

			const text = toolResultText()
			const parsed = JSON.parse(text)
			expect(parsed.error).toBe("Error executing read_file: ENOENT: no such file or directory, open 'missing.ts'")
			expect(text).not.toContain("stack")
			expect(text).not.toContain("ReadFileTool.ts:42")
			expect(text).not.toContain("/home/someone")
			// The teaching fields from formatResponse.toolError are still there.
			expect(parsed.status).toBe("error")
			expect(parsed.failed_tool).toBe("read_file")
			expect(parsed.minimal_valid_example).toBeDefined()
		})

		it("keeps the stack in the log and the plain message in the UI", async () => {
			const error = new Error("boom")
			error.stack = "Error: boom\n    at somewhere (/home/someone/project/file.ts:1:1)"
			const callbacks = createToolCallbacks(task, {
				block: { type: "tool_use" },
				toolCallId: "call_1",
				toolName: "read_file",
			})

			await callbacks.handleError("reading file", error, "read_file")

			expect(task.askSay.say).toHaveBeenCalledWith("error", "Error reading file:\nboom")
			const logged = vi
				.mocked(console.error)
				.mock.calls.flat()
				.map((arg) => (arg instanceof Error ? String(arg.stack) : String(arg)))
				.join("\n")
			expect(logged).toContain("at somewhere (/home/someone/project/file.ts:1:1)")
		})

		it("keeps the message of the cause, without the cause's stack", async () => {
			const cause = new Error("connect ECONNREFUSED 127.0.0.1:443")
			cause.stack = "Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect (node:net:1:1)"
			const error = new Error("fetch failed", { cause })
			const callbacks = createToolCallbacks(task, {
				block: { type: "tool_use" },
				toolCallId: "call_1",
				toolName: "read_file",
			})

			await callbacks.handleError("fetching", error, "read_file")

			const text = toolResultText()
			expect(JSON.parse(text).error).toBe(
				"Error fetching: fetch failed (cause: connect ECONNREFUSED 127.0.0.1:443)",
			)
			expect(text).not.toContain("afterConnect")
		})

		it("describes a thrown value without a message, still without a stack", async () => {
			const callbacks = createToolCallbacks(task, {
				block: { type: "tool_use" },
				toolCallId: "call_1",
				toolName: "read_file",
			})
			const notAnError = { code: "E_WEIRD", stack: "at nowhere (/secret/path.ts:1:1)" }

			await callbacks.handleError("doing things", notAnError as unknown as Error, "read_file")

			const text = toolResultText()
			expect(JSON.parse(text).error).toBe('Error doing things: {"code":"E_WEIRD"}')
			expect(text).not.toContain("/secret/path.ts")
		})
	})
})
