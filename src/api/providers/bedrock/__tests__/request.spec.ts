// cd src && ./node_modules/.bin/vitest run api/providers/bedrock/__tests__/request.spec.ts

// Unit tests of the pure Bedrock request builders split out of AwsBedrockHandler.createMessage
// (API-18). The end-to-end payloads are pinned in bedrock-characterization.spec.ts.

vi.mock("../../../../utils/logging", () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import type { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import {
	buildAnthropicBetas,
	buildConversationId,
	buildConverseStreamPayload,
	buildInferenceConfig,
	buildThinkingFields,
	convertToolChoiceForBedrock,
	convertToolsForBedrock,
	convertToConverseMessages,
	resolveServiceTier,
	supportsAwsPromptCache,
} from "../request"

const info: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsPromptCache: true,
	supportsReasoningBudget: true,
}

describe("bedrock request builders", () => {
	describe("buildConversationId", () => {
		it("uses the first message role and the first 20 characters of string content", () => {
			expect(buildConversationId([{ role: "user", content: "Hello world, this is long" }])).toBe(
				"conv_user_Hello world, this is",
			)
		})

		it("marks block content as complex and falls back for an empty conversation", () => {
			const blocks: Anthropic.Messages.MessageParam[] = [{ role: "user", content: [{ type: "text", text: "x" }] }]
			expect(buildConversationId(blocks)).toBe("conv_user_complex_content")
			expect(buildConversationId([])).toBe("default_conversation")
		})
	})

	describe("buildInferenceConfig", () => {
		it("prefers the resolved maxTokens and temperature", () => {
			expect(
				buildInferenceConfig(
					{ info, maxTokens: 4000, temperature: 0.5 },
					{ isAdaptiveThinkingModel: false },
					0.3,
				),
			).toEqual({ maxTokens: 4000, temperature: 0.5 })
		})

		it("falls back to the model info and the settings temperature", () => {
			expect(buildInferenceConfig({ info }, { isAdaptiveThinkingModel: false }, 0.3)).toEqual({
				maxTokens: 8192,
				temperature: 0.3,
			})
		})

		it("omits temperature for adaptive-thinking models", () => {
			expect(buildInferenceConfig({ info, temperature: 1 }, { isAdaptiveThinkingModel: true }, 0.3)).toEqual({
				maxTokens: 8192,
			})
		})
	})

	describe("buildThinkingFields", () => {
		const model = { id: "anthropic.claude-3-7-sonnet-20250219-v1:0", info }

		it("returns undefined when thinking is not requested", () => {
			expect(buildThinkingFields({ model, settings: {}, isAdaptiveThinkingModel: false })).toBeUndefined()
		})

		it("uses the metadata budget, then the model budget, then 4096", () => {
			const explicit = { enabled: true, maxThinkingTokens: 2048 }
			expect(
				buildThinkingFields({ model, settings: {}, thinking: explicit, isAdaptiveThinkingModel: false }),
			).toEqual({ thinking: { type: "enabled", budget_tokens: 2048 } })
			expect(
				buildThinkingFields({
					model: { ...model, reasoningBudget: 3000 },
					settings: {},
					thinking: { enabled: true },
					isAdaptiveThinkingModel: false,
				}),
			).toEqual({ thinking: { type: "enabled", budget_tokens: 3000 } })
			expect(
				buildThinkingFields({
					model,
					settings: {},
					thinking: { enabled: true },
					isAdaptiveThinkingModel: false,
				}),
			).toEqual({ thinking: { type: "enabled", budget_tokens: 4096 } })
		})

		it("uses adaptive thinking with xhigh effort for adaptive models", () => {
			expect(
				buildThinkingFields({
					model,
					settings: {},
					thinking: { enabled: true },
					isAdaptiveThinkingModel: true,
				}),
			).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "xhigh" } })
		})

		it("ignores the request when the model has no reasoning budget support", () => {
			expect(
				buildThinkingFields({
					model: { ...model, info: { ...info, supportsReasoningBudget: false } },
					settings: {},
					thinking: { enabled: true },
					isAdaptiveThinkingModel: false,
				}),
			).toBeUndefined()
		})
	})

	describe("betas and service tier", () => {
		it("adds the 1M context beta only for supported models with the setting on", () => {
			expect(buildAnthropicBetas("anthropic.claude-sonnet-4-6", true)).toEqual([
				"context-1m-2025-08-07",
				"fine-grained-tool-streaming-2025-05-14",
			])
			expect(buildAnthropicBetas("anthropic.claude-sonnet-4-6", false)).toEqual([
				"fine-grained-tool-streaming-2025-05-14",
			])
			expect(buildAnthropicBetas("meta.llama3-1-70b-instruct-v1:0", true)).toEqual([])
		})

		it("keeps the service tier only for supported models", () => {
			expect(resolveServiceTier("amazon.nova-pro-v1:0", "FLEX")).toBe("FLEX")
			expect(resolveServiceTier("anthropic.claude-3-5-sonnet-20241022-v2:0", "FLEX")).toBeFalsy()
			expect(resolveServiceTier("amazon.nova-pro-v1:0", undefined)).toBeFalsy()
		})
	})

	describe("tools", () => {
		it("converts function tools and normalizes nullable types", () => {
			expect(
				convertToolsForBedrock([
					{
						type: "function",
						function: {
							name: "run",
							description: "Run",
							parameters: { type: "object", properties: { cwd: { type: ["string", "null"] } } },
						},
					},
				]),
			).toEqual([
				{
					toolSpec: {
						name: "run",
						description: "Run",
						inputSchema: {
							json: {
								type: "object",
								properties: { cwd: { anyOf: [{ type: "string" }, { type: "null" }] } },
								additionalProperties: false,
							},
						},
					},
				},
			])
		})

		it("maps tool_choice", () => {
			expect(convertToolChoiceForBedrock(undefined)).toEqual({ auto: {} })
			expect(convertToolChoiceForBedrock("none")).toBeUndefined()
			expect(convertToolChoiceForBedrock("required")).toEqual({ any: {} })
			expect(convertToolChoiceForBedrock({ type: "function", function: { name: "x" } })).toEqual({
				tool: { name: "x" },
			})
		})
	})

	describe("prompt cache", () => {
		it("detects prompt cache support from supportsPromptCache and cachableFields", () => {
			expect(
				supportsAwsPromptCache({ id: "m", info: { ...info, cachableFields: ["system"] } as ModelInfo }),
			).toBe(true)
			expect(supportsAwsPromptCache({ id: "m", info })).toBeFalsy()
		})

		it("returns plain messages without cache points when caching is off", () => {
			const result = convertToConverseMessages({
				messages: [{ role: "user", content: "hi" }],
				systemPrompt: "sys",
				usePromptCache: false,
				modelInfo: info,
			})
			expect(result).toEqual({
				system: [{ text: "sys" }],
				messages: [{ role: "user", content: [{ text: "hi" }] }],
				placements: undefined,
			})
		})

		it("adds cache points and reports the placements when caching is on", () => {
			const long = "lorem ipsum dolor sit amet ".repeat(400)
			const result = convertToConverseMessages({
				messages: [
					{ role: "user", content: long },
					{ role: "assistant", content: long },
					{ role: "user", content: long },
				],
				systemPrompt: long,
				usePromptCache: true,
				modelInfo: {
					...info,
					minTokensPerCachePoint: 1024,
					maxCachePoints: 4,
					cachableFields: ["system", "messages"],
				} as ModelInfo,
			})
			expect(result.system.at(-1)).toEqual({ cachePoint: { type: "default" } })
			expect(result.placements?.length).toBeGreaterThan(0)
			const placement = result.placements![0]
			expect(result.messages[placement.index].content?.at(-1)).toEqual({ cachePoint: { type: "default" } })
		})
	})

	describe("buildConverseStreamPayload", () => {
		it("assembles the payload with thinking, betas, tools and service tier", () => {
			const settings: ProviderSettings = { awsBedrockServiceTier: "PRIORITY", modelTemperature: 0.3 }
			const payload = buildConverseStreamPayload({
				model: { id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0", info },
				baseModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
				isAdaptiveThinkingModel: false,
				settings,
				formatted: { system: [{ text: "sys" }], messages: [] },
				thinking: { enabled: true, maxThinkingTokens: 1024 },
				toolConfig: { tools: [], toolChoice: { auto: {} } },
			})
			expect(payload).toEqual({
				modelId: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
				messages: [],
				system: [{ text: "sys" }],
				inferenceConfig: { maxTokens: 8192, temperature: 0.3 },
				additionalModelRequestFields: {
					thinking: { type: "enabled", budget_tokens: 1024 },
					anthropic_beta: ["fine-grained-tool-streaming-2025-05-14"],
				},
				anthropic_version: "bedrock-2023-05-31",
				toolConfig: { tools: [], toolChoice: { auto: {} } },
			})
		})
	})
})
