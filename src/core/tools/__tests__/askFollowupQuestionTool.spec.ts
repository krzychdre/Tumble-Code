// AskFollowupQuestionTool with the real response formatting; only the task is replaced.

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { AskFollowupQuestionTool } from "../AskFollowupQuestionTool"
import { formatResponse } from "../../prompts/responses"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"

const IMAGE = "data:image/png;base64,AAAA"

function makeTask(answer: { text?: string; images?: string[] } = { text: "User answer", images: [IMAGE] }) {
	return {
		consecutiveMistakeCount: 2,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		sayAndCreateMissingParamError: vi.fn(async (_tool: string, param: string) => `missing ${param}`),
		ask: vi.fn().mockResolvedValue(answer),
		say: vi.fn().mockResolvedValue(undefined),
	} as unknown as Task & Record<"ask" | "say" | "recordToolError", ReturnType<typeof vi.fn>>
}

function makeCallbacks() {
	return { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() } as unknown as ToolCallbacks &
		Record<"askApproval" | "handleError" | "pushToolResult", ReturnType<typeof vi.fn>>
}

const run = async (params: Record<string, unknown>, task = makeTask()) => {
	const callbacks = makeCallbacks()
	await new AskFollowupQuestionTool().execute(params as any, task, callbacks)
	return { task, callbacks }
}

describe("AskFollowupQuestionTool", () => {
	it.each([
		[{ question: "", follow_up: [{ text: "Yes" }] }, "question"],
		[{ question: "Q?", follow_up: null }, "follow_up"],
		[{ question: "Q?" }, "follow_up"],
	])("reports %j as a missing %s and fails the turn", async (params, param) => {
		const { task, callbacks } = await run(params)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(`missing ${param}`)
		expect(task.recordToolError).toHaveBeenCalledWith("ask_followup_question")
		expect(task.consecutiveMistakeCount).toBe(3)
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(task.ask).not.toHaveBeenCalled()
	})

	it.each([["Yes or no"], [{ text: "Yes" }], [5]])(
		"reports a follow_up of %j as a shape error, not a missing value",
		async (followUp) => {
			const { task, callbacks } = await run({ question: "Q?", follow_up: followUp })

			const [[type, message]] = task.say.mock.calls
			expect(type).toBe("error")
			expect(message).toContain("must be an array of suggestion objects")
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(formatResponse.toolError(message))
			expect(task.didToolFailInCurrentTurn).toBe(true)
			expect(task.ask).not.toHaveBeenCalled()
		},
	)

	it("asks with the usable suggestions and returns the answer with its images", async () => {
		const followUp = [
			{ text: "Yes" },
			{ text: "Do it", mode: "code" },
			"bare answer",
			"  ",
			{ text: "" },
			{ text: 5 },
			null,
			{},
		]

		const { task, callbacks } = await run({ question: "Proceed?", follow_up: followUp })

		expect(task.ask).toHaveBeenCalledWith(
			"followup",
			JSON.stringify({
				question: "Proceed?",
				suggest: [
					{ answer: "Yes", mode: undefined },
					{ answer: "Do it", mode: "code" },
					{ answer: "bare answer", mode: undefined },
				],
			}),
			false,
		)
		expect(task.say).toHaveBeenCalledWith("user_feedback", "User answer", [IMAGE])
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolResult("<user_message>\nUser answer\n</user_message>", [IMAGE]),
		)
		expect(task.consecutiveMistakeCount).toBe(0)
		expect(callbacks.askApproval).not.toHaveBeenCalled()
	})

	it("returns an empty message for an answer without text", async () => {
		const { task, callbacks } = await run({ question: "Q?", follow_up: [] }, makeTask({}))

		expect(task.say).toHaveBeenCalledWith("user_feedback", "", undefined)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolResult("<user_message>\n\n</user_message>"),
		)
	})

	it("hands a failed ask to handleError", async () => {
		const task = makeTask()
		const failure = new Error("aborted")
		task.ask.mockRejectedValue(failure)

		const { callbacks } = await run({ question: "Q?", follow_up: [] }, task)

		expect(callbacks.handleError).toHaveBeenCalledWith("asking question", failure, "ask_followup_question")
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it.each([
		[{ question: "native" }, { question: "param" }, "native"],
		[undefined, { question: "param" }, "param"],
		[undefined, {}, ""],
	])("shows only the question while streaming (nativeArgs %j, params %j)", async (nativeArgs, params, shown) => {
		const task = makeTask()
		const block = { type: "tool_use", name: "ask_followup_question", params, nativeArgs, partial: true }

		await new AskFollowupQuestionTool().handlePartial(task, block as unknown as ToolUse<"ask_followup_question">)

		expect(task.ask).toHaveBeenCalledWith("followup", shown, true)
	})

	it("ignores a rejected placeholder ask", async () => {
		const task = makeTask()
		task.ask.mockRejectedValue(new Error("ask promise was ignored"))
		const block = { type: "tool_use", name: "ask_followup_question", params: { question: "Q" }, partial: true }

		await expect(
			new AskFollowupQuestionTool().handlePartial(task, block as unknown as ToolUse<"ask_followup_question">),
		).resolves.toBeUndefined()
	})

	// ===== NativeToolCallParser integration tests for ask_followup_question =====

	describe("NativeToolCallParser.createPartialToolUse for ask_followup_question", () => {
		let parser: NativeToolCallParser

		beforeEach(() => {
			parser = new NativeToolCallParser()
			parser.clearAllStreamingToolCalls()
			parser.clearRawChunkState()
		})

		it("should build nativeArgs with question and follow_up during streaming", () => {
			// Start a streaming tool call
			parser.startStreamingToolCall("call_123", "ask_followup_question")

			// Simulate streaming JSON chunks
			const chunk1 = '{"question":"What would you like?","follow_up":[{"text":"Option 1","mode":"code"}'
			const result1 = parser.processStreamingChunk("call_123", chunk1)

			expect(result1).not.toBeNull()
			expect(result1?.name).toBe("ask_followup_question")
			expect(result1?.params.question).toBe("What would you like?")
			expect(result1?.nativeArgs).toBeDefined()
			// Use type assertion to access the specific fields
			const nativeArgs = result1?.nativeArgs as {
				question: string
				follow_up?: Array<{ text: string; mode?: string }>
			}
			expect(nativeArgs?.question).toBe("What would you like?")
			// partial-json should parse the incomplete array
			expect(nativeArgs?.follow_up).toBeDefined()
		})

		it("should finalize with complete nativeArgs", () => {
			parser.startStreamingToolCall("call_456", "ask_followup_question")

			// Add complete JSON
			const completeJson =
				'{"question":"Choose an option","follow_up":[{"text":"Yes","mode":"code"},{"text":"No","mode":null}]}'
			parser.processStreamingChunk("call_456", completeJson)

			const result = parser.finalizeStreamingToolCall("call_456")

			expect(result).not.toBeNull()
			expect(result?.type).toBe("tool_use")
			expect(result?.name).toBe("ask_followup_question")
			expect(result?.partial).toBe(false)
			// Type guard: regular tools have type 'tool_use', MCP tools have type 'mcp_tool_use'
			if (result?.type === "tool_use") {
				expect(result.nativeArgs).toEqual({
					question: "Choose an option",
					follow_up: [
						{ text: "Yes", mode: "code" },
						{ text: "No", mode: null },
					],
				})
			}
		})
	})
})
