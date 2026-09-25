/**
 * Builders for the Bedrock ConverseStream request, split out of AwsBedrockHandler.createMessage.
 * Every function is pure apart from the info logs that createMessage always wrote, so each piece
 * of the payload (messages with prompt-cache points, thinking config, inference config, betas,
 * tools, service tier) can be tested on its own.
 */
import type {
	ContentBlock,
	Message,
	SystemContentBlock,
	Tool,
	ToolChoice,
	ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime"
import type OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import {
	type ModelInfo,
	type ProviderSettings,
	type BedrockModelId,
	type BedrockServiceTier,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	BEDROCK_SERVICE_TIER_MODEL_IDS,
} from "@roo-code/types"

import { logger } from "../../../utils/logging"
import { shouldUseReasoningBudget } from "../../../shared/api"
import { normalizeToolSchema } from "../../../utils/json-schema"
import { MultiPointStrategy } from "../../transform/cache-strategy/multi-point-strategy"
import type { CachePointPlacement, ModelInfo as CacheModelInfo } from "../../transform/cache-strategy/types"
import { convertToBedrockConverseMessages as sharedConverter } from "../../transform/bedrock-converse-format"
import type { ApiHandlerCreateMessageMetadata } from "../../index"

export interface BedrockInferenceConfig {
	maxTokens: number
	temperature?: number
}

// Thinking configuration, 1M context beta and other model-specific parameters
export interface BedrockAdditionalModelFields {
	thinking?:
		| {
				type: "enabled"
				budget_tokens: number
		  }
		| {
				// Claude 4.7+ adaptive thinking: no budget_tokens, uses output_config.effort instead
				type: "adaptive"
				// "summarized" shows thinking content in UI; omit to keep thinking internal only
				display?: "summarized" | "none"
		  }
	output_config?: {
		// Claude 4.7+ effort levels: "low" | "medium" | "high" | "xhigh" | "max"
		effort: string
	}
	anthropic_beta?: string[]
	[key: string]: any // Index signature to be compatible with DocumentType
}

interface BedrockPayload {
	modelId: BedrockModelId | string
	messages: Message[]
	system?: SystemContentBlock[]
	inferenceConfig: BedrockInferenceConfig
	anthropic_version?: string
	additionalModelRequestFields?: BedrockAdditionalModelFields
	toolConfig?: ToolConfiguration
}

// AWS Bedrock service tiers (STANDARD, FLEX, PRIORITY) are a top-level parameter, NOT inside
// additionalModelRequestFields: https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html
export type BedrockPayloadWithServiceTier = BedrockPayload & {
	service_tier?: BedrockServiceTier
}

/** The model as AwsBedrockHandler.getModel() resolves it. */
export interface BedrockRequestModel {
	id: BedrockModelId | string
	info: ModelInfo
	maxTokens?: number
	temperature?: number
	reasoning?: any
	reasoningBudget?: number
}

export type BedrockCreateMessageMetadata = ApiHandlerCreateMessageMetadata & {
	thinking?: {
		enabled: boolean
		maxTokens?: number
		maxThinkingTokens?: number
	}
}

/** Key under which the prompt-cache point placements of a conversation are remembered. */
export function buildConversationId(messages: Anthropic.Messages.MessageParam[]): string {
	return messages.length > 0
		? `conv_${messages[0].role}_${
				typeof messages[0].content === "string" ? messages[0].content.substring(0, 20) : "complex_content"
			}`
		: "default_conversation"
}

export function supportsAwsPromptCache(modelConfig: {
	id: BedrockModelId | string
	info: ModelInfo
}): boolean | undefined {
	// The cachableFields property is not part of the ModelInfo type in schemas
	// but it's used in the bedrockModels object
	return (
		modelConfig?.info?.supportsPromptCache &&
		(modelConfig?.info as any)?.cachableFields &&
		(modelConfig?.info as any)?.cachableFields?.length > 0
	)
}

/**
 * Convert Anthropic messages to Bedrock Converse format and, with prompt caching on, add the
 * cache points chosen by the multi-point strategy. `placements` is what the caller keeps per
 * conversation and passes back as `previousPlacements` on the next request.
 */
export function convertToConverseMessages(options: {
	messages: Anthropic.Messages.MessageParam[] | { role: string; content: string }[]
	systemPrompt?: string
	usePromptCache: boolean
	modelInfo?: any
	previousPlacements?: CachePointPlacement[]
}): { system: SystemContentBlock[]; messages: Message[]; placements: CachePointPlacement[] | undefined } {
	const { messages, systemPrompt, usePromptCache, modelInfo, previousPlacements } = options

	// First convert messages using shared converter for proper image handling
	const convertedMessages = sharedConverter(messages as Anthropic.Messages.MessageParam[])

	if (!usePromptCache) {
		return {
			system: systemPrompt ? [{ text: systemPrompt } as SystemContentBlock] : [],
			messages: convertedMessages,
			placements: undefined,
		}
	}

	// Convert model info to expected format for cache strategy
	const cacheModelInfo: CacheModelInfo = {
		maxTokens: modelInfo?.maxTokens || 8192,
		contextWindow: modelInfo?.contextWindow || 200_000,
		supportsPromptCache: modelInfo?.supportsPromptCache || false,
		maxCachePoints: modelInfo?.maxCachePoints || 0,
		minTokensPerCachePoint: modelInfo?.minTokensPerCachePoint || 50,
		cachableFields: modelInfo?.cachableFields || [],
	}

	const strategy = new MultiPointStrategy({
		modelInfo: cacheModelInfo,
		systemPrompt,
		messages: messages as Anthropic.Messages.MessageParam[],
		usePromptCache,
		previousCachePointPlacements: previousPlacements,
	})
	const cacheResult = strategy.determineOptimalCachePoints()

	// Apply cache points to the properly converted messages
	const messagesWithCache = convertedMessages.map((msg, index) => {
		const placement = cacheResult.messageCachePointPlacements?.find((p) => p.index === index)
		if (placement) {
			return {
				...msg,
				content: [...(msg.content || []), { cachePoint: { type: "default" } } as ContentBlock],
			}
		}
		return msg
	})

	return {
		system: cacheResult.system,
		messages: messagesWithCache,
		placements: cacheResult.messageCachePointPlacements,
	}
}

export function buildInferenceConfig(
	model: Pick<BedrockRequestModel, "info" | "maxTokens" | "temperature">,
	options: { isAdaptiveThinkingModel: boolean },
	fallbackTemperature: number,
): BedrockInferenceConfig {
	return {
		maxTokens: model.maxTokens || (model.info.maxTokens as number),
		// Claude 4.7+ (including 4.8) removed sampling parameters entirely:
		// sending temperature causes a 400 error.
		...(options.isAdaptiveThinkingModel ? {} : { temperature: model.temperature ?? fallbackTemperature }),
	}
}

/**
 * Thinking fields, or undefined when thinking is off. Thinking is on when the request metadata
 * asks for it (direct request) or the settings enable a reasoning budget
 * (enableReasoningEffort), and the model supports a reasoning budget.
 */
export function buildThinkingFields(options: {
	model: BedrockRequestModel
	settings: ProviderSettings
	thinking?: BedrockCreateMessageMetadata["thinking"]
	isAdaptiveThinkingModel: boolean
}): BedrockAdditionalModelFields | undefined {
	const { model, settings, thinking, isAdaptiveThinkingModel } = options

	const isThinkingExplicitlyEnabled = thinking?.enabled
	const isThinkingEnabledBySettings =
		shouldUseReasoningBudget({ model: model.info, settings }) && model.reasoning && model.reasoningBudget

	if (!((isThinkingExplicitlyEnabled || isThinkingEnabledBySettings) && model.info.supportsReasoningBudget)) {
		return undefined
	}

	let fields: BedrockAdditionalModelFields
	if (isAdaptiveThinkingModel) {
		// Claude 4.7+ (incl. 4.8) uses adaptive thinking with effort levels:
		// budget_tokens causes a 400 error.
		// display: "summarized" surfaces thinking content in the UI.
		// effort "xhigh" remains the recommended level for agentic coding tasks
		// across both 4.7 and 4.8 (4.8 changed the API default to "high" but
		// the model continues to honour "xhigh" for deeper reasoning).
		fields = {
			thinking: { type: "adaptive", display: "summarized" },
			output_config: { effort: "xhigh" },
		}
	} else {
		fields = {
			thinking: {
				type: "enabled",
				budget_tokens: thinking?.maxThinkingTokens || model.reasoningBudget || 4096,
			},
		}
	}
	logger.info("Extended thinking enabled for Bedrock request", {
		ctx: "bedrock",
		modelId: model.id,
		thinking: fields?.thinking,
	})
	return fields
}

/** anthropic_beta values for the model (base id, without cross-region prefix). */
export function buildAnthropicBetas(baseModelId: string, awsBedrock1MContext: boolean | undefined): string[] {
	const betas: string[] = []

	// 1M context for supported Claude 4 models
	if (BEDROCK_1M_CONTEXT_MODEL_IDS.includes(baseModelId as any) && awsBedrock1MContext) {
		betas.push("context-1m-2025-08-07")
	}

	// Fine-grained tool streaming enables proper tool use streaming for Anthropic models on Bedrock
	if (baseModelId.includes("claude")) {
		betas.push("fine-grained-tool-streaming-2025-05-14")
	}

	return betas
}

/** The configured service tier when the model supports one, otherwise a falsy value. */
export function resolveServiceTier(baseModelId: string, serviceTier: BedrockServiceTier | undefined) {
	return serviceTier && BEDROCK_SERVICE_TIER_MODEL_IDS.includes(baseModelId as any) ? serviceTier : undefined
}

/**
 * Convert OpenAI tool definitions to Bedrock Converse format.
 * Transforms JSON Schema to the draft 2020-12 compliant format required by Claude models.
 */
export function convertToolsForBedrock(tools: OpenAI.Chat.ChatCompletionTool[]): Tool[] {
	return tools
		.filter((tool) => tool.type === "function")
		.map(
			(tool) =>
				({
					toolSpec: {
						name: tool.function.name,
						description: tool.function.description,
						inputSchema: {
							// Normalize schema to JSON Schema draft 2020-12 compliant format
							// This converts type: ["T", "null"] to anyOf: [{type: "T"}, {type: "null"}]
							json: normalizeToolSchema(tool.function.parameters as Record<string, unknown>),
						},
					},
				}) as Tool,
		)
}

/** Convert OpenAI tool_choice to Bedrock ToolChoice format. */
export function convertToolChoiceForBedrock(
	toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
): ToolChoice | undefined {
	if (!toolChoice) {
		// Default to auto - model decides whether to use tools
		return { auto: {} } as ToolChoice
	}

	if (typeof toolChoice === "string") {
		switch (toolChoice) {
			case "none":
				return undefined // Bedrock doesn't have "none", just omit tools
			case "auto":
				return { auto: {} } as ToolChoice
			case "required":
				return { any: {} } as ToolChoice // Model must use at least one tool
			default:
				return { auto: {} } as ToolChoice
		}
	}

	// Handle object form { type: "function", function: { name: string } }
	if (typeof toolChoice === "object" && "function" in toolChoice) {
		return {
			tool: {
				name: toolChoice.function.name,
			},
		} as ToolChoice
	}

	return { auto: {} } as ToolChoice
}

/** The complete ConverseStream command input. */
export function buildConverseStreamPayload(options: {
	model: BedrockRequestModel
	/** model id without cross-region or global prefix */
	baseModelId: string
	isAdaptiveThinkingModel: boolean
	settings: ProviderSettings
	formatted: { system: SystemContentBlock[]; messages: Message[] }
	thinking?: BedrockCreateMessageMetadata["thinking"]
	toolConfig: ToolConfiguration
}): BedrockPayloadWithServiceTier {
	const { model, baseModelId, isAdaptiveThinkingModel, settings, formatted, thinking, toolConfig } = options

	let additionalModelRequestFields = buildThinkingFields({ model, settings, thinking, isAdaptiveThinkingModel })
	const thinkingEnabled = additionalModelRequestFields !== undefined

	const inferenceConfig = buildInferenceConfig(
		model,
		{ isAdaptiveThinkingModel },
		settings.modelTemperature as number,
	)

	const serviceTier = resolveServiceTier(baseModelId, settings.awsBedrockServiceTier)
	if (serviceTier) {
		logger.info("Service tier specified for Bedrock request", {
			ctx: "bedrock",
			modelId: model.id,
			serviceTier: settings.awsBedrockServiceTier,
		})
	}

	const anthropicBetas = buildAnthropicBetas(baseModelId, settings.awsBedrock1MContext)
	if (anthropicBetas.length > 0) {
		if (!additionalModelRequestFields) {
			additionalModelRequestFields = {} as BedrockAdditionalModelFields
		}
		additionalModelRequestFields.anthropic_beta = anthropicBetas
	}

	return {
		modelId: model.id,
		messages: formatted.messages,
		system: formatted.system,
		inferenceConfig,
		...(additionalModelRequestFields && { additionalModelRequestFields }),
		// anthropic_version at top level when using thinking features
		...(thinkingEnabled && { anthropic_version: "bedrock-2023-05-31" }),
		toolConfig,
		// service_tier is a top-level parameter (not inside additionalModelRequestFields)
		...(serviceTier && { service_tier: serviceTier }),
	}
}
