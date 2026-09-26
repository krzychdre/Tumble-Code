import { OpenAI } from "openai"
import { EmbedderInfo } from "../interfaces/embedder"
import { getDefaultModelId } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import { HttpError } from "../shared/validation-helpers"
import { handleProviderError } from "../../../api/providers/utils/error-handler"
import { BaseHttpEmbedder, EmbedBatchResult, decodeEmbedding } from "./base-http-embedder"

interface EmbeddingItem {
	embedding: string | number[]
	[key: string]: any
}

interface OpenAIEmbeddingResponse {
	data: EmbeddingItem[]
	usage?: {
		prompt_tokens?: number
		total_tokens?: number
	}
}

/**
 * Known URL shapes of a full embeddings endpoint (as opposed to a base URL the SDK appends
 * `/embeddings` to). We cannot cover every provider, only the common ones.
 */
const FULL_ENDPOINT_PATTERNS = [
	// Azure OpenAI: /deployments/{deployment-name}/embeddings
	/\/deployments\/[^/]+\/embeddings(\?|$)/,
	// Azure Databricks: /serving-endpoints/{endpoint-name}/invocations
	/\/serving-endpoints\/[^/]+\/invocations(\?|$)/,
	// Direct endpoints: ends with /embeddings (before query params)
	/\/embeddings(\?|$)/,
	// Some providers use /embed instead of /embeddings
	/\/embed(\?|$)/,
]

/**
 * OpenAI Compatible implementation of the embedder interface.
 * This embedder allows using any OpenAI-compatible API endpoint by specifying a custom baseURL.
 * Batching, retry, rate limiting and validation come from BaseHttpEmbedder.
 */
export class OpenAICompatibleEmbedder extends BaseHttpEmbedder {
	private readonly embeddingsClient: OpenAI
	private readonly baseUrl: string
	private readonly apiKey: string
	private readonly isFullUrl: boolean

	/**
	 * Creates a new OpenAI Compatible embedder
	 * @param baseUrl The base URL for the OpenAI-compatible API endpoint
	 * @param apiKey The API key for authentication
	 * @param modelId Optional model identifier (defaults to the provider's default model)
	 * @param maxItemTokens Optional maximum tokens per item (defaults to MAX_ITEM_TOKENS)
	 */
	constructor(baseUrl: string, apiKey: string, modelId?: string, maxItemTokens?: number) {
		if (!baseUrl) {
			throw new Error(t("embeddings:validation.baseUrlRequired"))
		}
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		super({
			defaultModelId: modelId || getDefaultModelId("openai-compatible"),
			maxItemTokens,
			queryPrefixProvider: "openai-compatible",
			rateLimitKey: baseUrl,
		})

		this.baseUrl = baseUrl
		this.apiKey = apiKey
		this.isFullUrl = this.isFullEndpointUrl(baseUrl)

		// Wrap OpenAI client creation to handle invalid API key characters
		try {
			this.embeddingsClient = new OpenAI({
				baseURL: baseUrl,
				apiKey: apiKey,
			})
		} catch (error) {
			// Use the error handler to transform ByteString conversion errors
			throw handleProviderError(error, "OpenAI Compatible")
		}
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "openai-compatible",
		}
	}

	protected get telemetryName(): string {
		return "OpenAICompatibleEmbedder"
	}

	protected async embedBatch(texts: string[], model: string): Promise<EmbedBatchResult> {
		const response = this.isFullUrl
			? await this.makeDirectEmbeddingRequest(this.baseUrl, texts, model)
			: ((await this.embeddingsClient.embeddings.create({
					input: texts,
					model: model,
					// OpenAI package (as of v4.78.1) has a parsing issue that truncates embedding dimensions to 256
					// when processing numeric arrays, which breaks compatibility with models using larger dimensions.
					// By requesting base64 encoding, we bypass the package's parser and handle decoding ourselves.
					encoding_format: "base64",
				})) as OpenAIEmbeddingResponse)

		return {
			embeddings: (response?.data ?? []).map((item) => decodeEmbedding(item.embedding)),
			usage: {
				promptTokens: response?.usage?.prompt_tokens || 0,
				totalTokens: response?.usage?.total_tokens || 0,
			},
		}
	}

	/**
	 * Determines if the provided URL is a full endpoint URL or a base URL that needs the endpoint appended by the SDK.
	 * @param url The URL to check
	 * @returns true if it's a full endpoint URL, false if it's a base URL
	 */
	private isFullEndpointUrl(url: string): boolean {
		return FULL_ENDPOINT_PATTERNS.some((pattern) => pattern.test(url))
	}

	/**
	 * Makes a direct HTTP request to the embeddings endpoint
	 * Used when the user provides a full endpoint URL (e.g., Azure OpenAI with query parameters)
	 * @param url The full endpoint URL
	 * @param batchTexts Array of texts to embed
	 * @param model Model identifier to use
	 * @returns Promise resolving to OpenAI-compatible response
	 */
	private async makeDirectEmbeddingRequest(
		url: string,
		batchTexts: string[],
		model: string,
	): Promise<OpenAIEmbeddingResponse> {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Azure OpenAI uses 'api-key' header, while OpenAI uses 'Authorization'
				// We'll try 'api-key' first for Azure compatibility
				"api-key": this.apiKey,
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				input: batchTexts,
				model: model,
				encoding_format: "base64",
			}),
		})

		if (!response || !response.ok) {
			const status = response?.status || 0
			let errorText = "No response"
			try {
				if (response && typeof response.text === "function") {
					errorText = await response.text()
				} else if (response) {
					errorText = `Error ${status}`
				}
			} catch {
				// Ignore text parsing errors
				errorText = `Error ${status}`
			}
			const error = new Error(`HTTP ${status}: ${errorText}`) as HttpError
			error.status = status || response?.status || 0
			throw error
		}

		try {
			return await response.json()
		} catch (e) {
			const error = new Error(`Failed to parse response JSON`) as HttpError
			error.status = response.status
			throw error
		}
	}
}
