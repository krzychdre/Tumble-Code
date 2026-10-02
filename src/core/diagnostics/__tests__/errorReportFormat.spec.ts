// npx vitest run core/diagnostics/__tests__/errorReportFormat.spec.ts

import {
	type ErrorReport,
	ERROR_REPORT_MAX_BODY_BYTES,
	ERROR_REPORT_MAX_MESSAGE_CHARS,
	ERROR_REPORT_MAX_MESSAGES,
	ERROR_REPORT_MAX_SUMMARY_CHARS,
	errorReportSchema,
} from "@tumble-code/types"

import {
	apiErrorBody,
	capErrorReport,
	finalizeErrorReport,
	isContextOverflowError,
	scrubSecrets,
	summaryLine,
	toReportMessages,
	truncateText,
} from "../errorReportFormat"

function statusError(status: number | undefined, message: string): Error {
	return Object.assign(new Error(message), status === undefined ? {} : { status })
}

describe("isContextOverflowError", () => {
	it.each([
		// The owner's real evidence: vLLM / OpenAI-compatible wording.
		[
			400,
			"This model's maximum context length is 131072 tokens. However, you requested 135000 output tokens and your prompt contains at least 1 input tokens.",
		],
		[undefined, "OpenAI completion error: This model's maximum context length is 32768 tokens."],
		[400, "prompt is too long: 210000 tokens > 200000 maximum"],
		[400, "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."],
		[400, "Input is too long for requested model."],
		[400, "Prompt contains 40000 tokens and 0 draft tokens, too large for model with 32768 maximum context length"],
		[400, "context_length_exceeded"],
		[413, "Request exceeds the model's context window"],
		[undefined, "too many tokens in the request"],
	])("detects status %s: %s", (status, message) => {
		expect(isContextOverflowError(statusError(status, message))).toBe(true)
	})

	it("detects an Anthropic error body", () => {
		const error = {
			status: 400,
			message: "400",
			error: { error: { type: "invalid_request_error", message: "prompt is too long: 1 tokens > 0 maximum" } },
		}
		expect(isContextOverflowError(error)).toBe(true)
	})

	it.each([
		[429, "Rate limit reached: too many tokens per minute"],
		[undefined, "You exceeded your current quota: too many tokens"],
		[401, "maximum context length is not your problem, the key is invalid"],
		[undefined, "OpenAI completion error: Connection error."],
		[500, "Internal server error"],
		[undefined, "Roo tried to use apply_diff without value for required parameter 'path'. Retrying..."],
	])("does not flag status %s: %s", (status, message) => {
		expect(isContextOverflowError(statusError(status, message))).toBe(false)
	})

	it("never throws on odd values", () => {
		expect(isContextOverflowError(undefined)).toBe(false)
		expect(isContextOverflowError(null)).toBe(false)
		expect(isContextOverflowError("maximum context length")).toBe(true)
		expect(isContextOverflowError(42)).toBe(false)
	})
})

describe("apiErrorBody", () => {
	it("takes the SDK's parsed body and never the headers", () => {
		const error = Object.assign(new Error("400 bad"), {
			error: { message: "bad", code: "x" },
			headers: { authorization: "Bearer secret-token-value" },
		})
		expect(apiErrorBody(error)).toBe('{"message":"bad","code":"x"}')
	})

	it("falls back to body, responseBody and response.data", () => {
		expect(apiErrorBody({ body: "raw" })).toBe("raw")
		expect(apiErrorBody({ responseBody: '{"a":1}' })).toBe('{"a":1}')
		expect(apiErrorBody({ response: { data: { b: 2 } } })).toBe('{"b":2}')
		expect(apiErrorBody(new Error("no body"))).toBeUndefined()
	})
})

describe("scrubSecrets", () => {
	it.each([
		["Authorization: Bearer abcdefghijklmnop", "[redacted]"],
		['{"api_key":"0123456789abcdef"}', '{"api_key":"[redacted]"}'],
		["https://x.example/v1?key=AIzaSecret123&alt=sse", "https://x.example/v1?key=[redacted]&alt=sse"],
		["key sk-proj-abcdefghijklmnopqrstuvwx used", "key [redacted-key] used"],
		["x-api-key=supersecretvalue", "x-api-key=[redacted]"],
	])("removes the secret from %s", (input, expected) => {
		const output = scrubSecrets(input)
		expect(output).toContain(expected)
		expect(output).not.toMatch(/abcdefghijklmnop|0123456789abcdef|AIzaSecret123|supersecretvalue/)
	})

	it("leaves ordinary text alone", () => {
		const text = "Error reading file src/app.ts: ENOENT: no such file or directory"
		expect(scrubSecrets(text)).toBe(text)
	})
})

describe("truncation", () => {
	it("marks a cut text and keeps the limit", () => {
		const cut = truncateText("x".repeat(100), 50)
		expect(cut).toHaveLength(50)
		expect(cut.endsWith(" [truncated]")).toBe(true)
		expect(truncateText("short", 50)).toBe("short")
	})

	it("summary is the first non-empty line, at most 500 chars", () => {
		expect(summaryLine("\n  first line \nsecond")).toBe("first line")
		expect(summaryLine("y".repeat(2000))).toHaveLength(ERROR_REPORT_MAX_SUMMARY_CHARS)
	})

	it("keeps the last 6 messages, each JSON-stringified and cut to 16000 chars", () => {
		const messages = Array.from({ length: 9 }, (_, i) => ({
			role: i % 2 ? "assistant" : "user",
			content: i === 8 ? [{ type: "text", text: "z".repeat(40_000) }] : `message ${i}`,
		}))
		const tail = toReportMessages(messages)
		expect(tail).toHaveLength(ERROR_REPORT_MAX_MESSAGES)
		expect(tail[0]).toEqual({ role: "assistant", content: "message 3" })
		expect(tail.at(-1)!.role).toBe("user")
		expect(tail.at(-1)!.content.startsWith('[{"type":"text","text":"zzz')).toBe(true)
		expect(tail.at(-1)!.content).toHaveLength(ERROR_REPORT_MAX_MESSAGE_CHARS)
	})
})

describe("capErrorReport", () => {
	const base: ErrorReport = {
		id: "id-1",
		occurredAt: 1,
		category: "api_error",
		summary: "s",
		modelId: "m",
	}

	it("returns a small report unchanged", () => {
		const report = { ...base, request: { messages: [{ role: "user" as const, content: "hi" }] } }
		expect(capErrorReport(report)).toEqual(report)
	})

	it("drops the oldest messages first", () => {
		const messages = Array.from({ length: 6 }, (_, i) => ({
			role: "user" as const,
			content: `${i}`.repeat(15_000),
		}))
		const capped = capErrorReport({ ...base, request: { messages } }, 50_000)
		expect(capped.request!.messages!.map((m) => m.content[0])).toEqual(["3", "4", "5"])
		expect(capped.request!.messages![0].content).toHaveLength(15_000)
		expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(50_000)
	})

	it("then shortens long fields until the body fits", () => {
		const huge = "q".repeat(400_000)
		const capped = capErrorReport({
			...base,
			errorMessage: "e".repeat(8_000),
			request: { messages: [{ role: "user", content: huge }] },
			response: { text: huge, reasoning: huge, toolCalls: [{ name: "apply_diff", arguments: huge }] },
		})
		expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(ERROR_REPORT_MAX_BODY_BYTES)
		expect(capped.summary).toBe("s")
		expect(capped.modelId).toBe("m")
		expect(capped.response!.toolCalls![0].name).toBe("apply_diff")
		expect(capped.request!.messages).toHaveLength(1)
	})
})

describe("finalizeErrorReport", () => {
	it("produces a body the wire schema accepts, scrubbed and within the limits", () => {
		const report = finalizeErrorReport({
			id: "id-2",
			occurredAt: 2,
			category: "tool_error",
			summary: `Bearer abcdefghijklmnopqrstuvwxyz ${"s".repeat(600)}`,
			errorMessage: "x".repeat(20_000),
			toolResult: "y".repeat(20_000),
			response: { errorBody: '{"api_key":"0123456789abcdef"}' },
		})
		expect(errorReportSchema.safeParse(report).success).toBe(true)
		expect(report.summary.length).toBeLessThanOrEqual(ERROR_REPORT_MAX_SUMMARY_CHARS)
		expect(report.summary).not.toContain("abcdefghijklmnopqrstuvwxyz")
		expect(report.response!.errorBody).toBe('{"api_key":"[redacted]"}')
		expect(report.errorMessage!.length).toBe(8_000)
		expect(JSON.stringify(report)).not.toContain("null")
	})
})
