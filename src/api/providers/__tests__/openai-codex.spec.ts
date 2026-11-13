// npx vitest run api/providers/__tests__/openai-codex.spec.ts

import { openAiCodexModels } from "@tumble-code/types"

import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

vitest.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vitest.fn() } },
}))

describe("OpenAiCodexHandler.getModel", () => {
	it.each(["gpt-6.1-terra", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
		"should expose a 200k subscription model: %s",
		(apiModelId) => {
			const handler = new OpenAiCodexHandler({ apiModelId })
			const model = handler.getModel()

			expect(model.id).toBe(apiModelId)
			expect(model.info).toMatchObject({
				contextWindow: 200_000,
				// Response reservation only (the Codex backend rejects max_output_tokens);
				// kept at 20% of the window so auto-condense doesn't fire early.
				maxTokens: 40_000,
				supportsImages: true,
				supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
				reasoningEffort: "medium",
			})
		},
	)

	it("should keep reasoning required for GPT-6 Astra", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6-astra" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-6-astra")
		// Astra rejects `none` with HTTP 400, so reasoning cannot be switched off.
		expect(model.info.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"])
		expect(model.info.requiredReasoningEffort).toBe(true)
		expect(model.info.contextWindow).toBe(200_000)
	})

	it("should expose current GPT-6.1 Sol capabilities on the 500k subscription window", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-6.1-sol")
		expect(model.info).toMatchObject({
			// Codex runs Sol on a 500k window, not the usual 200k.
			contextWindow: 500_000,
			maxTokens: 100_000,
			supportsImages: true,
			supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh", "max"],
			reasoningEffort: "medium",
		})
	})

	it("should expose only the current ChatGPT subscription model catalog", () => {
		expect(Object.keys(openAiCodexModels)).toEqual([
			"gpt-6.1-sol",
			"gpt-6.1-terra",
			"gpt-6-astra",
			"gpt-6-luna",
			"gpt-5.6-sol",
			"gpt-5.6-terra",
			"gpt-5.6-luna",
		])
	})

	it("keeps an unknown model id instead of substituting the default (owner decision 5)", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "not-a-real-model" })
		const model = handler.getModel()

		expect(model.id).toBe("not-a-real-model")
		expect(model.info.contextWindow).toBe(new OpenAiCodexHandler({}).getModel().info.contextWindow)
	})
})

describe("OpenAiCodexHandler usage", () => {
	afterEach(() => {
		vitest.restoreAllMocks()
	})

	// GPT-5.6 reports the tokens it wrote to the prompt cache only in
	// usage.input_tokens_details.cache_write_tokens. OpenAI Native reads them (7be31a426);
	// the Codex copy of the usage code did not (D4 in the refactor plan).
	it("reports GPT-5.6 cache writes from input_tokens_details", async () => {
		vitest.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vitest.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
		Reflect.set(handler, "client", {
			responses: {
				create: vitest.fn().mockResolvedValue({
					async *[Symbol.asyncIterator]() {
						yield {
							type: "response.completed",
							response: {
								id: "r1",
								status: "completed",
								output: [],
								usage: {
									input_tokens: 10000,
									input_tokens_details: { cached_tokens: 2000, cache_write_tokens: 3000 },
									output_tokens: 500,
								},
							},
						}
					},
				}),
			},
		})

		const usage = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "Hi" }])) {
			if (chunk.type === "usage") usage.push(chunk)
		}

		expect(usage).toEqual([
			{
				type: "usage",
				inputTokens: 10000,
				outputTokens: 500,
				cacheWriteTokens: 3000,
				cacheReadTokens: 2000,
				totalCost: 0,
			},
		])
	})
})

describe("OpenAiCodexHandler.completePrompt", () => {
	function asyncStreamFrom(events: unknown[]) {
		return {
			async *[Symbol.asyncIterator]() {
				for (const event of events) {
					yield event
				}
			},
		}
	}

	function sseResponse(events: unknown[]) {
		return {
			ok: true,
			body: new ReadableStream({
				start(controller) {
					for (const event of events) {
						controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
					}
					controller.close()
				},
			}),
		}
	}

	function createHandler() {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
		vitest.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vitest.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
		// The Codex endpoint answers a non-streaming request with this error.
		vitest.stubGlobal(
			"fetch",
			vitest.fn().mockResolvedValue({
				ok: false,
				status: 400,
				text: vitest.fn().mockResolvedValue('{"detail":"Stream must be set to true"}'),
			}),
		)
		return handler
	}

	function injectStream(handler: OpenAiCodexHandler, events: unknown[]) {
		const create = vitest.fn().mockResolvedValue(asyncStreamFrom(events))
		Reflect.set(handler, "client", { responses: { create } })
		return create
	}

	afterEach(() => {
		vitest.restoreAllMocks()
		vitest.unstubAllGlobals()
	})

	it("sends a streaming request and joins the text deltas", async () => {
		const handler = createHandler()
		const create = injectStream(handler, [
			{ type: "response.output_text.delta", delta: "feat: " },
			{ type: "response.output_text.delta", delta: "add commit messages" },
			{ type: "response.completed", response: { id: "r1", status: "completed", output: [] } },
		])

		await expect(handler.completePrompt("Hello")).resolves.toBe("feat: add commit messages")
		expect(create.mock.calls[0][0]).toMatchObject({
			stream: true,
			input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
		})
	})

	it("omits reasoning from the completion", async () => {
		const handler = createHandler()
		injectStream(handler, [
			{ type: "response.reasoning_summary_text.delta", delta: "Thinking about the diff" },
			{ type: "response.output_text.delta", delta: "fix: correct the parser" },
			{ type: "response.completed", response: { id: "r1", status: "completed", output: [] } },
		])

		await expect(handler.completePrompt("Hello")).resolves.toBe("fix: correct the parser")
	})

	it("reports the usage of the streamed response", async () => {
		const handler = createHandler()
		injectStream(handler, [
			{ type: "response.output_text.delta", delta: "chore: tidy" },
			{
				type: "response.completed",
				response: {
					id: "r1",
					status: "completed",
					output: [],
					usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } },
				},
			},
		])

		await expect(handler.completePromptWithUsage("Hello")).resolves.toEqual({
			text: "chore: tidy",
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 4 },
		})
	})

	// A refusal is streamed as text so the chat can show it, but it is not an answer: the
	// prompt enhancer would paste "[Refusal] ..." into the input box.
	it("omits refusals but keeps the answer text", async () => {
		const handler = createHandler()
		injectStream(handler, [
			{ type: "response.output_text.delta", delta: "docs: update the readme" },
			{ type: "response.refusal.delta", delta: "I cannot help with the rest." },
			{ type: "response.completed", response: { id: "r1", status: "completed", output: [] } },
		])

		await expect(handler.completePrompt("Hello")).resolves.toBe("docs: update the readme")
	})

	it("omits refusals streamed over the SSE fallback", async () => {
		const handler = createHandler()
		Reflect.set(handler, "client", {
			responses: { create: vitest.fn().mockRejectedValue(new Error("SDK unavailable")) },
		})
		vitest.stubGlobal(
			"fetch",
			vitest
				.fn()
				.mockResolvedValue(
					sseResponse([{ type: "response.refusal.delta", delta: "I cannot help with that." }]),
				),
		)

		await expect(handler.completePrompt("Hello")).resolves.toBe("")
	})

	it("retries once with a refreshed token when the first attempt is unauthorized", async () => {
		const handler = createHandler()
		const refresh = vitest
			.spyOn(openAiCodexOAuthManager, "forceRefreshAccessToken")
			.mockResolvedValue("fresh-token")
		Reflect.set(handler, "client", {
			responses: { create: vitest.fn().mockRejectedValue(new Error("SDK unavailable")) },
		})
		const mockFetch = vitest
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: vitest.fn().mockResolvedValue('{"error":{"message":"Codex API invalid token"}}'),
			})
			.mockResolvedValueOnce(sseResponse([{ type: "response.output_text.delta", delta: "docs: update" }]))
		vitest.stubGlobal("fetch", mockFetch)

		await expect(handler.completePrompt("Hello")).resolves.toBe("docs: update")
		expect(refresh).toHaveBeenCalled()
		expect(mockFetch).toHaveBeenCalledTimes(2)
	})

	// Once the SDK stream has emitted, the service has accepted the request and its output is
	// already with the caller. Replaying it (over SSE or after a token refresh) would append a
	// second generation to the first.
	it("does not replay the request when the SDK stream fails after emitting", async () => {
		const handler = createHandler()
		const refresh = vitest
			.spyOn(openAiCodexOAuthManager, "forceRefreshAccessToken")
			.mockResolvedValue("fresh-token")
		const create = vitest.fn().mockResolvedValue(
			(async function* () {
				yield { type: "response.output_text.delta", delta: "feat: add" }
				throw new Error("401 unauthorized mid-stream")
			})(),
		)
		Reflect.set(handler, "client", { responses: { create } })
		const mockFetch = vitest.fn().mockResolvedValue(sseResponse([]))
		vitest.stubGlobal("fetch", mockFetch)

		await expect(handler.completePrompt("Hello")).rejects.toThrow("errors.openAiCodex.completionError")
		expect(mockFetch).not.toHaveBeenCalled()
		expect(refresh).not.toHaveBeenCalled()
		expect(create).toHaveBeenCalledTimes(1)
	})

	it("does not replay a chat request when the SDK stream fails after emitting", async () => {
		const handler = createHandler()
		Reflect.set(handler, "client", {
			responses: {
				create: vitest.fn().mockResolvedValue(
					(async function* () {
						yield { type: "response.output_text.delta", delta: "Hello" }
						throw new Error("stream broke")
					})(),
				),
			},
		})
		const mockFetch = vitest
			.fn()
			.mockResolvedValue(sseResponse([{ type: "response.output_text.delta", delta: "Hello again" }]))
		vitest.stubGlobal("fetch", mockFetch)

		const texts: string[] = []
		await expect(
			(async () => {
				for await (const chunk of handler.createMessage("system", [{ role: "user", content: "Hi" }])) {
					if (chunk.type === "text") texts.push(chunk.text)
				}
			})(),
		).rejects.toThrow("stream broke")
		expect(texts).toEqual(["Hello"])
		expect(mockFetch).not.toHaveBeenCalled()
	})
})
