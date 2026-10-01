// npx vitest run core/condense/__tests__/condense-error-details.spec.ts

import type { ApiHandler } from "../../../api"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { summarizeConversation } from "../index"
import { logger } from "../../../utils/logging"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: { capture: vi.fn() },
	},
}))

/** The details a failed condense shows next to its error, built from what the thrown value carries. */

const messages: ApiMessage[] = [
	{ role: "user", content: "first", ts: 1 },
	{ role: "assistant", content: "second", ts: 2 },
	{ role: "user", content: "third", ts: 3 },
]

function failingHandler(thrown: unknown): ApiHandler {
	return {
		createMessage: () =>
			(async function* () {
				yield { type: "text", text: "partial" }
				throw thrown
			})(),
		getModel: () => ({ id: "m", info: { contextWindow: 200_000, supportsPromptCache: false } }),
		countTokens: async () => 0,
	} as unknown as ApiHandler
}

const condenseWith = (thrown: unknown) =>
	summarizeConversation({
		messages,
		apiHandler: failingHandler(thrown),
		systemPrompt: "system",
		taskId: "task-1",
	})

describe("summarizeConversation error details", () => {
	beforeEach(() => vi.spyOn(logger, "error").mockImplementation(() => {}))
	afterEach(() => vi.restoreAllMocks())

	it("lists the message, status, code, response and body of an API error", async () => {
		const error = Object.assign(new Error("Bad Request"), {
			status: 400,
			code: "invalid_request",
			response: { reason: "too long" },
			body: { error: { message: "context too long" } },
		})

		const result = await condenseWith(error)

		expect(result.errorDetails).toBe(
			"Error: Bad Request" +
				"\n\nHTTP Status: 400" +
				"\nError Code: invalid_request" +
				`\n\nAPI Response:\n${JSON.stringify({ reason: "too long" }, null, 2)}` +
				`\n\nResponse Body:\n${JSON.stringify({ error: { message: "context too long" } }, null, 2)}`,
		)
		expect(result.error).toBeTruthy()
		expect(result.messages).toBe(messages)
	})

	it("marks a response or body that cannot be serialized", async () => {
		const circular: Record<string, unknown> = {}
		circular.self = circular
		const error = Object.assign(new Error("boom"), { response: circular, body: circular })

		const result = await condenseWith(error)

		expect(result.errorDetails).toBe(
			"Error: boom\n\nAPI Response: [Unable to serialize]\n\nResponse Body: [Unable to serialize]",
		)
	})

	it("uses the plain message of an error without API properties", async () => {
		expect((await condenseWith(new Error("plain"))).errorDetails).toBe("Error: plain")
	})

	it("stringifies a thrown value that is not an Error", async () => {
		expect((await condenseWith("socket hang up")).errorDetails).toBe("socket hang up")
	})
})
