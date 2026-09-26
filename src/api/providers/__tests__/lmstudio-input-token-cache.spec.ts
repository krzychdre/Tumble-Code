// npx vitest run api/providers/__tests__/lmstudio-input-token-cache.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

const { mockCreate, perBlockCalls } = vi.hoisted(() => ({
	mockCreate: vi.fn(),
	perBlockCalls: [] as unknown[][],
}))

vi.mock("openai", () => ({
	__esModule: true,
	default: vi.fn().mockImplementation(function () {
		return { chat: { completions: { create: mockCreate } } }
	}),
}))

// Count inline and record which blocks reach the tokenizer for the input estimate.
vi.mock("../../../utils/countTokens", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/countTokens")>()
	const { tiktoken, tiktokenPerBlock } = await import("../../../utils/tiktoken")
	return {
		...actual,
		countTokens: vi.fn(async (content: Anthropic.Messages.ContentBlockParam[]) => tiktoken(content)),
		countTokensPerBlock: vi.fn(async (content: Anthropic.Messages.ContentBlockParam[]) => {
			perBlockCalls.push(content)
			return tiktokenPerBlock(content)
		}),
	}
})

import { LmStudioHandler } from "../lm-studio"
import { tiktoken } from "../../../utils/tiktoken"
import { flattenMessagesForTokenCount } from "../../../utils/flattenMessagesForTokenCount"

const SYSTEM = "You are a local coding agent.\n".repeat(100)

function exchange(i: number): Anthropic.Messages.MessageParam[] {
	return [
		{
			role: "assistant",
			content: [
				{ type: "text", text: `Step ${i}: reading a file.` },
				{ type: "tool_use", id: `call_${i}`, name: "read_file", input: { path: `src/f${i}.ts` } },
			],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: `call_${i}`, content: `export const v${i} = ${i}\n`.repeat(60) },
				{ type: "text", text: `<environment_details>turn ${i}</environment_details>` },
			],
		},
	]
}

async function inputTokensOf(handler: LmStudioHandler, messages: Anthropic.Messages.MessageParam[]) {
	let inputTokens: number | undefined
	for await (const chunk of handler.createMessage(SYSTEM, messages)) {
		if (chunk.type === "usage") {
			inputTokens = chunk.inputTokens
		}
	}
	return inputTokens
}

const uncached = (messages: Anthropic.Messages.MessageParam[]) =>
	tiktoken([{ type: "text", text: SYSTEM }, ...flattenMessagesForTokenCount(messages)])

describe("LmStudioHandler input token estimate cache", () => {
	beforeEach(() => {
		perBlockCalls.length = 0
		mockCreate.mockReset()
		mockCreate.mockImplementation(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield { choices: [{ delta: { content: "ok" }, index: 0 }] }
			},
		}))
	})

	const options = { lmStudioModelId: "qwen3-coder", lmStudioBaseUrl: "http://localhost:1234" }

	it("reports the same input tokens as an uncached count and tokenizes only the new blocks", async () => {
		const handler = new LmStudioHandler(options)
		let history: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Fix the bug." }]

		for (let i = 0; i < 8; i++) {
			history = [...history, ...exchange(i)]
			// The task rebuilds the history objects for every request.
			const sent = structuredClone(history)
			expect(await inputTokensOf(handler, sent)).toBe(await uncached(sent))
		}

		// Request 1 counts system prompt + first message + one exchange (5 blocks);
		// every later request only the 4 blocks of its new exchange.
		expect(perBlockCalls.map((call) => call.length)).toEqual([6, 4, 4, 4, 4, 4, 4, 4])
	})

	it("recounts a message that was edited between requests", async () => {
		const handler = new LmStudioHandler(options)
		const history: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Fix the bug." }, ...exchange(0)]
		await inputTokensOf(handler, structuredClone(history))

		const edited = structuredClone(history)
		edited[0] = { role: "user", content: "Fix the bug in the parser, and add a regression test for it." }
		expect(await inputTokensOf(handler, edited)).toBe(await uncached(edited))
		expect(perBlockCalls[1]).toEqual([{ type: "text", text: edited[0].content }])
	})

	it("starts cold on a new handler (a mode or profile switch builds one)", async () => {
		const history: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Fix the bug." }, ...exchange(0)]
		await inputTokensOf(new LmStudioHandler(options), history)
		const other = new LmStudioHandler({ ...options, lmStudioModelId: "gpt-oss-20b" })

		expect(await inputTokensOf(other, history)).toBe(await uncached(history))
		expect(perBlockCalls[1]).toHaveLength(perBlockCalls[0].length)
	})
})
