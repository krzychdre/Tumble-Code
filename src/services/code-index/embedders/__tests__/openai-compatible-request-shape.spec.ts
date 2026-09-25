// Pins the exact HTTP request the OpenAI-compatible embedder sends, with the real OpenAI SDK
// and only `fetch` faked. This is the path a local llama.cpp server (behind an
// OpenAI-compatible endpoint) takes every day, so a refactor must keep these bytes identical.
//
// Headers that depend on the SDK version, the OS or the Node runtime (`user-agent` and the
// `x-stainless-*` family) are left out on purpose: they change with a dependency upgrade and
// say nothing about what this embedder builds.

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

import { OpenAICompatibleEmbedder } from "../openai-compatible"

interface CapturedRequest {
	url: string
	method: string | undefined
	headers: Record<string, string>
	body: string
}

function float32Base64(values: number[]): string {
	return Buffer.from(new Float32Array(values).buffer).toString("base64")
}

function embeddingsResponse(count: number): Response {
	return new Response(
		JSON.stringify({
			object: "list",
			data: Array.from({ length: count }, (_, index) => ({
				object: "embedding",
				index,
				embedding: float32Base64([index, 0.5, -1]),
			})),
			model: "local-embedder",
			usage: { prompt_tokens: 3, total_tokens: 3 },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	)
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

describe("OpenAICompatibleEmbedder request shape (pinned)", () => {
	const captured: CapturedRequest[] = []

	beforeEach(() => {
		captured.length = 0
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown, init?: RequestInit) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input)
				const body = typeof init?.body === "string" ? init.body : String(init?.body)
				captured.push({ url, method: init?.method, headers: stableHeaders(init), body })
				return embeddingsResponse((JSON.parse(body).input as string[]).length)
			}),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("sends the SDK request for a base URL unchanged", async () => {
		const embedder = new OpenAICompatibleEmbedder("http://127.0.0.1:11111/v1", "sk-local", "local-embedder")

		const result = await embedder.createEmbeddings(["first chunk", "second chunk"])

		expect(result.embeddings).toEqual([
			[0, 0.5, -1],
			[1, 0.5, -1],
		])
		expect(captured).toEqual([
			{
				url: "http://127.0.0.1:11111/v1/embeddings",
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

	it("sends the same SDK request for the validation probe", async () => {
		const embedder = new OpenAICompatibleEmbedder("http://127.0.0.1:11111/v1", "sk-local", "local-embedder")

		await expect(embedder.validateConfiguration()).resolves.toEqual({ valid: true, dimension: 3 })

		expect(captured).toHaveLength(1)
		expect(captured[0].url).toBe("http://127.0.0.1:11111/v1/embeddings")
		expect(captured[0].body).toBe('{"input":["test"],"model":"local-embedder","encoding_format":"base64"}')
	})

	it("sends the direct request for a full endpoint URL unchanged", async () => {
		const embedder = new OpenAICompatibleEmbedder(
			"http://127.0.0.1:11111/v1/embeddings",
			"sk-local",
			"local-embedder",
		)

		await embedder.createEmbeddings(["only chunk"])

		expect(captured).toEqual([
			{
				url: "http://127.0.0.1:11111/v1/embeddings",
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
})
