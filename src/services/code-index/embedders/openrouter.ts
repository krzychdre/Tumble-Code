import { OpenAI } from "openai"
import { EmbedderInfo } from "../interfaces/embedder"
import { getDefaultModelId } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import { handleProviderError } from "../../../api/providers/utils/error-handler"
import { BaseHttpEmbedder, EmbedBatchResult, decodeEmbedding } from "./base-http-embedder"

// Default provider name when no specific provider is selected
export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

interface EmbeddingItem {
	embedding: string | number[]
	[key: string]: any
}

interface OpenRouterEmbeddingResponse {
	data: EmbeddingItem[]
	usage?: {
		prompt_tokens?: number
		total_tokens?: number
	}
}

/**
 * OpenRouter implementation of the embedder interface.
 * OpenRouter provides an OpenAI-compatible API that gives access to hundreds of models
 * through a single endpoint, automatically handling fallbacks and cost optimization.
 * Batching, retry, rate limiting and validation come from BaseHttpEmbedder.
 */
export class OpenRouterEmbedder extends BaseHttpEmbedder {
	private readonly embeddingsClient: OpenAI
	private readonly specificProvider?: string

	/**
	 * Creates a new OpenRouter embedder
	 * @param apiKey The API key for authentication
	 * @param modelId Optional model identifier (defaults to "openai/text-embedding-3-large")
	 * @param maxItemTokens Optional maximum tokens per item (defaults to MAX_ITEM_TOKENS)
	 * @param specificProvider Optional specific provider to route requests to
	 */
	constructor(apiKey: string, modelId?: string, maxItemTokens?: number, specificProvider?: string) {
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		super({
			defaultModelId: modelId || getDefaultModelId("openrouter"),
			maxItemTokens,
			queryPrefixProvider: "openrouter",
			rateLimitKey: OPENROUTER_BASE_URL,
		})

		// Only set specificProvider if it's not the default value
		this.specificProvider =
			specificProvider && specificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME ? specificProvider : undefined

		// Wrap OpenAI client creation to handle invalid API key characters
		try {
			this.embeddingsClient = new OpenAI({
				baseURL: OPENROUTER_BASE_URL,
				apiKey: apiKey,
				defaultHeaders: {
					"HTTP-Referer": "https://github.com/RooCodeInc/Roo-Code",
					"X-Title": "Roo Code",
				},
			})
		} catch (error) {
			// Use the error handler to transform ByteString conversion errors
			throw handleProviderError(error, "OpenRouter")
		}
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "openrouter",
		}
	}

	protected get telemetryName(): string {
		return "OpenRouterEmbedder"
	}

	protected async embedBatch(texts: string[], model: string): Promise<EmbedBatchResult> {
		const requestParams: any = {
			input: texts,
			model: model,
			// OpenAI package (as of v4.78.1) has a parsing issue that truncates embedding dimensions to 256
			// when processing numeric arrays, which breaks compatibility with models using larger dimensions.
			// By requesting base64 encoding, we bypass the package's parser and handle decoding ourselves.
			encoding_format: "base64",
		}

		// Add provider routing if a specific provider is set
		if (this.specificProvider) {
			requestParams.provider = {
				order: [this.specificProvider],
				only: [this.specificProvider],
				allow_fallbacks: false,
			}
		}

		const response = (await this.embeddingsClient.embeddings.create(requestParams)) as OpenRouterEmbeddingResponse

		return {
			embeddings: (response?.data ?? []).map((item) => decodeEmbedding(item.embedding)),
			usage: {
				promptTokens: response?.usage?.prompt_tokens || 0,
				totalTokens: response?.usage?.total_tokens || 0,
			},
		}
	}
}
