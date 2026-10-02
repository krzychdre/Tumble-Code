// npx vitest run core/diagnostics/__tests__/ErrorReporter.spec.ts

import type { ErrorReport } from "@tumble-code/types"

const cloud = vi.hoisted(() => ({
	hasInstance: vi.fn(() => false),
	isErrorReportingEnabled: vi.fn(() => false),
	sendErrorReport: vi.fn(async (_report: unknown) => {}),
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: cloud.hasInstance,
		get instance() {
			return {
				isErrorReportingEnabled: cloud.isErrorReportingEnabled,
				sendErrorReport: cloud.sendErrorReport,
			}
		},
	},
}))

import {
	MAX_REPORTS_PER_CATEGORY_PER_TASK,
	beginToolCallProbe,
	captureApiRequest,
	captureFinishReason,
	captureStreamedToolCall,
	finishToolCallProbe,
	isErrorReportingActive,
	noteToolCallKind,
	noteToolFailure,
	reportApiError,
	reportEmptyResponse,
	reportMistakeLimit,
	type ErrorReportTask,
} from "../ErrorReporter"

function signIn(active: boolean) {
	cloud.hasInstance.mockReturnValue(active)
	cloud.isErrorReportingEnabled.mockReturnValue(active)
}

function makeTask(overrides: Partial<ErrorReportTask> = {}) {
	const getModel = vi.fn(() => ({ id: "glm-5.3", info: { contextWindow: 200_000, maxTokens: 32_000 } as any }))
	const task = {
		taskId: "task-1",
		api: { getModel },
		apiConfiguration: { apiProvider: "zai" } as any,
		apiConversationHistory: [
			{ role: "user", content: "fix the bug" },
			{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "apply_diff", input: {} }] },
		],
		getTokenUsage: vi.fn(() => ({ contextTokens: 151_000 }) as any),
		getTaskMode: vi.fn(async () => "code"),
		streamProcessor: {
			assistantMessage: "I will edit the file.",
			reasoningMessage: "thinking",
			inputTokens: 150_000,
			outputTokens: 1_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		assistantMessageContent: [],
		userMessageContent: [] as unknown[],
		...overrides,
	}
	return task
}

async function sentReports(count = 1): Promise<ErrorReport[]> {
	await vi.waitFor(() => expect(cloud.sendErrorReport).toHaveBeenCalledTimes(count))
	return cloud.sendErrorReport.mock.calls.map(([report]) => report as ErrorReport)
}

/** Let the background send of any report run (there must be none). */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 10))
}

beforeEach(() => {
	vi.clearAllMocks()
	signIn(false)
})

describe("gate: not signed in to the cloud", () => {
	it("builds nothing, stores nothing and sends nothing", async () => {
		const task = makeTask()
		const record = vi.fn(() => ({ systemPrompt: "p", messages: [], toolNames: [], params: {} }))

		expect(isErrorReportingActive()).toBe(false)
		captureApiRequest(task, record)
		captureStreamedToolCall(task, { id: "call_1", name: "apply_diff", arguments: "{}" })
		captureFinishReason(task, "tool_calls")
		reportApiError(task, new Error("maximum context length is 8 tokens"), 0)
		reportEmptyResponse(task, "no_assistant_messages")
		reportMistakeLimit(task, { limit: 3 })
		const probe = beginToolCallProbe(task, { id: "call_1", name: "apply_diff" })
		noteToolFailure(task, "boom", "error")
		finishToolCallProbe(task, probe)
		await settle()

		expect(probe).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
		expect(task.api.getModel).not.toHaveBeenCalled()
		expect(task.getTokenUsage).not.toHaveBeenCalled()
		expect(task.getTaskMode).not.toHaveBeenCalled()
		expect(cloud.sendErrorReport).not.toHaveBeenCalled()
	})

	it("is off when the cloud says reporting is disabled (for example by the telemetry env switch)", () => {
		cloud.hasInstance.mockReturnValue(true)
		cloud.isErrorReportingEnabled.mockReturnValue(false)
		expect(isErrorReportingActive()).toBe(false)
	})

	it("never throws, even when the cloud check does", () => {
		cloud.hasInstance.mockImplementation(() => {
			throw new Error("not ready")
		})
		expect(isErrorReportingActive()).toBe(false)
		expect(() => reportApiError(makeTask(), new Error("x"), 0)).not.toThrow()
		cloud.hasInstance.mockImplementation(() => false)
	})
})

describe("signed in", () => {
	beforeEach(() => signIn(true))

	it("reports a context-length rejection as context_overflow with the request it was about", async () => {
		const task = makeTask()
		captureApiRequest(task, () => ({
			systemPrompt: "You are Tumble.",
			messages: task.apiConversationHistory,
			toolNames: ["read_file", "apply_diff"],
			params: { temperature: 0, maxTokens: 32_000 },
		}))
		const error = Object.assign(new Error("This model's maximum context length is 131072 tokens."), {
			status: 400,
			error: { message: "maximum context length", authorization: "Bearer abcdefghijklmnop" },
		})

		reportApiError(task, error, 2)
		const [report] = await sentReports()

		expect(report).toMatchObject({
			category: "context_overflow",
			taskId: "task-1",
			mode: "code",
			provider: "zai",
			modelId: "glm-5.3",
			contextWindow: 200_000,
			contextTokens: 151_000,
			messageCount: 2,
			httpStatus: 400,
			retryAttempt: 2,
			request: {
				systemPromptChars: 15,
				toolNames: ["read_file", "apply_diff"],
				params: { temperature: 0, maxTokens: 32_000 },
			},
			response: { text: "I will edit the file.", reasoning: "thinking" },
		})
		expect(report.id).toMatch(/^[0-9a-f-]{36}$/)
		expect(report.request!.systemPromptSha256).toMatch(/^[0-9a-f]{64}$/)
		expect(report.request!.messages).toHaveLength(2)
		expect(report.response!.errorBody).not.toContain("abcdefghijklmnop")
	})

	it("reports one error object once, even from two layers", async () => {
		const task = makeTask()
		const error = new Error("OpenAI completion error: Connection error.")

		reportApiError(task, error, 0)
		reportApiError(task, error, 0)
		const reports = await sentReports(1)
		await settle()

		expect(cloud.sendErrorReport).toHaveBeenCalledTimes(1)
		expect(reports[0].category).toBe("api_error")
	})

	it("reads the model live: after a mode switch the report names the new model", async () => {
		const task = makeTask()
		reportApiError(task, new Error("first"), 0)
		task.api = { getModel: vi.fn(() => ({ id: "qwen-local", info: { contextWindow: 32_768 } as any })) }
		reportApiError(task, new Error("second"), 0)

		const reports = await sentReports(2)
		expect(reports.map((r) => [r.modelId, r.contextWindow])).toEqual([
			["glm-5.3", 200_000],
			["qwen-local", 32_768],
		])
	})

	it("reports an empty answer and the mistake limit", async () => {
		const task = makeTask({ streamProcessor: undefined })
		reportEmptyResponse(task, "no_assistant_messages", 1)
		reportMistakeLimit(task, { limit: 3, lastToolName: "apply_diff" })

		const reports = await sentReports(2)
		expect(reports[0]).toMatchObject({
			category: "empty_response",
			errorMessage: "MODEL_NO_ASSISTANT_MESSAGES",
			retryAttempt: 1,
		})
		expect(reports[1]).toMatchObject({ category: "mistake_limit", toolName: "apply_diff" })
	})

	it("files a missing required parameter as invalid_tool_call with the raw streamed arguments", async () => {
		const task = makeTask()
		captureApiRequest(task, () => ({ systemPrompt: "p", messages: [], toolNames: [], params: {} }))
		captureStreamedToolCall(task, { id: "call_1", name: "apply_diff", arguments: '{"diff":"<<<<<<< SEARCH' })
		captureFinishReason(task, "tool_calls")

		const probe = beginToolCallProbe(task, { id: "call_1", name: "apply_diff", nativeArgs: { diff: "x" } })
		noteToolCallKind(task, "invalid_tool_call")
		noteToolFailure(
			task,
			"Roo tried to use apply_diff without value for required parameter 'path'. Retrying...",
			"error",
		)
		;(task.userMessageContent as unknown[]).push({
			type: "tool_result",
			tool_use_id: "call_1",
			content: '{"status":"error","message":"The tool execution failed"}',
		})
		finishToolCallProbe(task, probe)

		const [report] = await sentReports()
		expect(report).toMatchObject({
			category: "invalid_tool_call",
			toolName: "apply_diff",
			errorMessage: "Roo tried to use apply_diff without value for required parameter 'path'. Retrying...",
			toolResult: '{"status":"error","message":"The tool execution failed"}',
			response: {
				stopReason: "tool_calls",
				toolCalls: [{ id: "call_1", name: "apply_diff", arguments: '{"diff":"<<<<<<< SEARCH' }],
			},
		})
	})

	it("files a failing tool as tool_error and a failing edit as diff_error", async () => {
		const task = makeTask()

		const readProbe = beginToolCallProbe(task, { id: "call_r", name: "read_file", nativeArgs: { path: "nope.ts" } })
		noteToolFailure(task, "Error reading file nope.ts: ENOENT: no such file or directory", "error")
		finishToolCallProbe(task, readProbe)

		const mcpProbe = beginToolCallProbe(task, { id: "call_m", name: "use_mcp_tool" })
		;(task.userMessageContent as unknown[]).push({
			type: "tool_result",
			tool_use_id: "call_m",
			content: "Error:\nMCP request timed out",
		})
		finishToolCallProbe(task, mcpProbe)

		const diffProbe = beginToolCallProbe(task, { id: "call_d", name: "apply_diff" })
		noteToolFailure(task, "<error_details>No sufficiently similar match found</error_details>", "diff_error")
		finishToolCallProbe(task, diffProbe)

		const reports = await sentReports(3)
		expect(reports.map((r) => [r.category, r.toolName])).toEqual([
			["tool_error", "read_file"],
			["tool_error", "use_mcp_tool"],
			["diff_error", "apply_diff"],
		])
		expect(reports[0].response!.toolCalls).toEqual([
			{ id: "call_r", name: "read_file", arguments: '{"path":"nope.ts"}' },
		])
		expect(reports[1].toolResult).toBe("Error:\nMCP request timed out")
	})

	it("sends nothing for a tool call that worked, a rejected one or a cancelled task", async () => {
		const task = makeTask()

		const ok = beginToolCallProbe(task, { id: "call_ok", name: "read_file" })
		;(task.userMessageContent as unknown[]).push({
			type: "tool_result",
			tool_use_id: "call_ok",
			content: "1 | const a = 1",
		})
		finishToolCallProbe(task, ok)

		const rejected = beginToolCallProbe(task, { id: "call_no", name: "write_to_file" })
		noteToolFailure(task, "denied", "error")
		;(task as any).didRejectTool = true
		finishToolCallProbe(task, rejected)

		await settle()
		expect(cloud.sendErrorReport).not.toHaveBeenCalled()
	})

	it(`stops after ${MAX_REPORTS_PER_CATEGORY_PER_TASK} reports of one category per task`, async () => {
		const task = makeTask()
		for (let i = 0; i < MAX_REPORTS_PER_CATEGORY_PER_TASK + 5; i++) {
			reportApiError(task, new Error(`fail ${i}`), i)
		}
		reportEmptyResponse(task, "no_tool_call")

		await sentReports(MAX_REPORTS_PER_CATEGORY_PER_TASK + 1)
		await settle()
		expect(cloud.sendErrorReport).toHaveBeenCalledTimes(MAX_REPORTS_PER_CATEGORY_PER_TASK + 1)
	})

	it("never throws into the caller when the snapshot or the send fails", async () => {
		const broken = makeTask({
			api: {
				getModel: () => {
					throw new Error("no model")
				},
			},
		})
		expect(() => reportApiError(broken, new Error("x"), 0)).not.toThrow()

		cloud.sendErrorReport.mockRejectedValueOnce(new Error("offline"))
		expect(() => reportApiError(makeTask(), new Error("y"), 0)).not.toThrow()
		await sentReports(1)
	})
})
