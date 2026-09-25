import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo, EmbedderValidationResult } from "../interfaces"
import { t } from "../../../i18n"
import { withValidationErrorHandling, HttpError } from "../shared/validation-helpers"
import { BaseHttpEmbedder, EmbedBatchResult } from "./base-http-embedder"

// Timeout constants for Ollama API requests
const OLLAMA_EMBEDDING_TIMEOUT_MS = 60000 // 60 seconds for embedding requests
const OLLAMA_VALIDATION_TIMEOUT_MS = 30000 // 30 seconds for validation requests

/**
 * Implements the IEmbedder interface using a local Ollama instance.
 * Batching, retry and rate limiting come from BaseHttpEmbedder; validation is Ollama's own,
 * because it first checks that the service runs and the model is installed.
 */
export class CodeIndexOllamaEmbedder extends BaseHttpEmbedder {
	private readonly baseUrl: string

	constructor(options: ApiHandlerOptions) {
		// Normalize the baseUrl by removing all trailing slashes
		const baseUrl = (options.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "")

		super({
			defaultModelId: options.ollamaModelId || "nomic-embed-text:latest",
			queryPrefixProvider: "ollama",
			rateLimitKey: baseUrl,
			reportsUsage: false,
		})

		this.baseUrl = baseUrl
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "ollama",
		}
	}

	protected get telemetryName(): string {
		return "OllamaEmbedder"
	}

	protected async embedBatch(texts: string[], model: string): Promise<EmbedBatchResult> {
		// Add timeout to prevent indefinite hanging
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), OLLAMA_EMBEDDING_TIMEOUT_MS)

		let response: Response
		try {
			response = await fetch(`${this.baseUrl}/api/embed`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					input: texts,
				}),
				signal: controller.signal,
			})
		} finally {
			clearTimeout(timeoutId)
		}

		if (!response.ok) {
			let errorBody = t("embeddings:ollama.couldNotReadErrorBody")
			try {
				errorBody = await response.text()
			} catch (e) {
				// Ignore error reading body
			}
			const error = new Error(
				t("embeddings:ollama.requestFailed", {
					status: response.status,
					statusText: response.statusText,
					errorBody,
				}),
			) as HttpError
			// Keep the status so a 429 is retried like everywhere else
			error.status = response.status
			throw error
		}

		const data = await response.json()
		const embeddings = data.embeddings
		if (!embeddings || !Array.isArray(embeddings)) {
			throw new Error(t("embeddings:ollama.invalidResponseStructure"))
		}

		return { embeddings }
	}

	protected override formatError(error: any): Error {
		if (error?.name === "AbortError") {
			return new Error(t("embeddings:validation.connectionFailed"))
		} else if (error?.message?.includes("fetch failed") || error?.code === "ECONNREFUSED") {
			return new Error(t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }))
		} else if (error?.code === "ENOTFOUND") {
			return new Error(t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }))
		}
		return new Error(t("embeddings:ollama.embeddingFailed", { message: error?.message }))
	}

	/**
	 * Validates the Ollama embedder configuration by checking service availability and model existence
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	override async validateConfiguration(): Promise<EmbedderValidationResult> {
		return withValidationErrorHandling(
			async () => {
				// First check if Ollama service is running by trying to list models
				const modelsUrl = `${this.baseUrl}/api/tags`

				// Add timeout to prevent indefinite hanging
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const modelsResponse = await fetch(modelsUrl, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
					signal: controller.signal,
				})
				clearTimeout(timeoutId)

				if (!modelsResponse.ok) {
					if (modelsResponse.status === 404) {
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					}
					return {
						valid: false,
						error: t("embeddings:ollama.serviceUnavailable", {
							baseUrl: this.baseUrl,
							status: modelsResponse.status,
						}),
					}
				}

				// Check if the specific model exists
				const modelsData = await modelsResponse.json()
				const models = modelsData.models || []

				// Check both with and without :latest suffix
				const modelExists = models.some((m: any) => {
					const modelName = m.name || ""
					return (
						modelName === this.defaultModelId ||
						modelName === `${this.defaultModelId}:latest` ||
						modelName === this.defaultModelId.replace(":latest", "")
					)
				})

				if (!modelExists) {
					const availableModels = models.map((m: any) => m.name).join(", ")
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotFound", {
							modelId: this.defaultModelId,
							availableModels,
						}),
					}
				}

				// Try a test embedding to ensure the model works for embeddings
				const testUrl = `${this.baseUrl}/api/embed`

				// Add timeout for test request too
				const testController = new AbortController()
				const testTimeoutId = setTimeout(() => testController.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const testResponse = await fetch(testUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: this.defaultModelId,
						input: ["test"],
					}),
					signal: testController.signal,
				})
				clearTimeout(testTimeoutId)

				if (!testResponse.ok) {
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotEmbeddingCapable", { modelId: this.defaultModelId }),
					}
				}

				// Report the probe's vector length so a wrong manually-entered dimension is caught
				// here rather than as a rejected upsert halfway through the scan.
				let body: any
				try {
					body = await testResponse.json()
				} catch {
					// A model that embeds but answers with an unreadable body still validates.
					return { valid: true }
				}

				const probe = body?.embeddings?.[0]
				if (!Array.isArray(probe) || probe.length === 0) {
					// The model answered but returned no vector: indexing would fail on every batch.
					return { valid: false, error: t("embeddings:validation.invalidResponse") }
				}

				return { valid: true, dimension: probe.length }
			},
			"ollama",
			{
				beforeStandardHandling: (error: any) => {
					// Handle Ollama-specific connection errors
					// Check for fetch failed errors which indicate Ollama is not running
					if (
						error?.message?.includes("fetch failed") ||
						error?.code === "ECONNREFUSED" ||
						error?.message?.includes("ECONNREFUSED")
					) {
						// Capture telemetry for connection failed error
						this.captureError(error, "validateConfiguration:connectionFailed")
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					} else if (error?.code === "ENOTFOUND" || error?.message?.includes("ENOTFOUND")) {
						// Capture telemetry for host not found error
						this.captureError(error, "validateConfiguration:hostNotFound")
						return {
							valid: false,
							error: t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }),
						}
					} else if (error?.name === "AbortError") {
						// Capture telemetry for timeout error
						this.captureError(error, "validateConfiguration:timeout")
						// Handle timeout
						return {
							valid: false,
							error: t("embeddings:validation.connectionFailed"),
						}
					}
					// Let standard handling take over
					return undefined
				},
			},
		)
	}
}
