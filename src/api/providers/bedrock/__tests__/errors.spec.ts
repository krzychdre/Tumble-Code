// cd src && ./node_modules/.bin/vitest run api/providers/bedrock/__tests__/errors.spec.ts

// Unit tests of the Bedrock error mapping split out of AwsBedrockHandler (API-18).
// The createMessage error paths end to end are pinned in bedrock-characterization.spec.ts
// and bedrock-error-handling.spec.ts.

const mockCaptureException = vi.fn()

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

vi.mock("../../../../utils/logging", () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import type { ApiStreamChunk } from "../../../transform/stream"
import {
	type BedrockErrorContext,
	bedrockStreamFailure,
	formatBedrockErrorMessage,
	getBedrockErrorType,
	handleBedrockError,
} from "../errors"

function named(name: string, message: string, extra: Record<string, unknown> = {}) {
	const error = new Error(message) as Error & Record<string, unknown>
	error.name = name
	Object.assign(error, extra)
	return error
}

const context: BedrockErrorContext = {
	getModel: () => ({ id: "model-x", info: { contextWindow: 1000, supportsPromptCache: false } }),
	clientConfig: { region: "eu-west-1" },
}

describe("bedrock error mapping", () => {
	beforeEach(() => mockCaptureException.mockClear())

	it("classifies errors by status, name and message patterns", () => {
		expect(getBedrockErrorType("not an error")).toBe("GENERIC")
		expect(getBedrockErrorType(named("Error", "x", { status: 429 }))).toBe("THROTTLING")
		expect(getBedrockErrorType(named("Error", "x", { $metadata: { httpStatusCode: 429 } }))).toBe("THROTTLING")
		expect(getBedrockErrorType(named("ThrottlingException", "x"))).toBe("THROTTLING")
		expect(getBedrockErrorType(new Error("Service quota exceeded for model"))).toBe("SERVICE_QUOTA_EXCEEDED")
		expect(getBedrockErrorType(new Error("too many tokens"))).toBe("TOO_MANY_TOKENS")
		expect(getBedrockErrorType(new Error("Access denied"))).toBe("ACCESS_DENIED")
		expect(getBedrockErrorType(named("AbortError", "aborted"))).toBe("GENERIC")
		expect(getBedrockErrorType(new Error("field required"))).toBe("GENERIC")
	})

	it("fills the template variables", () => {
		expect(formatBedrockErrorMessage(new Error("bad thing"), "GENERIC", context)).toBe("Unknown Error: bad thing")
		expect(formatBedrockErrorMessage("text", "GENERIC", context)).toBe("Unknown Error: {errorMessage}")
		expect(formatBedrockErrorMessage(new Error("x"), "NO_SUCH_TYPE", context)).toBe("Unknown Error: x")
	})

	it("reads the model only for Error instances", () => {
		const getModel = vi.fn(context.getModel)
		formatBedrockErrorMessage("text", "GENERIC", { ...context, getModel })
		expect(getModel).not.toHaveBeenCalled()
		formatBedrockErrorMessage(new Error("x"), "GENERIC", { ...context, getModel })
		expect(getModel).toHaveBeenCalledTimes(1)
	})

	it("returns stream chunks or a prefixed message", () => {
		expect(handleBedrockError(new Error("oops"), true, context)).toEqual([
			{ type: "text", text: "Error: Unknown Error: oops" },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		])
		expect(handleBedrockError(new Error("oops"), false, context)).toBe(
			"Bedrock completion error: Unknown Error: oops",
		)
	})

	async function drain(error: unknown) {
		const chunks: ApiStreamChunk[] = []
		let thrown: unknown
		try {
			for await (const chunk of bedrockStreamFailure(error, {
				providerName: "Bedrock",
				modelId: "model-x",
				context,
			})) {
				chunks.push(chunk)
			}
		} catch (caught) {
			thrown = caught
		}
		return { chunks, thrown }
	}

	it("rethrows throttling errors untouched apart from the normalized status", async () => {
		const error = named("ThrottlingException", "slow down", { $metadata: { httpStatusCode: 429 } })
		const { chunks, thrown } = await drain(error)
		expect(chunks).toEqual([])
		expect(thrown).toBe(error)
		expect((thrown as any).status).toBe(429)
		expect(mockCaptureException).toHaveBeenCalledTimes(1)
	})

	it("yields error chunks, then throws the enhanced error keeping name and status", async () => {
		const error = named("ValidationException", "boom", { $metadata: { httpStatusCode: 400 } })
		const { chunks, thrown } = await drain(error)
		expect(chunks).toEqual([
			{ type: "text", text: "Error: Unknown Error: boom" },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		])
		expect((thrown as Error).message).toBe("Unknown Error: boom")
		expect((thrown as Error).name).toBe("ValidationException")
		expect((thrown as any).status).toBe(400)
	})
})
