// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/zai.spec.ts
// The base class (client, sampling params, cancellation) has its own spec. This spec covers
// what ZAiHandler adds: the API line, the GLM thinking switch with the reasoning effort, and
// the R1 message format of the thinking models.

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("openai", async () => {
	const { openAiModuleMock } = await import("./provider-test-helpers")
	return openAiModuleMock(mocks.create)
})

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions } from "@tumble-code/core/browser"
import {
	ZAI_DEFAULT_TEMPERATURE,
	internationalZAiDefaultModelId,
	internationalZAiModels,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
} from "@tumble-code/types"

import { ZAiHandler, resolveZAiModel } from "../zai"
import { defaultOpenAiCreate } from "./provider-test-helpers"

function handlerFor(options: Partial<ApiHandlerOptions> = {}) {
	return new ZAiHandler({ zaiApiKey: "test-zai-api-key", zaiApiLine: "international_coding", ...options })
}

async function requestOf(options: Partial<ApiHandlerOptions>, messages: Anthropic.Messages.MessageParam[] = []) {
	for await (const _chunk of handlerFor(options).createMessage("system prompt", messages)) {
		// drain
	}
	return mocks.create.mock.calls.at(-1)![0]
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.create.mockImplementation(defaultOpenAiCreate)
})

describe("API line", () => {
	it.each([
		[
			"international_coding",
			"https://api.z.ai/api/coding/paas/v4",
			internationalZAiModels,
			internationalZAiDefaultModelId,
		],
		["china_coding", "https://open.bigmodel.cn/api/coding/paas/v4", mainlandZAiModels, mainlandZAiDefaultModelId],
		["international_api", "https://api.z.ai/api/paas/v4", internationalZAiModels, internationalZAiDefaultModelId],
		["china_api", "https://open.bigmodel.cn/api/paas/v4", mainlandZAiModels, mainlandZAiDefaultModelId],
		[undefined, "https://api.z.ai/api/coding/paas/v4", internationalZAiModels, internationalZAiDefaultModelId],
	] as const)("%s uses its base URL and model table", (zaiApiLine, baseURL, models, defaultId) => {
		const handler = handlerFor({ zaiApiLine, apiModelId: "glm-4.6" })
		expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toMatchObject({ baseURL, apiKey: "test-zai-api-key" })
		expect(handler.getModel().info).toEqual(models["glm-4.6"])
		expect(handlerFor({ zaiApiLine }).getModel().id).toBe(defaultId)
	})

	it("sends a placeholder key when none is set", () => {
		new ZAiHandler({})
		expect(vi.mocked(OpenAI).mock.calls.at(-1)![0]).toMatchObject({ apiKey: "not-provided" })
	})

	it("reports the same model without building a handler", () => {
		const options = { zaiApiLine: "china_coding" as const, apiModelId: "glm-4.7" }
		expect(resolveZAiModel(options)).toEqual(handlerFor(options).getModel())
	})
})

describe("request", () => {
	it("sends the Z.ai default temperature and the 20% output cap", async () => {
		const body = await requestOf({ apiModelId: "glm-5.1" })
		expect(body).toMatchObject({ model: "glm-5.1", temperature: ZAI_DEFAULT_TEMPERATURE, max_tokens: 40_000 })
	})

	// The override is a profile setting, so it survives a switch to another model; the request
	// uses the same capped value the task reserves.
	it.each([
		["glm-5.3", 200_000, 131_072],
		["glm-4-32b-0414-128k", 131_072, 16_384],
		["glm-4.6v", 131_072, 32_768],
	])("caps a stale max tokens override for %s (DEF-C22)", async (apiModelId, modelMaxTokens, expected) => {
		expect((await requestOf({ apiModelId, modelMaxTokens })).max_tokens).toBe(expected)
	})

	it("honors an explicit max tokens override above the 20% clamp", async () => {
		expect((await requestOf({ apiModelId: "glm-5.1", modelMaxTokens: 100_000 })).max_tokens).toBe(100_000)
	})
})

describe("thinking and reasoning effort", () => {
	it.each([
		["GLM-4.7 by default", "glm-4.7", {}, "enabled", "medium"],
		[
			"GLM-4.7 with an effort it does not offer",
			"glm-4.7",
			{ enableReasoningEffort: true, reasoningEffort: "high" },
			"enabled",
			"medium",
		],
		[
			"GLM-4.7 with effort disable",
			"glm-4.7",
			{ enableReasoningEffort: true, reasoningEffort: "disable" },
			"disabled",
			undefined,
		],
		["GLM-4.7 with reasoning off", "glm-4.7", { enableReasoningEffort: false }, "disabled", undefined],
		["GLM-5.2 by default", "glm-5.2", {}, "enabled", "high"],
		["GLM-5.2 at max", "glm-5.2", { enableReasoningEffort: true, reasoningEffort: "max" }, "enabled", "max"],
		[
			"GLM-5.2 with an effort it does not offer",
			"glm-5.2",
			{ enableReasoningEffort: true, reasoningEffort: "medium" },
			"enabled",
			"high",
		],
		// GLM-5.3 cannot turn reasoning off: the API rejects thinking "disabled".
		["GLM-5.3 by default", "glm-5.3", {}, "enabled", "max"],
		["GLM-5.3 with reasoning off", "glm-5.3", { enableReasoningEffort: false }, "enabled", "max"],
		["GLM-5.3 with a stale disable", "glm-5.3", { reasoningEffort: "disable" }, "enabled", "max"],
		["GLM-5.3 with an effort it does not offer", "glm-5.3", { reasoningEffort: "medium" }, "enabled", "max"],
		["GLM-5.3 with a chosen effort", "glm-5.3", { reasoningEffort: "low" }, "enabled", "low"],
	])("%s", async (_label, apiModelId, options, thinking, effort) => {
		const body = await requestOf({ apiModelId, ...options } as Partial<ApiHandlerOptions>)
		expect(body.thinking).toEqual({ type: thinking })
		expect(body.reasoning_effort).toBe(effort)
	})

	it("sends no thinking switch for a model without effort levels", async () => {
		const body = await requestOf({ apiModelId: "glm-4.6", enableReasoningEffort: true })
		expect(body).not.toHaveProperty("thinking")
		expect(body).not.toHaveProperty("reasoning_effort")
	})
})

describe("messages", () => {
	const history = [
		{ role: "user", content: "Start" },
		{
			role: "assistant",
			reasoning_content: "thinking",
			content: [{ type: "tool_use", id: "call_1", name: "list_files", input: {} }],
		},
		{
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call_1", content: "a.ts" },
				{ type: "text", text: "<environment_details>x</environment_details>" },
			],
		},
	] as unknown as Anthropic.Messages.MessageParam[]

	it("keeps the reasoning and merges post-tool text for a thinking model", async () => {
		expect((await requestOf({ apiModelId: "glm-4.7" }, history)).messages).toEqual([
			{ role: "system", content: "system prompt" },
			{ role: "user", content: "Start" },
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } }],
				reasoning_content: "thinking",
			},
			{ role: "tool", tool_call_id: "call_1", content: "a.ts\n\n<environment_details>x</environment_details>" },
		])
	})

	it("uses the plain OpenAI format for a model without thinking", async () => {
		const { messages } = await requestOf({ apiModelId: "glm-4.6" }, history)
		expect(messages[2]).not.toHaveProperty("reasoning_content")
		expect(messages.map((message: { role: string }) => message.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
			"user",
		])
	})
})
