import type { Anthropic } from "@anthropic-ai/sdk"

import { flattenMessagesForTokenCount } from "../flattenMessagesForTokenCount"
import { tiktoken } from "../tiktoken"

// DEF-C16: the local token estimate (LM Studio, OpenAI-compatible servers that omit
// usage, and the zero-usage context fallback in TaskApiLoop) used to keep only
// `text` blocks, so a history made mostly of read_file results was counted as if
// the file contents were not there and auto-condense fired late.

const fileBody = Array.from({ length: 200 }, (_, i) => `export const value${i} = computeSomething(${i}, "x")`).join(
	"\n",
)

const history: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Refactor the helpers in src/utils" },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "I will read the file first." },
			{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "src/utils/a.ts" } },
		],
	},
	{
		role: "user",
		content: [{ type: "tool_result", tool_use_id: "call_1", content: fileBody }],
	},
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call_2",
				content: [{ type: "text", text: fileBody }],
			},
		],
	},
]

describe("flattenMessagesForTokenCount", () => {
	it("keeps tool_result blocks so their content is counted", async () => {
		const blocks = flattenMessagesForTokenCount(history)
		expect(blocks.filter((b) => b.type === "tool_result")).toHaveLength(2)

		const withResults = await tiktoken(blocks)
		const textOnly = await tiktoken(blocks.filter((b) => b.type === "text"))
		// Two copies of a ~200-line file must dominate the count.
		expect(withResults - textOnly).toBeGreaterThan(2 * (await tiktoken([{ type: "text", text: fileBody }])) * 0.9)
	})

	it("keeps tool_use blocks so the call arguments are counted", () => {
		const blocks = flattenMessagesForTokenCount(history)
		expect(blocks).toContainEqual(
			expect.objectContaining({ type: "tool_use", name: "read_file", input: { path: "src/utils/a.ts" } }),
		)
	})

	it("keeps image blocks", () => {
		const blocks = flattenMessagesForTokenCount([
			{
				role: "user",
				content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }],
			},
		])
		expect(blocks).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }])
	})

	it("produces the same blocks as before for plain text histories", () => {
		const plain: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: [{ type: "text", text: "hi there" }] },
		]
		expect(flattenMessagesForTokenCount(plain)).toEqual([
			{ type: "text", text: "hello" },
			{ type: "text", text: "hi there" },
		])
	})

	it("drops block types the tokenizer does not count (reasoning, thinking)", () => {
		const blocks = flattenMessagesForTokenCount([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "secret", signature: "sig" },
					{ type: "reasoning", text: "internal" } as unknown as Anthropic.Messages.ContentBlockParam,
					{ type: "text", text: "answer" },
				],
			},
		])
		expect(blocks).toEqual([{ type: "text", text: "answer" }])
	})
})
