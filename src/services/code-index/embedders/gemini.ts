import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
const DEFAULT_MODEL = "gemini-embedding-001"

/**
 * Deprecated models that are automatically migrated to their replacements.
 * Users with these models configured will be silently migrated without interruption.
 */
const DEPRECATED_MODEL_MIGRATIONS: Record<string, string> = {
	"text-embedding-004": "gemini-embedding-001",
}

/**
 * Gemini embedder: the OpenAI-compatible embedder pointed at Google's OpenAI-compatible
 * Gemini endpoint, with Gemini's smaller per-item token limit.
 *
 * Supported models:
 * - gemini-embedding-001 (dimension: 3072)
 *
 * Note: text-embedding-004 has been deprecated and is automatically
 * migrated to gemini-embedding-001 for backward compatibility.
 */
export class GeminiEmbedder extends OpenAICompatibleEmbedder {
	/**
	 * Creates a new Gemini embedder
	 * @param apiKey The Gemini API key for authentication
	 * @param modelId The model ID to use (defaults to gemini-embedding-001)
	 */
	constructor(apiKey: string, modelId?: string) {
		const migratedModelId = modelId ? (DEPRECATED_MODEL_MIGRATIONS[modelId] ?? modelId) : undefined
		super(GEMINI_BASE_URL, apiKey, migratedModelId || DEFAULT_MODEL, GEMINI_MAX_ITEM_TOKENS)
	}

	override get embedderInfo(): EmbedderInfo {
		return {
			name: "gemini",
		}
	}

	protected override get telemetryName(): string {
		return "GeminiEmbedder"
	}
}
