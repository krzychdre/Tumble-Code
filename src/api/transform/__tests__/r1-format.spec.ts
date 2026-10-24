// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/r1-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { convertToR1Format } from "../r1-format"

const image = {
	type: "image" as const,
	source: { type: "base64" as const, media_type: "image/png" as const, data: "AAAA" },
}
const imageUrl = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }

function convert(messages: unknown[], options?: Parameters<typeof convertToR1Format>[1]) {
	return convertToR1Format(messages as Anthropic.Messages.MessageParam[], options) as any[]
}

describe("convertToR1Format", () => {
	describe("merging consecutive messages of one role", () => {
		it.each([
			[
				"two user strings",
				[
					{ role: "user", content: "a" },
					{ role: "user", content: "b" },
				],
				[{ role: "user", content: "a\nb" }],
			],
			[
				"a user string and user blocks with an image",
				[
					{ role: "user", content: "a" },
					{ role: "user", content: [{ type: "text", text: "b" }, image] },
				],
				[{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }, imageUrl] }],
			],
			[
				"user parts and a user string",
				[
					{ role: "user", content: [image] },
					{ role: "user", content: "b" },
				],
				[{ role: "user", content: [imageUrl, { type: "text", text: "b" }] }],
			],
			[
				"user parts and user text blocks",
				[
					{ role: "user", content: [image] },
					{ role: "user", content: [{ type: "text", text: "b" }] },
				],
				[{ role: "user", content: [imageUrl, { type: "text", text: "b" }] }],
			],
			[
				"two assistant strings",
				[
					{ role: "assistant", content: "a" },
					{ role: "assistant", content: "b" },
				],
				[{ role: "assistant", content: "a\nb" }],
			],
			[
				"assistant blocks after an assistant without text",
				[
					{ role: "assistant", content: [{ type: "reasoning", text: "r" }] },
					{ role: "assistant", content: [{ type: "text", text: "b" }] },
				],
				[{ role: "assistant", content: "\nb", reasoning_content: "r" }],
			],
			[
				"an assistant string after an assistant without text",
				[
					{ role: "assistant", content: [{ type: "reasoning", text: "r" }] },
					{ role: "assistant", content: "b" },
				],
				[{ role: "assistant", content: "b", reasoning_content: "r" }],
			],
		])("%s", (_label, messages, expected) => {
			expect(convert(messages)).toEqual(expected)
		})

		it.each([
			["blocks", [{ type: "text", text: "next" }]],
			["a string", "next"],
		])("keeps an assistant message with tool calls apart from the next assistant %s", (_label, content) => {
			const result = convert([
				{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "x", input: {} }] },
				{ role: "assistant", content },
			])
			expect(result).toHaveLength(2)
			expect(result[1].content).toBe("next")
		})

		it("keeps the latest reasoning when assistant turns merge", () => {
			expect(
				convert([
					{ role: "assistant", content: "a", reasoning_content: "first" },
					{ role: "assistant", content: "b", reasoning_content: "second" },
				]),
			).toEqual([{ role: "assistant", content: "a\nb", reasoning_content: "second" }])
		})
	})

	describe("tools", () => {
		it("turns tool uses into tool calls with null content when there is no text", () => {
			expect(
				convert([
					{
						role: "assistant",
						content: [
							{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a" } },
							{ type: "tool_use", id: "call_2", name: "list_files", input: {} },
						],
					},
				]),
			).toEqual([
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } },
						{ id: "call_2", type: "function", function: { name: "list_files", arguments: "{}" } },
					],
				},
			])
		})

		it.each([
			["a string", "body", "body"],
			["parts", [{ type: "text", text: "one" }, image, { type: "document" }], "one\n(image)\n"],
			["no content", undefined, ""],
		])("maps a tool result with %s", (_label, content, expected) => {
			expect(
				convert([{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content }] }]),
			).toEqual([{ role: "tool", tool_call_id: "call_1", content: expected }])
		})

		const toolTurn = (...extra: unknown[]) => [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "call_1", content: "one" },
					{ type: "tool_result", tool_use_id: "call_2", content: "two" },
					{ type: "text", text: "<env>" },
					...extra,
				],
			},
		]

		it("puts the post-tool text into a user message by default", () => {
			expect(convert(toolTurn())).toEqual([
				{ role: "tool", tool_call_id: "call_1", content: "one" },
				{ role: "tool", tool_call_id: "call_2", content: "two" },
				{ role: "user", content: "<env>" },
			])
		})

		// A user message makes DeepSeek and GLM drop the reasoning of the turn.
		it("merges the post-tool text into the last tool message when asked", () => {
			expect(convert(toolTurn({ type: "text", text: "more" }), { mergeToolResultText: true })).toEqual([
				{ role: "tool", tool_call_id: "call_1", content: "one" },
				{ role: "tool", tool_call_id: "call_2", content: "two\n\n<env>\nmore" },
			])
		})

		it.each([
			["the turn carries an image", toolTurn(image), "tool"],
			["there is no tool result", [{ role: "user", content: [{ type: "text", text: "<env>" }] }], undefined],
		])("keeps a user message, even when asked to merge, when %s", (_label, messages, previousRole) => {
			const result = convert(messages, { mergeToolResultText: true })
			expect(result.at(-1).role).toBe("user")
			expect(result.at(-2)?.role).toBe(previousRole)
		})
	})

	describe("reasoning", () => {
		const turn = (extra: Record<string, unknown> = {}) => ({
			role: "assistant",
			content: [
				{ type: "reasoning", text: "from the block" },
				{ type: "text", text: "Answer" },
				{ type: "reasoning" },
			],
			...extra,
		})

		it.each([
			["a stored reasoning block", turn(), undefined, { reasoning_content: "from the block" }],
			[
				"the top-level field over the block",
				turn({ reasoning_content: "top" }),
				undefined,
				{ reasoning_content: "top" },
			],
			[
				"every listed field (vLLM reads only `reasoning`)",
				turn(),
				["reasoning_content", "reasoning"] as const,
				{ reasoning_content: "from the block", reasoning: "from the block" },
			],
			["no field without reasoning", { role: "assistant", content: "Answer" }, undefined, {}],
		])("sends %s", (_label, message, reasoningFields, expected) => {
			expect(convert([message], { reasoningFields })).toEqual([
				{ role: "assistant", content: "Answer", ...expected },
			])
		})
	})
})
