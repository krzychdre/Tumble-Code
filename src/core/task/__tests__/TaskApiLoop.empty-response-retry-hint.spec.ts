// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.empty-response-retry-hint.spec.ts

// An Orchestrator task on GLM-5.3-Flash (vLLM) looped forever: the model called
// execute_command, which the mode does not have, vLLM dropped the call without an
// error, and the client saw an answer with no text and no tool call. The retry sent
// the identical content, so the model made the identical call. The retry now
// carries a note naming the tools the model can call.
// See ai_plans/2026-10-07_18-42_empty-response-retry-hint.md.

import { TaskApiLoop } from "../TaskApiLoop"
import { formatResponse } from "../../prompts/responses"
import { logger } from "../../../utils/logging"

function functionTool(name: string) {
	return { type: "function" as const, function: { name, description: name, parameters: {} } }
}

function makeLoop(options: { autoApprovalEnabled?: boolean } = {}) {
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "openai" },
		api: {
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
			createMessage: vi.fn(async function* () {
				yield { type: "text" as const, text: "ok" }
			}),
			cancelRequest: vi.fn(),
		},
		apiConversationHistory: [],
		clineMessages: [],
		microcompactStrippedTokens: 0,
		skipPrevResponseIdOnce: false,
		consecutiveNoAssistantMessagesCount: 0,
		providerRef: {
			deref: () => ({ getState: async () => ({ autoApprovalEnabled: options.autoApprovalEnabled ?? true }) }),
		},
		getTaskMode: async () => "orchestrator",
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			say: vi.fn().mockResolvedValue(undefined),
		},
		history: {
			addToApiConversationHistory: vi.fn(async (message: unknown) => {
				access.apiConversationHistory.push(message)
			}),
		},
		abortTask: vi.fn(),
	}
	const loop = new TaskApiLoop(access)
	vi.spyOn(loop, "getSystemPrompt").mockResolvedValue("system prompt")
	vi.spyOn((loop as any).retryHandler, "maybeWaitForProviderRateLimit").mockResolvedValue(undefined)
	vi.spyOn((loop as any).retryHandler, "backoffAndAnnounce").mockResolvedValue(undefined)
	const buildToolsArray = vi.spyOn(loop as any, "buildToolsArray")
	return { loop: loop as any, access, buildToolsArray }
}

/** Run one request so the loop remembers the tools it offered. */
async function sendRequest(loop: any): Promise<void> {
	for await (const _chunk of loop.attemptApiRequest()) {
		// drain
	}
}

function notesIn(content: any[]): string[] {
	return content
		.filter((block) => block.type === "text" && formatResponse.isEmptyResponseRetryNote(block.text))
		.map((block) => block.text)
}

const ORCHESTRATOR_TOOLS = ["new_task", "ask_followup_question", "attempt_completion", "update_todo_list"]

describe("TaskApiLoop: the retry of an empty answer names the callable tools", () => {
	beforeEach(() => {
		vi.spyOn(logger, "info").mockImplementation(() => {})
		vi.spyOn(logger, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("the note text names the tools and says a call to an unlisted tool is discarded", () => {
		expect(formatResponse.emptyResponseRetryNote(["read_file", "attempt_completion"])).toBe(
			"[ERROR] Your previous reply produced no text and no tool call that reached the system.\n" +
				"A call to a tool that is not in your tool list is rejected by the server and discarded.\n" +
				"The tools you can call now are: read_file, attempt_completion.\n" +
				"Reply with one of these tools, or with plain text.",
		)
		expect(formatResponse.emptyResponseRetryNote([])).toContain(
			"You have no tools in this request. Reply with plain text.",
		)
	})

	it("auto-approve: the queued retry carries the note with the function names of the last request", async () => {
		const { loop, access, buildToolsArray } = makeLoop()
		buildToolsArray.mockResolvedValue({
			allTools: ORCHESTRATOR_TOOLS.map(functionTool),
			allowedFunctionNames: undefined,
		})
		await sendRequest(loop)

		const userContent = [{ type: "tool_result", tool_use_id: "t1", content: "done" }]
		access.apiConversationHistory.push({ role: "user", content: userContent })
		const stack: any[] = []

		const result = await loop.handleEmptyAssistantResponse({ retryAttempt: 0 }, userContent, stack)

		expect(result).toBe("continue")
		expect(stack).toHaveLength(1)
		expect(stack[0].userMessageWasRemoved).toBe(true)
		expect(stack[0].userContent[0]).toEqual(userContent[0])
		expect(notesIn(stack[0].userContent)).toEqual([formatResponse.emptyResponseRetryNote(ORCHESTRATOR_TOOLS)])
		// The caller's array is not changed, and the popped user message is not left behind.
		expect(userContent).toHaveLength(1)
		expect(access.apiConversationHistory).toEqual([])
	})

	it("allowedFunctionNames, when set, is the callable set (not every tool sent)", async () => {
		const { loop, buildToolsArray } = makeLoop()
		buildToolsArray.mockResolvedValue({
			allTools: ["read_file", "execute_command", "attempt_completion"].map(functionTool),
			allowedFunctionNames: ["read_file", "attempt_completion"],
		})
		await sendRequest(loop)
		const stack: any[] = []

		await loop.handleEmptyAssistantResponse({ retryAttempt: 0 }, [], stack)

		const [note] = notesIn(stack[0].userContent)
		expect(note).toContain("The tools you can call now are: read_file, attempt_completion.")
		expect(note).not.toContain("execute_command")
	})

	it("repeated empty answers keep exactly one note", async () => {
		const { loop, access, buildToolsArray } = makeLoop()
		buildToolsArray.mockResolvedValue({ allTools: ORCHESTRATOR_TOOLS.map(functionTool) })
		await sendRequest(loop)

		let item: any = { userContent: [{ type: "text", text: "<user_message>stats</user_message>" }], retryAttempt: 0 }
		for (let attempt = 0; attempt < 4; attempt++) {
			const stack: any[] = []
			await loop.handleEmptyAssistantResponse(item, item.userContent, stack)
			item = stack[0]
		}

		expect(item.retryAttempt).toBe(4)
		expect(item.userContent).toHaveLength(2)
		expect(item.userContent[0]).toEqual({ type: "text", text: "<user_message>stats</user_message>" })
		expect(notesIn(item.userContent)).toHaveLength(1)
		// The behaviour around the retry is unchanged: the error row from the 2nd empty on.
		expect(access.consecutiveNoAssistantMessagesCount).toBe(4)
		expect(access.askSay.say.mock.calls.filter(([type]: any[]) => type === "error")).toHaveLength(3)
	})

	it("manual Retry: the retry carries the note and re-adds the removed user message", async () => {
		const { loop, access, buildToolsArray } = makeLoop({ autoApprovalEnabled: false })
		buildToolsArray.mockResolvedValue({ allTools: ORCHESTRATOR_TOOLS.map(functionTool) })
		await sendRequest(loop)

		const userContent = [{ type: "text", text: "<user_message>stats</user_message>" }]
		access.apiConversationHistory.push({ role: "assistant", content: [{ type: "text", text: "earlier" }] })
		access.apiConversationHistory.push({ role: "user", content: userContent })
		const stack: any[] = []

		const result = await loop.handleEmptyAssistantResponse({ retryAttempt: 0 }, userContent, stack)

		expect(result).toBe("continue")
		expect(access.askSay.ask).toHaveBeenCalledWith("api_req_failed", expect.any(String))
		expect(access.askSay.say).toHaveBeenCalledWith("api_req_retried")
		expect(notesIn(stack[0].userContent)).toEqual([formatResponse.emptyResponseRetryNote(ORCHESTRATOR_TOOLS)])
		// The user message was popped; without this flag the retry would send a history
		// ending in the assistant turn, without the user content or the note.
		expect(stack[0].userMessageWasRemoved).toBe(true)
		expect(access.apiConversationHistory).toHaveLength(1)
	})

	it("declined manual Retry: history gets the content as it was, without a new note", async () => {
		const { loop, access, buildToolsArray } = makeLoop({ autoApprovalEnabled: false })
		buildToolsArray.mockResolvedValue({ allTools: ORCHESTRATOR_TOOLS.map(functionTool) })
		access.askSay.ask.mockResolvedValue({ response: "noButtonClicked" })
		await sendRequest(loop)
		const userContent = [{ type: "text", text: "<user_message>stats</user_message>" }]
		const stack: any[] = []

		const result = await loop.handleEmptyAssistantResponse({ retryAttempt: 0 }, userContent, stack)

		expect(result).toBe("return_false")
		expect(stack).toEqual([])
		expect(access.apiConversationHistory).toEqual([
			{ role: "user", content: userContent },
			{ role: "assistant", content: [{ type: "text", text: "Failure: I did not provide a response." }] },
		])
	})

	it("a non-empty answer queues the tool results without a note", async () => {
		const { loop, access } = makeLoop()
		Object.assign(access, {
			streamProcessor: {
				finalizeStream: vi.fn().mockResolvedValue(undefined),
				assembleAndSaveAssistantMessage: vi.fn().mockResolvedValue(undefined),
				partialBlocks: [],
				assistantMessage: "",
			},
			assistantMessageContent: [{ type: "tool_use", id: "t2", name: "update_todo_list", params: {} }],
			userMessageContentReady: true,
			userMessageContent: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }],
			settlePendingToolResultSpills: vi.fn().mockResolvedValue(undefined),
			isPaused: false,
			consecutiveNoToolUseCount: 0,
		})
		const handleEmpty = vi.spyOn(loop, "handleEmptyAssistantResponse")
		// The content of a retry that carried a note: the next turn starts fresh.
		const retriedContent = [{ type: "text", text: formatResponse.emptyResponseRetryNote(ORCHESTRATOR_TOOLS) }]
		const stack: any[] = []

		const result = await loop.finalizeStreamAndProcessResults({ retryAttempt: 1 }, retriedContent, stack, vi.fn())

		expect(result).toBe("continue")
		expect(handleEmpty).not.toHaveBeenCalled()
		expect(stack).toHaveLength(1)
		expect(stack[0].userContent).toEqual([{ type: "tool_result", tool_use_id: "t2", content: "ok" }])
		expect(notesIn(stack[0].userContent)).toEqual([])
	})
})
