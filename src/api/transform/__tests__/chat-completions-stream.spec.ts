// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/chat-completions-stream.spec.ts

import type OpenAI from "openai"

import type { ApiStreamChunk } from "../stream"
import {
	streamChatCompletion,
	type ChatCompletionStreamOptions,
	type OpenRouterReasoningDetail,
} from "../chat-completions-stream"

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

const chunk = (delta: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): Chunk =>
	({
		id: "c",
		object: "chat.completion.chunk",
		created: 0,
		model: "m",
		choices: delta === undefined ? [] : [{ index: 0, delta, finish_reason: null }],
		...extra,
	}) as unknown as Chunk

const finish = (reason: string): Chunk =>
	({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) as unknown as Chunk

async function* streamOf(chunks: Chunk[]) {
	for (const c of chunks) {
		yield c
	}
}

async function collect(chunks: Chunk[], options?: ChatCompletionStreamOptions): Promise<ApiStreamChunk[]> {
	const out: ApiStreamChunk[] = []
	for await (const c of streamChatCompletion(streamOf(chunks), options)) {
		out.push(c)
	}
	return out
}

const usage = (completion: number) => ({ prompt_tokens: 10, completion_tokens: completion, total_tokens: 10 + completion })

const mapUsage: ChatCompletionStreamOptions["mapUsage"] = (u) => ({
	type: "usage",
	inputTokens: u.prompt_tokens,
	outputTokens: u.completion_tokens,
})

describe("streamChatCompletion", () => {
	it("yields reasoning, text, tool call partials and the finish reason of a delta in that order", async () => {
		const out = await collect([
			chunk({
				reasoning_content: "why",
				content: "text",
				tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "{}" } }],
			}),
			finish("tool_calls"),
		])

		expect(out).toEqual([
			{ type: "reasoning", text: "why" },
			{ type: "text", text: "text" },
			{ type: "tool_call_partial", index: 0, id: "call_1", name: "read_file", arguments: "{}" },
			{ type: "finish_reason", finishReason: "tool_calls" },
		])
	})

	it("yields the finish reason even when the server answers stop after tool calls", async () => {
		const out = await collect([
			chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "a", arguments: "" } }] }),
			finish("stop"),
		])

		expect(out.at(-1)).toEqual({ type: "finish_reason", finishReason: "stop" })
	})

	it("skips tool_calls that is not an array instead of ending the stream", async () => {
		const out = await collect([
			chunk({ content: "Hi", tool_calls: { index: 0, id: "call_1", function: { name: "a" } } }),
			finish("stop"),
		])

		expect(out).toEqual([
			{ type: "text", text: "Hi" },
			{ type: "finish_reason", finishReason: "stop" },
		])
	})

	it("maps only the last usage block, once, after everything else", async () => {
		const seen: unknown[] = []
		const out = await collect(
			[
				chunk({ content: "a" }, { usage: usage(1) }),
				chunk({ content: "b" }, { usage: usage(2) }),
				chunk(undefined, { usage: usage(3) }),
			],
			{
				mapUsage: (u) => {
					seen.push(u)
					return mapUsage!(u)
				},
			},
		)

		expect(seen).toEqual([usage(3)])
		expect(out).toEqual([
			{ type: "text", text: "a" },
			{ type: "text", text: "b" },
			{ type: "usage", inputTokens: 10, outputTokens: 3 },
		])
	})

	it("yields no usage chunk without a mapper or without usage", async () => {
		expect(await collect([chunk({ content: "a" }, { usage: usage(1) })])).toEqual([{ type: "text", text: "a" }])
		expect(await collect([chunk({ content: "a" })], { mapUsage })).toEqual([{ type: "text", text: "a" }])
	})

	describe("think tags", () => {
		it("reads a think block split across deltas as reasoning", async () => {
			const out = await collect(
				[chunk({ content: "<thi" }), chunk({ content: "nk>Plan" }), chunk({ content: "</think>Done" })],
				{ thinkTags: true },
			)

			expect(out).toEqual([
				{ type: "reasoning", text: "Plan" },
				{ type: "text", text: "Done" },
			])
		})

		it("also accepts <thought>", async () => {
			const out = await collect([chunk({ content: "<thought>x</thought>y" })], { thinkTags: true })

			expect(out).toEqual([
				{ type: "reasoning", text: "x" },
				{ type: "text", text: "y" },
			])
		})

		it("flushes a tag cut off by the end of the stream before the usage chunk", async () => {
			const out = await collect(
				[chunk({ content: "<think>Plan" }), chunk({ content: "</thi" }, { usage: usage(1) })],
				{ thinkTags: true, mapUsage },
			)

			expect(out).toEqual([
				{ type: "reasoning", text: "Plan" },
				{ type: "reasoning", text: "</thi" },
				{ type: "usage", inputTokens: 10, outputTokens: 1 },
			])
		})

		it("leaves the tags in the text when think tags are off", async () => {
			const out = await collect([chunk({ content: "<think>x</think>y" })])

			expect(out).toEqual([{ type: "text", text: "<think>x</think>y" }])
		})
	})

	describe("reasoning sources", () => {
		it("reads reasoning_content, then reasoning, by default", async () => {
			const out = await collect([chunk({ reasoning_content: "a" }), chunk({ reasoning: "b" })])

			expect(out).toEqual([
				{ type: "reasoning", text: "a" },
				{ type: "reasoning", text: "b" },
			])
		})

		it("ignores every reasoning field with reasoning none", async () => {
			const out = await collect([chunk({ reasoning_content: "a", reasoning: "b", content: "c" })], {
				reasoning: "none",
			})

			expect(out).toEqual([{ type: "text", text: "c" }])
		})

		it("shows OpenRouter reasoning_details text once and hands the accumulated details over", async () => {
			let details: OpenRouterReasoningDetail[] | undefined
			const out = await collect(
				[
					chunk({ reasoning: "Pl", reasoning_details: [{ type: "reasoning.text", text: "Pl", index: 0 }] }),
					chunk({ reasoning: "an", reasoning_details: [{ type: "reasoning.text", text: "an", signature: "s" }] }),
					chunk({ reasoning_details: [{ type: "reasoning.summary", summary: "Sum", index: 1 }] }),
					chunk({ reasoning_details: [{ type: "reasoning.encrypted", data: "enc", id: "r", index: 2 }] }),
					chunk({ reasoning_content: "ignored", content: "Answer" }),
				],
				{ reasoning: "openrouter", onReasoningDetails: (d) => (details = d) },
			)

			expect(out).toEqual([
				{ type: "reasoning", text: "Pl" },
				{ type: "reasoning", text: "an" },
				{ type: "reasoning", text: "Sum" },
				{ type: "text", text: "Answer" },
			])
			expect(details).toEqual([
				{
					type: "reasoning.text",
					text: "Plan",
					summary: undefined,
					data: undefined,
					id: undefined,
					format: undefined,
					signature: "s",
					index: 0,
				},
				{
					type: "reasoning.summary",
					text: undefined,
					summary: "Sum",
					data: undefined,
					id: undefined,
					format: undefined,
					signature: undefined,
					index: 1,
				},
				{
					type: "reasoning.encrypted",
					text: undefined,
					summary: undefined,
					data: "enc",
					id: "r",
					format: undefined,
					signature: undefined,
					index: 2,
				},
			])
		})

		it("shows OpenRouter's plain reasoning when no details carry text", async () => {
			let called = false
			const out = await collect([chunk({ reasoning: "plain" })], {
				reasoning: "openrouter",
				onReasoningDetails: () => (called = true),
			})

			expect(out).toEqual([{ type: "reasoning", text: "plain" }])
			expect(called).toBe(false)
		})
	})

	it("lets onChunk end the stream with an error", async () => {
		const stream = streamChatCompletion(streamOf([chunk({ content: "a" }), chunk({ content: "b" })]), {
			onChunk: (c) => {
				if ((c.choices[0]?.delta as { content?: string }).content === "b") {
					throw new Error("in-stream error")
				}
			},
		})

		const out: ApiStreamChunk[] = []
		await expect(
			(async () => {
				for await (const c of stream) out.push(c)
			})(),
		).rejects.toThrow("in-stream error")
		expect(out).toEqual([{ type: "text", text: "a" }])
	})

	it("tolerates chunks without choices", async () => {
		const out = await collect([{ usage: usage(1) } as unknown as Chunk], { mapUsage })

		expect(out).toEqual([{ type: "usage", inputTokens: 10, outputTokens: 1 }])
	})
})
