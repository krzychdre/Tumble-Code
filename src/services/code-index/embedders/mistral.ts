import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { EmbedderInfo } from "../interfaces/embedder"
import { MAX_ITEM_TOKENS } from "../constants"

const MISTRAL_BASE_URL = "https://api.mistral.ai/v1"
const DEFAULT_MODEL = "codestral-embed-2505"

/**
 * Mistral embedder: the OpenAI-compatible embedder pointed at Mistral's embedding API.
 *
 * Supported models:
 * - codestral-embed-2505 (dimension: 1536)
 */
export class MistralEmbedder extends OpenAICompatibleEmbedder {
	/**
	 * Creates a new Mistral embedder
	 * @param apiKey The Mistral API key for authentication
	 * @param modelId The model ID to use (defaults to codestral-embed-2505)
	 */
	constructor(apiKey: string, modelId?: string) {
		// MAX_ITEM_TOKENS is the per-item token limit (8191), not the embedding dimension
		super(MISTRAL_BASE_URL, apiKey, modelId || DEFAULT_MODEL, MAX_ITEM_TOKENS)
	}

	override get embedderInfo(): EmbedderInfo {
		return {
			name: "mistral",
		}
	}

	protected override get telemetryName(): string {
		return "MistralEmbedder"
	}
}
