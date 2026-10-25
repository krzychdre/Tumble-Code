// The embedders built on the real OpenAI SDK (OpenAI, OpenAI-compatible, Gemini, Mistral,
// OpenRouter); only `fetch` is faked. It pins the exact HTTP request each one sends (the
// OpenAI-compatible path is what a local llama.cpp server takes every day) and how they read the
// answers. Batching, retry, the query prefix and
// telemetry are BaseHttpEmbedder's and run for every embedder in embedder-contract.spec.ts.
//
// Headers that depend on the SDK version, the OS or the Node runtime (`user-agent` and the
// `x-stainless-*` family) are left out on purpose: they say nothing about what this embedder builds.

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

vi.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) =>
		params?.errorMessage !== undefined ? `${key} | ${String(params.errorMessage)}` : key,
}))

import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { OpenAiEmbedder } from "../openai"
import { GeminiEmbedder } from "../gemini"
import { MistralEmbedder } from "../mistral"
import { OpenRouterEmbedder } from "../openrouter"
import { getDefaultModelId } from "../../../../shared/embeddingModels"
import { logger } from "../../../../utils/logging"

interface CapturedRequest {
	url: string
	method: string | undefined
	headers: Record<string, string>
	body: string
}

function float32Base64(values: number[]): string {
	return Buffer.from(new Float32Array(values).buffer).toString("base64")
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

/** An embeddings answer with one vector [i, 0.5, -1] per input. */
function embeddingsResponse(count: number, encode: (v: number[]) => unknown = float32Base64): Response {
	return json({
		object: "list",
		data: Array.from({ length: count }, (_, index) => ({
			object: "embedding",
			index,
			embedding: encode([index, 0.5, -1]),
		})),
		model: "local-embedder",
		usage: { prompt_tokens: 3, total_tokens: 4 },
	})
}

function stableHeaders(init?: RequestInit): Record<string, string> {
	const result: Record<string, string> = {}
	new Headers(init?.headers).forEach((value, name) => {
		if (name === "user-agent" || name.startsWith("x-stainless-")) {
			return
		}
		result[name] = value
	})
	return result
}

const captured: CapturedRequest[] = []
let respond: (inputs: string[]) => Response | Promise<Response>

beforeEach(() => {
	captured.length = 0
	respond = (inputs) => embeddingsResponse(inputs.length)
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input)
			const body = typeof init?.body === "string" ? init.body : String(init?.body)
			captured.push({ url, method: init?.method, headers: stableHeaders(init), body })
			return respond(JSON.parse(body).input as string[])
		}),
	)
	vi.spyOn(logger, "error").mockImplementation(() => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const FULL_URL = "http://127.0.0.1:11111/v1/embeddings"
const BASE_URL = "http://127.0.0.1:11111/v1"

describe("OpenAICompatibleEmbedder", () => {
	it.each([
		["", "k", "embeddings:validation.baseUrlRequired"],
		[BASE_URL, "", "embeddings:validation.apiKeyRequired"],
	])("refuses base URL %j with key %j", (baseUrl, apiKey, message) => {
		expect(() => new OpenAICompatibleEmbedder(baseUrl, apiKey)).toThrow(message)
	})

	it("sends the SDK request for a base URL and decodes the base64 vectors and usage", async () => {
		const embedder = new OpenAICompatibleEmbedder(BASE_URL, "sk-local", "local-embedder")

		const result = await embedder.createEmbeddings(["first chunk", "second chunk"])

		expect(result).toEqual({
			embeddings: [
				[0, 0.5, -1],
				[1, 0.5, -1],
			],
			usage: { promptTokens: 3, totalTokens: 4 },
		})
		expect(captured).toEqual([
			{
				url: `${BASE_URL}/embeddings`,
				method: "POST",
				headers: {
					accept: "application/json",
					authorization: "Bearer sk-local",
					"content-type": "application/json",
				},
				body: '{"input":["first chunk","second chunk"],"model":"local-embedder","encoding_format":"base64"}',
			},
		])
	})

	it("uses the provider's default model and sends it in the validation probe", async () => {
		const embedder = new OpenAICompatibleEmbedder(BASE_URL, "sk-local")

		await expect(embedder.validateConfiguration()).resolves.toEqual({ valid: true, dimension: 3 })

		expect(captured).toHaveLength(1)
		expect(captured[0].body).toBe(
			`{"input":["test"],"model":"${getDefaultModelId("openai-compatible")}","encoding_format":"base64"}`,
		)
	})

	it("sends the direct request for a full endpoint URL, with both key headers", async () => {
		const embedder = new OpenAICompatibleEmbedder(FULL_URL, "sk-local", "local-embedder")

		await embedder.createEmbeddings(["only chunk"])

		expect(captured).toEqual([
			{
				url: FULL_URL,
				method: "POST",
				headers: {
					"api-key": "sk-local",
					authorization: "Bearer sk-local",
					"content-type": "application/json",
				},
				body: '{"input":["only chunk"],"model":"local-embedder","encoding_format":"base64"}',
			},
		])
	})

	it.each([
		["https://res.openai.azure.com/openai/deployments/m/embeddings?api-version=2024-02-01", true],
		["https://res.openai.azure.com/openai/deployments/m/embeddings", true],
		["https://adb.azuredatabricks.net/serving-endpoints/m/invocations", true],
		["https://api.example.com/v1/embeddings?api-version=2024", true],
		["https://api.example.com/embed", true],
		["https://api.example.com/embed?version=1", true],
		["https://api.openai.com/v1", false],
		["http://localhost:8080", false],
		["https://api.example.com/embeddings-service/v1", false],
		["https://embeddings.example.com/api", false],
		["https://api.example.com/v1/embeddings-api", false],
		["https://deployments.example.com/api", false],
	])("%s is a full endpoint URL (posted to as is): %s", async (url, full) => {
		await new OpenAICompatibleEmbedder(url, "k", "m").createEmbeddings(["x"])

		expect(captured[0].url === url).toBe(full)
		expect("api-key" in captured[0].headers).toBe(full)
	})

	it("reads plain number vectors and a missing usage from a full endpoint", async () => {
		respond = (inputs) => json({ data: inputs.map((_, i) => ({ embedding: [i, 1] })) })

		const result = await new OpenAICompatibleEmbedder(FULL_URL, "k", "m").createEmbeddings(["a", "b"])

		expect(result).toEqual({
			embeddings: [
				[0, 1],
				[1, 1],
			],
			usage: { promptTokens: 0, totalTokens: 0 },
		})
	})

	it.each([
		["an HTTP error with its body", () => new Response("model gone", { status: 500 }), "HTTP 500: model gone"],
		[
			"an HTTP error whose body cannot be read",
			() => {
				const response = new Response("x", { status: 502 })
				vi.spyOn(response, "text").mockRejectedValue(new Error("stream reset"))
				return response
			},
			"HTTP 502: Error 502",
		],
		["an answer that is not JSON", () => new Response("<html>", { status: 200 }), "Failed to parse response JSON"],
	])("a full endpoint answering %s fails with the status kept", async (_, answer, message) => {
		respond = answer

		const error = await new OpenAICompatibleEmbedder(FULL_URL, "k", "m").createEmbeddings(["a"]).then(
			() => undefined,
			(e: Error) => e,
		)

		expect(error?.message).toContain(message)
		expect(captured).toHaveLength(1)
	})

	it.each([
		[404, "the model does not exist", "embeddings:validation.modelNotAvailable"],
		[404, "no route", "embeddings:validation.invalidEndpoint"],
		[401, "bad key", "embeddings:validation.authenticationFailed"],
	])("validation of a full endpoint answering %i (%s) says %s", async (status, body, error) => {
		respond = () => new Response(body, { status })

		await expect(new OpenAICompatibleEmbedder(FULL_URL, "k", "m").validateConfiguration()).resolves.toEqual({
			valid: false,
			error,
		})
	})
})

const body = (model: string, extra = "") => `{"input":["x"],"model":"${model}","encoding_format":"base64"${extra}}`
const ROUTED = ',"provider":{"order":["together"],"only":["together"],"allow_fallbacks":false}'

describe("the other embedders on the OpenAI SDK", () => {
	it.each([
		[
			"openai",
			() => new OpenAiEmbedder({ openAiNativeApiKey: "sk" }),
			"https://api.openai.com/v1/embeddings",
			{ authorization: "Bearer sk" },
			body("text-embedding-3-small"),
		],
		[
			"openai without a key",
			() => new OpenAiEmbedder({ openAiEmbeddingModelId: "text-embedding-3-large" }),
			"https://api.openai.com/v1/embeddings",
			{ authorization: "Bearer not-provided" },
			body("text-embedding-3-large"),
		],
		[
			"gemini",
			() => new GeminiEmbedder("g-key"),
			"https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
			{ authorization: "Bearer g-key" },
			body("gemini-embedding-001"),
		],
		[
			"gemini with the retired text-embedding-004",
			() => new GeminiEmbedder("g-key", "text-embedding-004"),
			"https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
			{},
			body("gemini-embedding-001"),
		],
		[
			"gemini with a named model",
			() => new GeminiEmbedder("g-key", "gemini-embedding-002"),
			"https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
			{},
			body("gemini-embedding-002"),
		],
		[
			"mistral",
			() => new MistralEmbedder("m-key"),
			"https://api.mistral.ai/v1/embeddings",
			{ authorization: "Bearer m-key" },
			body("codestral-embed-2505"),
		],
		[
			"openrouter",
			() => new OpenRouterEmbedder("or-key", "qwen/qwen3-embedding-8b"),
			"https://openrouter.ai/api/v1/embeddings",
			{
				authorization: "Bearer or-key",
				"http-referer": "https://github.com/krzychdre/Tumble-Code",
				"x-title": "Tumble Code",
			},
			body("qwen/qwen3-embedding-8b"),
		],
		[
			"openrouter with the default provider entry",
			() => new OpenRouterEmbedder("or-key", undefined, undefined, "[default]"),
			"https://openrouter.ai/api/v1/embeddings",
			{},
			body(getDefaultModelId("openrouter")),
		],
		[
			"openrouter pinned to one provider",
			() => new OpenRouterEmbedder("or-key", "m", undefined, "together"),
			"https://openrouter.ai/api/v1/embeddings",
			{},
			body("m", ROUTED),
		],
	])("%s sends its request to its endpoint", async (_, create, url, headers, expectedBody) => {
		const result = await create().createEmbeddings(["x"])

		expect(result.embeddings).toEqual([[0, 0.5, -1]])
		expect(captured).toHaveLength(1)
		expect(captured[0]).toMatchObject({ url, method: "POST", headers, body: expectedBody })
	})

	it("a model passed to the call wins over the configured one", async () => {
		await new MistralEmbedder("m-key", "configured").createEmbeddings(["x"], "per-call")

		expect(captured[0].body).toBe(body("per-call"))
	})

	it("sends nothing for no input", async () => {
		await expect(new MistralEmbedder("m-key").createEmbeddings([])).resolves.toEqual({
			embeddings: [],
			usage: { promptTokens: 0, totalTokens: 0 },
		})
		expect(captured).toHaveLength(0)
	})

	it("openrouter reads a missing usage as zero", async () => {
		respond = (inputs) => json({ data: inputs.map(() => ({ embedding: float32Base64([1]) })) })

		await expect(new OpenRouterEmbedder("or-key").createEmbeddings(["x"])).resolves.toEqual({
			embeddings: [[1]],
			usage: { promptTokens: 0, totalTokens: 0 },
		})
	})

	it.each([
		[
			"openai-compatible (full URL)",
			() => new OpenAICompatibleEmbedder(FULL_URL, "k", "m"),
			"embeddings:validation.invalidResponse",
		],
		["openai", () => new OpenAiEmbedder({ openAiNativeApiKey: "sk" }), "embeddings:openai.invalidResponseFormat"],
	])("%s validation of an answer without data names the invalid response", async (_, create, error) => {
		respond = () => json({ object: "list", model: "m" })

		await expect(create().validateConfiguration()).resolves.toEqual({ valid: false, error })
	})

	it("openrouter refuses an empty key", () => {
		expect(() => new OpenRouterEmbedder("")).toThrow("embeddings:validation.apiKeyRequired")
	})
})
