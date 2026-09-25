// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/strict-schema-characterization.spec.ts

// Characterization of the tool schemas each OpenAI-family provider sends (API-3).
//
// Three copies of the strict-schema conversion existed: BaseProvider (Chat
// Completions providers), OpenAiNativeHandler and OpenAiCodexHandler (Responses
// API). They differ: only BaseProvider strips "null" from union types, and only
// the Responses API handlers add additionalProperties: false to MCP schemas.
// The snapshots below were recorded against those three copies before they were
// replaced by one shared function, so they prove the models keep receiving the
// same schema bytes (descriptions aside, see withoutDescriptions).

import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../../shared/api"
import { BaseProvider } from "../base-provider"
import { OpenAiHandler } from "../openai"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import { getNativeTools, getMcpServerTools } from "../../../core/prompts/tools/native-tools"
import type { ApiStream } from "../../transform/stream"

class ChatCompletionsProvider extends BaseProvider {
	createMessage(): ApiStream {
		throw new Error("Not implemented")
	}

	getModel() {
		return { id: "test-model", info: { maxTokens: 4096, contextWindow: 128000, supportsPromptCache: false } }
	}

	public convertTools(tools: any[] | undefined) {
		return this.convertToolsForOpenAI(tools)
	}
}

// Drops "description" keys so a reworded tool description does not break the
// snapshots; converters never touch descriptions, they only pass them through.
const withoutDescriptions = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(withoutDescriptions)
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key !== "description")
				.map(([key, child]) => [key, withoutDescriptions(child)]),
		)
	}
	return value
}

// Raw MCP server schemas, run through the real getMcpServerTools() so they get
// the same normalization and "mcp--server--tool" names as in production.
const mcpServerTools = (): OpenAI.Chat.ChatCompletionTool[] => {
	const hub = {
		getServers: () => [
			{
				name: "github",
				tools: [
					{
						name: "get_issue",
						description: "Get an issue",
						inputSchema: {
							type: "object",
							properties: {
								owner: { type: "string" },
								repo: { type: "string" },
								number: { type: "number" },
								state: { type: ["string", "null"] },
							},
							required: ["owner", "repo", "number"],
						},
					},
					{
						name: "create_issue",
						description: "Create an issue",
						inputSchema: {
							type: "object",
							additionalProperties: true,
							properties: {
								title: { type: "string" },
								labels: {
									type: "array",
									items: {
										type: "object",
										properties: { name: { type: "string" }, color: { type: "string" } },
										required: ["name"],
									},
								},
								meta: {
									type: "object",
									properties: { milestone: { type: "number" } },
								},
							},
							required: ["title"],
						},
					},
					{ name: "get_me", description: "Who am I" },
				],
			},
		],
	}
	return getMcpServerTools(hub as any)
}

// Non-MCP tools with shapes the native tool set does not cover today (a custom
// tool, for example): nullable nested objects, nullable arrays of objects, a
// multi-type union and an explicit additionalProperties: true.
const customTools = (): OpenAI.Chat.ChatCompletionTool[] => [
	{
		type: "function",
		function: {
			name: "custom_tool",
			description: "A custom tool",
			parameters: {
				type: "object",
				additionalProperties: true,
				properties: {
					command: { type: "string" },
					cwd: { type: ["string", "null"] },
					either: { type: ["string", "number", "null"] },
					nested: {
						type: ["object", "null"],
						properties: { inner: { type: ["number", "null"] } },
					},
					plain: {
						type: "object",
						properties: { deep: { type: "object", properties: { leaf: { type: ["boolean", "null"] } } } },
					},
					list: {
						type: ["array", "null"],
						items: { type: "object", properties: { mode: { type: ["string", "null"] } } },
					},
					objects: {
						type: "array",
						items: { type: "object", properties: { id: { type: "string" } }, required: [] },
					},
				},
				required: ["command"],
			},
		},
	},
]

const allToolSets = () => ({
	native: getNativeTools(),
	nativeWithImages: getNativeTools({ supportsImages: true }),
	mcp: mcpServerTools(),
	custom: customTools(),
})

const responsesStream = () => ({
	[Symbol.asyncIterator]: async function* () {
		yield {
			type: "response.done",
			response: {
				output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
				usage: { input_tokens: 1, output_tokens: 1 },
			},
		}
	},
})

async function nativeRequestTools(tools: OpenAI.Chat.ChatCompletionTool[]) {
	let body: any
	const handler = new OpenAiNativeHandler({
		openAiNativeApiKey: "test-key",
		apiModelId: "gpt-4.1",
	} as ApiHandlerOptions)
	;(handler as any).client = {
		responses: {
			create: vi.fn().mockImplementation((requestBody: any) => {
				body = requestBody
				return responsesStream()
			}),
		},
	}
	for await (const _ of handler.createMessage("system", [], { taskId: "t", tools })) {
		// drain
	}
	return body.tools
}

async function codexRequestTools(tools: OpenAI.Chat.ChatCompletionTool[]) {
	let body: any
	const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.2-2025-12-11" })
	;(handler as any).client = {
		responses: {
			create: vi.fn().mockImplementation(async (requestBody: any) => {
				body = requestBody
				return responsesStream()
			}),
		},
	}
	for await (const _ of handler.createMessage("system", [], { taskId: "t", tools })) {
		// drain
	}
	return body.tools
}

async function openAiCompatibleRequestTools(tools: OpenAI.Chat.ChatCompletionTool[]) {
	const create = vi.fn().mockImplementation(() => ({
		[Symbol.asyncIterator]: async function* () {
			yield { choices: [{ delta: { content: "ok" } }] }
		},
	}))
	const handler = new OpenAiHandler({
		openAiApiKey: "test-key",
		openAiBaseUrl: "https://example.com/v1",
		openAiModelId: "test-model",
		openAiCustomModelInfo: { maxTokens: 4096, contextWindow: 128000 },
	} as unknown as ApiHandlerOptions)
	;(handler as any).client = { chat: { completions: { create } } }
	for await (const _ of handler.createMessage("system", [], { taskId: "t", tools })) {
		// drain
	}
	return create.mock.calls[0][0].tools
}

const pin = (value: unknown) => JSON.stringify(withoutDescriptions(value), null, 2)

describe("strict tool schema characterization (API-3)", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
	})

	describe.each(Object.keys(allToolSets()) as Array<keyof ReturnType<typeof allToolSets>>)("%s tools", (set) => {
		it("BaseProvider (Chat Completions providers) output is unchanged", () => {
			const tools = allToolSets()[set]
			const before = structuredClone(tools)

			const converted = new ChatCompletionsProvider().convertTools(tools)

			expect(tools).toEqual(before)
			expect(pin(converted)).toMatchSnapshot()
		})

		it("OpenAiNativeHandler request tools are unchanged", async () => {
			const tools = allToolSets()[set]
			const before = structuredClone(tools)

			const sent = await nativeRequestTools(tools)

			expect(tools).toEqual(before)
			expect(pin(sent)).toMatchSnapshot()
		})

		it("OpenAiCodexHandler request tools are unchanged", async () => {
			const tools = allToolSets()[set]
			const before = structuredClone(tools)

			const sent = await codexRequestTools(tools)

			expect(tools).toEqual(before)
			expect(pin(sent)).toMatchSnapshot()
		})

		it("OpenAiNativeHandler and OpenAiCodexHandler send the same schemas", async () => {
			const tools = allToolSets()[set]

			expect(await codexRequestTools(tools)).toEqual(await nativeRequestTools(tools))
		})
	})

	it("execute_command keeps cwd as [string, null] after an OpenAI-compatible request (DEF-C10)", async () => {
		const sent = await openAiCompatibleRequestTools(getNativeTools())

		const sentExecute = sent.find((tool: any) => tool.function.name === "execute_command")
		expect(sentExecute.function.parameters.properties.cwd.type).toBe("string")
		const shared = getNativeTools().find(
			(tool) => tool.type === "function" && tool.function.name === "execute_command",
		) as any
		expect(shared.function.parameters.properties.cwd.type).toEqual(["string", "null"])
	})

	it("execute_command keeps cwd as [string, null] after Responses API requests", async () => {
		const sentNative = await nativeRequestTools(getNativeTools())
		const sentCodex = await codexRequestTools(getNativeTools())

		for (const sent of [sentNative, sentCodex]) {
			const tool = sent.find((t: any) => t.name === "execute_command")
			expect(tool.parameters.properties.cwd.type).toEqual(["string", "null"])
		}
		const shared = getNativeTools().find(
			(tool) => tool.type === "function" && tool.function.name === "execute_command",
		) as any
		expect(shared.function.parameters.properties.cwd.type).toEqual(["string", "null"])
	})
})
