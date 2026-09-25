// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/chat-completions-characterization.spec.ts
//
// API-7 characterization: golden OpenAI Chat Completions stream sequences
// (the chunks an SSE stream decodes into) replayed through each of the eight
// hand-written stream loops, pinning the exact chunk list each loop yields,
// the error it throws and, for OpenRouter, the reasoning details it keeps.
//
// The snapshot was recorded on main before the loops moved onto the shared
// adapter (transform/chat-completions-stream.ts), bugs included: a later
// change to a snapshot entry is a deliberate behavior change and is listed in
// the pull request that makes it.
//
// The eight loops:
// - OpenAI compatible, main path and o-series path (openai.ts)
// - BaseOpenAiCompatibleProvider (Z.ai, Moonshot)
// - DeepSeek, LM Studio, Qwen Code, OpenRouter, LiteLLM

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

// Model lists are fetched over HTTP; every handler falls back to its defaults.
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn(async () => ({})),
	getModelsFromCache: vi.fn(() => undefined),
}))
vi.mock("../fetchers/modelEndpointCache", () => ({
	getModelEndpoints: vi.fn(async () => ({})),
}))

import type { ApiHandler } from "../../index"
import type { ApiStreamChunk } from "../../transform/stream"
import { DeepSeekHandler } from "../deepseek"
import { LiteLLMHandler } from "../lite-llm"
import { LmStudioHandler } from "../lm-studio"
import { OpenAiHandler } from "../openai"
import { OpenRouterHandler } from "../openrouter"
import { QwenCodeHandler } from "../qwen-code"
import { ZAiHandler } from "../zai"

type RawChunk = Record<string, unknown>

// Golden sequences. Each entry is what the OpenAI SDK yields for one SSE
// `data:` line, recorded in the shapes real servers send.

const usageBlock = (completionTokens: number) => ({
	prompt_tokens: 100,
	completion_tokens: completionTokens,
	total_tokens: 100 + completionTokens,
	prompt_tokens_details: { cached_tokens: 40 },
})

const textDelta = (content: string, extra: RawChunk = {}): RawChunk => ({
	choices: [{ index: 0, delta: { content, ...extra }, finish_reason: null }],
})

const deltaChunk = (delta: RawChunk, finishReason: string | null = null): RawChunk => ({
	choices: [{ index: 0, delta, finish_reason: finishReason }],
})

const finalUsage = (usage: RawChunk): RawChunk => ({ choices: [], usage })

const SEQUENCES: Record<string, RawChunk[]> = {
	// Some servers (vLLM, llama.cpp, several gateways) repeat the cumulative
	// usage in every chunk instead of one final usage chunk.
	"usage repeated in every chunk": [
		{ ...textDelta("Hel"), usage: usageBlock(1) },
		{ ...textDelta("lo"), usage: usageBlock(2) },
		{ ...deltaChunk({}, "stop"), usage: usageBlock(3) },
	],

	// A proxy that sends a single tool call object instead of an array.
	"tool_calls not an array": [
		textDelta("Hi", {
			tool_calls: { index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } },
		}),
		deltaChunk({}, "stop"),
		finalUsage(usageBlock(5)),
	],

	// A local reasoning model (Qwen3, DeepSeek-R1 distills) writing its
	// thoughts inline, the tags split across chunks.
	"think block split across chunks": [
		textDelta("<thi"),
		textDelta("nk>Plan"),
		textDelta(" the edit.</th"),
		textDelta("ink>Done"),
		deltaChunk({}, "stop"),
		finalUsage(usageBlock(9)),
	],

	// llama.cpp, vLLM and older LM Studio answer "stop" after tool call deltas.
	// The first delta carries text and the start of the tool call together.
	"finish_reason stop after tool calls": [
		textDelta("I will read it.", {
			tool_calls: [
				{ index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "" } },
			],
		}),
		deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
		deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }),
		deltaChunk({}, "stop"),
		finalUsage(usageBlock(12)),
	],

	// DeepSeek, Z.ai, Qwen, Moonshot: reasoning in `reasoning_content`; the
	// delta that ends the thinking carries the first answer text too.
	reasoning_content: [
		deltaChunk({ role: "assistant", content: null, reasoning_content: "Let me " }),
		deltaChunk({ content: null, reasoning_content: "think." }),
		deltaChunk({ content: "The", reasoning_content: " Done." }),
		deltaChunk({ content: " answer." }),
		deltaChunk({}, "stop"),
		finalUsage(usageBlock(7)),
	],

	// OpenRouter: the plain `reasoning` text plus structured `reasoning_details`
	// (one text detail in two parts, one encrypted detail), then its billed cost.
	"OpenRouter reasoning_details": [
		deltaChunk({
			content: "",
			reasoning: "Plan",
			reasoning_details: [{ type: "reasoning.text", text: "Plan", index: 0, format: "anthropic-claude-v1" }],
		}),
		deltaChunk({
			content: "",
			reasoning: " more",
			reasoning_details: [{ type: "reasoning.text", text: " more", index: 0, signature: "sig-1" }],
		}),
		deltaChunk({
			content: "",
			reasoning_details: [{ type: "reasoning.encrypted", data: "opaque", id: "rs_1", index: 1 }],
		}),
		textDelta("Answer"),
		deltaChunk({}, "stop"),
		finalUsage({
			...usageBlock(20),
			completion_tokens_details: { reasoning_tokens: 8 },
			cost: 0.002,
			cost_details: { upstream_inference_cost: 0.001 },
		}),
	],

	// Code whose indentation token repeats: an incremental stream in which a
	// delta starts with the previous delta.
	"a delta that starts with the previous delta": [
		textDelta("if (x) {\n"),
		textDelta("  "),
		textDelta("  return 1\n"),
		textDelta("}"),
		deltaChunk({}, "stop"),
		finalUsage(usageBlock(6)),
	],

	// The stream ends (context limit, dropped connection) inside a closing tag.
	"stream ends inside a closing think tag": [textDelta("<think>Plan"), textDelta("</thi"), finalUsage(usageBlock(4))],
}

// A request that resolves like the OpenAI SDK's: a promise of the stream that
// also offers `.withResponse()` (LiteLLM reads the stream through it).
function streamOf(chunks: RawChunk[]) {
	const stream = {
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) {
				yield chunk
			}
		},
	}
	const pending = Promise.resolve(stream)
	return Object.assign(pending, {
		withResponse: async () => ({ data: stream, response: new Response(null) }),
	})
}

function chatClient(chunks: RawChunk[]) {
	return {
		apiKey: "k",
		baseURL: "https://example.invalid/v1",
		chat: { completions: { create: vi.fn(() => streamOf(chunks)) } },
	}
}

/** LM Studio counts tokens locally; the length of the text keeps the count deterministic. */
function countByLength(handler: ApiHandler) {
	vi.spyOn(handler, "countTokens").mockImplementation(async (blocks) =>
		blocks.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0),
	)
}

interface LoopCase {
	name: string
	build: (chunks: RawChunk[]) => ApiHandler
}

const LOOPS: LoopCase[] = [
	{
		name: "OpenAI compatible (main path)",
		build: (chunks) => {
			const handler = new OpenAiHandler({
				openAiApiKey: "k",
				openAiModelId: "gpt-4o",
				openAiBaseUrl: "https://api.openai.com/v1",
			})
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "OpenAI compatible (o-series path)",
		build: (chunks) => {
			const handler = new OpenAiHandler({
				openAiApiKey: "k",
				openAiModelId: "o3-mini",
				openAiBaseUrl: "https://api.openai.com/v1",
			})
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "BaseOpenAiCompatibleProvider (Z.ai)",
		build: (chunks) => {
			const handler = new ZAiHandler({ apiModelId: "glm-4.6", zaiApiKey: "k", zaiApiLine: "international_coding" })
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "DeepSeek",
		build: (chunks) => {
			const handler = new DeepSeekHandler({ apiModelId: "deepseek-chat", deepSeekApiKey: "k" })
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "LM Studio",
		build: (chunks) => {
			const handler = new LmStudioHandler({ lmStudioModelId: "local-model", lmStudioBaseUrl: "http://localhost:1234" })
			countByLength(handler)
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "Qwen Code",
		build: (chunks) => {
			const handler = new QwenCodeHandler({ apiModelId: "qwen3-coder-plus" })
			Reflect.set(handler, "credentials", {
				access_token: "t",
				refresh_token: "r",
				token_type: "Bearer",
				expiry_date: Date.now() + 3_600_000,
			})
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "OpenRouter",
		build: (chunks) => {
			const handler = new OpenRouterHandler({ openRouterApiKey: "k", openRouterModelId: "openai/gpt-4o" })
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
	{
		name: "LiteLLM",
		build: (chunks) => {
			const handler = new LiteLLMHandler({
				litellmApiKey: "k",
				litellmBaseUrl: "http://localhost:4000",
				litellmModelId: "gpt-4o",
			})
			Reflect.set(handler, "client", chatClient(chunks))
			return handler
		},
	},
]

interface Replay {
	chunks: ApiStreamChunk[]
	error?: string
	reasoningDetails?: unknown
}

async function replay(handler: ApiHandler): Promise<Replay> {
	const chunks: ApiStreamChunk[] = []
	let error: string | undefined

	try {
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "Hi" }])) {
			chunks.push(chunk)
		}
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught)
	}

	const result: Replay = { chunks }
	if (error !== undefined) {
		result.error = error
	}
	// Only OpenRouter keeps the reasoning details for the next request.
	const withDetails = handler as ApiHandler & { getReasoningDetails?: () => unknown }
	if (withDetails.getReasoningDetails) {
		result.reasoningDetails = withDetails.getReasoningDetails() ?? null
	}
	return result
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("Chat Completions stream loops (API-7 characterization)", () => {
	describe.each(LOOPS)("$name", ({ build }) => {
		it.each(Object.keys(SEQUENCES))("%s", async (sequenceName) => {
			const result = await replay(build(SEQUENCES[sequenceName]))
			expect(result).toMatchSnapshot()
		})
	})
})
