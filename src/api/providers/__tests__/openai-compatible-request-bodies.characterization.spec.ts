// Pins the request bodies the OpenAI-compatible handlers send (stream and one-shot), as they
// reach the wire, so the shared base can be refactored without changing what a provider sends.

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import { BaseOpenAiCompatibleProvider } from "../base-openai-compatible-provider"
import { MoonshotHandler } from "../moonshot"
import { ZAiHandler } from "../zai"
import { DeepSeekHandler } from "../deepseek"

vi.mock("openai", () => {
	const create = vi.fn(async (params: { stream?: boolean }) => {
		if (!params.stream) {
			return { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }
		}
		return (async function* () {
			yield { choices: [{ delta: { content: "hi" }, index: 0 }] }
			yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }
		})()
	})
	const client = vi.fn(function () {
		return { chat: { completions: { create } } }
	})
	return { __esModule: true, default: client, OpenAI: client, AzureOpenAI: client }
})

class TestCompatibleProvider extends BaseOpenAiCompatibleProvider<"plain" | "binary"> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Test",
			baseURL: "https://test.example/v1",
			apiKey: "key",
			defaultProviderModelId: "plain",
			providerModels: {
				plain: { maxTokens: 4096, contextWindow: 32_000, supportsPromptCache: false },
				binary: {
					maxTokens: 8192,
					contextWindow: 64_000,
					supportsPromptCache: false,
					supportsReasoningBinary: true,
					defaultTemperature: 0.6,
				},
			},
			defaultTemperature: 0.3,
		})
	}
}

const messages: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "first question" },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "let me look" },
			{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } },
		],
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: "call_1", content: "file body" },
			{ type: "text", text: "<environment_details>x</environment_details>" },
		],
	},
]

const tools = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file",
			parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		},
	},
]

type Handler = {
	createMessage: (s: string, m: Anthropic.Messages.MessageParam[], meta?: any) => AsyncIterable<unknown>
	completePrompt: (prompt: string) => Promise<string>
}

function lastCall() {
	const create = (OpenAI as unknown as () => any)().chat.completions.create
	const [params, options] = create.mock.calls.at(-1)
	return {
		body: JSON.parse(JSON.stringify(params)),
		requestOptions: Object.keys(options ?? {}).sort(),
		path: options?.path,
	}
}

async function streamBody(handler: Handler, metadata: Record<string, unknown> = {}) {
	for await (const _chunk of handler.createMessage("system prompt", messages, { taskId: "t", tools, ...metadata })) {
		// drain
	}
	return lastCall()
}

async function completionBody(handler: Handler) {
	await handler.completePrompt("one shot")
	return lastCall()
}

const CASES: Array<[string, () => Handler, Record<string, unknown>?]> = [
	["base, plain model", () => new TestCompatibleProvider({ apiModelId: "plain" })],
	[
		"base, binary reasoning on, user temperature, no parallel tools",
		() => new TestCompatibleProvider({ apiModelId: "binary", enableReasoningEffort: true, modelTemperature: 0.9 }),
		{ parallelToolCalls: false, tool_choice: "required" },
	],
	["base, binary reasoning off", () => new TestCompatibleProvider({ apiModelId: "binary" })],
	["moonshot kimi-k2.5", () => new MoonshotHandler({ moonshotApiKey: "k", apiModelId: "kimi-k2.5" })],
	[
		"moonshot kimi-k2-0905-preview, user temperature and max tokens",
		() =>
			new MoonshotHandler({
				moonshotApiKey: "k",
				apiModelId: "kimi-k2-0905-preview",
				modelTemperature: 0.5,
				modelMaxTokens: 1000,
				enableReasoningEffort: true,
			}),
	],
	["moonshot unknown model", () => new MoonshotHandler({ moonshotApiKey: "k", apiModelId: "kimi-custom" })],
	[
		"zai glm-4.6 (no thinking toggle), reasoning on",
		() =>
			new ZAiHandler({
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
				apiModelId: "glm-4.6",
				enableReasoningEffort: true,
			}),
	],
	[
		"zai glm-5 default",
		() => new ZAiHandler({ zaiApiKey: "k", zaiApiLine: "international_coding", apiModelId: "glm-5" }),
	],
	[
		"zai glm-5 reasoning off, user temperature",
		() =>
			new ZAiHandler({
				zaiApiKey: "k",
				zaiApiLine: "china_api",
				apiModelId: "glm-5",
				enableReasoningEffort: false,
				modelTemperature: 0.2,
			}),
	],
	[
		"zai glm-5.3 reasoning off (cannot disable)",
		() =>
			new ZAiHandler({
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
				apiModelId: "glm-5.3",
				enableReasoningEffort: false,
			}),
	],
	[
		"zai glm-5.2 effort max, max tokens override",
		() =>
			new ZAiHandler({
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
				apiModelId: "glm-5.2",
				reasoningEffort: "max",
				modelMaxTokens: 50_000,
			}),
		{ parallelToolCalls: false },
	],
	[
		"deepseek-flash default (thinking)",
		() => new DeepSeekHandler({ deepSeekApiKey: "k", apiModelId: "deepseek-flash" }),
	],
	[
		"deepseek-flash thinking off",
		() => new DeepSeekHandler({ deepSeekApiKey: "k", apiModelId: "deepseek-flash", enableReasoningEffort: false }),
	],
	[
		"deepseek-chat via Azure AI Inference",
		() =>
			new DeepSeekHandler({
				deepSeekApiKey: "k",
				apiModelId: "deepseek-chat",
				deepSeekBaseUrl: "https://my.services.ai.azure.com/models",
				modelMaxTokens: 2000,
			}),
	],
	[
		"deepseek-reasoner effort xhigh",
		() => new DeepSeekHandler({ deepSeekApiKey: "k", apiModelId: "deepseek-reasoner", reasoningEffort: "xhigh" }),
	],
]

describe("OpenAI-compatible request bodies (characterization)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each(CASES)("%s: stream request", async (_name, make, metadata) => {
		expect(await streamBody(make(), metadata)).toMatchSnapshot()
	})

	it.each(CASES)("%s: one-shot request", async (_name, make) => {
		expect(await completionBody(make())).toMatchSnapshot()
	})
})
