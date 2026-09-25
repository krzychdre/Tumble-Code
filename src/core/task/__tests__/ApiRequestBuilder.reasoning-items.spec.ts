// cd src && ./node_modules/.bin/vitest run core/task/__tests__/ApiRequestBuilder.reasoning-items.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"
import type { ApiMessage } from "../../task-persistence"
import type { ApiHandler } from "../../../api"
import { OpenAiNativeHandler } from "../../../api/providers/openai-native"
import { OpenAiCodexHandler } from "../../../api/providers/openai-codex"
import { XAIHandler } from "../../../api/providers/xai"
import { AnthropicHandler } from "../../../api/providers/anthropic"
import { OpenAiHandler } from "../../../api/providers/openai"
import { AwsBedrockHandler } from "../../../api/providers/bedrock"
import { toResponsesApiInput } from "../../../api/providers/responses-api/request"
import { convertToResponsesApiInput } from "../../../api/transform/responses-api-input"
import { filterNonAnthropicBlocks } from "../../../api/transform/anthropic-filter"
import { convertToOpenAiMessages } from "../../../api/transform/openai-format"
import { convertToBedrockConverseMessages } from "../../../api/transform/bedrock-converse-format"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: vi.fn() } },
}))

/**
 * DEF-C46. A task can switch modes, and every mode can use another provider. OpenAI Native
 * and Codex turns are stored with their encrypted reasoning (OpenAI ciphertext) as the first
 * assistant block, and the request builder sends it back as a standalone
 * `{ type: "reasoning", encrypted_content }` item. Only the handlers that returned such an
 * item can read it back; every other provider must get the history without it (xAI failed
 * with "message.content is not iterable", Anthropic and Bedrock with similar TypeErrors).
 * The stored history itself stays as it is, so switching back to OpenAI sends it again.
 */

// An OpenAI Native turn as TaskHistory stores it (buildEncryptedReasoningBlock), plus the
// older stored form: a standalone reasoning entry between the messages.
function openAiHistory(): ApiMessage[] {
	return [
		{ role: "user", content: "Read a.ts", ts: 1 },
		{
			role: "assistant",
			content: [
				{ type: "reasoning", summary: [], encrypted_content: "enc_openai_1", id: "rs_1" } as any,
				{ type: "text", text: "It exports one function." },
			],
			ts: 2,
		},
		{ role: "user", content: "And b.ts?", ts: 3 },
		{ type: "reasoning", encrypted_content: "enc_openai_2", id: "rs_2", summary: [] } as any,
		{ role: "assistant", content: "It is empty.", ts: 4 },
		{ role: "user", content: "Thanks", ts: 5 },
	]
}

// An xAI turn as TaskHistory stores it: plain reasoning text (buildReasoningBlock), xAI's own
// encrypted reasoning is never stored.
function xaiHistory(): ApiMessage[] {
	return [
		{ role: "user", content: "Read a.ts", ts: 1 },
		{
			role: "assistant",
			content: [
				{ type: "reasoning", text: "Let me look.", summary: [] } as any,
				{ type: "text", text: "It exports one function." },
			],
			ts: 2,
		},
		{ role: "user", content: "Thanks", ts: 3 },
	]
}

function build(api: ApiHandler, messages: ApiMessage[]): Anthropic.Messages.MessageParam[] {
	const access = { api, microcompactedToolUseIds: new Set<string>() } as unknown as ApiRequestBuilderAccess
	return new ApiRequestBuilder(access).buildCleanConversationHistory(
		messages,
		api.getModel().info.preserveReasoning === true,
	) as unknown as Anthropic.Messages.MessageParam[]
}

const reasoningItems = (messages: unknown[]) => messages.filter((message: any) => message.type === "reasoning")

const handlers = {
	openAiNative: () => new OpenAiNativeHandler({ openAiNativeApiKey: "k", apiModelId: "gpt-5.4" }),
	openAiCodex: () => new OpenAiCodexHandler({ apiModelId: "gpt-5.4" }),
	xai: () => new XAIHandler({ xaiApiKey: "k", apiModelId: "grok-4.6" }),
	anthropic: () => new AnthropicHandler({ apiKey: "k", apiModelId: "claude-sonnet-4-5" }),
	openAiCompatible: () => new OpenAiHandler({ openAiApiKey: "k", openAiModelId: "some-model" }),
	bedrock: () =>
		new AwsBedrockHandler({
			awsAccessKey: "k",
			awsSecretKey: "s",
			awsRegion: "us-east-1",
			apiModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		}),
}

describe("ApiRequestBuilder encrypted reasoning items across providers (DEF-C46)", () => {
	it.each(["openAiNative", "openAiCodex"] as const)("%s gets the OpenAI encrypted reasoning back", (name) => {
		const clean = build(handlers[name](), openAiHistory())

		expect(reasoningItems(clean)).toEqual([
			{ type: "reasoning", summary: [], encrypted_content: "enc_openai_1", id: "rs_1" },
			{ type: "reasoning", summary: [], encrypted_content: "enc_openai_2", id: "rs_2" },
		])
		expect(() => toResponsesApiInput(clean)).not.toThrow()
	})

	it.each(["xai", "anthropic", "openAiCompatible", "bedrock"] as const)(
		"%s gets the history without the OpenAI encrypted reasoning",
		(name) => {
			const stored = openAiHistory()
			const clean = build(handlers[name](), stored)

			expect(reasoningItems(clean)).toEqual([])
			expect(clean).toEqual([
				{ role: "user", content: "Read a.ts" },
				{ role: "assistant", content: "It exports one function." },
				{ role: "user", content: "And b.ts?" },
				{ role: "assistant", content: "It is empty." },
				{ role: "user", content: "Thanks" },
			])
			// Recomputed per request: the stored history keeps the items for a later OpenAI mode.
			expect(stored).toEqual(openAiHistory())
		},
	)

	it("every converter reads the history built for its provider after a switch from OpenAI", () => {
		expect(() => convertToResponsesApiInput(build(handlers.xai(), openAiHistory()))).not.toThrow()
		expect(() => filterNonAnthropicBlocks(build(handlers.anthropic(), openAiHistory()))).not.toThrow()
		expect(() => convertToOpenAiMessages(build(handlers.openAiCompatible(), openAiHistory()))).not.toThrow()
		expect(() => convertToBedrockConverseMessages(build(handlers.bedrock(), openAiHistory()))).not.toThrow()
	})

	it("switching back to OpenAI Native after an xAI mode sends the stored OpenAI reasoning again", () => {
		const stored = openAiHistory()
		build(handlers.xai(), stored)

		expect(reasoningItems(build(handlers.openAiNative(), stored))).toHaveLength(2)
	})

	it("an xAI turn followed by an OpenAI Native mode carries no standalone reasoning item", () => {
		const clean = build(handlers.openAiNative(), xaiHistory())

		expect(reasoningItems(clean)).toEqual([])
		expect(clean).toEqual([
			{ role: "user", content: "Read a.ts" },
			{ role: "assistant", content: "It exports one function." },
			{ role: "user", content: "Thanks" },
		])
		expect(() => toResponsesApiInput(clean)).not.toThrow()
	})
})
