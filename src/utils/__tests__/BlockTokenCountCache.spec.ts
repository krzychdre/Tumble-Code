// npx vitest run utils/__tests__/BlockTokenCountCache.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import { BlockTokenCountCache } from "../BlockTokenCountCache"
import { tiktoken, tiktokenPerBlock } from "../tiktoken"

type Block = Anthropic.Messages.ContentBlockParam

const MODEL = "lmstudio:qwen3-coder"

/**
 * A per-block counter that tokenizes inline (no worker) and records what it
 * was asked to count, so a spec can see exactly which blocks were tokenized.
 */
function recordingCounter() {
	const calls: Block[][] = []
	const counter = vi.fn(async (blocks: Block[]) => {
		calls.push(blocks)
		return tiktokenPerBlock(blocks)
	})
	return { counter, calls }
}

// One scripted turn: a user message with a tool result, then the assistant's
// text and tool call. Mixed block types so every tiktoken branch is exercised.
function turn(i: number): Block[] {
	return [
		{
			type: "tool_result",
			tool_use_id: `call_${i}`,
			content: [
				{ type: "text", text: `file body ${i}\n`.repeat(40) },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR".repeat(i + 1) } },
			],
		},
		{ type: "text", text: `<environment_details>turn ${i}</environment_details>` },
		{ type: "text", text: `Reading the next file, step ${i}.` },
		{ type: "tool_use", id: `call_${i + 1}`, name: "read_file", input: { path: `src/f${i}.ts`, lines: [1, 200] } },
	]
}

const SYSTEM: Block = { type: "text", text: "You are a coding agent.\n".repeat(200) }

describe("BlockTokenCountCache", () => {
	it("returns exactly the uncached count on every request of a growing conversation", async () => {
		const { counter } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		let history: Block[] = [SYSTEM]

		for (let i = 0; i < 30; i++) {
			history = [...history, ...turn(i)]
			await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
		}
	})

	it("tokenizes only the blocks a request adds to an unchanged history", async () => {
		const { counter, calls } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const first = [SYSTEM, ...turn(0), ...turn(1)]

		await cache.count(first, MODEL)
		expect(calls[0]).toHaveLength(first.length)

		// The next request rebuilds the history from fresh objects (the task
		// clones messages per request), so the cache must match by content.
		const second = structuredClone([...first, ...turn(2)])
		await expect(cache.count(second, MODEL)).resolves.toBe(await tiktoken(second))
		expect(calls).toHaveLength(2)
		expect(calls[1]).toEqual(turn(2))

		// Nothing new: no tokenizer call at all.
		await expect(cache.count(structuredClone(second), MODEL)).resolves.toBe(await tiktoken(second))
		expect(calls).toHaveLength(2)
	})

	it("recounts an edited block, including one mutated in place", async () => {
		const { counter, calls } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const history = [SYSTEM, ...turn(0), ...turn(1)]
		await cache.count(history, MODEL)

		// Same object, new text: identity must not be the key.
		const edited = history[3] as Anthropic.Messages.TextBlockParam
		edited.text = edited.text + " and a much longer edited sentence that adds tokens"
		await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
		expect(calls[1]).toEqual([edited])

		// A changed tool call argument.
		const replaced = [...history]
		replaced[4] = { type: "tool_use", id: "call_1", name: "read_file", input: { path: "other.ts" } }
		await expect(cache.count(replaced, MODEL)).resolves.toBe(await tiktoken(replaced))
		expect(calls[2]).toEqual([replaced[4]])
	})

	it("counts a condensed or truncated history exactly and forgets the dropped blocks", async () => {
		const { counter } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const long = [SYSTEM, ...Array.from({ length: 20 }, (_, i) => turn(i)).flat()]
		await cache.count(long, MODEL)
		const sizeBefore = cache.size

		const condensed: Block[] = [SYSTEM, { type: "text", text: "Summary of the earlier work." }, ...turn(19)]
		await expect(cache.count(condensed, MODEL)).resolves.toBe(await tiktoken(condensed))

		// Memory follows the latest history, not everything ever seen.
		expect(cache.size).toBeLessThanOrEqual(condensed.length)
		expect(cache.size).toBeLessThan(sizeBefore)
	})

	it("never reuses a count under another model or tokenizer scope", async () => {
		const { counter, calls } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const history = [SYSTEM, ...turn(0)]

		await cache.count(history, MODEL)
		await cache.count(history, "lmstudio:other-model")

		expect(calls).toHaveLength(2)
		expect(calls[1]).toHaveLength(history.length)
	})

	it("counts images by their data, so a different image is recounted", async () => {
		const { counter, calls } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const image = (data: string): Block => ({
			type: "image",
			source: { type: "base64", media_type: "image/png", data },
		})

		const a = [SYSTEM, image("A".repeat(10_000))]
		const b = [SYSTEM, image("B".repeat(90_000))]
		await expect(cache.count(a, MODEL)).resolves.toBe(await tiktoken(a))
		await expect(cache.count(b, MODEL)).resolves.toBe(await tiktoken(b))
		expect(calls[1]).toEqual([b[1]])
	})

	it("counts a tool call whose arguments JSON cannot serialize exactly like tiktoken", async () => {
		const { counter } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const history: Block[] = [
			SYSTEM,
			{ type: "tool_use", id: "call_1", name: "odd", input: { big: BigInt(1) } as unknown as object },
		]

		await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
		await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
	})

	it("fails like tiktoken on a block tiktoken cannot count, and keeps working afterwards", async () => {
		const { counter } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const broken = [
			SYSTEM,
			{ type: "image", source: { type: "base64", media_type: "image/png", data: undefined } },
		] as unknown as Block[]

		await expect(tiktoken(broken)).rejects.toThrow(TypeError)
		await expect(cache.count(broken, MODEL)).rejects.toThrow(TypeError)

		const history = [SYSTEM, ...turn(0)]
		await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
	})

	it("counts repeated identical blocks once each in the total but tokenizes them once", async () => {
		const { counter, calls } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)
		const same: Block = { type: "text", text: "<environment_details>same</environment_details>" }
		const history = [SYSTEM, same, { ...same }, { ...same }]

		await expect(cache.count(history, MODEL)).resolves.toBe(await tiktoken(history))
		expect(calls[0]).toHaveLength(2)
		expect(cache.size).toBe(2)
	})

	it("returns 0 for no blocks without calling the tokenizer", async () => {
		const { counter } = recordingCounter()
		const cache = new BlockTokenCountCache(counter)

		await expect(cache.count([], MODEL)).resolves.toBe(0)
		expect(counter).not.toHaveBeenCalled()
	})
})
