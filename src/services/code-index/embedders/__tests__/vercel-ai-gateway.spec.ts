import type { MockedClass } from "vitest"
import { OpenAI } from "openai"

import { VercelAiGatewayEmbedder } from "../vercel-ai-gateway"
import { resetRateLimitGates } from "../rate-limit-gate"

// The embedder is the OpenAI-compatible embedder pointed at Vercel AI Gateway, so only the SDK is mocked
vitest.mock("openai")

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vitest.fn(),
		},
	},
}))

vitest.mock("../../../../i18n", () => ({
	t: (key: string) => key,
}))

const MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>

describe("VercelAiGatewayEmbedder", () => {
	let mockEmbeddingsCreate: ReturnType<typeof vitest.fn>

	beforeEach(() => {
		vitest.clearAllMocks()
		resetRateLimitGates()
		vitest.spyOn(console, "warn").mockImplementation(() => {})
		vitest.spyOn(console, "error").mockImplementation(() => {})
		mockEmbeddingsCreate = vitest.fn().mockResolvedValue({
			data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
			usage: { prompt_tokens: 2, total_tokens: 2 },
		})
		MockedOpenAI.mockImplementation(() => ({ embeddings: { create: mockEmbeddingsCreate } }) as any)
	})

	afterEach(() => {
		vitest.restoreAllMocks()
	})

	describe("constructor", () => {
		it("should build its client for the Vercel AI Gateway endpoint", () => {
			new VercelAiGatewayEmbedder("test-api-key")

			expect(MockedOpenAI).toHaveBeenCalledWith({
				baseURL: "https://ai-gateway.vercel.sh/v1",
				apiKey: "test-api-key",
			})
		})

		it("should throw error when API key is not provided", () => {
			expect(() => new VercelAiGatewayEmbedder("")).toThrow("validation.apiKeyRequired")
			expect(() => new VercelAiGatewayEmbedder(null as any)).toThrow("validation.apiKeyRequired")
			expect(() => new VercelAiGatewayEmbedder(undefined as any)).toThrow("validation.apiKeyRequired")
		})
	})

	describe("embedderInfo", () => {
		it("should return correct embedder info", () => {
			expect(new VercelAiGatewayEmbedder("test-api-key").embedderInfo).toEqual({ name: "vercel-ai-gateway" })
		})
	})

	describe("createEmbeddings", () => {
		it("should use the default model when none is configured or passed", async () => {
			const result = await new VercelAiGatewayEmbedder("test-api-key").createEmbeddings(["a", "b"])

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["a", "b"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
			})
			expect(result.embeddings).toEqual([
				[0.1, 0.2],
				[0.3, 0.4],
			])
		})

		it("should use the configured model", async () => {
			await new VercelAiGatewayEmbedder("test-api-key", "mistral/codestral-embed").createEmbeddings(["a", "b"])

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
				expect.objectContaining({ model: "mistral/codestral-embed" }),
			)
		})

		it("should let a model passed to the call win over the configured one", async () => {
			await new VercelAiGatewayEmbedder("test-api-key").createEmbeddings(["a", "b"], "runtime-model")

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "runtime-model" }))
		})

		it("should cut an input to 8191 estimated tokens", async () => {
			mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1] }] })

			await new VercelAiGatewayEmbedder("test-api-key").createEmbeddings(["a".repeat(8191 * 4 + 10)])

			expect(mockEmbeddingsCreate.mock.calls[0][0].input).toEqual(["a".repeat(8191 * 4)])
		})

		it("should reject when the request fails", async () => {
			mockEmbeddingsCreate.mockRejectedValue(new Error("Embedding failed"))

			await expect(new VercelAiGatewayEmbedder("test-api-key").createEmbeddings(["a"])).rejects.toThrow(
				"embeddings:failedWithError",
			)
		})
	})

	describe("validateConfiguration", () => {
		it("should report the probe dimension", async () => {
			mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] })

			await expect(new VercelAiGatewayEmbedder("test-api-key").validateConfiguration()).resolves.toEqual({
				valid: true,
				dimension: 3,
			})
		})

		it("should map an authentication failure to a validation error", async () => {
			mockEmbeddingsCreate.mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))

			await expect(new VercelAiGatewayEmbedder("test-api-key").validateConfiguration()).resolves.toEqual({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})
		})
	})
})
