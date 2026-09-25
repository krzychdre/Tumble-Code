import type { EmbedderProvider } from "@roo-code/types"

/** Shown in a secret field when the extension reports that the secret is already stored. */
export const SECRET_PLACEHOLDER = "••••••••••••••••"

export const DEFAULT_QDRANT_URL = "http://localhost:6333"
export const DEFAULT_OLLAMA_URL = "http://localhost:11434"

export interface LocalCodeIndexSettings {
	// Global state settings
	codebaseIndexEnabled: boolean
	codebaseIndexQdrantUrl: string
	codebaseIndexEmbedderProvider: EmbedderProvider
	codebaseIndexEmbedderBaseUrl?: string
	codebaseIndexEmbedderModelId: string
	codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
	codebaseIndexSearchMaxResults?: number
	codebaseIndexSearchMinScore?: number

	// Bedrock-specific settings
	codebaseIndexBedrockRegion?: string
	codebaseIndexBedrockProfile?: string

	// Secret settings (start empty, will be loaded separately)
	codeIndexOpenAiKey?: string
	codeIndexQdrantApiKey?: string
	codebaseIndexOpenAiCompatibleBaseUrl?: string
	codebaseIndexOpenAiCompatibleApiKey?: string
	codebaseIndexGeminiApiKey?: string
	codebaseIndexMistralApiKey?: string
	codebaseIndexVercelAiGatewayApiKey?: string
	codebaseIndexOpenRouterApiKey?: string
	codebaseIndexOpenRouterSpecificProvider?: string
}

export type CodeIndexSettingKey = keyof LocalCodeIndexSettings

export type CodeIndexTranslate = (key: string, options?: Record<string, any>) => string
