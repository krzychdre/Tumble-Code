import {
	BedrockRuntimeClient,
	ConverseStreamCommand,
	ConverseCommand,
	BedrockRuntimeClientConfig,
	Message,
	SystemContentBlock,
	Tool,
	ToolChoice,
} from "@aws-sdk/client-bedrock-runtime"
import OpenAI from "openai"
import { fromIni } from "@aws-sdk/credential-providers"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	type ModelInfo,
	type ProviderSettings,
	type BedrockModelId,
	bedrockDefaultModelId,
	bedrockModels,
	bedrockDefaultPromptRouterModelId,
	BEDROCK_DEFAULT_TEMPERATURE,
	BEDROCK_MAX_TOKENS,
	BEDROCK_DEFAULT_CONTEXT,
	AWS_INFERENCE_PROFILE_MAPPING,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	BEDROCK_GLOBAL_INFERENCE_MODEL_IDS,
	BEDROCK_SERVICE_TIER_MODEL_IDS,
	BEDROCK_SERVICE_TIER_PRICING,
	ApiProviderError,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { logger } from "../../utils/logging"
import { Package } from "../../shared/package"
import { getModelParams } from "../transform/model-params"
import type { CompletionResult, SingleCompletionHandler } from "../index"
import { handleProviderError } from "./utils/error-handler"
import { createRequestAbortController } from "./utils/request-abort"
import {
	type BedrockCreateMessageMetadata,
	buildConversationId,
	buildConverseStreamPayload,
	buildInferenceConfig,
	convertToConverseMessages,
	convertToolChoiceForBedrock,
	convertToolsForBedrock,
	supportsAwsPromptCache,
} from "./bedrock/request"
import { processBedrockStream } from "./bedrock/stream"
import { type BedrockErrorContext, bedrockStreamFailure, handleBedrockError } from "./bedrock/errors"

// Kept for importers of the stream event type (bedrock-invokedModelId.spec)
export type { StreamEvent } from "./bedrock/stream"

/************************************************************************************
 *
 *     PROVIDER
 *
 *************************************************************************************/

export class AwsBedrockHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ProviderSettings
	private client: BedrockRuntimeClient
	private arnInfo: any
	private readonly providerName = "Bedrock"

	constructor(options: ProviderSettings) {
		super()
		this.options = options
		const region = this.options.awsRegion

		// process the various user input options, be opinionated about the intent of the options
		// and determine the model to use during inference and for cost calculations
		// There are variations on ARN strings that can be entered making the conditional logic
		// more involved than the non-ARN branch of logic
		if (this.options.awsCustomArn) {
			this.arnInfo = this.parseArn(this.options.awsCustomArn, region)

			if (!this.arnInfo.isValid) {
				logger.error("Invalid ARN format", {
					ctx: "bedrock",
					errorMessage: this.arnInfo.errorMessage,
				})

				// Throw a consistent error with a prefix that can be detected by callers
				const errorMessage =
					this.arnInfo.errorMessage ||
					"Invalid ARN format. ARN should follow the pattern: arn:aws:bedrock:region:account-id:resource-type/resource-name"
				throw new Error("INVALID_ARN_FORMAT:" + errorMessage)
			}

			if (this.arnInfo.region && this.arnInfo.region !== this.options.awsRegion) {
				// Log  if there's a region mismatch between the ARN and the region selected by the user
				// We will use the ARNs region, so execution can continue, but log an info statement.
				// Log a warning if there's a region mismatch between the ARN and the region selected by the user
				// We will use the ARNs region, so execution can continue, but log an info statement.
				logger.info(this.arnInfo.errorMessage, {
					ctx: "bedrock",
					selectedRegion: this.options.awsRegion,
					arnRegion: this.arnInfo.region,
				})

				this.options.awsRegion = this.arnInfo.region
			}

			this.options.apiModelId = this.arnInfo.modelId
			if (this.arnInfo.awsUseCrossRegionInference) this.options.awsUseCrossRegionInference = true
		}

		if (!this.options.modelTemperature) {
			this.options.modelTemperature = BEDROCK_DEFAULT_TEMPERATURE
		}

		this.costModelConfig = this.getModel()

		const clientConfig: BedrockRuntimeClientConfig = {
			userAgentAppId: `RooCode#${Package.version}`,
			region: this.options.awsRegion,
			// Add the endpoint configuration when specified and enabled
			...(this.options.awsBedrockEndpoint &&
				this.options.awsBedrockEndpointEnabled && { endpoint: this.options.awsBedrockEndpoint }),
		}

		if (this.options.awsUseApiKey && this.options.awsApiKey) {
			// Use API key/token-based authentication if enabled and API key is set
			clientConfig.token = { token: this.options.awsApiKey }
			clientConfig.authSchemePreference = ["httpBearerAuth"] // Otherwise there's no end of credential problems.
			clientConfig.requestHandler = {
				// This should be the default anyway, but without setting something
				// this provider fails to work with LiteLLM passthrough.
				requestTimeout: 0,
			}
		} else if (this.options.awsUseProfile && this.options.awsProfile) {
			// Use profile-based credentials if enabled and profile is set
			clientConfig.credentials = fromIni({
				profile: this.options.awsProfile,
				ignoreCache: true,
			})
		} else if (this.options.awsAccessKey && this.options.awsSecretKey) {
			// Use direct credentials if provided
			clientConfig.credentials = {
				accessKeyId: this.options.awsAccessKey,
				secretAccessKey: this.options.awsSecretKey,
				...(this.options.awsSessionToken ? { sessionToken: this.options.awsSessionToken } : {}),
			}
		}

		this.client = new BedrockRuntimeClient(clientConfig)
	}

	/**
	 * Detect models that require the adaptive-thinking API contract.
	 *
	 * Starting with Claude Opus 4.7 (and the matching Sonnet 4.7), and continuing
	 * in Opus 4.8 / Sonnet 4.8, Anthropic removed sampling parameters
	 * (temperature/top_p/top_k) and replaced budget_tokens-based thinking with
	 * `thinking.type: "adaptive"` plus `output_config.effort`. The migration guide
	 * from 4.7 → 4.8 confirms there are no further breaking API changes, and the
	 * Claude 5 family (Sonnet 5, Opus 5 / 5.5, Fable 5 / 5.1) keeps the same
	 * contract, so a single guard matches every generation. Shared by createMessage and completePrompt so
	 * both request paths omit temperature for these models (sending it causes a 400).
	 *
	 * Accepts a model ID (with or without a cross-region/global prefix) and strips
	 * the prefix via parseBaseModelId before matching.
	 */
	private isAdaptiveThinkingModel(modelId: string): boolean {
		const baseModelId = this.parseBaseModelId(modelId)
		return (
			baseModelId.includes("opus-4-7") ||
			baseModelId.includes("opus-4-8") ||
			baseModelId.includes("opus-5") || // also matches opus-5-5
			baseModelId.includes("fable-5") || // also matches fable-5-1
			baseModelId.includes("sonnet-4-7") ||
			baseModelId.includes("sonnet-4-8") ||
			baseModelId.includes("sonnet-5")
		)
	}

	// Helper to guess model info from custom modelId string if not in bedrockModels
	private guessModelInfoFromId(modelId: string): Partial<ModelInfo> {
		// Define a mapping for model ID patterns and their configurations
		const modelConfigMap: Record<string, Partial<ModelInfo>> = {
			"claude-4": {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
			"claude-3-7": {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
			"claude-3-5": {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
			"claude-4-opus": {
				maxTokens: 4096,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
			"claude-3-opus": {
				maxTokens: 4096,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
			"claude-3-haiku": {
				maxTokens: 4096,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
			},
		}

		// Match the model ID to a configuration
		const id = modelId.toLowerCase()
		for (const [pattern, config] of Object.entries(modelConfigMap)) {
			if (id.includes(pattern)) {
				return config
			}
		}

		// Default fallback
		return {
			maxTokens: BEDROCK_MAX_TOKENS,
			contextWindow: BEDROCK_DEFAULT_CONTEXT,
			supportsImages: false,
			supportsPromptCache: false,
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: BedrockCreateMessageMetadata,
	): ApiStream {
		const modelConfig = this.getModel()
		const usePromptCache = Boolean((this.options.awsUsePromptCache ?? true) && supportsAwsPromptCache(modelConfig))

		const formatted = this.convertToBedrockConverseMessages(
			messages,
			systemPrompt,
			usePromptCache,
			modelConfig.info,
			buildConversationId(messages),
		)

		const payload = buildConverseStreamPayload({
			model: modelConfig,
			// Without cross-region inference prefixes, for the 1M context and service tier lists
			baseModelId: this.parseBaseModelId(modelConfig.id),
			// The same guard is reused in completePrompt so both request paths stay consistent.
			isAdaptiveThinkingModel: this.isAdaptiveThinkingModel(modelConfig.id),
			settings: this.options,
			formatted,
			thinking: metadata?.thinking,
			toolConfig: {
				tools: this.convertToolsForBedrock(metadata?.tools ?? []),
				toolChoice: this.convertToolChoiceForBedrock(metadata?.tool_choice),
			},
		})

		// Aborted after a 10 minute timeout, or by the task's signal (Stop closes the HTTP request)
		const controller = createRequestAbortController(metadata?.signal)
		let timeoutId: NodeJS.Timeout | undefined

		try {
			timeoutId = setTimeout(
				() => {
					controller.abort()
				},
				10 * 60 * 1000,
			)

			const command = new ConverseStreamCommand(payload)
			const response = await this.client.send(command, {
				abortSignal: controller.signal,
			})

			if (!response.stream) {
				clearTimeout(timeoutId)
				throw new Error("No stream available in the response")
			}

			yield* processBedrockStream(response.stream, {
				onInvokedModelId: (invokedModelId) => this.useInvokedModelForCost(invokedModelId, modelConfig.id),
			})

			// Clear timeout after stream completes
			clearTimeout(timeoutId)
		} catch (error: unknown) {
			// Clear timeout on error
			clearTimeout(timeoutId)

			yield* bedrockStreamFailure(error, {
				providerName: this.providerName,
				modelId: modelConfig.id,
				context: this.errorContext(),
			})
		}
	}

	/**
	 * A prompt router reported the model it invoked: base pricing, context window, caching etc.
	 * on that model, but keep the router's id so subsequent requests are sent back through the
	 * router.
	 */
	private useInvokedModelForCost(invokedModelId: string, routerModelId: string): void {
		const invokedArnInfo = this.parseArn(invokedModelId)
		const invokedModel = this.getModelById(invokedArnInfo.modelId as string, invokedArnInfo.modelType)
		if (invokedModel) {
			invokedModel.id = routerModelId
			this.costModelConfig = invokedModel
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		return (await this.completePromptWithUsage(prompt)).text
	}

	async completePromptWithUsage(prompt: string): Promise<CompletionResult> {
		try {
			const modelConfig = this.getModel()

			const inferenceConfig = buildInferenceConfig(
				modelConfig,
				// Same temperature guard as createMessage: adaptive-thinking models reject it with a 400.
				{ isAdaptiveThinkingModel: this.isAdaptiveThinkingModel(modelConfig.id) },
				this.options.modelTemperature as number,
			)

			// For completePrompt, use a unique conversation ID based on the prompt
			const conversationId = `prompt_${prompt.substring(0, 20)}`

			const payload = {
				modelId: modelConfig.id,
				messages: this.convertToBedrockConverseMessages(
					[
						{
							role: "user",
							content: prompt,
						},
					],
					undefined,
					false,
					modelConfig.info,
					conversationId,
				).messages,
				inferenceConfig,
			}

			const command = new ConverseCommand(payload)
			const response = await this.client.send(command)
			// Converse reports usage in already-camelCased fields.
			const usage = response.usage
				? {
						inputTokens: response.usage.inputTokens ?? 0,
						outputTokens: response.usage.outputTokens ?? 0,
					}
				: undefined

			if (
				response?.output?.message?.content &&
				response.output.message.content.length > 0 &&
				response.output.message.content[0].text &&
				response.output.message.content[0].text.trim().length > 0
			) {
				try {
					return { text: response.output.message.content[0].text, usage }
				} catch (parseError) {
					logger.error("Failed to parse Bedrock response", {
						ctx: "bedrock",
						error: parseError instanceof Error ? parseError : String(parseError),
					})
				}
			}
			return { text: "", usage }
		} catch (error) {
			// Capture error in telemetry
			const model = this.getModel()
			const telemetryErrorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(telemetryErrorMessage, this.providerName, model.id, "completePrompt")
			TelemetryService.instance.captureException(apiError)

			// Use the extracted error handling method for all errors
			const errorResult = handleBedrockError(error, false, this.errorContext()) // false for non-streaming context
			// Since we're in a non-streaming context, we know the result is a string
			const errorMessage = errorResult as string

			// Create enhanced error for retry system. Keeps status ($metadata.httpStatusCode
			// normalized to `status`), $metadata and code.
			const enhancedError = handleProviderError(error, this.providerName, {
				messageTransformer: () => errorMessage,
			})
			if (error instanceof Error) {
				enhancedError.name = error.name
			}
			throw enhancedError
		}
	}

	/**
	 * Convert Anthropic messages to Bedrock Converse format, remembering the prompt-cache point
	 * placements per conversation so consecutive requests keep their cache points stable.
	 */
	private convertToBedrockConverseMessages(
		anthropicMessages: Anthropic.Messages.MessageParam[] | { role: string; content: string }[],
		systemMessage?: string,
		usePromptCache: boolean = false,
		modelInfo?: any,
		conversationId?: string, // Optional conversation ID to track cache points across messages
	): { system: SystemContentBlock[]; messages: Message[] } {
		const result = convertToConverseMessages({
			messages: anthropicMessages,
			systemPrompt: systemMessage,
			usePromptCache,
			modelInfo,
			previousPlacements: conversationId ? this.previousCachePointPlacements[conversationId] : undefined,
		})

		// Store cache point placements for future use if conversation ID is provided
		if (conversationId && result.placements) {
			this.previousCachePointPlacements[conversationId] = result.placements
		}

		return { system: result.system, messages: result.messages }
	}

	/************************************************************************************
	 *
	 *     MODEL IDENTIFICATION
	 *
	 *************************************************************************************/

	private costModelConfig: { id: BedrockModelId | string; info: ModelInfo } = {
		id: "",
		info: { maxTokens: 0, contextWindow: 0, supportsPromptCache: false, supportsImages: false },
	}

	private parseArn(arn: string, region?: string) {
		/*
		 * VIA Roo analysis: platform-independent Regex. It's designed to parse Amazon Bedrock ARNs and doesn't rely on any platform-specific features
		 * like file path separators, line endings, or case sensitivity behaviors. The forward slashes in the regex are properly escaped and
		 * represent literal characters in the AWS ARN format, not filesystem paths. This regex will function consistently across Windows,
		 * macOS, Linux, and any other operating system where JavaScript runs.
		 *
		 * Supports any AWS partition (aws, aws-us-gov, aws-cn, or future partitions).
		 * The partition is not captured since we don't need to use it.
		 *
		 *  This matches ARNs like:
		 *  - Foundation Model: arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-v2
		 *  - GovCloud Inference Profile: arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:inference-profile/us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0
		 *  - Prompt Router: arn:aws:bedrock:us-west-2:123456789012:prompt-router/anthropic-claude
		 *  - Inference Profile: arn:aws:bedrock:us-west-2:123456789012:inference-profile/anthropic.claude-v2
		 *  - Cross Region Inference Profile: arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0
		 *  - Custom Model (Provisioned Throughput): arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-custom-model
		 *  - Imported Model: arn:aws:bedrock:us-west-2:123456789012:imported-model/my-imported-model
		 *
		 * match[0] - The entire matched string
		 * match[1] - The region (e.g., "us-east-1", "us-gov-west-1")
		 * match[2] - The account ID (can be empty string for AWS-managed resources)
		 * match[3] - The resource type (e.g., "foundation-model")
		 * match[4] - The resource ID (e.g., "anthropic.claude-3-sonnet-20240229-v1:0")
		 */

		const arnRegex = /^arn:[^:]+:(?:bedrock|sagemaker):([^:]+):([^:]*):(?:([^/]+)\/([\w.\-:]+)|([^/]+))$/
		const match = arn.match(arnRegex)

		if (match && match[1] && match[3] && match[4]) {
			// Create the result object
			const result: {
				isValid: boolean
				region?: string
				modelType?: string
				modelId?: string
				errorMessage?: string
				crossRegionInference: boolean
			} = {
				isValid: true,
				crossRegionInference: false, // Default to false
			}

			result.modelType = match[3]
			const originalModelId = match[4]
			result.modelId = this.parseBaseModelId(originalModelId)

			// Extract the region from the first capture group
			const arnRegion = match[1]
			result.region = arnRegion

			// Check if the original model ID had a region prefix
			if (originalModelId && result.modelId !== originalModelId) {
				// If the model ID changed after parsing, it had a region prefix
				const prefix = originalModelId.replace(result.modelId, "")
				result.crossRegionInference = AwsBedrockHandler.isSystemInferenceProfile(prefix)
			}

			// Check if region in ARN matches provided region (if specified)
			if (region && arnRegion !== region) {
				result.errorMessage = `Region mismatch: The region in your ARN (${arnRegion}) does not match your selected region (${region}). This may cause access issues. The provider will use the region from the ARN.`
				result.region = arnRegion
			}

			return result
		}

		// If we get here, the regex didn't match
		return {
			isValid: false,
			region: undefined,
			modelType: undefined,
			modelId: undefined,
			errorMessage: "Invalid ARN format. ARN should follow the Amazon Bedrock ARN pattern.",
			crossRegionInference: false,
		}
	}

	//This strips any region prefix that used on cross-region model inference ARNs
	private parseBaseModelId(modelId: string): string {
		if (!modelId) {
			return modelId
		}

		// Remove AWS cross-region inference profile prefixes
		// as defined in AWS_INFERENCE_PROFILE_MAPPING
		for (const [_, inferenceProfile] of AWS_INFERENCE_PROFILE_MAPPING) {
			if (modelId.startsWith(inferenceProfile)) {
				// Remove the inference profile prefix from the model ID
				return modelId.substring(inferenceProfile.length)
			}
		}

		// Also strip Global Inference profile prefix if present
		if (modelId.startsWith("global.")) {
			return modelId.substring("global.".length)
		}

		// Return the model ID as-is for all other cases
		return modelId
	}

	//Prompt Router responses come back in a different sequence and the model used is in the response and must be fetched by name
	getModelById(modelId: string, modelType?: string): { id: BedrockModelId | string; info: ModelInfo } {
		// Try to find the model in bedrockModels
		const baseModelId = this.parseBaseModelId(modelId) as BedrockModelId

		let model
		if (baseModelId in bedrockModels) {
			//Do a deep copy of the model info so that later in the code the model id and maxTokens can be set.
			// The bedrockModels array is a constant and updating the model ID from the returned invokedModelID value
			// in a prompt router response isn't possible on the constant.
			model = { id: baseModelId, info: JSON.parse(JSON.stringify(bedrockModels[baseModelId])) }
		} else if (modelType && modelType.includes("router")) {
			model = {
				id: bedrockDefaultPromptRouterModelId,
				info: JSON.parse(JSON.stringify(bedrockModels[bedrockDefaultPromptRouterModelId])),
			}
		} else {
			// An unknown model id is kept (owner decision 5). Use heuristics for
			// the model info, then allow overrides from ProviderSettings.
			const guessed = this.guessModelInfoFromId(modelId)
			model = {
				id: baseModelId,
				info: {
					...JSON.parse(JSON.stringify(bedrockModels[bedrockDefaultModelId])),
					...guessed,
				},
			}
		}

		// Always allow user to override detected/guessed maxTokens and contextWindow
		if (this.options.modelMaxTokens && this.options.modelMaxTokens > 0) {
			model.info.maxTokens = this.options.modelMaxTokens
		}
		if (this.options.awsModelContextWindow && this.options.awsModelContextWindow > 0) {
			model.info.contextWindow = this.options.awsModelContextWindow
		}

		return model
	}

	override getModel(): {
		id: BedrockModelId | string
		info: ModelInfo
		maxTokens?: number
		temperature?: number
		reasoning?: any
		reasoningBudget?: number
	} {
		if (this.costModelConfig?.id?.trim().length > 0) {
			// Get model params for cost model config
			const params = getModelParams({
				format: "anthropic",
				modelId: this.costModelConfig.id,
				model: this.costModelConfig.info,
				settings: this.options,
				defaultTemperature: BEDROCK_DEFAULT_TEMPERATURE,
			})
			return { ...this.costModelConfig, ...params }
		}

		let modelConfig = undefined

		// If custom ARN is provided, use it
		if (this.options.awsCustomArn) {
			modelConfig = this.getModelById(this.arnInfo.modelId, this.arnInfo.modelType)

			//If the user entered an ARN for a foundation-model they've done the same thing as picking from our list of options.
			//We leave the model data matching the same as if a drop-down input method was used by not overwriting the model ID with the user input ARN
			//Otherwise the ARN is not a foundation-model resource type that ARN should be used as the identifier in Bedrock interactions
			if (this.arnInfo.modelType !== "foundation-model") modelConfig.id = this.options.awsCustomArn
		} else {
			//a model was selected from the drop down. `custom-arn` is the settings
			//UI's "use a custom ARN" option, not a model id: without an ARN it
			//selects the default model, like an empty model id.
			const selectedModelId = this.options.apiModelId === "custom-arn" ? undefined : this.options.apiModelId
			modelConfig = this.getModelById(selectedModelId || bedrockDefaultModelId)

			// Apply Global Inference prefix if enabled and supported (takes precedence over cross-region)
			const baseIdForGlobal = this.parseBaseModelId(modelConfig.id)
			if (
				this.options.awsUseGlobalInference &&
				BEDROCK_GLOBAL_INFERENCE_MODEL_IDS.includes(baseIdForGlobal as any)
			) {
				modelConfig.id = `global.${baseIdForGlobal}`
			}
			// Otherwise, add cross-region inference prefix if enabled
			else if (this.options.awsUseCrossRegionInference && this.options.awsRegion) {
				const prefix = AwsBedrockHandler.getPrefixForRegion(this.options.awsRegion)
				if (prefix) {
					modelConfig.id = `${prefix}${modelConfig.id}`
				}
			}
		}

		// Check if 1M context is enabled for supported Claude 4 models
		// Use parseBaseModelId to handle cross-region inference prefixes
		const baseModelId = this.parseBaseModelId(modelConfig.id)
		if (BEDROCK_1M_CONTEXT_MODEL_IDS.includes(baseModelId as any) && this.options.awsBedrock1MContext) {
			// Update context window and pricing to 1M tier when 1M context beta is enabled
			const tier = modelConfig.info.tiers?.[0]
			modelConfig.info = {
				...modelConfig.info,
				contextWindow: tier?.contextWindow ?? 1_000_000,
				inputPrice: tier?.inputPrice ?? modelConfig.info.inputPrice,
				outputPrice: tier?.outputPrice ?? modelConfig.info.outputPrice,
				cacheWritesPrice: tier?.cacheWritesPrice ?? modelConfig.info.cacheWritesPrice,
				cacheReadsPrice: tier?.cacheReadsPrice ?? modelConfig.info.cacheReadsPrice,
			}
		}

		// Get model params including reasoning configuration
		const params = getModelParams({
			format: "anthropic",
			modelId: modelConfig.id,
			model: modelConfig.info,
			settings: this.options,
			defaultTemperature: BEDROCK_DEFAULT_TEMPERATURE,
		})

		// Apply service tier pricing if specified and model supports it
		const baseModelIdForTier = this.parseBaseModelId(modelConfig.id)
		if (this.options.awsBedrockServiceTier && BEDROCK_SERVICE_TIER_MODEL_IDS.includes(baseModelIdForTier as any)) {
			const pricingMultiplier = BEDROCK_SERVICE_TIER_PRICING[this.options.awsBedrockServiceTier]
			if (pricingMultiplier && pricingMultiplier !== 1.0) {
				// Apply pricing multiplier to all price fields
				modelConfig.info = {
					...modelConfig.info,
					inputPrice: modelConfig.info.inputPrice
						? modelConfig.info.inputPrice * pricingMultiplier
						: undefined,
					outputPrice: modelConfig.info.outputPrice
						? modelConfig.info.outputPrice * pricingMultiplier
						: undefined,
					cacheWritesPrice: modelConfig.info.cacheWritesPrice
						? modelConfig.info.cacheWritesPrice * pricingMultiplier
						: undefined,
					cacheReadsPrice: modelConfig.info.cacheReadsPrice
						? modelConfig.info.cacheReadsPrice * pricingMultiplier
						: undefined,
				}
			}
		}

		// Don't override maxTokens/contextWindow here; handled in getModelById (and includes user overrides)
		return { ...modelConfig, ...params } as {
			id: BedrockModelId | string
			info: ModelInfo
			maxTokens?: number
			temperature?: number
			reasoning?: any
			reasoningBudget?: number
		}
	}

	/************************************************************************************
	 *
	 *     CACHE
	 *
	 *************************************************************************************/

	// Store previous cache point placements for maintaining consistency across consecutive messages
	private previousCachePointPlacements: { [conversationId: string]: any[] } = {}

	/************************************************************************************
	 *
	 *     NATIVE TOOLS
	 *
	 *************************************************************************************/

	private convertToolsForBedrock(tools: OpenAI.Chat.ChatCompletionTool[]): Tool[] {
		return convertToolsForBedrock(tools)
	}

	private convertToolChoiceForBedrock(
		toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
	): ToolChoice | undefined {
		return convertToolChoiceForBedrock(toolChoice)
	}

	/************************************************************************************
	 *
	 *     AMAZON REGIONS
	 *
	 *************************************************************************************/

	private static getPrefixForRegion(region: string): string | undefined {
		// Use AWS recommended inference profile prefixes
		// Array is pre-sorted by pattern length (descending) to ensure more specific patterns match first
		for (const [regionPattern, inferenceProfile] of AWS_INFERENCE_PROFILE_MAPPING) {
			if (region.startsWith(regionPattern)) {
				return inferenceProfile
			}
		}

		return undefined
	}

	private static isSystemInferenceProfile(prefix: string): boolean {
		// Check if the prefix is defined in AWS_INFERENCE_PROFILE_MAPPING
		for (const [_, inferenceProfile] of AWS_INFERENCE_PROFILE_MAPPING) {
			if (prefix === inferenceProfile) {
				return true
			}
		}
		return false
	}

	/************************************************************************************
	 *
	 *     ERROR HANDLING
	 *
	 *************************************************************************************/

	/** What the error messages and logs need from this handler (see bedrock/errors.ts). */
	private errorContext(): BedrockErrorContext {
		return {
			getModel: () => this.getModel(),
			clientConfig: this.client?.config,
			customArn: this.options.awsCustomArn,
		}
	}
}
