// cd src && ./node_modules/.bin/vitest run api/providers/__tests__/bedrock.spec.ts
// The request builders and the error classification have unit specs under ../bedrock/__tests__;
// this spec covers what AwsBedrockHandler adds: client config, ARN and model resolution, the
// ConverseStream/Converse command input, stream reading and the error paths.

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	captureException: vi.fn(),
	fromIni: vi.fn(() => ({ accessKeyId: "profile-key", secretAccessKey: "profile-secret" })),
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { captureException: mocks.captureException } },
}))
vi.mock("../../../utils/logging", () => ({ logger: mocks.logger }))
vi.mock("@aws-sdk/credential-providers", () => ({ fromIni: mocks.fromIni }))
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn(function (config: unknown) {
		return { send: mocks.send, config }
	}),
	ConverseStreamCommand: vi.fn(function (input: unknown) {
		return { input }
	}),
	ConverseCommand: vi.fn(function (input: unknown) {
		return { input }
	}),
}))

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import type { Anthropic } from "@anthropic-ai/sdk"
import type OpenAI from "openai"
import {
	type ModelInfo,
	type ProviderSettings,
	BEDROCK_DEFAULT_CONTEXT,
	BEDROCK_MAX_TOKENS,
	BEDROCK_SERVICE_TIER_PRICING,
	bedrockDefaultModelId,
	bedrockDefaultPromptRouterModelId,
	bedrockModels,
} from "@tumble-code/types"

import { AwsBedrockHandler } from "../bedrock"
import type { ApiStreamChunk } from "../../transform/stream"

const SONNET_45 = "anthropic.claude-sonnet-4-5-20250929-v1:0"
const HAIKU_45 = "anthropic.claude-haiku-4-5-20251001-v1:0"
const NOVA_PRO = "amazon.nova-pro-v1:0"
const FINE_GRAINED = "fine-grained-tool-streaming-2025-05-14"
const CONTEXT_1M = "context-1m-2025-08-07"

const baseSettings: ProviderSettings = {
	apiProvider: "bedrock",
	awsAccessKey: "access-key",
	awsSecretKey: "secret-key",
	awsRegion: "us-east-1",
}

const conversation: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "Hello" },
	{ role: "assistant", content: [{ type: "text", text: "Hi, how can I help?" }] },
	{ role: "user", content: [{ type: "text", text: "Read a file" }] },
]

function handlerFor(settings: Partial<ProviderSettings> = {}) {
	return new AwsBedrockHandler({ ...baseSettings, apiModelId: SONNET_45, ...settings })
}

function modelInfo(id: string): ModelInfo {
	return bedrockModels[id as keyof typeof bedrockModels]
}

function lastClientConfig() {
	return vi.mocked(BedrockRuntimeClient).mock.calls.at(-1)![0] as Record<string, unknown>
}

function lastCommandInput() {
	return mocks.send.mock.calls.at(-1)![0].input
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
	let error: any
	try {
		for await (const chunk of stream) {
			chunks.push(chunk)
		}
	} catch (caught) {
		error = caught
	}
	return { chunks, error }
}

async function requestFor(
	handler: AwsBedrockHandler,
	options: {
		messages?: Anthropic.Messages.MessageParam[]
		systemPrompt?: string
		metadata?: Parameters<AwsBedrockHandler["createMessage"]>[2]
	} = {},
) {
	mocks.send.mockResolvedValueOnce({ stream: scripted([]) })
	await collect(
		handler.createMessage(
			options.systemPrompt ?? "You are a helpful assistant.",
			options.messages ?? conversation,
			options.metadata,
		),
	)
	return lastCommandInput()
}

function awsError(message: string, fields: Record<string, unknown> = {}) {
	return Object.assign(new Error(message), fields)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("client configuration", () => {
	it.each([
		[
			"access keys with a session token",
			{ awsSessionToken: "session" },
			{ credentials: { accessKeyId: "access-key", secretAccessKey: "secret-key", sessionToken: "session" } },
			["token", "endpoint"],
		],
		[
			"an API key, which wins over access keys",
			{ awsUseApiKey: true, awsApiKey: "api-key" },
			{
				token: { token: "api-key" },
				authSchemePreference: ["httpBearerAuth"],
				requestHandler: { requestTimeout: 0 },
			},
			["credentials"],
		],
		[
			"a profile",
			{ awsUseProfile: true, awsProfile: "dev" },
			{ credentials: { accessKeyId: "profile-key", secretAccessKey: "profile-secret" } },
			["token"],
		],
		[
			"an enabled VPC endpoint",
			{ awsBedrockEndpoint: "https://bedrock-vpc.example.com", awsBedrockEndpointEnabled: true },
			{ endpoint: "https://bedrock-vpc.example.com" },
			[],
		],
		[
			"a disabled VPC endpoint",
			{ awsBedrockEndpoint: "https://bedrock-vpc.example.com", awsBedrockEndpointEnabled: false },
			{},
			["endpoint"],
		],
		["an empty VPC endpoint", { awsBedrockEndpoint: "", awsBedrockEndpointEnabled: true }, {}, ["endpoint"]],
	])("builds the client config for %s", (_label, settings, expected, absent) => {
		handlerFor(settings)
		const config = lastClientConfig()
		expect(config).toMatchObject({ region: "us-east-1", userAgentAppId: expect.stringMatching(/^TumbleCode#/) })
		expect(config).toMatchObject(expected)
		for (const key of absent) {
			expect(config).not.toHaveProperty(key)
		}
	})

	it("reads profile credentials without the SDK cache", () => {
		handlerFor({ awsUseProfile: true, awsProfile: "dev" })
		expect(mocks.fromIni).toHaveBeenCalledWith({ profile: "dev", ignoreCache: true })
	})
})

describe("custom ARN", () => {
	it.each([
		"invalid-arn-format",
		"arn:aws:bedrock:us-east-1",
		"arn:aws:bedrock:us-east-1:123456789012:some-other-resource",
	])("rejects %s with the INVALID_ARN_FORMAT prefix", (awsCustomArn) => {
		expect(() => handlerFor({ awsCustomArn })).toThrow(/^INVALID_ARN_FORMAT:/)
	})

	it("uses the ARN region when it differs from the selected one", () => {
		handlerFor({
			awsRegion: "us-east-1",
			awsCustomArn: `arn:aws:bedrock:eu-west-1:123456789012:inference-profile/${SONNET_45}`,
		})
		expect(lastClientConfig().region).toBe("eu-west-1")
		expect(mocks.logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Region mismatch"),
			expect.objectContaining({ selectedRegion: "us-east-1", arnRegion: "eu-west-1" }),
		)
	})

	it.each([
		[
			"a foundation model is sent by its model id",
			`arn:aws:bedrock:us-east-1::foundation-model/${SONNET_45}`,
			SONNET_45,
			SONNET_45,
		],
		[
			"an inference profile with a cross-region prefix is sent by ARN, priced as its model",
			`arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.${SONNET_45}`,
			"ARN",
			SONNET_45,
		],
		[
			"a GovCloud partition ARN with an unknown prefix gets the stand-in info",
			`arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.${SONNET_45}`,
			"ARN",
			SONNET_45,
		],
		[
			"a China partition ARN",
			`arn:aws-cn:bedrock:cn-north-1:123456789012:inference-profile/${HAIKU_45}`,
			"ARN",
			HAIKU_45,
		],
		[
			"a prompt router without an identifiable model uses the default router model",
			"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
			"ARN",
			bedrockDefaultPromptRouterModelId,
		],
	])("%s", (_label, awsCustomArn, expectedId, infoOf) => {
		const model = handlerFor({ awsCustomArn }).getModel()
		expect(model.id).toBe(expectedId === "ARN" ? awsCustomArn : expectedId)
		expect(model.info.inputPrice).toBe(modelInfo(infoOf).inputPrice)
	})

	it("keeps a prefix that is not an inference profile as part of the model id", () => {
		const model = handlerFor({
			awsCustomArn: `arn:aws:bedrock:us-east-1::foundation-model/ap.${SONNET_45}`,
		}).getModel()
		expect(model.id).toBe(`ap.${SONNET_45}`)
	})
})

describe("getModel", () => {
	it.each([undefined, "", "custom-arn"])("falls back to the default model for model id %o", (apiModelId) => {
		expect(handlerFor({ apiModelId }).getModel().id).toBe(bedrockDefaultModelId)
	})

	// The default is Claude Opus 5, but an unknown id or ARN keeps the Claude Sonnet 4.5 stand-in info:
	// Opus 5 info would drop temperature and add effort support for models that may not accept them.
	it.each([
		[{ apiModelId: "mistral.some-new-model-v1:0" }, "mistral.some-new-model-v1:0"],
		[
			{ awsCustomArn: "arn:aws:bedrock:us-east-1:123456789012:imported-model/abc" },
			"arn:aws:bedrock:us-east-1:123456789012:imported-model/abc",
		],
	])("sizes an unknown model with the stand-in info, not the Opus 5 default (%o)", (settings, id) => {
		const model = handlerFor(settings).getModel()
		expect(model.id).toBe(id)
		expect(model.temperature).toBe(0.3)
		expect(model.reasoning).toBeUndefined()
		expect(model.info.supportsTemperature).not.toBe(false)
		expect(model.info.supportsReasoningEffort).toBeUndefined()
		expect(model.info.reasoningEffort).toBeUndefined()
		expect(model.info.inputPrice).toBe(modelInfo(SONNET_45).inputPrice)
	})

	it.each([
		[
			"a Claude 3 Haiku look-alike",
			"acme.claude-3-haiku-custom",
			{ maxTokens: 4096, contextWindow: 200_000, supportsImages: true },
		],
		[
			"a non-Claude model",
			"mistral.some-new-model-v1:0",
			{
				maxTokens: BEDROCK_MAX_TOKENS,
				contextWindow: BEDROCK_DEFAULT_CONTEXT,
				supportsImages: false,
				supportsPromptCache: false,
			},
		],
	])("guesses the limits of %s from its id", (_label, apiModelId, expected) => {
		expect(handlerFor({ apiModelId }).getModel().info).toMatchObject(expected)
	})

	it("applies the user's max tokens and context window overrides", () => {
		const model = handlerFor({ modelMaxTokens: 4096, awsModelContextWindow: 100_000 }).getModel()
		expect(model.info.maxTokens).toBe(4096)
		expect(model.info.contextWindow).toBe(100_000)
	})

	it.each([
		["us-east-1", true, `us.${SONNET_45}`],
		["us-gov-west-1", true, `ug.${SONNET_45}`],
		["eu-west-1", true, `eu.${SONNET_45}`],
		["ap-southeast-2", true, `au.${SONNET_45}`],
		["ap-northeast-1", true, `jp.${SONNET_45}`],
		["ap-south-1", true, `apac.${SONNET_45}`],
		["ca-central-1", true, `ca.${SONNET_45}`],
		["af-south-1", true, SONNET_45],
		["us-east-1", false, SONNET_45],
	])("cross-region inference in %s (enabled %s) sends %s", (awsRegion, awsUseCrossRegionInference, id) => {
		expect(handlerFor({ awsRegion, awsUseCrossRegionInference }).getModel().id).toBe(id)
	})

	it.each([
		["a supported model, over cross-region", SONNET_45, true, `global.${SONNET_45}`],
		["a supported model", "anthropic.claude-fable-5", false, "global.anthropic.claude-fable-5"],
		[
			"an unsupported model falls back to cross-region",
			"anthropic.claude-opus-4-20250514-v1:0",
			true,
			"us.anthropic.claude-opus-4-20250514-v1:0",
		],
	])("global inference for %s", (_label, apiModelId, awsUseCrossRegionInference, id) => {
		expect(handlerFor({ apiModelId, awsUseGlobalInference: true, awsUseCrossRegionInference }).getModel().id).toBe(
			id,
		)
	})

	// The Sonnet 4 and 4.5 entries carried no 1M tier pricing once, so with the beta on they were
	// billed at the 200K prices above 200K tokens.
	it.each([SONNET_45, "anthropic.claude-sonnet-4-20250514-v1:0"])(
		"switches %s to the 1M tier window and prices, also with a cross-region prefix",
		(apiModelId) => {
			const [tier] = modelInfo(apiModelId).tiers!
			for (const awsUseCrossRegionInference of [false, true]) {
				const { info } = handlerFor({
					apiModelId,
					awsBedrock1MContext: true,
					awsUseCrossRegionInference,
				}).getModel()
				expect(info).toMatchObject({
					contextWindow: 1_000_000,
					inputPrice: tier.inputPrice,
					outputPrice: tier.outputPrice,
					cacheWritesPrice: tier.cacheWritesPrice,
					cacheReadsPrice: tier.cacheReadsPrice,
				})
			}
		},
	)

	it("keeps the standard prices for a model that serves 1M natively", () => {
		const { info } = handlerFor({ apiModelId: "anthropic.claude-sonnet-4-6", awsBedrock1MContext: true }).getModel()
		expect(info.contextWindow).toBe(1_000_000)
		expect(info.inputPrice).toBe(modelInfo("anthropic.claude-sonnet-4-6").inputPrice)
	})

	it.each([
		["the setting is off", SONNET_45, false],
		["the model has no 1M tier", "anthropic.claude-opus-4-20250514-v1:0", true],
	])("keeps the table window when %s", (_label, apiModelId, awsBedrock1MContext) => {
		expect(handlerFor({ apiModelId, awsBedrock1MContext }).getModel().info.contextWindow).toBe(
			modelInfo(apiModelId).contextWindow,
		)
	})

	it.each(["STANDARD", "FLEX", "PRIORITY"] as const)("prices the %s service tier", (awsBedrockServiceTier) => {
		const multiplier = BEDROCK_SERVICE_TIER_PRICING[awsBedrockServiceTier]
		for (const awsUseCrossRegionInference of [false, true]) {
			const { info } = handlerFor({
				apiModelId: NOVA_PRO,
				awsBedrockServiceTier,
				awsUseCrossRegionInference,
			}).getModel()
			expect(info.inputPrice).toBeCloseTo(modelInfo(NOVA_PRO).inputPrice! * multiplier)
			expect(info.outputPrice).toBeCloseTo(modelInfo(NOVA_PRO).outputPrice! * multiplier)
		}
	})

	it("ignores the service tier for a model without tiers", () => {
		const { info } = handlerFor({ awsBedrockServiceTier: "FLEX" }).getModel()
		expect(info.inputPrice).toBe(modelInfo(SONNET_45).inputPrice)
	})
})

describe("createMessage request", () => {
	it("builds the ConverseStream input for a plain request", async () => {
		expect(await requestFor(handlerFor({ awsUsePromptCache: false }))).toEqual({
			modelId: SONNET_45,
			system: [{ text: "You are a helpful assistant." }],
			messages: [
				{ role: "user", content: [{ text: "Hello" }] },
				{ role: "assistant", content: [{ text: "Hi, how can I help?" }] },
				{ role: "user", content: [{ text: "Read a file" }] },
			],
			inferenceConfig: { maxTokens: 8192, temperature: 0.3 },
			additionalModelRequestFields: { anthropic_beta: [FINE_GRAINED] },
			toolConfig: { tools: [], toolChoice: { auto: {} } },
		})
	})

	it.each([
		[
			"budget thinking from the settings",
			{ enableReasoningEffort: true, modelMaxTokens: 8192, modelMaxThinkingTokens: 4096 },
			{
				modelId: SONNET_45,
				inferenceConfig: { maxTokens: 8192, temperature: 1 },
				additionalModelRequestFields: {
					anthropic_beta: [FINE_GRAINED],
					thinking: { type: "enabled", budget_tokens: 4096 },
				},
				anthropic_version: "bedrock-2023-05-31",
			},
		],
		[
			"adaptive thinking with the chosen effort, detected through a cross-region prefix",
			{
				apiModelId: "anthropic.claude-opus-4-8",
				awsUseCrossRegionInference: true,
				enableReasoningEffort: true,
				reasoningEffort: "max",
			},
			{
				modelId: "us.anthropic.claude-opus-4-8",
				inferenceConfig: { maxTokens: expect.any(Number) },
				additionalModelRequestFields: {
					anthropic_beta: [FINE_GRAINED],
					thinking: { type: "adaptive", display: "summarized" },
					output_config: { effort: "max" },
				},
				anthropic_version: "bedrock-2023-05-31",
			},
		],
		[
			"adaptive thinking without an effort the model does not offer",
			{ apiModelId: "anthropic.claude-opus-4-8", enableReasoningEffort: true, reasoningEffort: "minimal" },
			{
				modelId: "anthropic.claude-opus-4-8",
				inferenceConfig: { maxTokens: expect.any(Number) },
				additionalModelRequestFields: {
					anthropic_beta: [FINE_GRAINED],
					thinking: { type: "adaptive", display: "summarized" },
				},
				anthropic_version: "bedrock-2023-05-31",
			},
		],
		[
			"an adaptive model with reasoning off: no thinking and no temperature",
			{ apiModelId: "anthropic.claude-opus-4-8", enableReasoningEffort: false },
			{
				modelId: "anthropic.claude-opus-4-8",
				inferenceConfig: { maxTokens: expect.any(Number) },
				additionalModelRequestFields: { anthropic_beta: [FINE_GRAINED] },
			},
		],
		[
			"the 1M beta on the base id behind a cross-region prefix",
			{ awsBedrock1MContext: true, awsUseCrossRegionInference: true },
			{
				modelId: `us.${SONNET_45}`,
				inferenceConfig: { maxTokens: expect.any(Number), temperature: 0.3 },
				additionalModelRequestFields: { anthropic_beta: [CONTEXT_1M, FINE_GRAINED] },
			},
		],
		[
			"a supported service tier as a top-level field",
			{ apiModelId: NOVA_PRO, awsBedrockServiceTier: "FLEX" },
			{
				modelId: NOVA_PRO,
				inferenceConfig: { maxTokens: expect.any(Number), temperature: 0.3 },
				service_tier: "FLEX",
			},
		],
		[
			"a service tier the model does not support",
			{ awsBedrockServiceTier: "PRIORITY" },
			{
				modelId: SONNET_45,
				inferenceConfig: { maxTokens: expect.any(Number), temperature: 0.3 },
				additionalModelRequestFields: { anthropic_beta: [FINE_GRAINED] },
			},
		],
	])("sends %s", async (_label, settings, expected) => {
		const {
			messages: _m,
			system: _s,
			toolConfig: _t,
			...rest
		} = await requestFor(handlerFor({ awsUsePromptCache: false, ...(settings as Partial<ProviderSettings>) }))
		expect(rest).toEqual(expected)
	})

	it("enables budget thinking from the request metadata", async () => {
		const input = await requestFor(handlerFor({ apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0" }), {
			metadata: { taskId: "t1", thinking: { enabled: true, maxThinkingTokens: 2048 } },
		})
		expect(input.additionalModelRequestFields.thinking).toEqual({ type: "enabled", budget_tokens: 2048 })
		expect(input.anthropic_version).toBe("bedrock-2023-05-31")
	})

	it("converts the request tools and tool_choice", async () => {
		const tools: OpenAI.Chat.ChatCompletionTool[] = [
			{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } },
		]
		const input = await requestFor(handlerFor(), {
			metadata: { taskId: "t1", tools, tool_choice: "required" },
		})
		expect(input.toolConfig.toolChoice).toEqual({ any: {} })
		expect(input.toolConfig.tools.map((tool: any) => tool.toolSpec.name)).toEqual(["read_file"])
	})

	describe("prompt cache", () => {
		const long = (label: string) => `${label} ${"lorem ipsum dolor sit amet ".repeat(400)}`
		const hasCachePoint = (blocks: any[]) => blocks.some((block) => block.cachePoint)
		const cachedMessageIndexes = (input: any) =>
			input.messages.flatMap((message: any, index: number) => (hasCachePoint(message.content) ? [index] : []))

		it.each([
			[undefined, true],
			[false, false],
		])("awsUsePromptCache %o places a system cache point: %s", async (awsUsePromptCache, expected) => {
			const input = await requestFor(handlerFor({ awsUsePromptCache }), { systemPrompt: long("system") })
			expect(hasCachePoint(input.system)).toBe(expected)
		})

		it("keeps the earlier cache point in place on the next request of a conversation", async () => {
			const handler = handlerFor()
			const firstTurn: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: long("first question") },
				{ role: "assistant", content: long("first answer") },
				{ role: "user", content: long("second question") },
			]
			const first = await requestFor(handler, { messages: firstTurn, systemPrompt: long("system") })
			expect(cachedMessageIndexes(first)).toEqual([2])

			const second = await requestFor(handler, {
				messages: [
					...firstTurn,
					{ role: "assistant", content: long("second answer") },
					{ role: "user", content: long("third question") },
				],
				systemPrompt: long("system"),
			})
			expect(cachedMessageIndexes(second)).toEqual([2, 4])
		})
	})
})

describe("createMessage stream", () => {
	it("prices a prompt router request as the invoked model and keeps the router id", async () => {
		const routerArn = "arn:aws:bedrock:us-east-1:123456789:default-prompt-router/anthropic.claude:1"
		const handler = handlerFor({ awsCustomArn: routerArn })
		mocks.send.mockResolvedValueOnce({
			stream: scripted([
				{
					trace: {
						promptRouter: {
							invokedModelId: `arn:aws:bedrock:us-east-1:123456789:foundation-model/${SONNET_45}`,
							usage: {
								inputTokens: 11,
								outputTokens: 22,
								cacheReadTokens: 3,
								cacheWriteInputTokenCount: 4,
							},
						},
					},
					contentBlockDelta: { delta: { text: "ignored, the trace wins" } },
				},
				{
					trace: {
						promptRouter: {
							invokedModelId: `arn:aws:bedrock:us-east-1:123456789:inference-profile/us.${HAIKU_45}`,
						},
					},
				},
				{ contentBlockDelta: { delta: { text: "routed answer" } } },
			]),
		})
		const { chunks } = await collect(handler.createMessage("system", conversation))
		expect(chunks).toEqual([
			{ type: "usage", inputTokens: 11, outputTokens: 22, cacheReadTokens: 3, cacheWriteTokens: 4 },
			{ type: "text", text: "routed answer" },
		])
		const model = handler.getModel()
		expect(model.id).toBe(routerArn)
		expect(model.info.inputPrice).toBe(modelInfo(HAIKU_45).inputPrice)
	})

	it("logs an unreadable invoked model id and keeps streaming with the old pricing", async () => {
		const handler = handlerFor()
		mocks.send.mockResolvedValueOnce({
			stream: scripted([
				{ trace: { promptRouter: { invokedModelId: "invalid-format-not-an-arn" } } },
				{ contentBlockDelta: { delta: { text: "still here" } } },
			]),
		})
		const { chunks, error } = await collect(handler.createMessage("system", conversation))
		expect(error).toBeUndefined()
		expect(chunks).toEqual([{ type: "text", text: "still here" }])
		expect(handler.getModel().id).toBe(SONNET_45)
		expect(mocks.logger.error).toHaveBeenCalledWith("Error handling Bedrock invokedModelId", expect.anything())
	})
})

describe("createMessage errors", () => {
	function throttlingError() {
		return awsError("Rate exceeded", {
			name: "ThrottlingException",
			$metadata: { httpStatusCode: 429, requestId: "req-1" },
		})
	}

	function expectTelemetry(message: string) {
		expect(mocks.captureException).toHaveBeenCalledTimes(1)
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			message,
			provider: "Bedrock",
			modelId: SONNET_45,
			operation: "createMessage",
		})
	}

	it("rethrows a throttling error at send untouched, with the status for the retry loop", async () => {
		const original = throttlingError()
		mocks.send.mockRejectedValueOnce(original)
		const { chunks, error } = await collect(handlerFor().createMessage("system", conversation))
		expect(chunks).toEqual([])
		expect(error).toBe(original)
		expect(error.status).toBe(429)
		expectTelemetry("Rate exceeded")
	})

	it("rethrows a throttling error in the middle of the stream after the partial text", async () => {
		const original = throttlingError()
		mocks.send.mockResolvedValueOnce({
			stream: scripted([{ contentBlockDelta: { delta: { text: "partial" } } }], original),
		})
		const { chunks, error } = await collect(handlerFor().createMessage("system", conversation))
		expect(chunks).toEqual([{ type: "text", text: "partial" }])
		expect(error).toBe(original)
	})

	it.each([
		[
			"a validation error keeps name, status and metadata",
			() =>
				mocks.send.mockRejectedValueOnce(
					awsError("Malformed input request: field required", {
						name: "ValidationException",
						$metadata: { httpStatusCode: 400, requestId: "req-2" },
					}),
				),
			"Malformed input request: field required",
			"Unknown Error: Malformed input request: field required",
			{
				message: "Unknown Error: Malformed input request: field required",
				name: "ValidationException",
				status: 400,
				$metadata: { httpStatusCode: 400, requestId: "req-2" },
			},
		],
		[
			"a rejection that is not an Error",
			() => mocks.send.mockRejectedValueOnce("plain string failure"),
			"plain string failure",
			"Unknown Error: {errorMessage}",
			{ message: "An unknown error occurred" },
		],
		[
			"a response without a stream",
			() => mocks.send.mockResolvedValueOnce({}),
			"No stream available in the response",
			"Unknown Error: No stream available in the response",
			{ message: "Unknown Error: No stream available in the response" },
		],
	])("%s yields an error chunk and a zero usage chunk, then throws", async (_l, arrange, raw, text, thrown) => {
		arrange()
		const { chunks, error } = await collect(handlerFor().createMessage("system", conversation))
		expect(chunks).toEqual([
			{ type: "text", text: `Error: ${text}` },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		])
		expect(error).toMatchObject(thrown)
		expectTelemetry(raw)
	})
})

describe("completePrompt", () => {
	function respond(text: string | undefined, usage?: { inputTokens?: number; outputTokens?: number }) {
		mocks.send.mockResolvedValueOnce({
			output: { message: { content: text === undefined ? [] : [{ text }] } },
			usage,
		})
	}

	it("sends the prompt as one user message and returns the text with usage", async () => {
		respond("answer", { inputTokens: 5 })
		const result = await handlerFor().completePromptWithUsage("Summarize this")
		expect(lastCommandInput()).toEqual({
			modelId: SONNET_45,
			messages: [{ role: "user", content: [{ text: "Summarize this" }] }],
			inferenceConfig: { maxTokens: 8192, temperature: 0.3 },
		})
		expect(result).toEqual({ text: "answer", usage: { inputTokens: 5, outputTokens: 0 } })
	})

	it.each([
		["blank text", "  "],
		["no content", undefined],
	])("returns empty text for %s", async (_label, text) => {
		respond(text)
		expect(await handlerFor().completePromptWithUsage("p")).toEqual({ text: "", usage: undefined })
	})

	// Claude 4.7+ and the Claude 5 family reject sampling parameters with a 400.
	it.each([
		["anthropic.claude-opus-4-7", {}, false],
		["anthropic.claude-opus-4-8", {}, false],
		["anthropic.claude-sonnet-4-7", {}, false],
		["anthropic.claude-sonnet-4-8", {}, false],
		["anthropic.claude-sonnet-5", {}, false],
		["anthropic.claude-opus-5-5", {}, false],
		["anthropic.claude-fable-5", { awsUseGlobalInference: true }, false],
		["anthropic.claude-haiku-5-5", {}, false],
		["anthropic.claude-opus-4-6-v1", {}, true],
		["anthropic.claude-sonnet-4-6", {}, true],
		[HAIKU_45, {}, true],
		[NOVA_PRO, {}, true],
	])("%s %o sends temperature: %s", async (apiModelId, settings, sendsTemperature) => {
		respond("ok")
		await handlerFor({ apiModelId, ...settings }).completePrompt("p")
		expect("temperature" in lastCommandInput().inferenceConfig).toBe(sendsTemperature)
	})

	it("throws the Bedrock message with the SDK status, metadata and name, and reports telemetry", async () => {
		mocks.send.mockRejectedValueOnce(
			awsError("Request failed", {
				name: "ThrottlingException",
				$metadata: { httpStatusCode: 429, requestId: "req-3" },
			}),
		)
		const error = await handlerFor()
			.completePrompt("p")
			.catch((caught) => caught)
		expect(error.message).toMatch(/^Bedrock completion error: Request was throttled or rate limited/)
		expect(error).toMatchObject({ name: "ThrottlingException", status: 429, $metadata: { requestId: "req-3" } })
		expect(mocks.captureException.mock.calls[0][0]).toMatchObject({
			message: "Request failed",
			provider: "Bedrock",
			modelId: SONNET_45,
			operation: "completePrompt",
		})
	})
})
