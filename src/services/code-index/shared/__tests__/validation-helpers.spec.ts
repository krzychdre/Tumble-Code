import {
	sanitizeErrorMessage,
	isTransientConnectionError,
	handleValidationError,
	formatEmbeddingError,
	measureEmbeddingDimension,
} from "../validation-helpers"

describe("sanitizeErrorMessage", () => {
	it("should sanitize Unix-style file paths", () => {
		const input = "Error reading file /Users/username/projects/myapp/src/index.ts"
		const expected = "Error reading file [REDACTED_PATH]"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize Windows-style file paths", () => {
		const input = "Cannot access C:\\Users\\username\\Documents\\project\\file.js"
		const expected = "Cannot access [REDACTED_PATH]"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize relative file paths", () => {
		const input = "File not found: ./src/components/Button.tsx"
		const expected = "File not found: [REDACTED_PATH]"
		expect(sanitizeErrorMessage(input)).toBe(expected)

		const input2 = "Cannot read ../config/settings.json"
		const expected2 = "Cannot read [REDACTED_PATH]"
		expect(sanitizeErrorMessage(input2)).toBe(expected2)
	})

	it("should sanitize URLs with various protocols", () => {
		const input = "Failed to connect to http://localhost:11434/api/embed"
		const expected = "Failed to connect to [REDACTED_URL]"
		expect(sanitizeErrorMessage(input)).toBe(expected)

		const input2 = "Error fetching https://api.example.com:8080/v1/embeddings"
		const expected2 = "Error fetching [REDACTED_URL]"
		expect(sanitizeErrorMessage(input2)).toBe(expected2)
	})

	it("should sanitize IP addresses", () => {
		const input = "Connection refused at 192.168.1.100"
		const expected = "Connection refused at [REDACTED_IP]"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize port numbers", () => {
		const input = "Server running on :8080 failed"
		const expected = "Server running on :[REDACTED_PORT] failed"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize email addresses", () => {
		const input = "User john.doe@example.com not found"
		const expected = "User [REDACTED_EMAIL] not found"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize paths in quotes", () => {
		const input = 'Cannot open file "/home/user/documents/secret.txt"'
		const expected = 'Cannot open file "[REDACTED_PATH]"'
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should handle complex error messages with multiple sensitive items", () => {
		const input = "Failed to fetch http://localhost:11434 from /Users/john/project at 192.168.1.1:3000"
		const expected = "Failed to fetch [REDACTED_URL] from [REDACTED_PATH] at [REDACTED_IP]:[REDACTED_PORT]"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should handle non-string inputs gracefully", () => {
		expect(sanitizeErrorMessage(null as any)).toBe("null")
		expect(sanitizeErrorMessage(undefined as any)).toBe("undefined")
		expect(sanitizeErrorMessage(123 as any)).toBe("123")
		expect(sanitizeErrorMessage({} as any)).toBe("[object Object]")
	})

	it("should preserve non-sensitive error messages", () => {
		const input = "Invalid JSON format"
		expect(sanitizeErrorMessage(input)).toBe(input)

		const input2 = "Connection timeout"
		expect(sanitizeErrorMessage(input2)).toBe(input2)
	})

	it("should handle file paths with special characters", () => {
		const input = 'Error in "/path/to/file with spaces.txt"'
		const expected = 'Error in "[REDACTED_PATH]"'
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})

	it("should sanitize multiple occurrences of sensitive data", () => {
		const input = "Copy from /src/file1.js to /dest/file2.js failed"
		const expected = "Copy from [REDACTED_PATH] to [REDACTED_PATH] failed"
		expect(sanitizeErrorMessage(input)).toBe(expected)
	})
})

describe("isTransientConnectionError", () => {
	it("returns true for raw network error signatures", () => {
		const transient = [
			"connect ECONNREFUSED 127.0.0.1:8080",
			"read ECONNRESET",
			"getaddrinfo ENOTFOUND localhost",
			"connect ETIMEDOUT",
			"getaddrinfo EAI_AGAIN host",
			"socket hang up",
			"fetch failed",
			"Connection error.", // OpenAI SDK APIConnectionError
			"request timed out",
			"HTTP 0: (no status)",
			"No response",
		]
		for (const msg of transient) {
			expect(isTransientConnectionError(msg)).toBe(true)
		}
	})

	it("matches case-insensitively", () => {
		expect(isTransientConnectionError("connect econnrefused 127.0.0.1")).toBe(true)
	})

	it("returns false for permanent configuration errors", () => {
		const permanent = [
			"Authentication failed. Please check your API key in the settings.",
			"The specified model is not available. Please check your model configuration.",
			"Invalid API endpoint. Please check your URL configuration.",
			"Invalid embedder configuration. Please review your settings.",
		]
		for (const msg of permanent) {
			expect(isTransientConnectionError(msg)).toBe(false)
		}
	})

	it("returns false for empty/nullish input", () => {
		expect(isTransientConnectionError(undefined)).toBe(false)
		expect(isTransientConnectionError(null)).toBe(false)
		expect(isTransientConnectionError("")).toBe(false)
		expect(isTransientConnectionError("everything is fine")).toBe(false)
	})

	it("detects errors wrapped by the orchestrator/embedder layers", () => {
		// Mirrors the real shape: failedDuringInitialScan -> indexing failed -> embed retry
		const wrapped =
			"Failed during initial scan: Indexing failed: Failed to create embeddings after 3 attempts: connect ECONNREFUSED 127.0.0.1:8080"
		expect(isTransientConnectionError(wrapped)).toBe(true)
	})
})

describe("handleValidationError 404", () => {
	it("reports an unknown model when the 404 body names the model (llama-swap)", () => {
		// Real OpenAI SDK error for llama-swap given " granite-..." with a leading space
		const error = Object.assign(new Error('404 "no router for requested model"'), { status: 404 })
		expect(handleValidationError(error, "openai-compatible").error).toContain("validation.modelNotAvailable")
	})

	it("still reports an invalid endpoint for a plain 404 on a wrong path", () => {
		const error = Object.assign(new Error("HTTP 404: 404 page not found"), { status: 404 })
		expect(handleValidationError(error, "openai-compatible").error).toContain("validation.invalidEndpoint")
	})
})

describe("handleValidationError with a thrown non-Error value", () => {
	it.each([
		["a string, as its own text", "embedder exploded", "embedder exploded"],
		["null, as the generic configuration error", null, "validation.configurationError"],
	])("reports %s", (_label, thrown, expected) => {
		expect(handleValidationError(thrown, "openai-compatible").error).toContain(expected)
		expect(handleValidationError(thrown, "openai-compatible").error).not.toContain("Non-error value")
	})
})

const withStatus = (message: string, status: number) => Object.assign(new Error(message), { status })

describe("handleValidationError", () => {
	it.each([
		["a 401", withStatus("401 Unauthorized", 401), "openai-compatible", "validation.authenticationFailed"],
		["a 403", withStatus("403 Forbidden", 403), "openai-compatible", "validation.authenticationFailed"],
		["an OpenAI 404", withStatus("404 not found", 404), "openai", "validation.modelNotAvailable"],
		["a 429", withStatus("429 slow down", 429), "openai-compatible", "validation.serviceUnavailable"],
		["a 500", withStatus("500 broken", 500), "openai-compatible", "validation.configurationError"],
		[
			"a status on response",
			Object.assign(new Error("denied"), { response: { status: 401 } }),
			"x",
			"validation.authenticationFailed",
		],
		["a status only in the message", new Error("HTTP 502: bad gateway"), "x", "validation.configurationError"],
		["a refused connection", new Error("connect ECONNREFUSED 127.0.0.1:1"), "x", "validation.connectionFailed"],
		["no response at all", new Error("HTTP 0: No response"), "x", "validation.connectionFailed"],
		["an unreadable answer", new Error("Failed to parse response JSON"), "x", "validation.invalidResponse"],
		["any other error, as its own message", new Error("model is loading"), "x", "model is loading"],
	])("reports %s", (_, error, embedderType, expected) => {
		expect(handleValidationError(error, embedderType)).toEqual({
			valid: false,
			error: expect.stringContaining(expected),
		})
	})

	it("lets a custom handler answer first", () => {
		const result = handleValidationError(withStatus("401", 401), "x", {
			beforeStandardHandling: () => ({ valid: false, error: "custom" }),
		})
		expect(result).toEqual({ valid: false, error: "custom" })
	})
})

describe("formatEmbeddingError", () => {
	it.each([
		["a 401", withStatus("401 Unauthorized", 401), "embeddings:authenticationFailed"],
		["a status", withStatus("500 broken", 500), "embeddings:failedWithStatus"],
		["no status", new Error("socket hang up"), "embeddings:failedWithError"],
		["a thrown string", "plain failure", "embeddings:failedWithError"],
	])("formats %s", (_, error, key) => {
		expect(formatEmbeddingError(error, 3).message).toContain(key.split(":")[1])
	})
})

describe("measureEmbeddingDimension", () => {
	const base64 = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString("base64")

	it.each([
		["a base64 vector", base64([1, 2, 3]), 3],
		["a base64 string shorter than one float", Buffer.from([1, 2]).toString("base64"), undefined],
		["a plain vector", [0.1, 0.2], 2],
		["an empty vector", [], undefined],
		["nothing", undefined, undefined],
	])("measures %s", (_, embedding, expected) => {
		expect(measureEmbeddingDimension(embedding)).toBe(expected)
	})
})
