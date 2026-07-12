import { describe, it, expect } from "vitest"

import { emitToolCallChunks, emitFinishReasonChunk } from "../openai-stream-chunks"

describe("emitToolCallChunks", () => {
	it("yields one chunk per tool call in the delta", () => {
		const delta = {
			tool_calls: [
				{
					index: 0,
					id: "call_abc",
					function: { name: "get_weather", arguments: '{"city": "' },
				},
				{
					index: 1,
					id: "call_def",
					function: { name: "get_time", arguments: '{"zone": "UTC"}' },
				},
			],
		}

		const chunks = [...emitToolCallChunks(delta)]

		expect(chunks).toHaveLength(2)
		expect(chunks[0]).toEqual({
			type: "tool_call_partial",
			index: 0,
			id: "call_abc",
			name: "get_weather",
			arguments: '{"city": "',
		})
		expect(chunks[1]).toEqual({
			type: "tool_call_partial",
			index: 1,
			id: "call_def",
			name: "get_time",
			arguments: '{"zone": "UTC"}',
		})
	})

	it("passes through undefined id/name/arguments when fields are missing", () => {
		const delta = {
			tool_calls: [
				{
					index: 2,
					function: { arguments: "more" },
				},
			],
		}

		const chunks = [...emitToolCallChunks(delta)]

		expect(chunks).toHaveLength(1)
		expect(chunks[0]).toEqual({
			type: "tool_call_partial",
			index: 2,
			id: undefined,
			name: undefined,
			arguments: "more",
		})
	})

	it("yields nothing when delta is null or undefined", () => {
		expect([...emitToolCallChunks(null)]).toEqual([])
		expect([...emitToolCallChunks(undefined)]).toEqual([])
	})

	it("yields nothing when tool_calls is missing or null", () => {
		expect([...emitToolCallChunks({})]).toEqual([])
		expect([...emitToolCallChunks({ tool_calls: null })]).toEqual([])
	})

	it("yields nothing when tool_calls is an empty array", () => {
		expect([...emitToolCallChunks({ tool_calls: [] })]).toEqual([])
	})
})

describe("emitFinishReasonChunk", () => {
	it("yields a single finish_reason chunk for a non-empty string", () => {
		const chunks = [...emitFinishReasonChunk("stop")]
		expect(chunks).toEqual([{ type: "finish_reason", finishReason: "stop" }])
	})

	it("yields nothing for null or undefined", () => {
		expect([...emitFinishReasonChunk(null)]).toEqual([])
		expect([...emitFinishReasonChunk(undefined)]).toEqual([])
	})

	it("yields nothing for empty string", () => {
		expect([...emitFinishReasonChunk("")]).toEqual([])
	})
})
