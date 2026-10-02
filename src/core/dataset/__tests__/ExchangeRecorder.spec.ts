// npx vitest run core/dataset/__tests__/ExchangeRecorder.spec.ts

import { createHash } from "crypto"

import type { LlmExchange, LlmExchangeOutcome } from "@tumble-code/types"
import { llmExchangeSchema } from "@tumble-code/types"

const cloud = vi.hoisted(() => ({
	hasInstance: vi.fn(() => false),
	isErrorReportingEnabled: vi.fn(() => false),
	getExchangeRecordingState: vi.fn((): boolean | undefined => false),
	resolveExchangeRecording: vi.fn(async () => true),
	sendLlmExchange: vi.fn(async (_exchange: unknown) => true),
	sendLlmExchangeOutcome: vi.fn(async (_outcome: unknown) => true),
	sendErrorReport: vi.fn(async (_report: unknown) => {}),
	getUserInfo: vi.fn((): { id?: string } | null => ({ id: "user-a" })),
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: cloud.hasInstance,
		get instance() {
			return cloud
		},
	},
}))

import {
	beginToolCallProbe,
	captureApiRequest,
	captureFinishReason,
	captureStreamedToolCall,
	finishToolCallProbe,
	noteToolCallKind,
} from "../../diagnostics/ErrorReporter"
import {
	MAX_CHAIN_LENGTH,
	beginExchange,
	completeExchange,
	failExchange,
	finishExchangeTurn,
	flushExchanges,
	type CanonicalRequest,
} from "../ExchangeRecorder"

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

const TOOLS = [
	{
		type: "function",
		function: {
			name: "read_file",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		},
	},
]

function record(recording: boolean | undefined) {
	cloud.hasInstance.mockReturnValue(true)
	cloud.isErrorReportingEnabled.mockReturnValue(true)
	cloud.getExchangeRecordingState.mockReturnValue(recording)
	cloud.resolveExchangeRecording.mockResolvedValue(recording !== false)
}

function makeTask() {
	return {
		taskId: "task-1",
		rootTaskId: "task-0",
		cwd: "/home/alice/project",
		api: { getModel: vi.fn(() => ({ id: "glm-5.3", info: {} as any })) },
		apiConfiguration: { apiProvider: "openai" } as any,
		apiConversationHistory: [],
		getTokenUsage: vi.fn(() => ({ contextTokens: 1 }) as any),
		getTaskMode: vi.fn(async () => "code"),
		streamProcessor: {
			assistantMessage: "",
			reasoningMessage: "",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		assistantMessageContent: [] as unknown[],
		userMessageContent: [] as unknown[],
		abort: false,
		didRejectTool: false,
	}
}

type TestTask = ReturnType<typeof makeTask>

function request(messages: unknown[], system = "You are Tumble."): CanonicalRequest {
	return { systemPrompt: system, messages, tools: TOOLS, mode: "code", params: { temperature: 0 } }
}

/** One full turn: the request, an answer with one read_file call, its tool ran fine. */
function turn(task: TestTask, messages: unknown[], callId: string) {
	captureApiRequest(task, () => ({ systemPrompt: "s", messages: [], toolNames: [], params: {} }))
	const sink = beginExchange(task, 0, () => request(messages))
	task.streamProcessor.assistantMessage = "Reading."
	task.streamProcessor.inputTokens = 100
	task.streamProcessor.outputTokens = 10
	captureStreamedToolCall(task, { id: callId, name: "read_file", arguments: '{"path":"a.ts"}' })
	captureFinishReason(task, "tool_calls")
	completeExchange(task)
	return sink
}

async function sentExchanges(count: number): Promise<LlmExchange[]> {
	await vi.waitFor(() => expect(cloud.sendLlmExchange).toHaveBeenCalledTimes(count))
	return cloud.sendLlmExchange.mock.calls.map(([exchange]) => exchange as LlmExchange)
}

async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 10))
}

const USER_1 = { role: "user", content: [{ type: "text", text: "read a.ts" }] }
const ASSISTANT_1 = {
	role: "assistant",
	content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
}
const RESULT_1 = { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "x" }] }

beforeEach(() => {
	vi.clearAllMocks()
	cloud.hasInstance.mockReturnValue(false)
	cloud.isErrorReportingEnabled.mockReturnValue(false)
	cloud.getExchangeRecordingState.mockReturnValue(false)
	cloud.sendLlmExchange.mockResolvedValue(true)
})

describe("gate", () => {
	it("signed out: builds nothing and sends nothing", async () => {
		const task = makeTask()
		const build = vi.fn(() => request([USER_1]))

		expect(beginExchange(task, 0, build)).toBeUndefined()
		completeExchange(task)
		finishExchangeTurn(task)
		flushExchanges(task)
		await settle()

		expect(build).not.toHaveBeenCalled()
		expect(task.api.getModel).not.toHaveBeenCalled()
		expect(cloud.sendLlmExchange).not.toHaveBeenCalled()
	})

	it("signed in with recording switched off: builds nothing", async () => {
		record(false)
		const task = makeTask()
		const build = vi.fn(() => request([USER_1]))

		expect(beginExchange(task, 0, build)).toBeUndefined()
		completeExchange(task)
		await settle()

		expect(build).not.toHaveBeenCalled()
		expect(cloud.sendLlmExchange).not.toHaveBeenCalled()
	})

	it("switch not read yet: captures, asks the cloud, and drops the exchange when it says off", async () => {
		record(undefined)
		cloud.resolveExchangeRecording.mockResolvedValue(false)
		const task = makeTask()

		turn(task, [USER_1], "call_1")
		await vi.waitFor(() => expect(cloud.resolveExchangeRecording).toHaveBeenCalled())
		await settle()

		expect(cloud.sendLlmExchange).not.toHaveBeenCalled()
	})

	it("never throws into the task loop", () => {
		record(true)
		const task = makeTask()

		expect(() =>
			beginExchange(task, 0, () => {
				throw new Error("boom")
			}),
		).not.toThrow()
		expect(() => completeExchange(task)).not.toThrow()
		expect(() => failExchange(task, new Error("x"), false)).not.toThrow()
	})
})

describe("incremental storage", () => {
	it("sends a full snapshot first, then only what changed against the accepted base", async () => {
		record(true)
		const task = makeTask()

		turn(task, [USER_1], "call_1")
		turn(task, [USER_1, ASSISTANT_1, RESULT_1], "call_2")
		const [first, second] = await sentExchanges(2)

		expect(first!.baseId).toBeUndefined()
		expect(first!.request.messages).toEqual({ keep: 0, append: [USER_1] })
		expect(first!.request.messageCount).toBe(1)
		expect(first!.request.system).toEqual({ sha256: sha("You are Tumble."), text: "You are Tumble." })
		expect(first!.request.tools).toEqual({ sha256: sha(JSON.stringify(TOOLS)), text: JSON.stringify(TOOLS) })

		expect(second!.baseId).toBe(first!.id)
		expect(second!.request.messages).toEqual({ keep: 1, append: [ASSISTANT_1, RESULT_1] })
		expect(second!.request.messageCount).toBe(3)
		// The chain already carries these texts: only the hash travels.
		expect(second!.request.system).toEqual({ sha256: sha("You are Tumble.") })
		expect(second!.request.tools).toEqual({ sha256: sha(JSON.stringify(TOOLS)) })
		expect(second!.sequence).toBe(first!.sequence + 1)
	})

	it("a changed message (microcompact, condense) cuts the kept prefix there", async () => {
		record(true)
		const task = makeTask()

		turn(task, [USER_1, ASSISTANT_1, RESULT_1], "call_1")
		const compacted = { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "[cut]" }] }
		turn(task, [USER_1, ASSISTANT_1, compacted, USER_1], "call_2")
		const [, second] = await sentExchanges(2)

		expect(second!.request.messages).toEqual({ keep: 2, append: [compacted, USER_1] })
	})

	it("records the conversation as it was when the request was built", async () => {
		record(true)
		const task = makeTask()
		const message = { role: "user", content: [{ type: "text", text: "original" }] }

		const messages = [message]
		beginExchange(task, 0, () => request(messages))
		message.content[0]!.text = "changed later"
		messages.push(USER_1)
		completeExchange(task)
		const [exchange] = await sentExchanges(1)

		expect(exchange!.request.messages.append).toEqual([
			{ role: "user", content: [{ type: "text", text: "original" }] },
		])
	})

	it("starts a full snapshot again after a failed upload", async () => {
		record(true)
		const task = makeTask()
		cloud.sendLlmExchange.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

		turn(task, [USER_1], "call_1")
		turn(task, [USER_1, ASSISTANT_1], "call_2")
		turn(task, [USER_1, ASSISTANT_1, RESULT_1], "call_3")
		const [first, second, third] = await sentExchanges(3)

		expect(second!.baseId).toBe(first!.id)
		// The server may lack the second one: the third must not build on it.
		expect(third!.baseId).toBeUndefined()
		expect(third!.request.messages.keep).toBe(0)
		expect(third!.request.system.text).toBe("You are Tumble.")
	})

	it("starts a full snapshot again when another account signed in", async () => {
		record(true)
		const task = makeTask()

		turn(task, [USER_1], "call_1")
		await sentExchanges(1)
		cloud.getUserInfo.mockReturnValue({ id: "user-b" })
		turn(task, [USER_1, ASSISTANT_1], "call_2")
		const [, second] = await sentExchanges(2)
		cloud.getUserInfo.mockReturnValue({ id: "user-a" })

		expect(second!.baseId).toBeUndefined()
		expect(second!.request.system.text).toBe("You are Tumble.")
	})

	it(`starts a full snapshot again after ${MAX_CHAIN_LENGTH} exchanges`, async () => {
		record(true)
		const task = makeTask()

		for (let i = 0; i <= MAX_CHAIN_LENGTH; i++) {
			turn(task, [USER_1], `call_${i}`)
		}
		const sent = await sentExchanges(MAX_CHAIN_LENGTH + 1)

		expect(sent[MAX_CHAIN_LENGTH - 1]!.baseId).toBe(sent[MAX_CHAIN_LENGTH - 2]!.id)
		expect(sent[MAX_CHAIN_LENGTH]!.baseId).toBeUndefined()
	})

	it("every exchange it sends passes the wire contract", async () => {
		record(true)
		const task = makeTask()

		const sink = turn(task, [USER_1], "call_1")
		expect(sink).toBeDefined()
		const [exchange] = await sentExchanges(1)

		expect(llmExchangeSchema.safeParse(exchange).success).toBe(true)
	})
})

describe("the exact wire request", () => {
	function wireBody(messages: unknown[]) {
		return JSON.stringify({
			model: "glm-5.3",
			messages: [{ role: "system", content: "You are Tumble." }, ...messages],
			tools: TOOLS.concat(Array.from({ length: 30 }, () => TOOLS[0]!)),
			stream: true,
		})
	}

	it("keeps the body's fields in order, the conversation as a delta and large fields as blobs", async () => {
		record(true)
		const task = makeTask()
		const body1 = wireBody([{ role: "user", content: "read a.ts" }])
		const body2 = wireBody([
			{ role: "user", content: "read a.ts" },
			{ role: "assistant", content: "ok" },
		])

		beginExchange(task, 0, () => request([USER_1]))!({
			url: "https://api.example/v1/chat/completions?key=secret",
			method: "POST",
			body: body1,
		})
		completeExchange(task)
		beginExchange(task, 0, () => request([USER_1, ASSISTANT_1]))!({
			url: "https://api.example/v1/chat/completions",
			method: "POST",
			body: body2,
		})
		completeExchange(task)
		const [first, second] = await sentExchanges(2)

		const wire1 = first!.request.wire!
		expect(wire1.url).toBe("https://api.example/v1/chat/completions")
		expect(wire1.format).toBe("openai-chat")
		expect(wire1.bodySha256).toBe(sha(body1))
		expect(wire1.bodyBytes).toBe(Buffer.byteLength(body1))
		expect(wire1.fields!.map((field) => [field.key, field.kind])).toEqual([
			["model", "value"],
			["messages", "array"],
			["tools", "blob"],
			["stream", "value"],
		])

		const fields2 = second!.request.wire!.fields!
		expect(fields2[1]).toEqual({
			key: "messages",
			kind: "array",
			delta: { keep: 2, append: [{ role: "assistant", content: "ok" }] },
		})
		// Sent with the first exchange of the chain: only the hash now.
		expect(fields2[2]).toMatchObject({ key: "tools", kind: "blob", blob: { sha256: expect.any(String) } })
		expect((fields2[2] as any).blob.text).toBeUndefined()
	})

	it("a provider's internal retry overwrites the captured body with the last attempt", async () => {
		record(true)
		const task = makeTask()
		const sink = beginExchange(task, 0, () => request([USER_1]))!

		sink({ url: "https://api.example/v1/chat/completions", method: "POST", body: '{"attempt":1}' })
		sink({ url: "https://api.example/v1/chat/completions", method: "POST", body: '{"attempt":2}' })
		completeExchange(task)
		const [exchange] = await sentExchanges(1)

		expect(exchange!.request.wire!.bodySha256).toBe(sha('{"attempt":2}'))
	})
})

describe("answer, failure and outcome", () => {
	it("records the answer with the raw tool call arguments and the stop reason", async () => {
		record(true)
		const task = makeTask()
		task.streamProcessor.reasoningMessage = "thinking"

		turn(task, [USER_1], "call_1")
		const [exchange] = await sentExchanges(1)

		expect(exchange!.status).toBe("completed")
		expect(exchange!.response).toEqual({
			text: "Reading.",
			reasoning: "thinking",
			toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' }],
			finishReason: "tool_calls",
			usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
		})
		expect(exchange).toMatchObject({
			taskId: "task-1",
			rootTaskId: "task-0",
			modelId: "glm-5.3",
			provider: "openai",
			mode: "code",
			workspacePath: "/home/alice/project",
			retryAttempt: 0,
		})
	})

	it("a failed request is sent once, with the error, and a cancel as aborted", async () => {
		record(true)
		const task = makeTask()

		beginExchange(task, 2, () => request([USER_1]))
		const error = Object.assign(new Error("maximum context length is 8 tokens"), { status: 400 })
		failExchange(task, error, false)
		failExchange(task, error, false)
		beginExchange(task, 0, () => request([USER_1]))
		failExchange(task, new Error("Request cancelled by user"), true)
		const [failed, aborted] = await sentExchanges(2)

		expect(failed).toMatchObject({
			status: "error",
			retryAttempt: 2,
			error: { message: "maximum context length is 8 tokens", httpStatus: 400 },
		})
		expect(aborted!.status).toBe("aborted")
	})

	it("sends how each tool call went once the tools have run", async () => {
		record(true)
		const task = makeTask()
		turn(task, [USER_1], "call_1")
		captureStreamedToolCall(task, { id: "call_2", name: "read_file", arguments: "{}" })

		const ok = beginToolCallProbe(task, { id: "call_1", name: "read_file" })
		task.userMessageContent.push({ type: "tool_result", tool_use_id: "call_1", content: "file text" })
		finishToolCallProbe(task, ok)
		const broken = beginToolCallProbe(task, { id: "call_2", name: "read_file" })
		noteToolCallKind(task, "invalid_tool_call")
		finishToolCallProbe(task, broken)
		task.streamProcessor.outputTokens = 12
		finishExchangeTurn(task)
		finishExchangeTurn(task)

		await vi.waitFor(() => expect(cloud.sendLlmExchangeOutcome).toHaveBeenCalledTimes(1))
		await settle()
		expect(cloud.sendLlmExchangeOutcome).toHaveBeenCalledTimes(1)
		const [exchange] = await sentExchanges(1)
		const outcome = cloud.sendLlmExchangeOutcome.mock.calls[0]![0] as LlmExchangeOutcome
		expect(outcome.exchangeId).toBe(exchange!.id)
		expect(outcome.toolResults).toEqual([
			{ toolCallId: "call_1", toolName: "read_file", status: "ok" },
			expect.objectContaining({ toolCallId: "call_2", toolName: "read_file", status: "invalid_tool_call" }),
		])
		expect(outcome.usage?.outputTokens).toBe(12)
	})

	it("sends no outcome for an exchange the server did not accept", async () => {
		record(true)
		cloud.sendLlmExchange.mockResolvedValue(false)
		const task = makeTask()

		turn(task, [USER_1], "call_1")
		finishExchangeTurn(task)
		await sentExchanges(1)
		await settle()

		expect(cloud.sendLlmExchangeOutcome).not.toHaveBeenCalled()
	})

	it("a task going away sends an unfinished exchange as aborted", async () => {
		record(true)
		const task = makeTask()

		beginExchange(task, 0, () => request([USER_1]))
		flushExchanges(task)
		const [exchange] = await sentExchanges(1)

		expect(exchange!.status).toBe("aborted")
	})
})
