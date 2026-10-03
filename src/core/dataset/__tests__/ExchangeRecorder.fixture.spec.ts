// npx vitest run core/dataset/__tests__/ExchangeRecorder.fixture.spec.ts
//
// The cross-language contract: a scripted task goes through the real recorder, and what
// it uploads is compared with self-hosted-cloudapi/tests/fixtures/llm_exchanges_recorder.json.
// The cloud's tests (test_llm_exchange_contract.py) post the same records and check that
// the reconstruction gives back `expected` exactly. After a deliberate change of the
// wire shape, regenerate with UPDATE_EXCHANGE_FIXTURE=1 and run both suites.

import * as fs from "fs"
import * as path from "path"

const cloud = vi.hoisted(() => ({
	hasInstance: vi.fn(() => true),
	isErrorReportingEnabled: vi.fn(() => true),
	getExchangeRecordingState: vi.fn((): boolean | undefined => true),
	resolveExchangeRecording: vi.fn(async () => true),
	sendLlmExchange: vi.fn(async (_exchange: unknown) => true),
	sendLlmExchangeOutcome: vi.fn(async (_outcome: unknown) => true),
	sendErrorReport: vi.fn(async (_report: unknown) => {}),
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: cloud.hasInstance,
		get instance() {
			return cloud
		},
	},
}))

let uuid = 0
vi.mock("crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("crypto")>()
	return { ...actual, randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` }
})

import {
	beginToolCallProbe,
	captureApiRequest,
	captureFinishReason,
	captureStreamedToolCall,
	finishToolCallProbe,
} from "../../diagnostics/ErrorReporter"
import { beginExchange, completeExchange, failExchange, finishExchangeTurn } from "../ExchangeRecorder"

const FIXTURE = path.resolve(__dirname, "../../../../self-hosted-cloudapi/tests/fixtures/llm_exchanges_recorder.json")

const SYSTEM = [
	"You are Tumble, a coding agent.",
	"Operating System: Linux",
	"Home Directory: /home/alice",
	"Current Workspace Directory: /home/alice/work/acme-portal",
].join("\n")

const TOOLS = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file. ".repeat(200),
			strict: true,
			parameters: {
				type: "object",
				properties: { path: { type: "string" }, mode: { type: ["string", "null"] } },
				required: ["path", "mode"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "attempt_completion",
			description: "Finish the task.",
			parameters: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
		},
	},
]

const U1 = {
	role: "user",
	content: [
		{ type: "text", text: "<task>Fix the login bug, mail alice@acme.com when done.</task>" },
		{
			type: "text",
			text: "<environment_details>\n# Current Workspace Directory (/home/alice/work/acme-portal) Files\nsrc/login.ts\n</environment_details>",
		},
	],
}
const A1 = {
	role: "assistant",
	content: [
		{ type: "text", text: "Reading the login code." },
		{
			type: "tool_use",
			id: "call_1",
			name: "read_file",
			input: { path: "/home/alice/work/acme-portal/src/login.ts" },
		},
	],
}
const R1 = {
	role: "user",
	content: [
		{
			type: "tool_result",
			tool_use_id: "call_1",
			content: "export const API_KEY = 'sk-proj-abcdefghijklmnop1234567890'\nlogin()",
		},
		{
			type: "text",
			text: "<environment_details>\nCurrent time: 2026-10-02T18:00:00+02:00\n</environment_details>",
		},
	],
}
const R1_COMPACTED = {
	role: "user",
	content: [
		{ type: "tool_result", tool_use_id: "call_1", content: "[Old tool result content cleared]" },
		{
			type: "text",
			text: "<environment_details>\nCurrent time: 2026-10-02T18:00:00+02:00\n</environment_details>",
		},
	],
}
const A2 = {
	role: "assistant",
	content: [{ type: "tool_use", id: "call_2", name: "read_file", input: { path: "src/session.ts", mode: null } }],
}
const R2 = {
	role: "user",
	content: [{ type: "tool_result", tool_use_id: "call_2", content: "Error: ENOENT: no such file src/session.ts" }],
}

function toWire(messages: any[]): unknown[] {
	return [
		{ role: "system", content: SYSTEM },
		...messages.map((m) => ({ role: m.role, content: JSON.stringify(m.content) })),
	]
}

function wireBody(messages: any[]): string {
	return JSON.stringify({
		model: "glm-5.3",
		messages: toWire(messages),
		tools: TOOLS,
		temperature: 0.2,
		top_p: 1e-7,
		max_tokens: 32768,
		stream: true,
		stream_options: { include_usage: true },
	})
}

function makeTask() {
	return {
		taskId: "task-contract",
		rootTaskId: "task-contract",
		cwd: "/home/alice/work/acme-portal",
		api: { getModel: () => ({ id: "glm-5.3", info: {} as any }) },
		apiConfiguration: { apiProvider: "openai" } as any,
		apiConversationHistory: [],
		getTokenUsage: () => ({ contextTokens: 1 }) as any,
		getTaskMode: async () => "code",
		providerRef: new WeakRef({
			appProperties: {
				appVersion: "1.0.0",
				editorName: "Visual Studio Code",
				platform: "linux",
				clientKind: "vscode" as const,
			},
		}),
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

type Turn = {
	messages: any[]
	text?: string
	reasoning?: string
	call?: { id: string; name: string; arguments: string }
	finish?: string
	fail?: Error & { status?: number }
	result?: { content: string }
}

function run(task: ReturnType<typeof makeTask>, turn: Turn) {
	captureApiRequest(task, () => ({ systemPrompt: SYSTEM, messages: [], toolNames: [], params: {} }))
	const sink = beginExchange(task, 0, () => ({
		systemPrompt: SYSTEM,
		messages: turn.messages,
		tools: TOOLS,
		mode: "code",
		params: { mode: "code", toolProtocol: "openai", temperature: 0.2, maxTokens: 32768, toolChoice: "auto" },
	}))!
	sink({
		url: "https://llm.example/v1/chat/completions?api-key=secret",
		method: "POST",
		body: wireBody(turn.messages),
	})
	if (turn.fail) {
		failExchange(task, turn.fail, false)
		return
	}
	task.streamProcessor.assistantMessage = turn.text ?? ""
	task.streamProcessor.reasoningMessage = turn.reasoning ?? ""
	task.streamProcessor.inputTokens = 1000
	task.streamProcessor.outputTokens = 50
	task.userMessageContent = []
	if (turn.call) {
		captureStreamedToolCall(task, turn.call)
	}
	captureFinishReason(task, turn.finish ?? "tool_calls")
	completeExchange(task)
	if (turn.call && turn.result) {
		const probe = beginToolCallProbe(task, { id: turn.call.id, name: turn.call.name })
		task.userMessageContent.push({ type: "tool_result", tool_use_id: turn.call.id, content: turn.result.content })
		finishToolCallProbe(task, probe)
	}
	finishExchangeTurn(task)
}

it("the recorder's uploads match the cloud's contract fixture", async () => {
	const accepted: boolean[] = []
	cloud.sendLlmExchange.mockImplementation(async (exchange: any) => {
		// The fourth upload is lost: the fifth must start a full snapshot.
		const ok = cloud.sendLlmExchange.mock.calls.length !== 4
		accepted.push(ok)
		return ok
	})
	const task = makeTask()
	const turns: Turn[] = [
		{
			messages: [U1],
			text: "Reading the login code.",
			reasoning: "The bug is probably in login.ts.",
			call: {
				id: "call_1",
				name: "read_file",
				arguments: '{"path": "/home/alice/work/acme-portal/src/login.ts"}',
			},
			result: { content: "export const API_KEY = 'sk-proj-abcdefghijklmnop1234567890'\nlogin()" },
		},
		{ messages: [U1, A1, R1], fail: Object.assign(new Error("502 Bad Gateway"), { status: 502 }) },
		{
			messages: [U1, A1, R1],
			call: { id: "call_2", name: "read_file", arguments: '{"path":"src/session.ts","mode":null}' },
			result: { content: "Error: ENOENT: no such file src/session.ts" },
		},
		{
			messages: [U1, A1, R1_COMPACTED, A2, R2],
			call: { id: "call_3", name: "read_file", arguments: '{"mode":"slice"}' },
			result: { content: "Missing value for required parameter 'path'." },
		},
		{
			messages: [U1, A1, R1_COMPACTED, A2, R2],
			text: "The session file does not exist; login.ts was the culprit.",
			call: { id: "call_4", name: "attempt_completion", arguments: '{"result":"Fixed the login bug."}' },
		},
	]
	for (const turn of turns) {
		run(task, turn)
	}
	await vi.waitFor(() => expect(cloud.sendLlmExchange).toHaveBeenCalledTimes(turns.length))
	await new Promise((resolve) => setTimeout(resolve, 20))

	const exchanges = cloud.sendLlmExchange.mock.calls.map(([exchange]) => exchange as any)
	const outcomes = cloud.sendLlmExchangeOutcome.mock.calls.map(([outcome]) => outcome as any)
	// Times vary run to run; the contract does not depend on them.
	for (const exchange of exchanges) {
		exchange.occurredAt = 1790000000000 + exchange.sequence * 1000
		exchange.durationMs = 500
	}
	const fixture = {
		comment: "Generated by src/core/dataset/__tests__/ExchangeRecorder.fixture.spec.ts; see its header.",
		exchanges: exchanges.map((exchange, index) => ({ accepted: accepted[index], body: exchange })),
		outcomes,
		expected: turns.map((turn, index) => ({
			id: exchanges[index].id,
			system: SYSTEM,
			tools: TOOLS,
			messages: turn.messages,
			wireBody: wireBody(turn.messages),
		})),
	}

	const text = JSON.stringify(fixture, null, "\t") + "\n"
	if (process.env.UPDATE_EXCHANGE_FIXTURE) {
		fs.writeFileSync(FIXTURE, text)
	}
	expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(text))
})
