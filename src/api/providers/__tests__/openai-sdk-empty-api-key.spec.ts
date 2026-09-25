// npx vitest run api/providers/__tests__/openai-sdk-empty-api-key.spec.ts

// DEP-6 (openai 5 to 7): openai 5 rejected only a missing apiKey (`undefined`), so a profile
// whose key was saved as an empty string still reached the server (a keyless local server
// answered it). openai 7 rejects every falsy key with "Missing credentials" before any request.
// The handlers that build the SDK client themselves fall back to "not-provided" for a missing
// key; these specs pin that the same fallback covers an empty key, with the REAL openai SDK
// (no module mock) and a fake fetch standing in for a keyless server.

vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockResolvedValue({}),
	getModelsFromCache: vitest.fn().mockReturnValue(undefined),
}))

vitest.mock("../fetchers/modelEndpointCache", () => ({
	getModelEndpoints: vitest.fn().mockResolvedValue({}),
}))

import { OpenAiHandler } from "../openai"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenRouterHandler } from "../openrouter"
import { XAIHandler } from "../xai"
import { OpenAiEmbedder } from "../../../services/code-index/embedders/openai"

function chatCompletion(content: string): Response {
	return new Response(
		JSON.stringify({
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 0,
			model: "local-model",
			choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	)
}

describe("OpenAI SDK clients built with an empty api key", () => {
	const seenAuthorization: Array<string | null> = []

	beforeEach(() => {
		seenAuthorization.length = 0
		vitest.stubGlobal(
			"fetch",
			vitest.fn(async (_input: unknown, init?: RequestInit) => {
				seenAuthorization.push(new Headers(init?.headers).get("authorization"))
				return chatCompletion("pong")
			}),
		)
	})

	afterEach(() => {
		vitest.unstubAllGlobals()
	})

	it("OpenAI Compatible still sends the request to a keyless local server", async () => {
		const handler = new OpenAiHandler({
			openAiApiKey: "",
			openAiBaseUrl: "http://127.0.0.1:8080/v1",
			openAiModelId: "local-model",
		})

		await expect(handler.completePrompt("ping")).resolves.toBe("pong")
		expect(seenAuthorization).toHaveLength(1)
	})

	it("OpenAI Native builds its client", () => {
		expect(() => new OpenAiNativeHandler({ openAiNativeApiKey: "" })).not.toThrow()
	})

	it("OpenRouter builds its client", () => {
		expect(() => new OpenRouterHandler({ openRouterApiKey: "" })).not.toThrow()
	})

	it("xAI builds its client", () => {
		expect(() => new XAIHandler({ xaiApiKey: "" })).not.toThrow()
	})

	it("the OpenAI code-index embedder builds its client", () => {
		expect(() => new OpenAiEmbedder({ openAiNativeApiKey: "" })).not.toThrow()
	})
})
