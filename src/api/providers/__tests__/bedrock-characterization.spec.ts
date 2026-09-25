// Characterization tests for AwsBedrockHandler.createMessage (refactor item API-18).
// They pin today's exact ConverseStream command input and the exact chunk list produced
// for a scripted Bedrock event stream, so splitting createMessage cannot change behavior.
// npx vitest run api/providers/__tests__/bedrock-characterization.spec.ts

const mockCaptureException = vi.fn()

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

vi.mock("../../../utils/logging", () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const mockSend = vi.fn()

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
		send: mockSend,
		config: { region: "us-east-1" },
	})),
	ConverseStreamCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
	ConverseCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}))

import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"
import type { ProviderSettings } from "@roo-code/types"

import { AwsBedrockHandler } from "../bedrock"
import type { ApiStreamChunk } from "../../transform/stream"

const mockCommand = vi.mocked(ConverseStreamCommand)

// Long strings make snapshots unreadable; replace them by their length.
function summarize(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length > 200 ? `<text length=${value.length}>` : value
	}
	if (Array.isArray(value)) {
		return value.map(summarize)
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, summarize(entry)]))
	}
	return value
}

async function* scripted(events: unknown[], failWith?: unknown) {
	for (const event of events) {
		yield event
	}
	if (failWith) {
		throw failWith
	}
}

async function collect(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = []
	let error: unknown
	try {
		for await (const chunk of stream) {
			chunks.push(chunk)
		}
	} catch (caught) {
		error = caught
	}
	return { chunks, error }
}

const baseSettings: ProviderSettings = {
	apiProvider: "bedrock",
	awsAccessKey: "test-access-key",
	awsSecretKey: "test-secret-key",
	awsRegion: "us-east-1",
}

const shortConversation: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Hello" },
	{ role: "assistant", content: [{ type: "text", text: "Hi, how can I help?" }] },
	{ role: "user", content: [{ type: "text", text: "Read a file" }] },
]

async function commandInputFor(
	settings: Partial<ProviderSettings>,
	options: {
		messages?: Anthropic.Messages.MessageParam[]
		systemPrompt?: string
		metadata?: Parameters<AwsBedrockHandler["createMessage"]>[2]
		handler?: AwsBedrockHandler
	} = {},
) {
	const handler = options.handler ?? new AwsBedrockHandler({ ...baseSettings, ...settings })
	mockCommand.mockClear()
	mockSend.mockResolvedValueOnce({ stream: scripted([]) })
	await collect(
		handler.createMessage(
			options.systemPrompt ?? "You are a helpful assistant.",
			options.messages ?? shortConversation,
			options.metadata,
		),
	)
	expect(mockCommand).toHaveBeenCalledTimes(1)
	return summarize(mockCommand.mock.calls[0][0])
}

describe("AwsBedrockHandler.createMessage characterization (API-18)", () => {
	beforeEach(() => {
		mockSend.mockReset()
		mockCaptureException.mockClear()
	})

	describe("ConverseStream command input", () => {
		it("plain text request", async () => {
			const input = await commandInputFor({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsUsePromptCache: false,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("non-Claude model without betas", async () => {
			const input = await commandInputFor({ apiModelId: "meta.llama3-1-70b-instruct-v1:0" })
			expect(input).toMatchInlineSnapshot(`
				{
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "meta.llama3-1-70b-instruct-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("prompt caching on, two consecutive requests of one conversation", async () => {
			const handler = new AwsBedrockHandler({
				...baseSettings,
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsUsePromptCache: true,
			})
			const long = (label: string) => `${label} ${"lorem ipsum dolor sit amet ".repeat(400)}`
			const firstTurn: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: long("first question") },
				{ role: "assistant", content: long("first answer") },
				{ role: "user", content: long("second question") },
			]
			const first = await commandInputFor({}, { handler, messages: firstTurn, systemPrompt: long("system") })
			expect(first).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "<text length=10815>",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10813>",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10816>",
				        },
				        {
				          "cachePoint": {
				            "type": "default",
				          },
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-3-7-sonnet-20250219-v1:0",
				  "system": [
				    {
				      "text": "<text length=10807>",
				    },
				    {
				      "cachePoint": {
				        "type": "default",
				      },
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)

			const secondTurn: Anthropic.Messages.MessageParam[] = [
				...firstTurn,
				{ role: "assistant", content: long("second answer") },
				{ role: "user", content: long("third question") },
			]
			const second = await commandInputFor({}, { handler, messages: secondTurn, systemPrompt: long("system") })
			expect(second).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "<text length=10815>",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10813>",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10816>",
				        },
				        {
				          "cachePoint": {
				            "type": "default",
				          },
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10814>",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "<text length=10815>",
				        },
				        {
				          "cachePoint": {
				            "type": "default",
				          },
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-3-7-sonnet-20250219-v1:0",
				  "system": [
				    {
				      "text": "<text length=10807>",
				    },
				    {
				      "cachePoint": {
				        "type": "default",
				      },
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("extended thinking with a budget (settings)", async () => {
			const input = await commandInputFor({
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsUsePromptCache: false,
				enableReasoningEffort: true,
				modelMaxTokens: 8192,
				modelMaxThinkingTokens: 4096,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				    "thinking": {
				      "budget_tokens": 4096,
				      "type": "enabled",
				    },
				  },
				  "anthropic_version": "bedrock-2023-05-31",
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 1,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-3-7-sonnet-20250219-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("extended thinking enabled through metadata", async () => {
			const input = await commandInputFor(
				{ apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0", awsUsePromptCache: false },
				{ metadata: { taskId: "t1", thinking: { enabled: true, maxThinkingTokens: 2048 } } },
			)
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				    "thinking": {
				      "budget_tokens": 2048,
				      "type": "enabled",
				    },
				  },
				  "anthropic_version": "bedrock-2023-05-31",
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-sonnet-4-20250514-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("adaptive thinking model with 1M context", async () => {
			const input = await commandInputFor({
				apiModelId: "anthropic.claude-opus-4-7",
				awsUsePromptCache: false,
				enableReasoningEffort: true,
				awsBedrock1MContext: true,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "context-1m-2025-08-07",
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				    "output_config": {
				      "effort": "xhigh",
				    },
				    "thinking": {
				      "display": "summarized",
				      "type": "adaptive",
				    },
				  },
				  "anthropic_version": "bedrock-2023-05-31",
				  "inferenceConfig": {
				    "maxTokens": 16384,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "anthropic.claude-opus-4-7",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("custom ARN (inference profile in another region)", async () => {
			const input = await commandInputFor({
				awsRegion: "us-east-1",
				awsCustomArn:
					"arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0",
				awsUsePromptCache: false,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("cross-region inference", async () => {
			const input = await commandInputFor({
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsRegion: "eu-west-1",
				awsUseCrossRegionInference: true,
				awsUsePromptCache: false,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("global inference", async () => {
			const input = await commandInputFor({
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsRegion: "eu-west-1",
				awsUseGlobalInference: true,
				awsUsePromptCache: false,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "additionalModelRequestFields": {
				    "anthropic_beta": [
				      "fine-grained-tool-streaming-2025-05-14",
				    ],
				  },
				  "inferenceConfig": {
				    "maxTokens": 8192,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("service tier on a supported model", async () => {
			const input = await commandInputFor({
				apiModelId: "amazon.nova-pro-v1:0",
				awsBedrockServiceTier: "FLEX",
				awsUsePromptCache: false,
			})
			expect(input).toMatchInlineSnapshot(`
				{
				  "inferenceConfig": {
				    "maxTokens": 5000,
				    "temperature": 0.3,
				  },
				  "messages": [
				    {
				      "content": [
				        {
				          "text": "Hello",
				        },
				      ],
				      "role": "user",
				    },
				    {
				      "content": [
				        {
				          "text": "Hi, how can I help?",
				        },
				      ],
				      "role": "assistant",
				    },
				    {
				      "content": [
				        {
				          "text": "Read a file",
				        },
				      ],
				      "role": "user",
				    },
				  ],
				  "modelId": "amazon.nova-pro-v1:0",
				  "service_tier": "FLEX",
				  "system": [
				    {
				      "text": "You are a helpful assistant.",
				    },
				  ],
				  "toolConfig": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [],
				  },
				}
			`)
		})

		it("tools and tool_choice variants", async () => {
			const tools: OpenAI.Chat.ChatCompletionTool[] = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: { path: { type: "string" }, cwd: { type: ["string", "null"] } },
							required: ["path"],
						},
					},
				},
			]
			const settings = { apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", awsUsePromptCache: false }
			const byChoice: Record<string, unknown> = {}
			for (const [label, tool_choice] of [
				["undefined", undefined],
				["none", "none"],
				["auto", "auto"],
				["required", "required"],
				["function", { type: "function", function: { name: "read_file" } }],
			] as const) {
				const input = (await commandInputFor(settings, {
					metadata: { taskId: "t1", tools, tool_choice: tool_choice as any },
				})) as { toolConfig: unknown }
				byChoice[label] = input.toolConfig
			}
			expect(byChoice).toMatchInlineSnapshot(`
				{
				  "auto": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [
				      {
				        "toolSpec": {
				          "description": "Read a file",
				          "inputSchema": {
				            "json": {
				              "additionalProperties": false,
				              "properties": {
				                "cwd": {
				                  "anyOf": [
				                    {
				                      "type": "string",
				                    },
				                    {
				                      "type": "null",
				                    },
				                  ],
				                },
				                "path": {
				                  "type": "string",
				                },
				              },
				              "required": [
				                "path",
				              ],
				              "type": "object",
				            },
				          },
				          "name": "read_file",
				        },
				      },
				    ],
				  },
				  "function": {
				    "toolChoice": {
				      "tool": {
				        "name": "read_file",
				      },
				    },
				    "tools": [
				      {
				        "toolSpec": {
				          "description": "Read a file",
				          "inputSchema": {
				            "json": {
				              "additionalProperties": false,
				              "properties": {
				                "cwd": {
				                  "anyOf": [
				                    {
				                      "type": "string",
				                    },
				                    {
				                      "type": "null",
				                    },
				                  ],
				                },
				                "path": {
				                  "type": "string",
				                },
				              },
				              "required": [
				                "path",
				              ],
				              "type": "object",
				            },
				          },
				          "name": "read_file",
				        },
				      },
				    ],
				  },
				  "none": {
				    "toolChoice": undefined,
				    "tools": [
				      {
				        "toolSpec": {
				          "description": "Read a file",
				          "inputSchema": {
				            "json": {
				              "additionalProperties": false,
				              "properties": {
				                "cwd": {
				                  "anyOf": [
				                    {
				                      "type": "string",
				                    },
				                    {
				                      "type": "null",
				                    },
				                  ],
				                },
				                "path": {
				                  "type": "string",
				                },
				              },
				              "required": [
				                "path",
				              ],
				              "type": "object",
				            },
				          },
				          "name": "read_file",
				        },
				      },
				    ],
				  },
				  "required": {
				    "toolChoice": {
				      "any": {},
				    },
				    "tools": [
				      {
				        "toolSpec": {
				          "description": "Read a file",
				          "inputSchema": {
				            "json": {
				              "additionalProperties": false,
				              "properties": {
				                "cwd": {
				                  "anyOf": [
				                    {
				                      "type": "string",
				                    },
				                    {
				                      "type": "null",
				                    },
				                  ],
				                },
				                "path": {
				                  "type": "string",
				                },
				              },
				              "required": [
				                "path",
				              ],
				              "type": "object",
				            },
				          },
				          "name": "read_file",
				        },
				      },
				    ],
				  },
				  "undefined": {
				    "toolChoice": {
				      "auto": {},
				    },
				    "tools": [
				      {
				        "toolSpec": {
				          "description": "Read a file",
				          "inputSchema": {
				            "json": {
				              "additionalProperties": false,
				              "properties": {
				                "cwd": {
				                  "anyOf": [
				                    {
				                      "type": "string",
				                    },
				                    {
				                      "type": "null",
				                    },
				                  ],
				                },
				                "path": {
				                  "type": "string",
				                },
				              },
				              "required": [
				                "path",
				              ],
				              "type": "object",
				            },
				          },
				          "name": "read_file",
				        },
				      },
				    ],
				  },
				}
			`)
		})
	})

	describe("stream event processing", () => {
		const events = [
			{ messageStart: { role: "assistant" } },
			{ contentBlockStart: { contentBlockIndex: 0, contentBlock: { reasoningContent: { text: "Thinking" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: " more" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { type: "thinking_delta", thinking: " legacy" } } },
			{ contentBlockStart: { contentBlockIndex: 1, content_block: { type: "thinking", thinking: "Alt" } } },
			{ contentBlockStart: { contentBlockIndex: 2, contentBlock: { reasoningContent: {} } } },
			{ contentBlockStart: { contentBlockIndex: 3, contentBlock: { type: "thinking" } } },
			{ contentBlockStart: { contentBlockIndex: 4, start: { text: "Answer:" } } },
			{ contentBlockDelta: { contentBlockIndex: 4, delta: { text: " forty-two" } } },
			{ contentBlockDelta: { contentBlockIndex: 4, delta: {} } },
			{ contentBlockDelta: { contentBlockIndex: 4 } },
			{
				contentBlockStart: {
					contentBlockIndex: 5,
					start: { toolUse: { toolUseId: "tool-1", name: "read_file" } },
				},
			},
			{ contentBlockDelta: { contentBlockIndex: 5, delta: { toolUse: { input: '{"path":' } } } },
			{ contentBlockDelta: { contentBlockIndex: 5, delta: { toolUse: { input: '"a.ts"}' } } } },
			{ contentBlockStart: { contentBlock: { toolUse: { toolUseId: "tool-2", name: "list_files" } } } },
			{ contentBlockDelta: { delta: { toolUse: { input: "{}" } } } },
			JSON.stringify({ contentBlockDelta: { contentBlockIndex: 6, delta: { text: "from a JSON string" } } }),
			"{not json",
			{ messageStop: { stopReason: "tool_use" } },
			{
				metadata: {
					usage: {
						inputTokens: 100,
						outputTokens: 50,
						cacheReadInputTokens: 30,
						cacheWriteInputTokens: 20,
					},
				},
			},
			{
				metadata: {
					usage: {
						inputTokens: 7,
						outputTokens: 3,
						cacheReadInputTokenCount: 5,
						cacheWriteInputTokenCount: 4,
					},
				},
			},
			{ metadata: { usage: {} } },
			{ metadata: { metrics: { latencyMs: 12 } } },
			{},
		]

		it("yields the exact chunk list for a scripted stream", async () => {
			const handler = new AwsBedrockHandler({
				...baseSettings,
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			})
			mockSend.mockResolvedValueOnce({ stream: scripted(events) })
			const { chunks, error } = await collect(handler.createMessage("system", shortConversation))
			expect(error).toBeUndefined()
			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "text": "Thinking",
				    "type": "reasoning",
				  },
				  {
				    "text": " more",
				    "type": "reasoning",
				  },
				  {
				    "text": " legacy",
				    "type": "reasoning",
				  },
				  {
				    "text": "
				",
				    "type": "reasoning",
				  },
				  {
				    "text": "Alt",
				    "type": "reasoning",
				  },
				  {
				    "text": "
				",
				    "type": "reasoning",
				  },
				  {
				    "text": "",
				    "type": "reasoning",
				  },
				  {
				    "text": "
				",
				    "type": "reasoning",
				  },
				  {
				    "text": "Answer:",
				    "type": "text",
				  },
				  {
				    "text": " forty-two",
				    "type": "text",
				  },
				  {
				    "arguments": undefined,
				    "id": "tool-1",
				    "index": 5,
				    "name": "read_file",
				    "type": "tool_call_partial",
				  },
				  {
				    "arguments": "{"path":",
				    "id": undefined,
				    "index": 5,
				    "name": undefined,
				    "type": "tool_call_partial",
				  },
				  {
				    "arguments": ""a.ts"}",
				    "id": undefined,
				    "index": 5,
				    "name": undefined,
				    "type": "tool_call_partial",
				  },
				  {
				    "arguments": undefined,
				    "id": "tool-2",
				    "index": 0,
				    "name": "list_files",
				    "type": "tool_call_partial",
				  },
				  {
				    "arguments": "{}",
				    "id": undefined,
				    "index": 0,
				    "name": undefined,
				    "type": "tool_call_partial",
				  },
				  {
				    "text": "from a JSON string",
				    "type": "text",
				  },
				  {
				    "cacheReadTokens": 30,
				    "cacheWriteTokens": 20,
				    "inputTokens": 100,
				    "outputTokens": 50,
				    "type": "usage",
				  },
				  {
				    "cacheReadTokens": 5,
				    "cacheWriteTokens": 4,
				    "inputTokens": 7,
				    "outputTokens": 3,
				    "type": "usage",
				  },
				  {
				    "cacheReadTokens": 0,
				    "cacheWriteTokens": 0,
				    "inputTokens": 0,
				    "outputTokens": 0,
				    "type": "usage",
				  },
				]
			`)
		})

		it("prompt router trace: usage chunk and cost model switch", async () => {
			const handler = new AwsBedrockHandler({
				...baseSettings,
				awsCustomArn: "arn:aws:bedrock:us-east-1:123456789:default-prompt-router/anthropic.claude:1",
			})
			mockSend.mockResolvedValueOnce({
				stream: scripted([
					{
						trace: {
							promptRouter: {
								invokedModelId:
									"arn:aws:bedrock:us-east-1:123456789:foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
								usage: {
									inputTokens: 11,
									outputTokens: 22,
									cacheReadTokens: 3,
									cacheWriteInputTokenCount: 4,
								},
							},
						},
						contentBlockDelta: { delta: { text: "ignored, trace wins" } },
					},
					{
						trace: {
							promptRouter: {
								invokedModelId:
									"arn:aws:bedrock:us-east-1:123456789:foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0",
							},
						},
					},
					{ contentBlockDelta: { delta: { text: "routed answer" } } },
					{ metadata: { usage: { inputTokens: 1, outputTokens: 2 } } },
				]),
			})
			const { chunks, error } = await collect(handler.createMessage("system", shortConversation))
			expect(error).toBeUndefined()
			expect(chunks).toMatchInlineSnapshot(`
				[
				  {
				    "cacheReadTokens": 3,
				    "cacheWriteTokens": 4,
				    "inputTokens": 11,
				    "outputTokens": 22,
				    "type": "usage",
				  },
				  {
				    "text": "routed answer",
				    "type": "text",
				  },
				  {
				    "cacheReadTokens": 0,
				    "cacheWriteTokens": 0,
				    "inputTokens": 1,
				    "outputTokens": 2,
				    "type": "usage",
				  },
				]
			`)
			const model = handler.getModel()
			expect(summarize({ id: model.id, inputPrice: model.info.inputPrice })).toMatchInlineSnapshot(`
				{
				  "id": "arn:aws:bedrock:us-east-1:123456789:default-prompt-router/anthropic.claude:1",
				  "inputPrice": 0.8,
				}
			`)
		})
	})

	describe("errors", () => {
		function throttlingError() {
			const error = new Error("Rate exceeded") as Error & Record<string, unknown>
			error.name = "ThrottlingException"
			error.$metadata = { httpStatusCode: 429, requestId: "req-1" }
			return error
		}

		async function run(send: () => void) {
			const handler = new AwsBedrockHandler({
				...baseSettings,
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			})
			send()
			const { chunks, error } = await collect(handler.createMessage("system", shortConversation))
			const err = error as Error & Record<string, unknown>
			return summarize({
				chunks,
				error: {
					name: err?.name,
					message: err?.message,
					status: err?.status,
					metadata: err?.$metadata,
				},
				telemetry: mockCaptureException.mock.calls.map(([e]) => ({
					message: e.message,
					provider: e.provider,
					modelId: e.modelId,
					operation: e.operation,
				})),
			})
		}

		it("throttling at send rethrows the original error with status and no chunks", async () => {
			const original = throttlingError()
			const handler = new AwsBedrockHandler({
				...baseSettings,
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			})
			mockSend.mockRejectedValueOnce(original)
			const { chunks, error } = await collect(handler.createMessage("system", shortConversation))
			expect(error).toBe(original)
			expect(chunks).toEqual([])
			expect((error as any).status).toBe(429)
		})

		it("throttling in the middle of the stream", async () => {
			const result = await run(() =>
				mockSend.mockResolvedValueOnce({
					stream: scripted([{ contentBlockDelta: { delta: { text: "partial" } } }], throttlingError()),
				}),
			)
			expect(result).toMatchInlineSnapshot(`
				{
				  "chunks": [
				    {
				      "text": "partial",
				      "type": "text",
				    },
				  ],
				  "error": {
				    "message": "Rate exceeded",
				    "metadata": {
				      "httpStatusCode": 429,
				      "requestId": "req-1",
				    },
				    "name": "ThrottlingException",
				    "status": 429,
				  },
				  "telemetry": [
				    {
				      "message": "Rate exceeded",
				      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				      "operation": "createMessage",
				      "provider": "Bedrock",
				    },
				  ],
				}
			`)
		})

		it("throttling detected by message only", async () => {
			const result = await run(() => mockSend.mockRejectedValueOnce(new Error("Too many requests, please wait")))
			expect(result).toMatchInlineSnapshot(`
				{
				  "chunks": [],
				  "error": {
				    "message": "Too many requests, please wait",
				    "metadata": undefined,
				    "name": "Error",
				    "status": undefined,
				  },
				  "telemetry": [
				    {
				      "message": "Too many requests, please wait",
				      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				      "operation": "createMessage",
				      "provider": "Bedrock",
				    },
				  ],
				}
			`)
		})

		it("non-Error throttling-free rejection", async () => {
			const result = await run(() => mockSend.mockRejectedValueOnce("plain string failure"))
			expect(result).toMatchInlineSnapshot(`
				{
				  "chunks": [
				    {
				      "text": "Error: Unknown Error: {errorMessage}",
				      "type": "text",
				    },
				    {
				      "inputTokens": 0,
				      "outputTokens": 0,
				      "type": "usage",
				    },
				  ],
				  "error": {
				    "message": "An unknown error occurred",
				    "metadata": undefined,
				    "name": "Error",
				    "status": undefined,
				  },
				  "telemetry": [
				    {
				      "message": "plain string failure",
				      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				      "operation": "createMessage",
				      "provider": "Bedrock",
				    },
				  ],
				}
			`)
		})

		it("validation error yields error chunks then throws the enhanced error", async () => {
			const result = await run(() => {
				const error = new Error("Malformed input request: field required") as Error & Record<string, unknown>
				error.name = "ValidationException"
				error.$metadata = { httpStatusCode: 400, requestId: "req-2" }
				mockSend.mockRejectedValueOnce(error)
			})
			expect(result).toMatchInlineSnapshot(`
				{
				  "chunks": [
				    {
				      "text": "Error: Unknown Error: Malformed input request: field required",
				      "type": "text",
				    },
				    {
				      "inputTokens": 0,
				      "outputTokens": 0,
				      "type": "usage",
				    },
				  ],
				  "error": {
				    "message": "Unknown Error: Malformed input request: field required",
				    "metadata": {
				      "httpStatusCode": 400,
				      "requestId": "req-2",
				    },
				    "name": "ValidationException",
				    "status": 400,
				  },
				  "telemetry": [
				    {
				      "message": "Malformed input request: field required",
				      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				      "operation": "createMessage",
				      "provider": "Bedrock",
				    },
				  ],
				}
			`)
		})

		it("missing stream", async () => {
			const result = await run(() => mockSend.mockResolvedValueOnce({}))
			expect(result).toMatchInlineSnapshot(`
				{
				  "chunks": [
				    {
				      "text": "Error: Unknown Error: No stream available in the response",
				      "type": "text",
				    },
				    {
				      "inputTokens": 0,
				      "outputTokens": 0,
				      "type": "usage",
				    },
				  ],
				  "error": {
				    "message": "Unknown Error: No stream available in the response",
				    "metadata": undefined,
				    "name": "Error",
				    "status": undefined,
				  },
				  "telemetry": [
				    {
				      "message": "No stream available in the response",
				      "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
				      "operation": "createMessage",
				      "provider": "Bedrock",
				    },
				  ],
				}
			`)
		})
	})
})
