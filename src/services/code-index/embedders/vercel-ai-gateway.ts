import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { EmbedderInfo } from "../interfaces/embedder"
import { MAX_ITEM_TOKENS } from "../constants"

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
const DEFAULT_MODEL = "openai/text-embedding-3-large"

/**
 * Vercel AI Gateway embedder: the OpenAI-compatible embedder pointed at Vercel AI Gateway's
 * embedding API.
 *
 * Supported models:
 * - openai/text-embedding-3-small (dimension: 1536)
 * - openai/text-embedding-3-large (dimension: 3072)
 * - openai/text-embedding-ada-002 (dimension: 1536)
 * - cohere/embed-v4.0 (dimension: 1024)
 * - google/gemini-embedding-001 (dimension: 768)
 * - google/text-embedding-005 (dimension: 768)
 * - google/text-multilingual-embedding-002 (dimension: 768)
 * - amazon/titan-embed-text-v2 (dimension: 1024)
 * - mistral/codestral-embed (dimension: 1536)
 * - mistral/mistral-embed (dimension: 1024)
 */
export class VercelAiGatewayEmbedder extends OpenAICompatibleEmbedder {
	/**
	 * Creates a new Vercel AI Gateway embedder
	 * @param apiKey The Vercel AI Gateway API key for authentication
	 * @param modelId The model ID to use (defaults to openai/text-embedding-3-large)
	 */
	constructor(apiKey: string, modelId?: string) {
		super(VERCEL_AI_GATEWAY_BASE_URL, apiKey, modelId || DEFAULT_MODEL, MAX_ITEM_TOKENS)
	}

	override get embedderInfo(): EmbedderInfo {
		return {
			name: "vercel-ai-gateway",
		}
	}

	protected override get telemetryName(): string {
		return "VercelAiGatewayEmbedder"
	}
}
