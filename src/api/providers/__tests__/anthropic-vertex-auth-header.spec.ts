// DEP-6: @anthropic-ai/vertex-sdk and google-auth-library must be upgraded as a
// pair. google-auth-library 10 returns a fetch `Headers` object from
// getRequestHeaders(); vertex-sdk 0.7 spread that object (spreading a Headers
// yields nothing), so every request went out without Authorization and Vertex
// answered 401. vertex-sdk 0.19 reads it with the Headers API. This spec uses
// the real SDK and a real google-auth-library OAuth2Client (a cached access
// token, so no network) and checks the request that reaches fetch.

vitest.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vitest.fn().mockReturnValue(600_000),
}))

import type { MockInstance } from "vitest"
import { GoogleAuth, OAuth2Client } from "google-auth-library"

import { AnthropicVertexHandler } from "../anthropic-vertex"

describe("AnthropicVertexHandler request authorization", () => {
	let fetchSpy: MockInstance<typeof fetch>

	beforeEach(() => {
		vitest.stubEnv("ANTHROPIC_VERTEX_BASE_URL", undefined)
		const authClient = new OAuth2Client()
		authClient.setCredentials({ access_token: "test-access-token", expiry_date: Date.now() + 60 * 60 * 1000 })
		vitest.spyOn(GoogleAuth.prototype, "getClient").mockResolvedValue(authClient as any)

		// The SDK picks up the global fetch when the client is built, so spy first.
		fetchSpy = vitest.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						id: "msg_1",
						type: "message",
						role: "assistant",
						model: "claude-sonnet-4@20250514",
						content: [{ type: "text", text: "pong" }],
						stop_reason: "end_turn",
						stop_sequence: null,
						usage: { input_tokens: 3, output_tokens: 1 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		)
	})

	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllEnvs()
	})

	it("sends the Google access token as a Bearer Authorization header to the Vertex endpoint", async () => {
		const handler = new AnthropicVertexHandler({
			apiModelId: "claude-sonnet-4@20250514",
			vertexProjectId: "test-project",
			vertexRegion: "us-east5",
		})

		await expect(handler.completePrompt("ping")).resolves.toBe("pong")

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const [input, init] = fetchSpy.mock.calls[0]
		const request = new Request(input, init)

		expect(request.headers.get("authorization")).toBe("Bearer test-access-token")
		// No first-party Anthropic key may reach Google.
		expect(request.headers.get("x-api-key")).toBeNull()
		expect(new URL(request.url).pathname).toBe(
			"/v1/projects/test-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-4@20250514:rawPredict",
		)
		const body = JSON.parse(await request.text())
		expect(body.model).toBeUndefined()
		expect(body.anthropic_version).toBe("vertex-2023-10-16")
	})
})
