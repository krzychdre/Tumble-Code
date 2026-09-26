// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/cancellation-contract.spec.ts

// API-5: one cancellation contract for every provider handler.
//
// The task hands each request its own AbortSignal in the request metadata
// (`metadata.signal`, the signal of the task's `currentRequestAbortController`),
// and Stop aborts it. A handler that does not give that signal to its SDK or
// fetch call leaves the HTTP request open: the task stops reading, but the
// server keeps generating (tokens billed, a local GPU stays busy until the
// answer is complete). A handler-wide controller that `cancelRequest()` aborts
// is not enough either: two overlapping requests share it, so the second
// request overwrites the first one's controller.
//
// Each case builds the REAL handler with a client whose request behaves like the
// real SDK: it waits for its AbortSignal and rejects once the signal fires, and
// hangs forever when it was given no signal. The contract, per handler:
// - aborting the task's signal while the stream waits for its next chunk aborts
//   the SDK request and ends the stream promptly;
// - aborting it while the request waits for the response (prompt processing on
//   a local server) does the same;
// - two overlapping requests are cancelled independently.
//
// Not in the table: VS Code LM (a CancellationToken, pinned in vscode-lm.spec)
// and fake-ai (test double that forwards the metadata unchanged).

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

// Model lists are fetched over HTTP; the cancellation path does not need them.
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn(async () => ({})),
	getModelsFromCache: vi.fn(() => undefined),
}))
vi.mock("../fetchers/modelEndpointCache", () => ({
	getModelEndpoints: vi.fn(async () => ({})),
}))
vi.mock("../fetchers/ollama", () => ({
	getOllamaModels: vi.fn(async () => ({})),
}))

// The real AnthropicVertex constructor starts a Google credential lookup.
vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vi.fn().mockImplementation(function () {
		return { messages: { create: vi.fn() } }
	}),
}))

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../index"
import { AnthropicHandler } from "../anthropic"
import { AnthropicVertexHandler } from "../anthropic-vertex"
import { AwsBedrockHandler } from "../bedrock"
import { DeepSeekHandler } from "../deepseek"
import { GeminiHandler } from "../gemini"
import { LiteLLMHandler } from "../lite-llm"
import { LmStudioHandler } from "../lm-studio"
import { MiniMaxHandler } from "../minimax"
import { MistralHandler } from "../mistral"
import { MoonshotHandler } from "../moonshot"
import { NativeOllamaHandler } from "../native-ollama"
import { OpenAiHandler } from "../openai"
import { OpenAiCodexHandler } from "../openai-codex"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenRouterHandler } from "../openrouter"
import { QwenCodeHandler } from "../qwen-code"
import { XAIHandler } from "../xai"
import { ZAiHandler } from "../zai"
import { VertexHandler } from "../vertex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

type Phase = "stream" | "response"

/** One SDK call: the signal it was given and whether it is blocked waiting for it. */
interface SdkCall {
	signal: AbortSignal | undefined
	waiting: boolean
}

class FakeAbortError extends Error {
	constructor() {
		super("Request was aborted.")
		this.name = "AbortError"
	}
}

/** Rejects when the signal fires; never settles without a signal (the request keeps running). */
function waitForAbort(call: SdkCall): Promise<never> {
	call.waiting = true
	return new Promise<never>((_, reject) => {
		const { signal } = call
		if (!signal) return
		if (signal.aborted) return reject(new FakeAbortError())
		signal.addEventListener("abort", () => reject(new FakeAbortError()), { once: true })
	})
}

/** An SDK stream that emits `first`, then waits for the next chunk until aborted. */
function streamThatWaits(first: unknown, call: SdkCall): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]() {
			let sent = false
			return {
				next: async () => {
					if (!sent) {
						sent = true
						return { done: false, value: first }
					}
					return waitForAbort(call)
				},
			}
		},
	}
}

/**
 * The request of one SDK call: resolves with a stream that waits (phase "stream") or waits for
 * the response itself (phase "response"). Also offers the openai SDK's `.withResponse()`.
 */
function sdkRequest(phase: Phase, call: SdkCall, answer: () => unknown) {
	const pending: Promise<unknown> = phase === "stream" ? Promise.resolve(answer()) : waitForAbort(call)
	pending.catch(() => {})
	return Object.assign(pending, {
		withResponse: () => pending.then((data) => ({ data, response: new Response() })),
	})
}

/** Records every SDK call; `phase` decides where the request blocks. */
class FakeSdk {
	phase: Phase = "stream"
	readonly calls: SdkCall[] = []

	request(
		signal: AbortSignal | undefined,
		first: unknown,
		wrap: (stream: AsyncIterable<unknown>) => unknown = (s) => s,
	) {
		const call: SdkCall = { signal, waiting: false }
		this.calls.push(call)
		return sdkRequest(this.phase, call, () => wrap(streamThatWaits(first, call)))
	}
}

const chatChunk = { choices: [{ delta: { content: "partial answer" }, index: 0 }] }
const responsesChunk = { type: "response.output_text.delta", delta: "partial answer" }
const anthropicChunk = {
	type: "content_block_start",
	index: 0,
	content_block: { type: "text", text: "partial answer" },
}
const geminiChunk = { candidates: [{ content: { parts: [{ text: "partial answer" }] } }] }
const mistralChunk = { data: { choices: [{ delta: { content: "partial answer" } }] } }
const bedrockChunk = { contentBlockDelta: { delta: { text: "partial answer" }, contentBlockIndex: 0 } }

function chatClient(sdk: FakeSdk) {
	return {
		apiKey: "k",
		baseURL: "https://example.invalid",
		chat: { completions: { create: vi.fn((_p: unknown, opts?: any) => sdk.request(opts?.signal, chatChunk)) } },
	}
}

function responsesClient(sdk: FakeSdk) {
	return { responses: { create: vi.fn((_p: unknown, opts?: any) => sdk.request(opts?.signal, responsesChunk)) } }
}

function anthropicClient(sdk: FakeSdk) {
	return { messages: { create: vi.fn((_p: unknown, opts?: any) => sdk.request(opts?.signal, anthropicChunk)) } }
}

function geminiClient(sdk: FakeSdk) {
	return {
		models: {
			generateContentStream: vi.fn((params: any) => sdk.request(params?.config?.abortSignal, geminiChunk)),
		},
	}
}

interface HandlerCase {
	name: string
	build: (sdk: FakeSdk) => ApiHandler
	/** The phases the handler can cancel; Ollama's client takes no signal before the response. */
	phases?: Phase[]
}

const cases: HandlerCase[] = [
	{
		name: "OpenAI compatible (openai)",
		build: (sdk) => {
			const handler = new OpenAiHandler({
				openAiApiKey: "k",
				openAiModelId: "gpt-4o",
				openAiBaseUrl: "https://api.openai.com/v1",
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "OpenAI compatible, o3 family",
		build: (sdk) => {
			const handler = new OpenAiHandler({
				openAiApiKey: "k",
				openAiModelId: "o3-mini",
				openAiBaseUrl: "https://api.openai.com/v1",
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "DeepSeek",
		build: (sdk) => {
			const handler = new DeepSeekHandler({ apiModelId: "deepseek-chat", deepSeekApiKey: "k" })
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "Z.ai (BaseOpenAiCompatibleProvider)",
		build: (sdk) => {
			const handler = new ZAiHandler({
				apiModelId: "glm-4.6",
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "Z.ai, GLM thinking path",
		build: (sdk) => {
			const handler = new ZAiHandler({
				apiModelId: "glm-5.3",
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "Moonshot",
		build: (sdk) => {
			const handler = new MoonshotHandler({ apiModelId: "kimi-k2-0905-preview", moonshotApiKey: "k" })
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "OpenRouter",
		build: (sdk) => {
			const handler = new OpenRouterHandler({ openRouterApiKey: "k", openRouterModelId: "openai/gpt-4o" })
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "LiteLLM",
		build: (sdk) => {
			const handler = new LiteLLMHandler({
				litellmApiKey: "k",
				litellmBaseUrl: "http://localhost:4000",
				litellmModelId: "gpt-4o",
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "LM Studio",
		build: (sdk) => {
			const handler = new LmStudioHandler({
				lmStudioModelId: "local-model",
				lmStudioBaseUrl: "http://localhost:1234",
			})
			vi.spyOn(handler, "countTokens").mockResolvedValue(0)
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "Qwen Code",
		build: (sdk) => {
			const handler = new QwenCodeHandler({ apiModelId: "qwen3-coder-plus" })
			Reflect.set(handler, "credentials", {
				access_token: "t",
				refresh_token: "r",
				token_type: "Bearer",
				expiry_date: Date.now() + 3_600_000,
			})
			Reflect.set(handler, "client", chatClient(sdk))
			return handler
		},
	},
	{
		name: "xAI",
		build: (sdk) => {
			const handler = new XAIHandler({ apiModelId: "grok-4", xaiApiKey: "k" })
			Reflect.set(handler, "client", responsesClient(sdk))
			return handler
		},
	},
	{
		name: "OpenAI native (Responses API)",
		build: (sdk) => {
			const handler = new OpenAiNativeHandler({ apiModelId: "gpt-4.1", openAiNativeApiKey: "k" })
			Reflect.set(handler, "client", responsesClient(sdk))
			return handler
		},
	},
	{
		name: "OpenAI Codex (ChatGPT subscription)",
		build: (sdk) => {
			const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
			vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
			vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
			Reflect.set(handler, "client", responsesClient(sdk))
			return handler
		},
	},
	{
		name: "Anthropic",
		build: (sdk) => {
			const handler = new AnthropicHandler({ apiKey: "k", apiModelId: "claude-sonnet-4-5" })
			Reflect.set(handler, "client", anthropicClient(sdk))
			return handler
		},
	},
	{
		name: "MiniMax",
		build: (sdk) => {
			const handler = new MiniMaxHandler({ minimaxApiKey: "k", apiModelId: "MiniMax-M2" })
			Reflect.set(handler, "client", anthropicClient(sdk))
			return handler
		},
	},
	{
		name: "Anthropic on Vertex",
		build: (sdk) => {
			const handler = new AnthropicVertexHandler({
				vertexProjectId: "p",
				vertexRegion: "us-east5",
				apiModelId: "claude-sonnet-4-5@20250929",
			})
			Reflect.set(handler, "client", anthropicClient(sdk))
			return handler
		},
	},
	{
		name: "Gemini",
		build: (sdk) => {
			const handler = new GeminiHandler({ geminiApiKey: "k", apiModelId: "gemini-2.5-flash" })
			Reflect.set(handler, "client", geminiClient(sdk))
			return handler
		},
	},
	{
		name: "Gemini on Vertex",
		build: (sdk) => {
			const handler = new VertexHandler({
				vertexProjectId: "p",
				vertexRegion: "us-central1",
				apiModelId: "gemini-2.5-flash",
			})
			Reflect.set(handler, "client", geminiClient(sdk))
			return handler
		},
	},
	{
		name: "Mistral",
		build: (sdk) => {
			const handler = new MistralHandler({ mistralApiKey: "k", apiModelId: "codestral-latest" })
			Reflect.set(handler, "client", {
				chat: {
					stream: vi.fn((_r: unknown, opts?: any) => sdk.request(opts?.fetchOptions?.signal, mistralChunk)),
				},
			})
			return handler
		},
	},
	{
		name: "Amazon Bedrock",
		build: (sdk) => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsAccessKey: "a",
				awsSecretKey: "s",
				awsRegion: "us-east-1",
			})
			Reflect.set(handler, "client", {
				send: vi.fn((_c: unknown, opts?: any) =>
					sdk.request(opts?.abortSignal, bedrockChunk, (stream) => ({ stream })),
				),
			})
			return handler
		},
	},
	{
		// The ollama client takes no signal: its streamed answer is an iterator with its own
		// abort(), which closes the HTTP connection. The fake gives that iterator a controller.
		name: "Ollama",
		phases: ["stream"],
		build: (sdk) => {
			const handler = new NativeOllamaHandler({
				ollamaModelId: "llama3.1",
				ollamaBaseUrl: "http://localhost:11434",
			})
			Reflect.set(handler, "client", {
				chat: vi.fn(() => {
					const controller = new AbortController()
					return sdk.request(
						controller.signal,
						{ message: { content: "partial answer" }, done: false },
						(stream) => Object.assign(stream, { abort: () => controller.abort() }),
					)
				}),
				abort: vi.fn(),
			})
			return handler
		},
	},
]

type Settled = { status: "finished" } | { status: "hung" }

/** Reads the whole stream in the background; settles when it ends or throws. */
function drain(stream: AsyncIterable<unknown>): Promise<void> {
	return (async () => {
		try {
			for await (const _chunk of stream) {
				// The chunks do not matter here, only that the stream stops.
			}
		} catch {
			// An abort error is a correct way to stop.
		}
	})()
}

/** Waits briefly; "hung" means the stream kept waiting after the abort. */
async function settleWithin(promise: Promise<void>, ms = 300): Promise<Settled> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<Settled>((resolve) => {
		timer = setTimeout(() => resolve({ status: "hung" }), ms)
	})
	try {
		return await Promise.race([promise.then((): Settled => ({ status: "finished" })), hung])
	} finally {
		clearTimeout(timer)
	}
}

function startRequest(handler: ApiHandler, signal: AbortSignal) {
	const metadata: ApiHandlerCreateMessageMetadata = { taskId: "task-1", signal }
	return drain(handler.createMessage("system", [{ role: "user", content: "Hi" }], metadata))
}

/** Waits until the SDK request (call `index`) is blocked, in the stream or before the response. */
async function waitUntilBlocked(sdk: FakeSdk, index = 0) {
	await vi.waitFor(() => {
		expect(sdk.calls[index]?.waiting).toBe(true)
	})
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
	// A fallback request after the abort would be a second request: it must not stay open either.
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
			waitForAbort({ signal: init?.signal, waiting: false }),
		),
	)
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("provider cancellation contract (API-5)", () => {
	describe.each(cases)("$name", ({ build, phases = ["stream", "response"] }) => {
		it.each(phases)("aborting the task's signal aborts the SDK request (waiting in the %s)", async (phase) => {
			const sdk = new FakeSdk()
			sdk.phase = phase
			const handler = build(sdk)
			const task = new AbortController()

			const finished = startRequest(handler, task.signal)
			await waitUntilBlocked(sdk)

			task.abort()

			expect(await settleWithin(finished)).toEqual({ status: "finished" })
			expect(sdk.calls).toHaveLength(1)
			expect(sdk.calls[0].signal?.aborted).toBe(true)
		})

		it("cancels two overlapping requests independently", async () => {
			const sdk = new FakeSdk()
			const handler = build(sdk)
			const first = new AbortController()
			const second = new AbortController()

			const firstFinished = startRequest(handler, first.signal)
			await waitUntilBlocked(sdk, 0)
			const secondFinished = startRequest(handler, second.signal)
			await waitUntilBlocked(sdk, 1)

			first.abort()

			expect(await settleWithin(firstFinished)).toEqual({ status: "finished" })
			expect(sdk.calls[0].signal?.aborted).toBe(true)
			expect(sdk.calls[1].signal?.aborted).toBe(false)

			second.abort()
			expect(await settleWithin(secondFinished)).toEqual({ status: "finished" })
		})
	})

	describe("Ollama, before the response arrives", () => {
		it("ends the stream promptly and aborts the answer as soon as it arrives", async () => {
			const handler = new NativeOllamaHandler({
				ollamaModelId: "llama3.1",
				ollamaBaseUrl: "http://localhost:11434",
			})
			// Prompt processing: the ollama client resolves only once the server answers.
			let answer!: (stream: unknown) => void
			const lateStream = { abort: vi.fn(), async *[Symbol.asyncIterator]() {} }
			Reflect.set(handler, "client", {
				chat: vi.fn(() => new Promise((resolve) => (answer = resolve))),
				abort: vi.fn(),
			})
			const task = new AbortController()

			const finished = startRequest(handler, task.signal)
			await vi.waitFor(() => expect(answer).toBeTypeOf("function"))

			task.abort()
			expect(await settleWithin(finished)).toEqual({ status: "finished" })

			// The server answers after all: the connection is closed right away.
			answer(lateStream)
			await vi.waitFor(() => expect(lateStream.abort).toHaveBeenCalled())
		})
	})
})
