/**
 * Bedrock error classification and messages, split out of AwsBedrockHandler.
 * bedrockStreamFailure is the createMessage catch block: throttling errors are rethrown for the
 * retry loop, every other error yields an error text chunk and a zero usage chunk and is then
 * rethrown with the user-facing message.
 */
import { type ModelInfo, ApiProviderError } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { logger } from "../../../utils/logging"
import type { ApiStreamChunk } from "../../transform/stream"
import { getApiErrorStatus } from "../../apiErrors"
import { handleProviderError } from "../utils/error-handler"

export interface BedrockErrorContext {
	/** Read lazily, and only for Error instances, to fill {modelId} and {contextWindow}. */
	getModel(): { id: string; info: ModelInfo }
	/** The Bedrock client's config; `region` is a value or a provider function. */
	clientConfig?: { region?: unknown }
	customArn?: string
}

interface BedrockErrorDefinition {
	patterns: string[] // Strings to match in lowercase error message or name
	messageTemplate: string // Template with placeholders like {region}, {modelId}, etc.
	logLevel: "error" | "warn" | "info" // Log level for this error type
}

/** Error type definitions for Bedrock API errors */
const BEDROCK_ERROR_TYPES: Record<string, BedrockErrorDefinition> = {
	ACCESS_DENIED: {
		patterns: ["access", "denied", "permission"],
		messageTemplate: `You don't have access to the model specified.

Please verify:
1. Try cross-region inference if you're using a foundation model
2. If using an ARN, verify the ARN is correct and points to a valid model
3. Your AWS credentials have permission to access this model (check IAM policies)
4. The region in the ARN matches the region where the model is deployed
5. If using a provisioned model, ensure it's active and not in a failed state`,
		logLevel: "error",
	},
	NOT_FOUND: {
		patterns: ["not found", "does not exist"],
		messageTemplate: `The specified ARN does not exist or is invalid. Please check:

1. The ARN format is correct (arn:aws:bedrock:region:account-id:resource-type/resource-name)
2. The model exists in the specified region
3. The account ID in the ARN is correct`,
		logLevel: "error",
	},
	THROTTLING: {
		patterns: [
			"throttl",
			"rate",
			"limit",
			"bedrock is unable to process your request", // Amazon Bedrock specific throttling message
			"please wait",
			"quota exceeded",
			"service unavailable",
			"busy",
			"overloaded",
			"too many requests",
			"request limit",
			"concurrent requests",
		],
		messageTemplate: `Request was throttled or rate limited. Please try:
1. Reducing the frequency of requests
2. If using a provisioned model, check its throughput settings
3. Contact AWS support to request a quota increase if needed

`,
		logLevel: "error",
	},
	TOO_MANY_TOKENS: {
		patterns: ["too many tokens", "token limit exceeded", "context length", "maximum context length"],
		messageTemplate: `"Too many tokens" error detected.
Possible Causes:
1. Input exceeds model's context window limit
2. Rate limiting (too many tokens per minute)
3. Quota exceeded for token usage
4. Other token-related service limitations

Suggestions:
1. Reduce the size of your input
2. Split your request into smaller chunks
3. Use a model with a larger context window
4. If rate limited, reduce request frequency
5. Check your Amazon Bedrock quotas and limits

`,
		logLevel: "error",
	},
	SERVICE_QUOTA_EXCEEDED: {
		patterns: ["service quota exceeded", "service quota", "quota exceeded for model"],
		messageTemplate: `Service quota exceeded. This error indicates you've reached AWS service limits.

Please try:
1. Contact AWS support to request a quota increase
2. Reduce request frequency temporarily
3. Check your Amazon Bedrock quotas in the AWS console
4. Consider using a different model or region with available capacity

`,
		logLevel: "error",
	},
	MODEL_NOT_READY: {
		patterns: ["model not ready", "model is not ready", "provisioned throughput not ready", "model loading"],
		messageTemplate: `Model is not ready or still loading. This can happen with:
1. Provisioned throughput models that are still initializing
2. Custom models that are being loaded
3. Models that are temporarily unavailable

Please try:
1. Wait a few minutes and retry
2. Check the model status in Amazon Bedrock console
3. Verify the model is properly provisioned

`,
		logLevel: "error",
	},
	INTERNAL_SERVER_ERROR: {
		patterns: ["internal server error", "internal error", "server error", "service error"],
		messageTemplate: `Amazon Bedrock internal server error. This is a temporary service issue.

Please try:
1. Retry the request after a brief delay
2. If the error persists, check AWS service health
3. Contact AWS support if the issue continues

`,
		logLevel: "error",
	},
	ON_DEMAND_NOT_SUPPORTED: {
		patterns: ["with on-demand throughput isn’t supported."],
		messageTemplate: `
1. Try enabling cross-region inference in settings.
2. Or, create an inference profile and then leverage the "Use custom ARN..." option of the model selector in settings.`,
		logLevel: "error",
	},
	ABORT: {
		patterns: ["aborterror"], // This will match error.name.toLowerCase() for AbortError
		messageTemplate: `Request was aborted: The operation timed out or was manually cancelled. Please try again or check your network connection.`,
		logLevel: "info",
	},
	INVALID_ARN_FORMAT: {
		patterns: ["invalid_arn_format:", "invalid arn format"],
		messageTemplate: `Invalid ARN format. ARN should follow the pattern: arn:aws:bedrock:region:account-id:resource-type/resource-name`,
		logLevel: "error",
	},
	VALIDATION_ERROR: {
		patterns: [
			"input tag",
			"does not match any of the expected tags",
			"field required",
			"validation",
			"invalid parameter",
		],
		messageTemplate: `Parameter validation error: {errorMessage}

This error indicates that the request parameters don't match Amazon Bedrock's expected format.

Common causes:
1. Extended thinking parameter format is incorrect
2. Model-specific parameters are not supported by this model
3. API parameter structure has changed

Please check:
- Model supports the requested features (extended thinking, etc.)
- Parameter format matches Amazon Bedrock specification
- Model ID is correct for the requested features`,
		logLevel: "error",
	},
	// Default/generic error
	GENERIC: {
		patterns: [], // Empty patterns array means this is the default
		messageTemplate: `Unknown Error: {errorMessage}`,
		logLevel: "error",
	},
}

/** Determines the error type based on the status, the error name or the message */
export function getBedrockErrorType(error: unknown): string {
	if (!(error instanceof Error)) {
		return "GENERIC"
	}

	// Check for HTTP 429 status code (Too Many Requests)
	if ((error as any).status === 429 || (error as any).$metadata?.httpStatusCode === 429) {
		return "THROTTLING"
	}

	// Check for Amazon Bedrock specific throttling exception names
	if ((error as any).name === "ThrottlingException" || (error as any).__type === "ThrottlingException") {
		return "THROTTLING"
	}

	const errorMessage = error.message.toLowerCase()
	const errorName = error.name.toLowerCase()

	// Check each error type's patterns in order of specificity (most specific first)
	const errorTypeOrder = [
		"SERVICE_QUOTA_EXCEEDED", // Most specific - check before THROTTLING
		"MODEL_NOT_READY",
		"TOO_MANY_TOKENS",
		"INTERNAL_SERVER_ERROR",
		"ON_DEMAND_NOT_SUPPORTED",
		"NOT_FOUND",
		"ACCESS_DENIED",
		"THROTTLING", // Less specific - check after more specific patterns
	]

	for (const errorType of errorTypeOrder) {
		const definition = BEDROCK_ERROR_TYPES[errorType]
		if (!definition) continue

		// If any pattern matches in either message or name, return this error type
		if (definition.patterns.some((pattern) => errorMessage.includes(pattern) || errorName.includes(pattern))) {
			return errorType
		}
	}

	return "GENERIC"
}

/** Formats an error message based on the error type */
export function formatBedrockErrorMessage(error: unknown, errorType: string, context: BedrockErrorContext): string {
	const definition = BEDROCK_ERROR_TYPES[errorType] || BEDROCK_ERROR_TYPES.GENERIC
	let template = definition.messageTemplate

	const templateVars: Record<string, string> = {}

	if (error instanceof Error) {
		templateVars.errorMessage = error.message
		templateVars.errorName = error.name

		const modelConfig = context.getModel()
		templateVars.modelId = modelConfig.id
		templateVars.contextWindow = String(modelConfig.info.contextWindow || "unknown")
	}

	const region =
		typeof context.clientConfig?.region === "function"
			? context.clientConfig?.region()
			: context.clientConfig?.region
	templateVars.regionInfo = `(${region})`

	for (const [key, value] of Object.entries(templateVars)) {
		template = template.replace(new RegExp(`{${key}}`, "g"), value || "")
	}

	return template
}

/**
 * Logs the error and returns stream chunks (streaming context) or the message with the
 * "Bedrock completion error: " prefix (completePrompt).
 */
export function handleBedrockError(
	error: unknown,
	isStreamContext: boolean,
	context: BedrockErrorContext,
): string | Array<{ type: string; text?: string; inputTokens?: number; outputTokens?: number }> {
	const errorType = getBedrockErrorType(error)
	const errorMessage = formatBedrockErrorMessage(error, errorType, context)

	const definition = BEDROCK_ERROR_TYPES[errorType]
	const logMethod = definition.logLevel
	const contextName = isStreamContext ? "createMessage" : "completePrompt"
	logger[logMethod](`${errorType} error in ${contextName}`, {
		ctx: "bedrock",
		customArn: context.customArn,
		errorType,
		errorMessage: error instanceof Error ? error.message : String(error),
		...(error instanceof Error && error.stack ? { errorStack: error.stack } : {}),
		...(context.clientConfig?.region ? { clientRegion: context.clientConfig.region } : {}),
	})

	if (isStreamContext) {
		return [
			{ type: "text", text: `Error: ${errorMessage}` },
			{ type: "usage", inputTokens: 0, outputTokens: 0 },
		]
	}
	return `Bedrock completion error: ${errorMessage}`
}

/**
 * The createMessage failure path: reports the error to telemetry, then either rethrows a
 * throttling error at once (the retry loop in TaskApiLoop expects the error on the first
 * chunk for its exponential backoff) or yields the error chunks and throws the enhanced error.
 */
export async function* bedrockStreamFailure(
	error: unknown,
	options: { providerName: string; modelId: string; context: BedrockErrorContext },
): AsyncGenerator<ApiStreamChunk, never> {
	const { providerName, modelId, context } = options

	// Capture error in telemetry before processing
	const errorMessage = error instanceof Error ? error.message : String(error)
	const apiError = new ApiProviderError(errorMessage, providerName, modelId, "createMessage")
	TelemetryService.instance.captureException(apiError)

	if (getBedrockErrorType(error) === "THROTTLING") {
		if (error instanceof Error) {
			// The AWS SDK keeps the HTTP status in $metadata.httpStatusCode only;
			// the retry loop and the background-model fallback read `status`.
			const status = getApiErrorStatus(error)
			if (status !== undefined && (error as any).status === undefined) {
				;(error as any).status = status
			}
			throw error
		} else {
			throw new Error("Throttling error occurred")
		}
	}

	const errorChunks = handleBedrockError(error, true, context) as ApiStreamChunk[]
	for (const chunk of errorChunks) {
		yield chunk
	}

	// Re-throw with enhanced error message for retry system
	const enhancedErrorMessage = formatBedrockErrorMessage(error, getBedrockErrorType(error), context)
	// Keeps status ($metadata.httpStatusCode normalized to `status`), $metadata and code.
	const enhancedError = handleProviderError(error, providerName, {
		messageTransformer: () => (error instanceof Error ? enhancedErrorMessage : "An unknown error occurred"),
	})
	if (error instanceof Error) {
		enhancedError.name = error.name
	}
	throw enhancedError
}
