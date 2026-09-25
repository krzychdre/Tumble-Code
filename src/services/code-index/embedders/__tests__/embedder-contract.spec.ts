// One behavioral contract, run against every code-index embedder.
//
// Each embedder talks to its backend through a different wire (the OpenAI SDK, a direct
// fetch, the Ollama REST API, the Bedrock runtime client). The fakes below translate one
// shared "server plan" into each wire, so the same expectations hold for all of them:
// one vector per input in input order, requests kept under MAX_BATCH_TOKENS, the same
// retry policy with the same delays, one telemetry event per failed call, and a
// validation probe that reports the model's dimension or a translated error.

import { MAX_BATCH_TOKENS, MAX_ITEM_TOKENS, GEMINI_MAX_ITEM_TOKENS } from "../../constants"
import type { IEmbedder } from "../../interfaces/embedder"

type PlanStep = { vectors: "all" | "none" | "allButLast" } | { status: number }

interface WireRequest {
	texts: string[]
}

const DIMENSION = 3

const server = {
	requests: [] as WireRequest[],
	plan: [] as PlanStep[],
	reset() {
		this.requests = []
		this.plan = []
	},
	/** Records a request and returns the vectors, or the HTTP status, the plan asks for. */
	answer(texts: string[]): { vectors: number[][] } | { status: number } {
		this.requests.push({ texts })
		const step = this.plan.shift() ?? { vectors: "all" }
		if ("status" in step) {
			return step
		}
		const all = texts.map((text) => [idOf(text), 0.5, -1])
		if (step.vectors === "none") return { vectors: [] }
		if (step.vectors === "allButLast") return { vectors: all.slice(0, -1) }
		return { vectors: all }
	},
}

/** Every test text starts with `#<id>|`, so a vector can say which input it belongs to. */
function idOf(text: string): number {
	const match = /#(\d+)\|/.exec(text)
	return match ? Number(match[1]) : -1
}

function text(id: number, chars = 20): string {
	const head = `#${id}|`
	return head + "x".repeat(Math.max(0, chars - head.length))
}

function float32Base64(values: number[]): string {
	return Buffer.from(new Float32Array(values).buffer).toString("base64")
}

function httpError(status: number): Error {
	return Object.assign(new Error(`${status} status code (no body)`), { status })
}

vi.mock("openai", () => {
	class OpenAI {
		embeddings: { create: (params: any) => Promise<any> }
		constructor(_options: unknown) {
			this.embeddings = {
				create: async (params: any) => {
					const reply = server.answer(params.input)
					if ("status" in reply) {
						throw httpError(reply.status)
					}
					const base64 = params.encoding_format === "base64"
					return {
						data: reply.vectors.map((vector, index) => ({
							index,
							embedding: base64 ? float32Base64(vector) : vector,
						})),
						usage: { prompt_tokens: 1, total_tokens: 1 },
					}
				},
			}
		}
	}
	return { OpenAI, default: OpenAI }
})

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class InvokeModelCommand {
		constructor(public input: any) {}
	}
	class BedrockRuntimeClient {
		async send(command: InvokeModelCommand) {
			const body = JSON.parse(command.input.body)
			const reply = server.answer([body.inputText])
			if ("status" in reply) {
				const name = reply.status === 429 ? "ThrottlingException" : "InternalServerException"
				throw Object.assign(new Error(name), { name, $metadata: { httpStatusCode: reply.status } })
			}
			const embedding = reply.vectors[0]
			return {
				body: new TextEncoder().encode(JSON.stringify(embedding ? { embedding, inputTextTokenCount: 1 } : {})),
			}
		}
	}
	return { BedrockRuntimeClient, InvokeModelCommand }
})

vi.mock("@aws-sdk/credential-providers", () => ({
	fromIni: vi.fn(() => ({})),
	fromNodeProviderChain: vi.fn(() => ({})),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

// A translated message is recognizable by its "T(" wrapper; a raw i18n key is not.
vi.mock("../../../../i18n", () => ({
	t: (key: string) => `T(${key})`,
}))

import { TelemetryService } from "@roo-code/telemetry"
import { OpenAiEmbedder } from "../openai"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { OpenRouterEmbedder } from "../openrouter"
import { GeminiEmbedder } from "../gemini"
import { MistralEmbedder } from "../mistral"
import { VercelAiGatewayEmbedder } from "../vercel-ai-gateway"
import { BedrockEmbedder } from "../bedrock"
import { CodeIndexOllamaEmbedder } from "../ollama"

/** The Ollama REST API and a full OpenAI-compatible endpoint URL both go through fetch. */
async function fakeFetch(input: unknown, init?: RequestInit): Promise<Response> {
	const url = String(input)
	if (url.endsWith("/api/tags")) {
		return Response.json({ models: [{ name: "nomic-embed-text:latest" }] })
	}
	const body = JSON.parse(String(init?.body))
	const reply = server.answer(body.input)
	if ("status" in reply) {
		return new Response("error", { status: reply.status })
	}
	if (url.endsWith("/api/embed")) {
		return Response.json({ embeddings: reply.vectors })
	}
	return Response.json({
		data: reply.vectors.map((vector, index) => ({ index, embedding: float32Base64(vector) })),
		usage: { prompt_tokens: 1, total_tokens: 1 },
	})
}

interface EmbedderCase {
	name: string
	create: () => IEmbedder
	maxItemTokens: number
}

const cases: EmbedderCase[] = [
	{
		name: "openai",
		create: () => new OpenAiEmbedder({ openAiNativeApiKey: "k", openAiEmbeddingModelId: "text-embedding-3-small" }),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "openai-compatible (base URL)",
		create: () => new OpenAICompatibleEmbedder("http://127.0.0.1:11111/v1", "k", "local-embedder"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "openai-compatible (full endpoint URL)",
		create: () => new OpenAICompatibleEmbedder("http://127.0.0.1:11112/v1/embeddings", "k", "local-embedder"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "openrouter",
		create: () => new OpenRouterEmbedder("k", "openai/text-embedding-3-small"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "gemini",
		create: () => new GeminiEmbedder("k"),
		maxItemTokens: GEMINI_MAX_ITEM_TOKENS,
	},
	{
		name: "mistral",
		create: () => new MistralEmbedder("k"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "vercel-ai-gateway",
		create: () => new VercelAiGatewayEmbedder("k"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "bedrock",
		create: () => new BedrockEmbedder("us-east-1", undefined, "amazon.titan-embed-text-v2:0"),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
	{
		name: "ollama",
		create: () =>
			new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModelId: "nomic-embed-text" }),
		maxItemTokens: MAX_ITEM_TOKENS,
	},
]

// Rate-limit state is kept across calls (by design), and it forgets errors older than a
// minute. Every test starts an hour after the previous one, so no test inherits a backoff.
let clock = Date.UTC(2030, 0, 1)

describe.each(cases)("embedder contract: $name", ({ create, maxItemTokens }) => {
	const captureEvent = () => vi.mocked(TelemetryService.instance.captureEvent)
	const sentIds = () => server.requests.flatMap((request) => request.texts.map(idOf))

	beforeEach(() => {
		clock += 60 * 60 * 1000
		vi.useFakeTimers({ now: clock })
		server.reset()
		captureEvent().mockClear()
		vi.stubGlobal("fetch", vi.fn(fakeFetch))
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("returns one vector per input, in input order, without telemetry", async () => {
		const result = await create().createEmbeddings([0, 1, 2, 3, 4].map((id) => text(id)))

		expect(result.embeddings.map((vector) => vector[0])).toEqual([0, 1, 2, 3, 4])
		expect(result.embeddings.every((vector) => vector.length === DIMENSION)).toBe(true)
		expect(captureEvent()).not.toHaveBeenCalled()
	})

	it("splits the input into requests under MAX_BATCH_TOKENS and keeps the order", async () => {
		// 60 items of 1,750 estimated tokens: 105,000 tokens in total, more than one request holds.
		const texts = Array.from({ length: 60 }, (_, id) => text(id, 7000))

		const result = await create().createEmbeddings(texts)

		expect(server.requests.length).toBeGreaterThanOrEqual(2)
		for (const request of server.requests) {
			const tokens = request.texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)
			expect(tokens).toBeLessThanOrEqual(MAX_BATCH_TOKENS)
		}
		expect(sentIds()).toEqual(texts.map(idOf))
		expect(result.embeddings.map((vector) => vector[0])).toEqual(texts.map(idOf))
	})

	it("keeps a vector for an item over the per-item limit, sending it cut to the limit", async () => {
		const oversized = text(1, maxItemTokens * 4 + 400)

		const result = await create().createEmbeddings([text(0), oversized, text(2)])

		expect(result.embeddings.map((vector) => vector[0])).toEqual([0, 1, 2])
		const sent = server.requests.flatMap((request) => request.texts).find((t) => idOf(t) === 1)!
		expect(Math.ceil(sent.length / 4)).toBeLessThanOrEqual(maxItemTokens)
	})

	it("retries a rate-limited batch after 5 s and then 10 s, and reports no telemetry once it succeeds", async () => {
		server.plan = [{ status: 429 }, { status: 429 }, { vectors: "all" }]

		const promise = create().createEmbeddings([text(0)])

		await vi.advanceTimersByTimeAsync(4_999)
		expect(server.requests).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(server.requests).toHaveLength(2)
		await vi.advanceTimersByTimeAsync(9_999)
		expect(server.requests).toHaveLength(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(server.requests).toHaveLength(3)

		const result = await promise
		expect(result.embeddings.map((vector) => vector[0])).toEqual([0])
		expect(captureEvent()).not.toHaveBeenCalled()
	})

	it("gives up after 3 rate-limited attempts with exactly one telemetry event", async () => {
		server.plan = [{ status: 429 }, { status: 429 }, { status: 429 }]

		const promise = create().createEmbeddings([text(0)])
		const settled = expect(promise).rejects.toThrow()
		await vi.advanceTimersByTimeAsync(60_000)
		await settled

		expect(server.requests).toHaveLength(3)
		expect(captureEvent()).toHaveBeenCalledTimes(1)
	})

	it("does not retry a server error and reports exactly one telemetry event", async () => {
		server.plan = [{ status: 500 }]

		await expect(create().createEmbeddings([text(0)])).rejects.toThrow()

		expect(server.requests).toHaveLength(1)
		expect(captureEvent()).toHaveBeenCalledTimes(1)
	})

	it("fails a request that answers with fewer vectors than inputs instead of misaligning them", async () => {
		server.plan = [{ vectors: "allButLast" }]

		await expect(create().createEmbeddings([text(0), text(1)])).rejects.toThrow()
		expect(captureEvent()).toHaveBeenCalledTimes(1)
	})

	it("validation reports the dimension of the probe embedding", async () => {
		await expect(create().validateConfiguration()).resolves.toEqual({ valid: true, dimension: DIMENSION })
	})

	it("validation of a probe without a vector fails with a translated message", async () => {
		server.plan = [{ vectors: "none" }]

		const result = await create().validateConfiguration()

		expect(result.valid).toBe(false)
		expect(result.dimension).toBeUndefined()
		expect(result.error).toMatch(/^T\(embeddings:/)
	})
})

describe("rate limits are tracked per endpoint", () => {
	beforeEach(() => {
		clock += 60 * 60 * 1000
		vi.useFakeTimers({ now: clock })
		server.reset()
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("a 429 from one endpoint does not delay an embedder on another endpoint", async () => {
		const limited = new OpenAICompatibleEmbedder("http://127.0.0.1:1/v1", "k", "m")
		const other = new OpenAICompatibleEmbedder("http://127.0.0.1:2/v1", "k", "m")
		server.plan = [{ status: 429 }, { vectors: "all" }, { vectors: "all" }]

		const first = limited.createEmbeddings([text(0)])
		await vi.advanceTimersByTimeAsync(10)
		expect(server.requests).toHaveLength(1)

		const second = other.createEmbeddings([text(1)])
		await vi.advanceTimersByTimeAsync(10)
		expect(server.requests.map((request) => idOf(request.texts[0]))).toEqual([0, 1])

		await vi.advanceTimersByTimeAsync(10_000)
		await expect(first).resolves.toBeDefined()
		await expect(second).resolves.toBeDefined()
	})

	it("two embedders on the same endpoint share the backoff", async () => {
		const a = new OpenAICompatibleEmbedder("http://127.0.0.1:3/v1", "k", "m")
		const b = new OpenAICompatibleEmbedder("http://127.0.0.1:3/v1", "k", "m")
		server.plan = [{ status: 429 }, { vectors: "all" }, { vectors: "all" }]

		const first = a.createEmbeddings([text(0)])
		await vi.advanceTimersByTimeAsync(10)
		const second = b.createEmbeddings([text(1)])
		await vi.advanceTimersByTimeAsync(10)
		expect(server.requests).toHaveLength(1)

		await vi.advanceTimersByTimeAsync(10_000)
		await expect(first).resolves.toBeDefined()
		await expect(second).resolves.toBeDefined()
		expect(server.requests).toHaveLength(3)
	})
})
