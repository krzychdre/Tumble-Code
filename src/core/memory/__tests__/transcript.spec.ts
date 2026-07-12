import { describe, it, expect } from "vitest"

import { renderTranscript, DEFAULT_MAX_MESSAGES, type TranscriptMessage } from "../transcript"

describe("renderTranscript", () => {
	it("returns empty string for empty / non-array history", () => {
		expect(renderTranscript([])).toBe("")
		expect(renderTranscript(undefined as unknown as TranscriptMessage[])).toBe("")
	})

	it("renders string-content messages with speaker labels, preserving order", () => {
		const out = renderTranscript([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		])
		expect(out).toBe("User: hello\n\nAssistant: hi there")
	})

	it("renders tool_use and tool_result blocks compactly", () => {
		const out = renderTranscript([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "let me read it" },
					{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }],
			},
		])
		expect(out).toContain("Assistant: let me read it")
		expect(out).toContain('→ tool read_file({"path":"a.ts"})')
		expect(out).toContain("← result: file body")
	})

	it("renders tool_result whose content is an array of parts", () => {
		const out = renderTranscript([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [{ type: "text", text: "line one" }],
					},
				],
			},
		])
		expect(out).toContain("← result: line one")
	})

	it("drops reasoning-tagged messages entirely", () => {
		const out = renderTranscript([
			{ role: "assistant", content: "thinking...", type: "reasoning" },
			{ role: "assistant", content: "the answer" },
		])
		expect(out).toBe("Assistant: the answer")
	})

	it("skips messages that render to nothing (e.g. only unknown blocks)", () => {
		const out = renderTranscript([
			{ role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" } as never] },
			{ role: "user", content: "real" },
		])
		expect(out).toBe("User: real")
	})

	it("keeps only the last maxMessages entries", () => {
		const history: TranscriptMessage[] = Array.from({ length: DEFAULT_MAX_MESSAGES + 5 }, (_, i) => ({
			role: "user" as const,
			content: `m${i}`,
		}))
		const out = renderTranscript(history)
		expect(out).not.toContain("User: m0")
		expect(out).toContain(`User: m${DEFAULT_MAX_MESSAGES + 4}`)
		expect(out.split("\n\n")).toHaveLength(DEFAULT_MAX_MESSAGES)
	})

	it("respects a custom maxMessages", () => {
		const history: TranscriptMessage[] = [
			{ role: "user", content: "a" },
			{ role: "assistant", content: "b" },
			{ role: "user", content: "c" },
		]
		expect(renderTranscript(history, { maxMessages: 1 })).toBe("User: c")
	})

	it("truncates long message bodies with a marker", () => {
		const long = "x".repeat(5000)
		const out = renderTranscript([{ role: "user", content: long }], { maxCharsPerMessage: 100 })
		expect(out).toContain("…[truncated]")
		expect(out.length).toBeLessThan(200)
	})
})
