import { handleProviderError } from "../error-handler"

describe("handleProviderError", () => {
	const providerName = "TestProvider"

	describe("HTTP status preservation", () => {
		it("should preserve status code from Error with status field", () => {
			const error = new Error("API request failed") as any
			error.status = 401

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect(result.message).toContain("TestProvider completion error")
			expect((result as any).status).toBe(401)
		})

		it("should preserve status code from Error with nested error structure", () => {
			const error = new Error("Wrapped error") as any
			error.status = 429
			error.errorDetails = [{ "@type": "type.googleapis.com/google.rpc.RetryInfo" }]

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(429)
			expect((result as any).errorDetails).toBeDefined()
		})

		it("should preserve status from non-Error exception", () => {
			const error = {
				status: 500,
				message: "Internal server error",
			}

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect((result as any).status).toBe(500)
		})

		// Not every SDK names the HTTP status `status`. The retry loop, the chat error row and the
		// background-model fallback only read `.status`, so the wrapper normalizes it.
		it("should expose the Mistral SDK's statusCode as status", () => {
			const error = Object.assign(new Error("Rate limited"), { statusCode: 429 })

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(429)
		})

		it("should expose the ollama ResponseError's status_code as status", () => {
			const error = Object.assign(new Error("model is too large"), { status_code: 400 })

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(400)
		})

		it("should expose the AWS SDK's $metadata.httpStatusCode as status", () => {
			const error = Object.assign(new Error("Access denied"), { $metadata: { httpStatusCode: 403 } })

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(403)
		})

		it("should prefer an explicit numeric status over the other spellings", () => {
			const error = Object.assign(new Error("Mixed"), { status: 429, statusCode: 500 })

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(429)
		})

		it("should not add status field if original error lacks it", () => {
			const error = new Error("Generic error")

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect((result as any).status).toBeUndefined()
		})
	})

	describe("errorDetails preservation", () => {
		it("should preserve errorDetails array from original error", () => {
			const error = new Error("Rate limited") as any
			error.status = 429
			error.errorDetails = [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "5s" }]

			const result = handleProviderError(error, providerName)

			expect((result as any).errorDetails).toEqual(error.errorDetails)
		})

		it("should preserve code field from original error", () => {
			const error = new Error("Bad request") as any
			error.code = "invalid_request"

			const result = handleProviderError(error, providerName)

			expect((result as any).code).toBe("invalid_request")
		})

		it("should preserve AWS $metadata from original error", () => {
			const error = new Error("AWS error") as any
			error.$metadata = { httpStatusCode: 403, requestId: "test-123" }

			const result = handleProviderError(error, providerName)

			expect((result as any).$metadata).toEqual(error.$metadata)
		})
	})

	describe("custom message prefix", () => {
		it("should use custom message prefix when provided", () => {
			const error = new Error("Stream failed")

			const result = handleProviderError(error, providerName, { messagePrefix: "streaming" })

			expect(result.message).toBe("TestProvider streaming error: Stream failed")
		})

		it("should default to 'completion' prefix when not provided", () => {
			const error = new Error("Request failed")

			const result = handleProviderError(error, providerName)

			expect(result.message).toBe("TestProvider completion error: Request failed")
		})
	})

	describe("custom message transformer", () => {
		it("should use custom message transformer when provided", () => {
			const error = new Error("API error")

			const result = handleProviderError(error, providerName, {
				messageTransformer: (msg) => `Custom format: ${msg}`,
			})

			expect(result.message).toBe("Custom format: API error")
		})

		it("should preserve status even with custom transformer", () => {
			const error = new Error("Rate limited") as any
			error.status = 429

			const result = handleProviderError(error, providerName, {
				messageTransformer: (msg) => `Transformed: ${msg}`,
			})

			expect(result.message).toBe("Transformed: Rate limited")
			expect((result as any).status).toBe(429)
		})

		it("should apply the transformer to non-Error exceptions too", () => {
			const result = handleProviderError("socket hang up", providerName, {
				messageTransformer: (msg) => `Transformed: ${msg}`,
			})

			expect(result.message).toBe("Transformed: socket hang up")
		})
	})

	describe("ByteString conversion errors", () => {
		it("should return localized message for ByteString conversion errors", () => {
			const error = new Error("Cannot convert argument to a ByteString")

			const result = handleProviderError(error, providerName)

			expect(result.message).not.toContain("TestProvider completion error")
			// The actual translated message depends on i18n setup
			expect(result.message).toBeTruthy()
		})

		it("should preserve status even for ByteString errors", () => {
			const error = new Error("Cannot convert argument to a ByteString") as any
			error.status = 400

			const result = handleProviderError(error, providerName)

			// Even though ByteString errors are typically client-side,
			// we preserve any status metadata that exists for debugging purposes
			expect((result as any).status).toBe(400)
		})
	})

	describe("error message formatting", () => {
		it("should wrap error message with provider name prefix", () => {
			const error = new Error("Authentication failed")

			const result = handleProviderError(error, providerName)

			expect(result.message).toBe("TestProvider completion error: Authentication failed")
		})

		it("should handle error with nested metadata", () => {
			const error = new Error("Network error") as any
			error.error = {
				metadata: {
					raw: "Connection refused",
				},
			}

			const result = handleProviderError(error, providerName)

			expect(result.message).toContain("Connection refused")
			expect(result.message).toContain("TestProvider completion error")
		})

		it("should handle non-Error exceptions", () => {
			const error = { message: "Something went wrong" }

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect(result.message).toContain("TestProvider completion error")
			expect(result.message).toContain("[object Object]")
		})

		it("should handle string exceptions", () => {
			const error = "Connection timeout"

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect(result.message).toBe("TestProvider completion error: Connection timeout")
		})
	})

	// The cause chains the OpenAI SDK (over undici fetch) delivers for an unreachable host.
	describe("network failure cause", () => {
		const fetchFailed = (socketError: string) => new TypeError("fetch failed", { cause: new Error(socketError) })

		it.each([
			[
				"Connection error.",
				"connect ECONNREFUSED 127.0.0.1:59999",
				"TestProvider completion error: Connection error. (connect ECONNREFUSED 127.0.0.1:59999)",
			],
			[
				"Request timed out.",
				"Connect Timeout Error (attempted address: 10.255.255.1:11111, timeout: 10000ms)",
				"TestProvider completion error: Request timed out. (Connect Timeout Error (attempted address: 10.255.255.1:11111, timeout: 10000ms))",
			],
			["fetch failed: bad port", "bad port", "TestProvider completion error: fetch failed: bad port"],
		])("names the socket error behind %s", (sdkMessage, socketError, expected) => {
			const error = new Error(sdkMessage, { cause: fetchFailed(socketError) })

			expect(handleProviderError(error, providerName).message).toBe(expected)
		})
	})

	describe("real-world error scenarios", () => {
		it("should handle 401 Unauthorized with status and message", () => {
			const error = new Error("Unauthorized") as any
			error.status = 401

			const result = handleProviderError(error, providerName)

			expect(result.message).toContain("Unauthorized")
			expect((result as any).status).toBe(401)
		})

		it("should handle 429 Rate Limit with RetryInfo", () => {
			const error = new Error("Rate limit exceeded") as any
			error.status = 429
			error.errorDetails = [
				{
					"@type": "type.googleapis.com/google.rpc.RetryInfo",
					retryDelay: "10s",
				},
			]

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(429)
			expect((result as any).errorDetails).toBeDefined()
			expect((result as any).errorDetails[0].retryDelay).toBe("10s")
		})

		it("should handle 500 Internal Server Error", () => {
			const error = new Error("Internal server error") as any
			error.status = 500

			const result = handleProviderError(error, providerName)

			expect((result as any).status).toBe(500)
			expect(result.message).toContain("Internal server error")
		})

		it("should handle errors without status gracefully", () => {
			const error = new Error("Network connectivity issue")

			const result = handleProviderError(error, providerName)

			expect(result).toBeInstanceOf(Error)
			expect((result as any).status).toBeUndefined()
			expect(result.message).toContain("Network connectivity issue")
		})

		it("should handle Gemini-specific errors with custom transformer", () => {
			const error = new Error("Model not found") as any
			error.status = 404

			const result = handleProviderError(error, "Gemini", {
				messageTransformer: (msg) => `Gemini API Error: ${msg}`,
			})

			expect(result.message).toBe("Gemini API Error: Model not found")
			expect((result as any).status).toBe(404)
		})

		it("should handle Anthropic SDK errors", () => {
			const error = new Error("Invalid API key") as any
			error.status = 401
			error.error = { type: "authentication_error" }

			const result = handleProviderError(error, "Anthropic")

			expect((result as any).status).toBe(401)
			expect(result.message).toContain("Invalid API key")
		})
	})
})
