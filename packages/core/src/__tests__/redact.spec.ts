import { redactSecrets } from "../redact.js"

describe("redactSecrets patterns", () => {
	it.each([
		["Authorization: Bearer abcdefghijklmnop", "[redacted]", "abcdefghijklmnop"],
		['{"api_key":"0123456789abcdef"}', '{"api_key":"[redacted]"}', "0123456789abcdef"],
		[
			"https://x.example/v1?key=AIzaSecret123&alt=sse",
			"https://x.example/v1?key=[redacted]&alt=sse",
			"AIzaSecret123",
		],
		["key sk-proj-abcdefghijklmnopqrstuvwx used", "key [redacted-key] used", "abcdefghijklmnopqrstuvwx"],
		["x-api-key=supersecretvalue", "x-api-key=[redacted]", "supersecretvalue"],
		["Bearer sk-TEST-LEAK-123\nX is an invalid header value", "[redacted]", "TEST-LEAK-123"],
		["invalid key sk-TEST-LEAK-123", "invalid key [redacted-key]", "TEST-LEAK-123"],
		[
			"request to https://user:sk-TEST-LEAK-123@llm.example:8443/v1/chat failed",
			"https://[redacted]@llm.example:8443/v1/chat",
			"TEST-LEAK-123",
		],
		["connect to http://:hunter2pass@10.0.0.5/v1", "http://[redacted]@10.0.0.5/v1", "hunter2pass"],
	])("removes the secret from %j", (input, expected, secret) => {
		const output = redactSecrets(input, [])
		expect(output).toContain(expected)
		expect(output).not.toContain(secret)
	})

	it.each([
		"Error reading file src/app.ts: ENOENT: no such file or directory",
		"POST https://llm.example:8443/v1/chat/completions -> 500",
		"git@github.com:org/repo.git and a task-1234567890 id",
		"sk-short",
	])("leaves %j alone", (text) => {
		expect(redactSecrets(text, [])).toBe(text)
	})
})

describe("redactSecrets configured values", () => {
	it("replaces every configured value in every string of a nested value, the rest intact", () => {
		const payload = {
			type: "Exception",
			properties: {
				errorMessage: 'Headers.append: "Bearer my-local-key-7f3a\nX" is an invalid header value.',
				count: 3,
				ok: true,
				list: ["plain", "custom header value=hdr-secret-99"],
			},
		}

		expect(redactSecrets(payload, ["my-local-key-7f3a", "hdr-secret-99"])).toEqual({
			type: "Exception",
			properties: {
				errorMessage: 'Headers.append: "Bearer [redacted]\nX" is an invalid header value.',
				count: 3,
				ok: true,
				list: ["plain", "custom header value=[redacted]"],
			},
		})
	})

	it("finds a value stored with surrounding whitespace, and never replaces values under 8 characters", () => {
		expect(redactSecrets("failed with my-local-key-7f3a.", ["  my-local-key-7f3a\n", "short1"])).toBe(
			"failed with [redacted].",
		)
		expect(redactSecrets("short1 stays", ["short1"])).toBe("short1 stays")
	})

	it("replaces the longer of two overlapping values whole", () => {
		expect(
			redactSecrets("x my-local-key-7f3a-extended y", ["my-local-key-7f3a", "my-local-key-7f3a-extended"]),
		).toBe("x [redacted] y")
	})
})
