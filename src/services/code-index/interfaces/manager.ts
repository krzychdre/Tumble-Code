export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error" | "Stopping"
export type EmbedderProvider =
	| "openai"
	| "ollama"
	| "openai-compatible"
	| "gemini"
	| "mistral"
	| "bedrock"
	| "openrouter"

export interface IndexProgressUpdate {
	systemStatus: IndexingState
	message?: string
	processedBlockCount?: number
	totalBlockCount?: number
}
