import * as crypto from "crypto"

import { sanitizeToolUseId, truncateOpenAiCallId, sanitizeOpenAiCallId } from "../tool-id"

const sha256Suffix = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 8)

describe("sanitizeToolUseId", () => {
	it.each([
		["toolu_01-AbC", "toolu_01-AbC"],
		["", ""],
		// Gemini/OpenRouter function call ids and MCP server-prefixed ids
		["functions.read_file:0", "functions_read_file_0"],
		["mcp.server/tool\\name with space", "mcp_server_tool_name_with_space"],
	])("turns %j into %j", (id, expected) => {
		expect(sanitizeToolUseId(id)).toBe(expected)
	})
})

describe("truncateOpenAiCallId", () => {
	it.each([["short_id"], ["a".repeat(64)], [""]])("keeps %j, which fits in 64 characters", (id) => {
		expect(truncateOpenAiCallId(id)).toBe(id)
	})

	// The reported id was 69 characters long.
	it("cuts a longer id to a 55-character prefix, '_' and an 8-character SHA-256 suffix", () => {
		const id = "toolu_mcp--posthog--query_run_" + "a".repeat(39)

		const result = truncateOpenAiCallId(id)

		// SHA-256, not MD5 (CodeQL js/weak-cryptographic-algorithm).
		expect(result).toBe(`${id.slice(0, 55)}_${sha256Suffix(id)}`)
		expect(truncateOpenAiCallId(id)).toBe(result)
		expect(truncateOpenAiCallId(id + "x")).not.toBe(result)
	})

	it("honours a custom maximum", () => {
		expect(truncateOpenAiCallId("a".repeat(40), 40)).toBe("a".repeat(40))
		expect(truncateOpenAiCallId("a".repeat(41), 40)).toBe(`${"a".repeat(31)}_${sha256Suffix("a".repeat(41))}`)
	})
})

describe("sanitizeOpenAiCallId", () => {
	it("sanitizes first, then cuts to 64 characters", () => {
		const id = "mcp.server:" + "x".repeat(60)
		const sanitized = "mcp_server_" + "x".repeat(60)

		expect(sanitizeOpenAiCallId(id)).toBe(`${sanitized.slice(0, 55)}_${sha256Suffix(sanitized)}`)
		expect(sanitizeOpenAiCallId("call.1")).toBe("call_1")
	})
})
