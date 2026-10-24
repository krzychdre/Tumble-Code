// What the OpenAI-compatible handler throws when its host cannot be reached: the real
// OpenAI SDK over a stubbed `fetch` that fails the way undici fails (a TypeError
// "fetch failed" whose cause is the socket error). The task retry row and the CLI
// show this message, so it must name the host and the reason.

import type { Anthropic } from "@anthropic-ai/sdk"

import { OpenAiHandler } from "../openai"

const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hi" }]

async function firstError(handler: OpenAiHandler): Promise<Error> {
	try {
		for await (const _chunk of handler.createMessage("system", messages)) {
			// drain
		}
	} catch (error) {
		return error as Error
	}
	throw new Error("the request did not fail")
}

describe("OpenAiHandler with an unreachable host", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it.each([
		["connection refused", "connect ECONNREFUSED 127.0.0.1:59999", "Connection error."],
		[
			"connect timeout",
			"Connect Timeout Error (attempted address: 10.255.255.1:11111, timeout: 10000ms)",
			"Request timed out.",
		],
	])("names the host and the reason on %s", async (_name, socketError, sdkMessage) => {
		vi.useFakeTimers()
		const fetchMock = vi.fn(async () => {
			throw new TypeError("fetch failed", {
				cause: Object.assign(new Error(socketError), {
					code: socketError.startsWith("connect") ? "ECONNREFUSED" : "UND_ERR_CONNECT_TIMEOUT",
				}),
			})
		})
		vi.stubGlobal("fetch", fetchMock)
		const handler = new OpenAiHandler({
			openAiBaseUrl: "http://127.0.0.1:59999/v1",
			openAiApiKey: "k",
			openAiModelId: "m",
		})

		const failure = firstError(handler)
		await vi.runAllTimersAsync()
		const error = await failure

		expect(error.message).toBe(`OpenAI completion error: ${sdkMessage} (${socketError})`)
		// The SDK's own two retries ran before the handler gave the error to the task.
		expect(fetchMock).toHaveBeenCalledTimes(3)
	})
})
