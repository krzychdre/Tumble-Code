import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from "@aws-sdk/client-bedrock-runtime"
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { EmbedderInfo, EmbedderValidationResult } from "../interfaces"
import { getDefaultModelId } from "../../../shared/embeddingModels"
import { Package } from "../../../shared/package"
import { t } from "../../../i18n"
import { BaseHttpEmbedder, EmbedBatchResult } from "./base-http-embedder"

/**
 * Amazon Bedrock implementation of the embedder interface.
 * Batching, retry, rate limiting and validation come from BaseHttpEmbedder.
 */
export class BedrockEmbedder extends BaseHttpEmbedder {
	private readonly bedrockClient: BedrockRuntimeClient

	/**
	 * Creates a new Amazon Bedrock embedder
	 * @param region AWS region for Bedrock service (required)
	 * @param profile AWS profile name for credentials (optional - uses default credential chain if not provided)
	 * @param modelId Optional model ID override
	 */
	constructor(region: string, profile?: string, modelId?: string) {
		if (!region) {
			throw new Error("Region is required for AWS Bedrock embedder")
		}

		super({
			defaultModelId: modelId || getDefaultModelId("bedrock"),
			queryPrefixProvider: "bedrock",
			rateLimitKey: `bedrock:${region}`,
		})

		// Initialize the Bedrock client with credentials
		// If profile is specified, use it; otherwise use default credential chain
		const credentials = profile ? fromIni({ profile }) : fromNodeProviderChain()

		this.bedrockClient = new BedrockRuntimeClient({
			userAgentAppId: `RooCode#${Package.version}`,
			region,
			credentials,
		})
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "bedrock",
		}
	}

	protected get telemetryName(): string {
		return "BedrockEmbedder"
	}

	protected override isRateLimitError(error: unknown): boolean {
		return (error as { name?: string } | undefined)?.name === "ThrottlingException"
	}

	protected override invalidResponseMessage(): string {
		return t("embeddings:bedrock.invalidResponseFormat")
	}

	protected override describeValidationError(error: unknown): EmbedderValidationResult | undefined {
		switch ((error as { name?: string } | undefined)?.name) {
			case "UnrecognizedClientException":
				return { valid: false, error: t("embeddings:bedrock.invalidCredentials") }
			case "AccessDeniedException":
				return { valid: false, error: t("embeddings:bedrock.accessDenied") }
			case "ResourceNotFoundException":
				return { valid: false, error: t("embeddings:bedrock.modelNotFound", { model: this.defaultModelId }) }
			default:
				return undefined
		}
	}

	/**
	 * Embeds a batch one text at a time: Amazon Titan models typically don't support batch
	 * embedding in a single request.
	 */
	protected async embedBatch(texts: string[], model: string): Promise<EmbedBatchResult> {
		const embeddings: number[][] = []
		let tokens = 0

		for (const text of texts) {
			const result = await this._invokeEmbeddingModel(text, model)
			embeddings.push(result.embedding)
			tokens += result.inputTextTokenCount || 0
		}

		return { embeddings, usage: { promptTokens: tokens, totalTokens: tokens } }
	}

	/**
	 * Invokes the embedding model for a single text
	 * @param text The text to embed
	 * @param model The model identifier to use
	 * @returns Promise resolving to embedding and token count
	 */
	private async _invokeEmbeddingModel(
		text: string,
		model: string,
	): Promise<{ embedding: number[]; inputTextTokenCount?: number }> {
		let requestBody: any
		let modelId = model

		// Prepare the request body based on the model
		if (model.startsWith("amazon.nova-2-multimodal")) {
			// Nova multimodal embeddings use a task-based format with embeddingParams
			// Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/embeddings-nova.html
			requestBody = {
				taskType: "SINGLE_EMBEDDING",
				singleEmbeddingParams: {
					embeddingPurpose: "GENERIC_INDEX",
					embeddingDimension: 1024, // Nova supports 1024 or 3072
					text: {
						truncationMode: "END",
						value: text,
					},
				},
			}
		} else if (model.startsWith("amazon.titan-embed")) {
			requestBody = {
				inputText: text,
			}
		} else if (model.startsWith("cohere.embed-v4")) {
			// Cohere Embed v4 requires embedding_types parameter
			requestBody = {
				texts: [text],
				input_type: "search_document",
				embedding_types: ["float"],
			}
		} else if (model.startsWith("cohere.embed")) {
			// Cohere Embed v3 format
			requestBody = {
				texts: [text],
				input_type: "search_document",
			}
		} else {
			// Default to Titan format
			requestBody = {
				inputText: text,
			}
		}

		const params: InvokeModelCommandInput = {
			modelId,
			body: JSON.stringify(requestBody),
			contentType: "application/json",
			accept: "application/json",
		}

		const command = new InvokeModelCommand(params)

		const response = await this.bedrockClient.send(command)

		// Parse the response
		const responseBody = JSON.parse(new TextDecoder().decode(response.body))

		// Extract embedding based on model type
		if (model.startsWith("amazon.nova-2-multimodal")) {
			// Nova multimodal returns { embeddings: [{ embedding: [...] }] }
			// Reference: AWS Bedrock documentation
			return {
				embedding: responseBody.embeddings?.[0]?.embedding || responseBody.embedding,
				inputTextTokenCount: responseBody.inputTextTokenCount,
			}
		} else if (model.startsWith("amazon.titan-embed")) {
			return {
				embedding: responseBody.embedding,
				inputTextTokenCount: responseBody.inputTextTokenCount,
			}
		} else if (model.startsWith("cohere.embed-v4")) {
			// Cohere Embed v4 returns { embeddings: { float: [[...]] } }
			return {
				embedding: responseBody.embeddings?.float?.[0] || responseBody.embeddings?.[0],
			}
		} else if (model.startsWith("cohere.embed")) {
			// Cohere Embed v3 returns { embeddings: [[...]] }
			return {
				embedding: responseBody.embeddings[0],
			}
		} else {
			// Default to Titan format
			return {
				embedding: responseBody.embedding,
				inputTextTokenCount: responseBody.inputTextTokenCount,
			}
		}
	}
}
