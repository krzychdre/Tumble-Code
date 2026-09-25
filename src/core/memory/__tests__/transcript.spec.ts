import { renderTranscript, MAX_ASSISTANT_ENTRY_CHARS, type TranscriptMessage } from "../transcript"

const userText = (text: string): TranscriptMessage => ({
	role: "user",
	content: [{ type: "text", text: `<user_message>\n${text}\n</user_message>` }],
})

describe("renderTranscript", () => {
	it("returns an empty string for empty or invalid history", () => {
		expect(renderTranscript([])).toBe("")
		expect(renderTranscript(undefined as unknown as TranscriptMessage[])).toBe("")
	})

	it("keeps user prose and drops environment details, tool output and reasoning", () => {
		const out = renderTranscript([
			{
				role: "user",
				content: [
					{ type: "text", text: "<user_message>\nfix the login bug\n</user_message>" },
					{ type: "text", text: "<environment_details>\n# Open tabs\nsrc/a.ts\n</environment_details>" },
				],
			},
			{ role: "assistant", type: "reasoning", content: "secret deliberation" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Reading the file." },
					{ type: "tool_use", id: "t1", name: "read_file", input: { path: "src/a.ts" } },
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "1 | export const a = 1" }],
			},
		])
		expect(out).toBe("User: fix the login bug\n\nAssistant: Reading the file.")
	})

	it("picks up user replies that arrive inside a tool result, and the completion result", () => {
		const out = renderTranscript([
			userText("add a retry"),
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "c1", name: "attempt_completion", input: { result: "Added a retry." } }],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "c1",
						content: [{ type: "text", text: "<user_message>\nno, always use exponential backoff\n</user_message>" }],
					},
				],
			},
		])
		expect(out).toBe(
			"User: add a retry\n\nAssistant: Added a retry.\n\nUser: no, always use exponential backoff",
		)
	})

	it("drops bare acknowledgements", () => {
		expect(renderTranscript([userText("do it"), userText("ok")])).toBe("User: do it")
	})

	it("returns empty when there is no user prose at all", () => {
		expect(renderTranscript([{ role: "assistant", content: "hello" }])).toBe("")
	})

	it("caps assistant entries and keeps the newest entries within the budget", () => {
		const long = "x".repeat(MAX_ASSISTANT_ENTRY_CHARS * 3)
		const capped = renderTranscript([userText("go"), { role: "assistant", content: long }])
		expect(capped.length).toBeLessThan(MAX_ASSISTANT_ENTRY_CHARS + 40)

		const history = Array.from({ length: 50 }, (_, i) => userText(`message number ${i}`))
		const out = renderTranscript(history, { maxChars: 200 })
		expect(out.length).toBeLessThanOrEqual(200)
		// the task statement always, then the newest replies; the middle drops out
		expect(out).toContain("message number 0\n")
		expect(out).toContain("message number 49")
		expect(out).not.toContain("message number 25")
		expect(out.indexOf("number 48")).toBeLessThan(out.indexOf("number 49"))
	})

	it("a long autonomous run cannot push the task statement out (regression)", () => {
		// 250 assistant turns of narration after one task statement: the old
		// newest-first walk filled the budget with narration and returned "".
		const narration: TranscriptMessage[] = Array.from({ length: 250 }, (_, i) => ({
			role: "assistant",
			content: [{ type: "text", text: `Step ${i}: reading more files. ${"x".repeat(200)}` }],
		}))
		const out = renderTranscript([userText("port the Phase 2D fixes, never touch prod state"), ...narration])
		expect(out).toContain("User: port the Phase 2D fixes, never touch prod state")
		expect(out).toContain("Step 249")
		expect(out).not.toContain("Step 100")
	})

	it("pairs each user reply with the assistant line right before it", () => {
		const out = renderTranscript([
			userText("set up CI"),
			{ role: "assistant", content: "Narration nobody needs." },
			{ role: "assistant", content: "Should I use npm or pnpm?" },
			userText("pnpm, always"),
			{ role: "assistant", content: "Done." },
		])
		expect(out).toBe(
			"User: set up CI\n\nAssistant: Should I use npm or pnpm?\n\nUser: pnpm, always\n\nAssistant: Done.",
		)
	})
})
