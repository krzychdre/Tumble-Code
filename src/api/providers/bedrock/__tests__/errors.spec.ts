// cd src && ./node_modules/.bin/vitest run api/providers/bedrock/__tests__/errors.spec.ts

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }))
vi.mock("../../../../utils/logging", () => ({ logger }))

import { formatBedrockErrorMessage, getBedrockErrorType, handleBedrockError } from "../errors"

function awsError(message: string, fields: Record<string, unknown> = {}): Error {
	return Object.assign(new Error(message), fields)
}

const context = {
	getModel: () => ({ id: "m", info: { maxTokens: 1, contextWindow: 1, supportsPromptCache: false } }),
	clientConfig: { region: "us-east-1" },
}

describe("getBedrockErrorType", () => {
	it.each([
		["HTTP 429 status", awsError("Request failed", { status: 429 }), "THROTTLING"],
		["SDK $metadata 429", awsError("Request failed", { $metadata: { httpStatusCode: 429 } }), "THROTTLING"],
		["ThrottlingException name", awsError("Some other error", { name: "ThrottlingException" }), "THROTTLING"],
		["ThrottlingException __type", awsError("Request failed", { __type: "ThrottlingException" }), "THROTTLING"],
		[
			"429 over a validation message",
			awsError("Invalid input", { status: 429, name: "ValidationException" }),
			"THROTTLING",
		],
		["Bedrock busy message", awsError("Bedrock is unable to process your request"), "THROTTLING"],
		["please wait message", awsError("Please wait and try again"), "THROTTLING"],
		["quota before throttling", awsError("Service quota exceeded for model requests"), "SERVICE_QUOTA_EXCEEDED"],
		["model not ready", awsError("Model is not ready, please try again later"), "MODEL_NOT_READY"],
		["token limit before throttling", awsError("Token limit exceeded"), "TOO_MANY_TOKENS"],
		["context length", awsError("Maximum context length reached"), "TOO_MANY_TOKENS"],
		["internal server error", awsError("Internal server error occurred"), "INTERNAL_SERVER_ERROR"],
		[
			"on-demand throughput",
			awsError("Invocation of model ID x with on-demand throughput isn’t supported."),
			"ON_DEMAND_NOT_SUPPORTED",
		],
		["not found", awsError("The resource does not exist"), "NOT_FOUND"],
		["access denied by name", awsError("No", { name: "AccessDeniedException" }), "ACCESS_DENIED"],
		["unrecognized message", awsError("Something completely unexpected happened"), "GENERIC"],
		[
			"validation message (no dedicated type is checked)",
			awsError("Malformed input request: field required"),
			"GENERIC",
		],
		["a non-Error value", "plain string failure", "GENERIC"],
	])("%s -> %s", (_label, error, expected) => {
		expect(getBedrockErrorType(error)).toBe(expected)
	})
})

describe("formatBedrockErrorMessage", () => {
	it("fills the error message into the template", () => {
		expect(formatBedrockErrorMessage(awsError("boom"), "GENERIC", context)).toBe("Unknown Error: boom")
	})

	it("falls back to the generic template for an unknown type", () => {
		expect(formatBedrockErrorMessage(awsError("x"), "NO_SUCH_TYPE", context)).toBe("Unknown Error: x")
	})

	it("leaves the placeholder for a non-Error value", () => {
		expect(formatBedrockErrorMessage("boom", "GENERIC", context)).toBe("Unknown Error: {errorMessage}")
	})

	it("uses the throttling advice for a throttling error", () => {
		expect(formatBedrockErrorMessage(awsError("x"), "THROTTLING", context)).toMatch(
			/^Request was throttled or rate limited/,
		)
	})
})

describe("handleBedrockError", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns an error text chunk and a zero usage chunk in the streaming context", () => {
		expect(handleBedrockError(awsError("boom"), true, context)).toEqual([
			{ type: "text", text: "Error: Unknown Error: boom" },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		])
		expect(logger.error).toHaveBeenCalledWith(
			"GENERIC error in createMessage",
			expect.objectContaining({ errorType: "GENERIC", errorMessage: "boom", clientRegion: "us-east-1" }),
		)
	})

	it("returns the prefixed message for completePrompt", () => {
		expect(handleBedrockError(awsError("Model is not ready"), false, context)).toMatch(
			/^Bedrock completion error: Model is not ready or still loading/,
		)
		expect(logger.error).toHaveBeenCalledWith("MODEL_NOT_READY error in completePrompt", expect.anything())
	})
})
