// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/responses-api-characterization.spec.ts

// Characterization of the three OpenAI Responses API handlers (API-13).
//
// OpenAI Native, OpenAI Codex and xAI each carried their own copy of the Responses
// API plumbing: the request body, the event processor, the hand-written SSE parser of
// the fetch fallback and the usage normalizer. The copies drifted (a fix landed in one
// copy only, see D4 in the refactor plan). Every fixture below is replayed through
// every path that exists today:
//
// - native:    OpenAiNativeHandler, events from the openai SDK stream
// - nativeSse: OpenAiNativeHandler, the same events over the plain-fetch SSE fallback
// - codex:     OpenAiCodexHandler, events from the openai SDK stream
// - codexSse:  OpenAiCodexHandler, the same events over the plain-fetch SSE fallback
// - xai:       XAIHandler, events from the openai SDK stream (it has no fallback)
//
// The snapshots pin what each path yields, so the extraction of one shared core can
// prove it changes nothing, and every deliberate change shows up as a snapshot diff.

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

// Tests run without loaded translations (t returns the key). Codex builds its error texts
// with t, and it recognizes its own texts by their words, so the English texts are needed
// to pin what users see.
vitest.mock("../../../i18n", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../../i18n")>()
	const english: Record<string, any> = { common: (await import("../../../i18n/locales/en/common.json")).default }
	return {
		...original,
		t: (key: string, options: Record<string, unknown> = {}) => {
			const [namespace, path] = key.split(":")
			const template = path.split(".").reduce((node: any, part) => node?.[part], english[namespace])
			if (typeof template !== "string") {
				return (options.defaultValue as string | undefined) ?? key
			}
			return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name]))
		},
	}
})

import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"

import type { ApiHandlerOptions } from "../../../shared/api"
import type { ApiStreamChunk } from "../../transform/stream"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenAiCodexHandler } from "../openai-codex"
import { XAIHandler } from "../xai"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

type Outcome = {
	chunks: ApiStreamChunk[]
	error?: string
	status?: number
	responseId?: string
	encryptedContent?: { encrypted_content: string; id?: string }
}

type HandlerWithState = {
	createMessage: OpenAiNativeHandler["createMessage"]
	getResponseId?: () => string | undefined
	getEncryptedContent?: () => { encrypted_content: string; id?: string } | undefined
}

const conversation: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

function sdkStream(events: unknown[]) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event
			}
		},
	}
}

/**
 * Encodes the events the way the Responses API sends them (an `event:` line, a `data:`
 * line and a blank line per event, a keep-alive comment and a final [DONE]) and cuts the
 * bytes into 7-byte pieces so that lines arrive split across reads.
 */
function sseResponse(events: unknown[]): Response {
	let text = ": keep-alive\n\n"
	for (const event of events) {
		const type = (event as { type?: string })?.type
		if (type) {
			text += `event: ${type}\n`
		}
		text += `data: ${JSON.stringify(event)}\n\n`
	}
	text += "data: [DONE]\n\n"
	const bytes = new TextEncoder().encode(text)
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let i = 0; i < bytes.length; i += 7) {
				controller.enqueue(bytes.slice(i, i + 7))
			}
			controller.close()
		},
	})
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

async function drain(handler: HandlerWithState): Promise<Outcome> {
	const outcome: Outcome = { chunks: [] }
	try {
		for await (const chunk of handler.createMessage("system", conversation, { taskId: "task-1" })) {
			outcome.chunks.push(chunk)
		}
	} catch (error) {
		outcome.error = error instanceof Error ? error.message : String(error)
		const status = (error as { status?: number })?.status
		if (status !== undefined) {
			outcome.status = status
		}
	}
	if (handler.getResponseId) {
		outcome.responseId = handler.getResponseId()
	}
	if (handler.getEncryptedContent) {
		outcome.encryptedContent = handler.getEncryptedContent()
	}
	return outcome
}

function nativeHandler(options: Partial<ApiHandlerOptions> = {}) {
	return new OpenAiNativeHandler({ openAiNativeApiKey: "test-key", apiModelId: "gpt-5.4", ...options })
}

function codexHandler(options: Partial<ApiHandlerOptions> = {}) {
	vitest.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
	vitest.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
	// A 401 makes Codex refresh the token once; here the refresh fails (signed out).
	vitest.spyOn(openAiCodexOAuthManager, "forceRefreshAccessToken").mockResolvedValue(null)
	return new OpenAiCodexHandler({ apiModelId: "gpt-5.4", ...options })
}

function xaiHandler(options: Partial<ApiHandlerOptions> = {}) {
	return new XAIHandler({ xaiApiKey: "test-key", apiModelId: "grok-4.6", ...options })
}

async function viaSdk(handler: HandlerWithState, events: unknown[]) {
	const create = vitest.fn().mockResolvedValue(sdkStream(events))
	Reflect.set(handler, "client", { responses: { create } })
	return drain(handler)
}

async function viaSseFallback(handler: HandlerWithState, events: unknown[], sdkFailure: "missing" | "error") {
	// An SDK without `responses` (TypeError) or a plain Error without an HTTP status is the
	// only failure that still takes the fetch fallback (DEF-C44).
	Reflect.set(
		handler,
		"client",
		sdkFailure === "missing"
			? {}
			: { responses: { create: vitest.fn().mockRejectedValue(new Error("SDK unavailable")) } },
	)
	vitest.stubGlobal(
		"fetch",
		vitest.fn().mockImplementation(async () => sseResponse(events)),
	)
	return drain(handler)
}

async function replay(events: unknown[]) {
	return {
		native: await viaSdk(nativeHandler(), events),
		nativeSse: await viaSseFallback(nativeHandler(), events, "missing"),
		codex: await viaSdk(codexHandler(), events),
		codexSse: await viaSseFallback(codexHandler(), events, "error"),
		xai: await viaSdk(xaiHandler(), events),
	}
}

const completed = (id: string, extra: Record<string, unknown> = {}) => ({
	type: "response.completed",
	response: {
		id,
		status: "completed",
		output: [],
		usage: { input_tokens: 1, output_tokens: 2 },
		...extra,
	},
})

/**
 * Recorded shapes of Responses API streams. The #10719 and #11621 fixtures are the event
 * sequences of the specs that came with those upstream fixes (openai-native-tools and
 * openai-codex-native-tool-calls); the rest cover the other branches of the processors.
 */
const fixtures: Record<string, unknown[]> = {
	"reasoning, text and usage of a real GPT-5 answer": [
		{
			type: "response.created",
			response: { id: "resp_full", status: "in_progress", output: [], service_tier: "auto" },
		},
		{ type: "response.in_progress", response: { id: "resp_full", status: "in_progress", output: [] } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { id: "rs_1", type: "reasoning", summary: [] },
		},
		{ type: "response.reasoning_summary_part.added", item_id: "rs_1", part: { type: "summary_text", text: "" } },
		{ type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Thinking about " },
		{ type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "the answer" },
		{ type: "response.reasoning_summary_text.done", item_id: "rs_1", text: "Thinking about the answer" },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				id: "rs_1",
				type: "reasoning",
				encrypted_content: "enc_abc",
				summary: [{ type: "summary_text", text: "Thinking about the answer" }],
			},
		},
		{
			type: "response.output_item.added",
			output_index: 1,
			item: { id: "msg_1", type: "message", role: "assistant", status: "in_progress", content: [] },
		},
		{
			type: "response.content_part.added",
			item_id: "msg_1",
			part: { type: "output_text", text: "", annotations: [] },
		},
		{ type: "response.output_text.delta", item_id: "msg_1", delta: "Hello " },
		{ type: "response.output_text.delta", item_id: "msg_1", delta: "there" },
		{ type: "response.output_text.done", item_id: "msg_1", text: "Hello there" },
		{
			type: "response.content_part.done",
			item_id: "msg_1",
			part: { type: "output_text", text: "Hello there", annotations: [] },
		},
		{
			type: "response.output_item.done",
			output_index: 1,
			item: {
				id: "msg_1",
				type: "message",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "Hello there", annotations: [] }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_full",
				status: "completed",
				service_tier: "flex",
				output: [
					{
						id: "rs_1",
						type: "reasoning",
						encrypted_content: "enc_abc",
						summary: [{ type: "summary_text", text: "Thinking about the answer" }],
					},
					{
						id: "msg_1",
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "Hello there" }],
					},
				],
				usage: {
					input_tokens: 1000,
					input_tokens_details: { cached_tokens: 400 },
					output_tokens: 200,
					output_tokens_details: { reasoning_tokens: 120 },
					total_tokens: 1200,
				},
			},
		},
	],
	"streamed function call (item_id on the deltas, identity on the item)": [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "read_file", arguments: "" },
		},
		{ type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: '{"path":' },
		{ type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: '"a.ts"}' },
		{
			type: "response.function_call_arguments.done",
			item_id: "fc_1",
			output_index: 0,
			arguments: '{"path":"a.ts"}',
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				id: "fc_1",
				type: "function_call",
				call_id: "call_1",
				name: "read_file",
				arguments: '{"path":"a.ts"}',
			},
		},
		completed("resp_fc"),
	],
	"#10719 argument deltas without any identity": [
		{
			type: "response.output_item.added",
			item: { type: "function_call", call_id: "call_123", name: "read_file", arguments: "" },
		},
		{ type: "response.function_call_arguments.delta", delta: '{"path":' },
		{ type: "response.function_call_arguments.delta", delta: '"/tmp/test.txt"}' },
		{
			type: "response.output_item.done",
			item: {
				type: "function_call",
				call_id: "call_123",
				name: "read_file",
				arguments: '{"path":"/tmp/test.txt"}',
			},
		},
	],
	"argument deltas that carry their own identity": [
		{
			type: "response.function_call_arguments.delta",
			call_id: "call_own",
			name: "list_files",
			index: 2,
			delta: '{"path":"."}',
		},
		{ type: "response.function_call_arguments.delta", call_id: "call_own", name: "list_files", index: 2 },
		{
			type: "response.output_item.done",
			item: { type: "function_call", call_id: "call_own", name: "list_files", arguments: '{"path":"."}' },
		},
	],
	"#11621 assistant message only in response.output_item.done": [
		{
			type: "response.output_item.done",
			item: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "hello from done item" }],
			},
			output_index: 0,
		},
		completed("resp_done_item_only"),
	],
	"#11621 text only in the response.completed output": [
		completed("resp_completed_only", {
			output: [
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "final payload only" }],
				},
			],
		}),
	],
	"#11621 text only in response.output_text.done": [
		{ type: "response.output_text.done", text: "done-event text only" },
		completed("resp_done_text_only"),
	],
	"#11621 text only in response.content_part.added": [
		{
			type: "response.content_part.added",
			part: { type: "output_text", text: "content part text" },
			output_index: 0,
			content_index: 0,
		},
		completed("resp_content_part"),
	],
	"#11621 function call only in response.output_item.done (object arguments)": [
		{
			type: "response.output_item.done",
			item: {
				type: "function_call",
				call_id: "call_done_only",
				name: "attempt_completion",
				arguments: { result: "ok" },
			},
			output_index: 0,
		},
		completed("resp_done_tool_only"),
	],
	"#11621 deltas and output_text.done together": [
		{ type: "response.output_text.delta", delta: "hello " },
		{ type: "response.output_text.delta", delta: "world" },
		{ type: "response.output_text.done", text: "hello world" },
		completed("resp_delta_done"),
	],
	"#11621 deltas and content_part.added together": [
		{ type: "response.output_text.delta", delta: "hello world" },
		{
			type: "response.content_part.added",
			part: { type: "output_text", text: "hello world" },
			output_index: 0,
			content_index: 0,
		},
		completed("resp_delta_content_part"),
	],
	"text and reasoning items in response.output_item.added": [
		{ type: "response.output_item.added", item: { type: "reasoning", text: "item reasoning" } },
		{ type: "response.output_item.added", item: { type: "output_text", text: "item text" } },
		{
			type: "response.output_item.added",
			item: { type: "message", content: [{ type: "text", text: "message text" }] },
		},
		completed("resp_added_items"),
	],
	refusal: [
		{ type: "response.refusal.delta", delta: "I cannot help with that." },
		{ type: "response.refusal.done", refusal: "I cannot help with that." },
		completed("resp_refusal"),
	],
	"reasoning_text deltas and legacy delta names": [
		{ type: "response.reasoning_text.delta", delta: "raw reasoning" },
		{ type: "response.reasoning.delta", delta: " more" },
		{ type: "response.reasoning_summary.delta", delta: " summary" },
		{ type: "response.text.delta", delta: "legacy text" },
		{ type: "response.done", response: { id: "resp_legacy", usage: { input_tokens: 5, output_tokens: 6 } } },
	],
	"GPT-5.6 cache writes in input_tokens_details": [
		{ type: "response.output_text.delta", delta: "cached" },
		completed("resp_cache_write", {
			usage: {
				input_tokens: 10000,
				input_tokens_details: { cached_tokens: 2000, cache_write_tokens: 3000 },
				output_tokens: 500,
			},
		}),
	],
	"usage with only token details": [
		completed("resp_details_only", {
			usage: {
				input_tokens_details: { cached_tokens: 30, cache_miss_tokens: 70, cache_write_tokens: 5 },
				output_tokens: 9,
			},
		}),
	],
	"usage with Chat Completions and Anthropic style names": [
		completed("resp_alt_usage", {
			usage: {
				prompt_tokens: 50,
				completion_tokens: 7,
				cache_creation_input_tokens: 11,
				cache_read_input_tokens: 13,
			},
		}),
	],
	"usage in a separate event and a Chat Completions chunk": [
		{ choices: [{ delta: { content: "chat chunk" } }] },
		{ type: "response.usage", usage: { input_tokens: 3, output_tokens: 4 } },
	],
	"Chat Completions chunk followed by a done message": [
		{ choices: [{ delta: { content: "chat chunk" } }] },
		{
			type: "response.output_item.done",
			item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "chat chunk" }] },
		},
	],
	"audio transcript and tool status events": [
		{ type: "response.audio_transcript.delta", delta: "spoken words" },
		{ type: "response.web_search_call.completed", item: { text: "search status" } },
		{ type: "response.reasoning_summary_text.done", item: { text: "summary done" } },
		completed("resp_audio"),
	],
	"error event": [
		{ type: "response.output_text.delta", delta: "partial" },
		{ type: "error", code: "server_error", message: "The server had an error" },
		completed("resp_error"),
	],
	"response.failed": [
		{
			type: "response.failed",
			response: {
				id: "resp_failed",
				status: "failed",
				output: [],
				error: { code: "server_error", message: "Something went wrong" },
			},
		},
	],
	"full response in a non-streaming event": [
		{
			type: "response.snapshot",
			response: {
				id: "resp_snapshot",
				output: [
					{ type: "text", content: [{ type: "text", text: "snapshot text" }] },
					{ type: "reasoning", summary: [{ type: "summary_text", text: "snapshot reasoning" }] },
				],
				usage: { input_tokens: 8, output_tokens: 9 },
			},
		},
	],
}

describe("Responses API handlers: replayed event fixtures", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	it.each(Object.entries(fixtures))("%s", async (_name, events) => {
		expect(await replay(events)).toMatchSnapshot()
	})
})

// OpenAI Native and OpenAI Codex talk to the same Responses API, so the same events must
// give the same chunks. Only the price differs (Codex is a subscription: cost 0).
describe("Responses API handlers: OpenAI Native and Codex agree", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	const withoutCost = (outcome: Outcome) => ({
		...outcome,
		chunks: outcome.chunks.map((chunk) => {
			if (chunk.type !== "usage") {
				return chunk
			}
			const { totalCost: _totalCost, ...rest } = chunk
			return rest
		}),
	})

	it.each(Object.entries(fixtures))("%s", async (_name, events) => {
		const outcomes = await replay(events)
		expect(withoutCost(outcomes.codex)).toEqual(withoutCost(outcomes.native))
		// The error texts of the fallback are each handler's own (Codex translates them).
		expect(withoutCost({ ...outcomes.codexSse, error: undefined })).toEqual(
			withoutCost({ ...outcomes.nativeSse, error: undefined }),
		)
	})
})

// Tool definitions exercising both schema paths: a native tool (strict) with a nullable
// property and a nested object, and an MCP tool (not strict) with an optional property.
const tools: OpenAI.Chat.ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "execute_command",
			description: "Run a command",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string" },
					cwd: { type: ["string", "null"] },
					env: { type: "object", properties: { name: { type: "string" } } },
				},
				required: ["command"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "mcp--github--search",
			description: "Search GitHub",
			parameters: {
				type: "object",
				properties: { query: { type: "string" }, limit: { type: "number" } },
				required: ["query"],
			},
		},
	},
]

const longToolUseId = "toolu_" + "x".repeat(70) + ".bad:chars"

// A history with every block the converters handle.
const history: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Read a.ts" },
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Need to read it", signature: "sig" } as any,
			{ type: "text", text: "Reading the file." },
			{ type: "tool_use", id: longToolUseId, name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: longToolUseId, content: "file body" },
			{
				type: "tool_result",
				tool_use_id: "toolu_2",
				content: [
					{ type: "text", text: "part one" },
					{ type: "text", text: "part two" },
				],
			},
			{ type: "tool_result", tool_use_id: "toolu_3", content: "" },
			{ type: "text", text: "Now explain it" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
		],
	},
	{ type: "reasoning", id: "rs_prev", encrypted_content: "enc_prev", summary: [] } as any,
	{ role: "assistant", content: "It exports one function." },
]

// The xAI converter cannot read the standalone reasoning item (see the last test).
const historyWithoutReasoningItem = history.filter((message) => (message as any).type !== "reasoning")

async function requestBodyOf(
	handler: HandlerWithState,
	metadata: Record<string, unknown> = { taskId: "task-1", tools },
	messages: Anthropic.Messages.MessageParam[] = history,
): Promise<unknown> {
	const create = vitest.fn().mockResolvedValue(sdkStream([completed("resp_body")]))
	Reflect.set(handler, "client", { responses: { create } })
	for await (const _chunk of handler.createMessage("You are a coder.", messages, metadata as any)) {
		// drain
	}
	return create.mock.calls[0][0]
}

// xAI serves the same Responses API events; its stream must be read like OpenAI Native's
// (it has no SSE fallback and prices usage in the task, so only the chunks without cost
// are compared).
describe("Responses API handlers: xAI reads events like OpenAI Native", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	it.each(Object.entries(fixtures))("%s", async (_name, events) => {
		const native = await viaSdk(nativeHandler(), events)
		const xai = await viaSdk(xaiHandler(), events)
		const withoutCost = (chunks: ApiStreamChunk[]) =>
			chunks.map((chunk) => {
				if (chunk.type !== "usage") {
					return chunk
				}
				const { totalCost: _totalCost, ...rest } = chunk
				return rest
			})
		expect({ chunks: withoutCost(xai.chunks), error: xai.error }).toEqual({
			chunks: withoutCost(native.chunks),
			error: native.error,
		})
	})
})

// What the fetch fallback reports when the server refuses the request or cannot be reached.
describe("Responses API handlers: fallback HTTP errors", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	const answers: Array<[string, () => Promise<Response>]> = [
		[
			"400 with a detail field",
			async () => new Response('{"detail":"Stream must be set to true"}', { status: 400 }),
		],
		["401 with an error message", async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })],
		["403 with a message field", async () => new Response('{"message":"no access"}', { status: 403 })],
		["404 with plain text", async () => new Response("not found", { status: 404 })],
		["429 with an empty body", async () => new Response("", { status: 429 })],
		["502 with JSON without a message", async () => new Response('{"code":1}', { status: 502 })],
		["418 (no dedicated text)", async () => new Response("teapot", { status: 418 })],
		["a 200 without a body", async () => new Response(null, { status: 200 })],
		[
			"a network failure",
			async () => {
				throw new TypeError("fetch failed")
			},
		],
	]

	it.each(answers)("%s", async (_name, answer) => {
		const outcomes: Record<string, Outcome> = {}
		for (const [name, handler, sdkFailure] of [
			["native", nativeHandler(), "missing"],
			["codex", codexHandler(), "error"],
		] as const) {
			Reflect.set(
				handler,
				"client",
				sdkFailure === "missing"
					? {}
					: { responses: { create: vitest.fn().mockRejectedValue(new Error("SDK unavailable")) } },
			)
			vitest.stubGlobal("fetch", vitest.fn().mockImplementation(answer))
			outcomes[name] = await drain(handler)
		}
		expect(outcomes).toMatchSnapshot()
	})
})

describe("Responses API handlers: request bodies", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	it.each([
		["gpt-5.4 with default settings", {}],
		[
			"gpt-5.4 with effort, summary off, verbosity, flex tier and temperature",
			{
				reasoningEffort: "high",
				enableResponsesReasoningSummary: false,
				verbosity: "low",
				openAiNativeServiceTier: "flex",
				modelTemperature: 0.3,
			},
		],
		["gpt-5.1 (24h prompt cache retention)", { apiModelId: "gpt-5.1" }],
		["gpt-4.1 (no reasoning, temperature)", { apiModelId: "gpt-4.1", openAiNativeServiceTier: "priority" }],
		["gpt-5.4 with reasoning disabled", { reasoningEffort: "disable" }],
	] as const)("native: %s", async (_name, options) => {
		expect(await requestBodyOf(nativeHandler(options as Partial<ApiHandlerOptions>))).toMatchSnapshot()
	})

	it("native: no tools, forced tool choice and parallel calls off", async () => {
		expect(
			await requestBodyOf(nativeHandler(), {
				taskId: "task-1",
				tool_choice: "required",
				parallelToolCalls: false,
			}),
		).toMatchSnapshot()
	})

	it.each([
		["gpt-5.4 with default settings", {}],
		["gpt-5.6-sol with effort none", { apiModelId: "gpt-5.6-sol", reasoningEffort: "none" }],
		[
			"gpt-5.4 with effort high and summary off",
			{ reasoningEffort: "high", enableResponsesReasoningSummary: false },
		],
	] as const)("codex: %s", async (_name, options) => {
		expect(await requestBodyOf(codexHandler(options as Partial<ApiHandlerOptions>))).toMatchSnapshot()
	})

	it.each([
		["grok-4.6 with default settings", {}],
		["grok-3-mini (reasoning effort)", { apiModelId: "grok-3-mini" }],
		["grok-4-0709 with temperature", { apiModelId: "grok-4-0709", modelTemperature: 0.5 }],
	] as const)("xai: %s", async (_name, options) => {
		expect(
			await requestBodyOf(
				xaiHandler(options as Partial<ApiHandlerOptions>),
				undefined,
				historyWithoutReasoningItem,
			),
		).toMatchSnapshot()
	})

	it("xai: no tools", async () => {
		expect(await requestBodyOf(xaiHandler(), { taskId: "task-1" }, historyWithoutReasoningItem)).toMatchSnapshot()
	})

	// Today's behavior, pinned as found (not fixed here): the task history sends an OpenAI
	// encrypted reasoning item as a standalone `{ type: "reasoning" }` entry, for example
	// after a task switched from an OpenAI Native or Codex mode to an xAI mode, and the xAI
	// converter treats it as a user message without content.
	it("xai: a standalone reasoning item in the history fails the request", async () => {
		await expect(requestBodyOf(xaiHandler())).rejects.toThrow("message.content is not iterable")
	})
})
