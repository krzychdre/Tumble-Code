import { OpenAI } from "openai"
import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo } from "../interfaces"
import { t } from "../../../i18n"
import { handleProviderError } from "../../../api/providers/utils/error-handler"
import { BaseHttpEmbedder, EmbedBatchResult } from "./base-http-embedder"

/** Rate-limit key for the OpenAI embeddings endpoint (the client always uses the SDK default). */
const OPENAI_ENDPOINT = "https://api.openai.com/v1"

/**
 * OpenAI implementation of the embedder interface.
 * Batching, retry, rate limiting and validation come from BaseHttpEmbedder; this class only
 * owns its OpenAI SDK client.
 */
export class OpenAiEmbedder extends BaseHttpEmbedder {
	private readonly embeddingsClient: OpenAI

	/**
	 * Creates a new OpenAI embedder
	 * @param options API handler options; only the API key and the embedding model are used
	 */
	constructor(options: ApiHandlerOptions & { openAiEmbeddingModelId?: string }) {
		super({
			defaultModelId: options.openAiEmbeddingModelId || "text-embedding-3-small",
			queryPrefixProvider: "openai",
			rateLimitKey: OPENAI_ENDPOINT,
		})

		// `||`, not `??`: openai 7 rejects an empty key before sending, openai 5 did not.
		const apiKey = options.openAiNativeApiKey || "not-provided"

		// Wrap OpenAI client creation to handle invalid API key characters
		try {
			this.embeddingsClient = new OpenAI({ apiKey })
		} catch (error) {
			// Use the error handler to transform ByteString conversion errors
			throw handleProviderError(error, "OpenAI")
		}
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "openai",
		}
	}

	protected get telemetryName(): string {
		return "OpenAiEmbedder"
	}

	protected override invalidResponseMessage(): string {
		return t("embeddings:openai.invalidResponseFormat")
	}

	protected async embedBatch(texts: string[], model: string): Promise<EmbedBatchResult> {
		const response = await this.embeddingsClient.embeddings.create({
			input: texts,
			model: model,
		})

		return {
			embeddings: (response?.data ?? []).map((item) => item.embedding),
			usage: {
				promptTokens: response?.usage?.prompt_tokens || 0,
				totalTokens: response?.usage?.total_tokens || 0,
			},
		}
	}
}
