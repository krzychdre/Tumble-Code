// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/error-contract.spec.ts

// API-1: one error-normalization contract for every provider handler.
//
// The task retry loop (RetryHandler: 429 RetryInfo), the chat error row and the
// background-model fallback (BackgroundModelHandler.isFallbackTriggerError) all
// decide on the HTTP status of the error a handler throws. A handler that
// re-wraps the SDK error in `new Error(message)` drops that status, so for
// example a background compaction model on LM Studio or LiteLLM could never
// fall back to the foreground model on a 400 (payload too large for a small
// local model) or a 429.
//
// Each case below builds the REAL handler, hands it a client whose request
// rejects with the error the provider's own SDK throws for that status (the
// real SDK error class where the SDK exports one), and pins, for both
// `createMessage` and `completePromptWithUsage`:
// - the thrown error still carries the HTTP status as `.status`,
// - isFallbackTriggerError accepts it (429, 400 and 401 are all triggers),
// - the message is not prefixed twice ("X completion error: X completion error: ...").
//
// Not in the table: VS Code LM (the VS Code API reports no HTTP status) and
// fake-ai (test double).

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

// Model lists are fetched over HTTP; the error path does not need them.
vi.mock("../fetchers/modelCache", () => ({
	getModels: vi.fn(async () => ({})),
	getModelsFromCache: vi.fn(() => undefined),
}))
vi.mock("../fetchers/modelEndpointCache", () => ({
	getModelEndpoints: vi.fn(async () => ({})),
}))
vi.mock("../fetchers/ollama", () => ({
	getOllamaModels: vi.fn(async () => ({})),
}))

// The real AnthropicVertex constructor starts a Google credential lookup.
vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vi.fn().mockImplementation(function () {
		return { messages: { create: vi.fn() } }
	}),
}))

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiError as GoogleApiError } from "@google/genai"
import { SDKError as MistralSDKError } from "@mistralai/mistralai/models/errors"
import { BedrockRuntimeServiceException } from "@aws-sdk/client-bedrock-runtime"

import type { ApiHandler, SingleCompletionHandler } from "../../index"
import { isFallbackTriggerError } from "../../BackgroundModelHandler"
import { AnthropicHandler } from "../anthropic"
import { AnthropicVertexHandler } from "../anthropic-vertex"
import { AwsBedrockHandler } from "../bedrock"
import { DeepSeekHandler } from "../deepseek"
import { GeminiHandler } from "../gemini"
import { LiteLLMHandler } from "../lite-llm"
import { LmStudioHandler } from "../lm-studio"
import { MiniMaxHandler } from "../minimax"
import { MistralHandler } from "../mistral"
import { MoonshotHandler } from "../moonshot"
import { NativeOllamaHandler } from "../native-ollama"
import { OpenAiHandler } from "../openai"
import { OpenAiCodexHandler } from "../openai-codex"
import { OpenAiNativeHandler } from "../openai-native"
import { OpenRouterHandler } from "../openrouter"
import { QwenCodeHandler } from "../qwen-code"
import { XAIHandler } from "../xai"
import { ZAiHandler } from "../zai"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"

type Handler = ApiHandler & SingleCompletionHandler
type Reject = () => Promise<never>

const STATUSES = [429, 400, 401] as const

// SDK error surfaces, one per SDK family.

function openAiSdkError(status: number): Error {
	return OpenAI.APIError.generate(status, { error: { message: `upstream says ${status}` } }, undefined, new Headers())
}

function anthropicSdkError(status: number): Error {
	return Anthropic.APIError.generate(
		status,
		{ type: "error", error: { type: "api_error", message: `upstream says ${status}` } },
		undefined,
		new Headers(),
	)
}

function geminiSdkError(status: number): Error {
	return new GoogleApiError({ message: `upstream says ${status}`, status })
}

/**
 * The Mistral SDK reports the status as `statusCode`. SDK 2.x takes the HTTP
 * metadata as one object (1.x took the response and the body positionally).
 */
function mistralSdkError(status: number): Error {
	return new MistralSDKError(`upstream says ${status}`, {
		response: new Response("", { status }),
		request: new Request("https://api.mistral.ai/v1/chat/completions"),
		body: "",
	})
}

/** The ollama package's ResponseError (not exported) carries the status as `status_code`. */
function ollamaSdkError(status: number): Error {
	return Object.assign(new Error(`upstream says ${status}`), {
		name: "ResponseError",
		error: `upstream says ${status}`,
		status_code: status,
	})
}

/** AWS SDK v3 errors carry the status in `$metadata.httpStatusCode`. */
function bedrockSdkError(status: number): Error {
	const name =
		status === 429 ? "ThrottlingException" : status === 400 ? "ValidationException" : "UnrecognizedClientException"
	return new BedrockRuntimeServiceException({
		name,
		$fault: "client",
		$metadata: { httpStatusCode: status },
		message: `upstream says ${status}`,
	})
}

/** What the Responses API endpoint answers when the SDK path fails and the handler falls back to fetch. */
function stubResponsesFetch(status: number) {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: `upstream says ${status}` } }), {
					status,
					headers: { "content-type": "application/json" },
				}),
		),
	)
}

/**
 * A request that fails like the SDK's: a rejected promise that also offers the
 * OpenAI SDK's `.withResponse()` (LiteLLM reads the response headers through it).
 */
function rejectWith(error: Error): Reject {
	return () => {
		const failed = Promise.reject(error)
		failed.catch(() => {})
		return Object.assign(failed, { withResponse: () => failed })
	}
}

function chatClient(reject: Reject) {
	return { apiKey: "k", baseURL: "https://example.invalid", chat: { completions: { create: vi.fn(reject) } } }
}

interface HandlerCase {
	name: string
	build: (status: number) => Handler
}

const cases: HandlerCase[] = [
	{
		name: "OpenAI compatible (openai)",
		build: (status) => {
			const handler = new OpenAiHandler({
				openAiApiKey: "k",
				openAiModelId: "gpt-4o",
				openAiBaseUrl: "https://api.openai.com/v1",
			})
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "DeepSeek",
		build: (status) => {
			const handler = new DeepSeekHandler({ apiModelId: "deepseek-chat", deepSeekApiKey: "k" })
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "Z.ai (BaseOpenAiCompatibleProvider)",
		build: (status) => {
			const handler = new ZAiHandler({
				apiModelId: "glm-4.6",
				zaiApiKey: "k",
				zaiApiLine: "international_coding",
			})
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		// Own createStream and completePromptWithUsage on the OpenAI-compatible base (API-4).
		name: "Moonshot",
		build: (status) => {
			const handler = new MoonshotHandler({ apiModelId: "kimi-k2-0905-preview", moonshotApiKey: "k" })
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "xAI",
		build: (status) => {
			const handler = new XAIHandler({ apiModelId: "grok-4", xaiApiKey: "k" })
			Reflect.set(handler, "client", { responses: { create: vi.fn(rejectWith(openAiSdkError(status))) } })
			return handler
		},
	},
	{
		name: "OpenRouter",
		build: (status) => {
			const handler = new OpenRouterHandler({ openRouterApiKey: "k", openRouterModelId: "openai/gpt-4o" })
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "LiteLLM",
		build: (status) => {
			const handler = new LiteLLMHandler({
				litellmApiKey: "k",
				litellmBaseUrl: "http://localhost:4000",
				litellmModelId: "gpt-4o",
			})
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "LM Studio",
		build: (status) => {
			const handler = new LmStudioHandler({
				lmStudioModelId: "local-model",
				lmStudioBaseUrl: "http://localhost:1234",
			})
			vi.spyOn(handler, "countTokens").mockResolvedValue(0)
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "Qwen Code",
		build: (status) => {
			const handler = new QwenCodeHandler({ apiModelId: "qwen3-coder-plus" })
			const credentials = {
				access_token: "t",
				refresh_token: "r",
				token_type: "Bearer",
				expiry_date: Date.now() + 3_600_000,
			}
			Reflect.set(handler, "credentials", credentials)
			// A 401 refreshes the token once and repeats the request.
			vi.spyOn(handler as any, "refreshAccessToken").mockResolvedValue(credentials)
			Reflect.set(handler, "client", chatClient(rejectWith(openAiSdkError(status))))
			return handler
		},
	},
	{
		name: "OpenAI native (Responses API)",
		build: (status) => {
			const handler = new OpenAiNativeHandler({ apiModelId: "gpt-4.1", openAiNativeApiKey: "k" })
			Reflect.set(handler, "client", { responses: { create: vi.fn(rejectWith(openAiSdkError(status))) } })
			// A failed SDK stream falls back to a plain fetch of the same endpoint.
			stubResponsesFetch(status)
			return handler
		},
	},
	{
		name: "OpenAI Codex (ChatGPT subscription)",
		build: (status) => {
			const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
			vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
			vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")
			// An auth failure refreshes the token once and repeats the request.
			vi.spyOn(openAiCodexOAuthManager, "forceRefreshAccessToken").mockResolvedValue("test-token-2")
			Reflect.set(handler, "client", { responses: { create: vi.fn(rejectWith(openAiSdkError(status))) } })
			stubResponsesFetch(status)
			return handler
		},
	},
	{
		name: "Anthropic",
		build: (status) => {
			const handler = new AnthropicHandler({ apiKey: "k", apiModelId: "claude-sonnet-4-5" })
			Reflect.set(handler, "client", { messages: { create: vi.fn(rejectWith(anthropicSdkError(status))) } })
			return handler
		},
	},
	{
		name: "MiniMax",
		build: (status) => {
			const handler = new MiniMaxHandler({ minimaxApiKey: "k", apiModelId: "MiniMax-M2" })
			Reflect.set(handler, "client", { messages: { create: vi.fn(rejectWith(anthropicSdkError(status))) } })
			return handler
		},
	},
	{
		name: "Anthropic on Vertex",
		build: (status) => {
			const handler = new AnthropicVertexHandler({
				vertexProjectId: "p",
				vertexRegion: "us-east5",
				apiModelId: "claude-sonnet-4-5@20250929",
			})
			Reflect.set(handler, "client", { messages: { create: vi.fn(rejectWith(anthropicSdkError(status))) } })
			return handler
		},
	},
	{
		name: "Gemini",
		build: (status) => {
			const handler = new GeminiHandler({ geminiApiKey: "k", apiModelId: "gemini-2.5-flash" })
			const reject = rejectWith(geminiSdkError(status))
			Reflect.set(handler, "client", {
				models: { generateContentStream: vi.fn(reject), generateContent: vi.fn(reject) },
			})
			return handler
		},
	},
	{
		name: "Mistral",
		build: (status) => {
			const handler = new MistralHandler({ mistralApiKey: "k", apiModelId: "codestral-latest" })
			const reject = rejectWith(mistralSdkError(status))
			Reflect.set(handler, "client", { chat: { stream: vi.fn(reject), complete: vi.fn(reject) } })
			return handler
		},
	},
	{
		name: "Ollama",
		build: (status) => {
			const handler = new NativeOllamaHandler({
				ollamaModelId: "llama3.1",
				ollamaBaseUrl: "http://localhost:11434",
			})
			Reflect.set(handler, "client", { chat: vi.fn(rejectWith(ollamaSdkError(status))) })
			return handler
		},
	},
	{
		name: "Amazon Bedrock",
		build: (status) => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				awsAccessKey: "a",
				awsSecretKey: "s",
				awsRegion: "us-east-1",
			})
			Reflect.set(handler, "client", { send: vi.fn(rejectWith(bedrockSdkError(status))) })
			return handler
		},
	},
]

async function errorFromStream(handler: Handler): Promise<any> {
	try {
		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "Hi" }])) {
			// Bedrock yields its error text as chunks before throwing; keep draining.
		}
	} catch (error) {
		return error
	}
	throw new Error("createMessage was expected to throw")
}

async function errorFromCompletion(handler: Handler): Promise<any> {
	try {
		await handler.completePromptWithUsage!("a prompt")
	} catch (error) {
		return error
	}
	throw new Error("completePromptWithUsage was expected to throw")
}

/** "X completion error: X completion error: ..." is a message wrapped by two layers of the same handler. */
function expectNotDoublePrefixed(message: string) {
	expect(message).not.toMatch(/completion error: .*completion error:/)
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("provider error contract (API-1)", () => {
	describe.each(cases)("$name", ({ build }) => {
		it.each(STATUSES)(
			"createMessage keeps HTTP %i as .status and triggers the background fallback",
			async (status) => {
				const error = await errorFromStream(build(status))

				expect(error).toBeInstanceOf(Error)
				// The message rides along so a failure shows which layer produced the error.
				expect(error.status, error.message).toBe(status)
				expect(isFallbackTriggerError(error)).toBe(true)
				expectNotDoublePrefixed(error.message)
			},
		)

		it.each(STATUSES)(
			"completePromptWithUsage keeps HTTP %i as .status and triggers the background fallback",
			async (status) => {
				const error = await errorFromCompletion(build(status))

				expect(error).toBeInstanceOf(Error)
				expect(error.status, error.message).toBe(status)
				expect(isFallbackTriggerError(error)).toBe(true)
				expectNotDoublePrefixed(error.message)
			},
		)
	})
})
