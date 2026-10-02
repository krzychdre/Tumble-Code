// Codebase index: settings, secrets, status and indexing control.

import { t } from "../../../i18n"
import { CodeIndexManager } from "../../../services/code-index/manager"
import type { DomainHandlerMap } from "./types"
import { logger } from "../../../utils/logging"

export const codeIndexHandlers: DomainHandlerMap<"codeIndex"> = {
	saveCodeIndexSettingsAtomic: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		if (!message.codeIndexSettings) {
			return
		}

		const settings = message.codeIndexSettings

		try {
			// Check if embedder provider has changed
			const currentConfig = getGlobalState("codebaseIndexConfig") || {}
			const embedderProviderChanged =
				currentConfig.codebaseIndexEmbedderProvider !== settings.codebaseIndexEmbedderProvider

			// Save global state settings atomically
			const globalStateConfig = {
				...currentConfig,
				codebaseIndexEnabled: settings.codebaseIndexEnabled,
				// Trimmed: a pasted " model-id" made llama-swap answer 404 ("Invalid API endpoint")
				codebaseIndexQdrantUrl: settings.codebaseIndexQdrantUrl?.trim(),
				codebaseIndexEmbedderProvider: settings.codebaseIndexEmbedderProvider,
				codebaseIndexEmbedderBaseUrl: settings.codebaseIndexEmbedderBaseUrl?.trim(),
				codebaseIndexEmbedderModelId: settings.codebaseIndexEmbedderModelId?.trim(),
				codebaseIndexEmbedderModelDimension: settings.codebaseIndexEmbedderModelDimension, // Generic dimension
				codebaseIndexOpenAiCompatibleBaseUrl: settings.codebaseIndexOpenAiCompatibleBaseUrl?.trim(),
				codebaseIndexBedrockRegion: settings.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: settings.codebaseIndexBedrockProfile,
				codebaseIndexSearchMaxResults: settings.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: settings.codebaseIndexSearchMinScore,
				codebaseIndexOpenRouterSpecificProvider: settings.codebaseIndexOpenRouterSpecificProvider,
			}

			// Save global state first
			await updateGlobalState("codebaseIndexConfig", globalStateConfig)

			// Save secrets directly using context proxy
			if (settings.codeIndexOpenAiKey !== undefined) {
				await provider.contextProxy.storeSecret("codeIndexOpenAiKey", settings.codeIndexOpenAiKey)
			}
			if (settings.codeIndexQdrantApiKey !== undefined) {
				await provider.contextProxy.storeSecret("codeIndexQdrantApiKey", settings.codeIndexQdrantApiKey)
			}
			if (settings.codebaseIndexOpenAiCompatibleApiKey !== undefined) {
				await provider.contextProxy.storeSecret(
					"codebaseIndexOpenAiCompatibleApiKey",
					settings.codebaseIndexOpenAiCompatibleApiKey,
				)
			}
			if (settings.codebaseIndexGeminiApiKey !== undefined) {
				await provider.contextProxy.storeSecret("codebaseIndexGeminiApiKey", settings.codebaseIndexGeminiApiKey)
			}
			if (settings.codebaseIndexMistralApiKey !== undefined) {
				await provider.contextProxy.storeSecret(
					"codebaseIndexMistralApiKey",
					settings.codebaseIndexMistralApiKey,
				)
			}
			if (settings.codebaseIndexOpenRouterApiKey !== undefined) {
				await provider.contextProxy.storeSecret(
					"codebaseIndexOpenRouterApiKey",
					settings.codebaseIndexOpenRouterApiKey,
				)
			}

			// Send success response first - settings are saved regardless of validation
			await provider.postMessageToWebview({
				type: "codeIndexSettingsSaved",
				success: true,
				settings: globalStateConfig,
			})

			// Update webview state
			await provider.postStateToWebview()

			// Then handle validation and initialization for the current workspace
			const currentCodeIndexManager = provider.getCurrentWorkspaceCodeIndexManager()
			if (currentCodeIndexManager) {
				// If embedder provider changed, perform proactive validation
				if (embedderProviderChanged) {
					try {
						// Force handleSettingsChange which will trigger validation
						await currentCodeIndexManager.handleSettingsChange()
					} catch (error) {
						// Validation failed - the error state is already set by handleSettingsChange
						logger.warn(
							`Embedder validation failed after provider change: ${error instanceof Error ? error.message : String(error)}`,
						)
						// Send validation error to webview
						await provider.postMessageToWebview({
							type: "indexingStatusUpdate",
							values: currentCodeIndexManager.getCurrentStatus(),
						})
						// Exit early - don't try to start indexing with invalid configuration
						return
					}
				} else {
					// No provider change, just handle settings normally
					try {
						await currentCodeIndexManager.handleSettingsChange()
					} catch (error) {
						// Log but don't fail - settings are saved
						logger.error(
							`Settings change handling error: ${error instanceof Error ? error.message : String(error)}`,
						)
					}
				}

				// Wait a bit more to ensure everything is ready
				await new Promise((resolve) => setTimeout(resolve, 200))

				// Auto-start indexing if now enabled and configured
				if (currentCodeIndexManager.isFeatureEnabled && currentCodeIndexManager.isFeatureConfigured) {
					if (!currentCodeIndexManager.isInitialized) {
						try {
							await currentCodeIndexManager.initialize(provider.contextProxy)
							logger.info(`Code index manager initialized after settings save`)
						} catch (error) {
							logger.error(
								`Code index initialization failed: ${error instanceof Error ? error.message : String(error)}`,
							)
							// Send error status to webview
							await provider.postMessageToWebview({
								type: "indexingStatusUpdate",
								values: currentCodeIndexManager.getCurrentStatus(),
							})
						}
					}
				}
			} else {
				// No workspace open - send error status
				logger.warn("Cannot save code index settings: No workspace folder open")
				await provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: {
						systemStatus: "Error",
						message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
						processedItems: 0,
						totalItems: 0,
						currentItemUnit: "items",
					},
				})
			}
		} catch (error) {
			logger.error(`Error saving code index settings: ${error.message || error}`)
			await provider.postMessageToWebview({
				type: "codeIndexSettingsSaved",
				success: false,
				error: error.message || "Failed to save settings",
			})
		}
	},

	requestIndexingStatus: (ctx, message) => {
		const { provider } = ctx
		const manager = provider.getCurrentWorkspaceCodeIndexManager()
		if (!manager) {
			// No workspace open - send error status
			provider.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: {
					systemStatus: "Error",
					message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
					processedItems: 0,
					totalItems: 0,
					currentItemUnit: "items",
					workerspacePath: undefined,
				},
			})
			return
		}

		const status = manager
			? manager.getCurrentStatus()
			: {
					systemStatus: "Standby",
					message: "No workspace folder open",
					processedItems: 0,
					totalItems: 0,
					currentItemUnit: "items",
					workspacePath: undefined,
				}

		provider.postMessageToWebview({
			type: "indexingStatusUpdate",
			values: status,
		})
	},

	requestCodeIndexSecretStatus: async (ctx) => {
		const { provider } = ctx
		// Check if secrets are set using the VSCode context directly for async access
		const hasOpenAiKey = !!(await provider.context.secrets.get("codeIndexOpenAiKey"))
		const hasQdrantApiKey = !!(await provider.context.secrets.get("codeIndexQdrantApiKey"))
		const hasOpenAiCompatibleApiKey = !!(await provider.context.secrets.get("codebaseIndexOpenAiCompatibleApiKey"))
		const hasGeminiApiKey = !!(await provider.context.secrets.get("codebaseIndexGeminiApiKey"))
		const hasMistralApiKey = !!(await provider.context.secrets.get("codebaseIndexMistralApiKey"))
		const hasOpenRouterApiKey = !!(await provider.context.secrets.get("codebaseIndexOpenRouterApiKey"))

		provider.postMessageToWebview({
			type: "codeIndexSecretStatus",
			values: {
				hasOpenAiKey,
				hasQdrantApiKey,
				hasOpenAiCompatibleApiKey,
				hasGeminiApiKey,
				hasMistralApiKey,
				hasOpenRouterApiKey,
			},
		})
	},

	startIndexing: async (ctx, message) => {
		const { provider } = ctx
		try {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				provider.postMessageToWebview({
					type: "indexingStatusUpdate",
					values: {
						systemStatus: "Error",
						message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
						processedItems: 0,
						totalItems: 0,
						currentItemUnit: "items",
					},
				})
				logger.warn("Cannot start indexing: No workspace folder open")
				return
			}

			// "Start Indexing" implicitly enables the workspace
			await manager.setWorkspaceEnabled(true)

			if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
				await manager.initialize(provider.contextProxy)

				const currentState = manager.state
				if (currentState === "Standby" || currentState === "Error") {
					manager.startIndexing()

					if (!manager.isInitialized) {
						await manager.initialize(provider.contextProxy)
						if (manager.state === "Standby" || manager.state === "Error") {
							manager.startIndexing()
						}
					}
				}
			}
		} catch (error) {
			logger.error(`Error starting indexing: ${error instanceof Error ? error.message : String(error)}`)
		}
	},

	stopIndexing: (ctx) => {
		const { provider } = ctx
		try {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				logger.warn("Cannot stop indexing: No workspace folder open")
				return
			}
			manager.stopIndexing()
			provider.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: manager.getCurrentStatus(),
			})
		} catch (error) {
			logger.error(`Error stopping indexing: ${error instanceof Error ? error.message : String(error)}`)
		}
	},

	toggleWorkspaceIndexing: async (ctx, message) => {
		const { provider } = ctx
		try {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				logger.warn("Cannot toggle workspace indexing: No workspace folder open")
				return
			}
			const enabled = message.bool ?? false
			await manager.setWorkspaceEnabled(enabled)
			if (enabled && manager.isFeatureEnabled && manager.isFeatureConfigured) {
				await manager.initialize(provider.contextProxy)
				manager.startIndexing()
			} else if (!enabled) {
				manager.stopIndexing()
			}
			provider.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: manager.getCurrentStatus(),
			})
		} catch (error) {
			logger.error(`Error toggling workspace indexing: ${error instanceof Error ? error.message : String(error)}`)
		}
	},

	setAutoEnableDefault: async (ctx, message) => {
		const { provider } = ctx
		try {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				logger.warn("Cannot set auto-enable default: No workspace folder open")
				return
			}
			// Capture prior state for every manager before persisting the global change
			const allManagers = CodeIndexManager.getAllInstances()
			const priorStates = new Map(allManagers.map((m) => [m, m.isWorkspaceEnabled]))
			await manager.setAutoEnableDefault(message.bool ?? true)
			// Apply stop/start to every affected manager
			for (const m of allManagers) {
				const wasEnabled = priorStates.get(m)!
				const isNowEnabled = m.isWorkspaceEnabled
				if (wasEnabled && !isNowEnabled) {
					m.stopIndexing()
				} else if (!wasEnabled && isNowEnabled && m.isFeatureEnabled && m.isFeatureConfigured) {
					await m.initialize(provider.contextProxy)
					m.startIndexing()
				}
			}
			provider.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: manager.getCurrentStatus(),
			})
		} catch (error) {
			logger.error(`Error setting auto-enable default: ${error instanceof Error ? error.message : String(error)}`)
		}
	},

	clearIndexData: async (ctx) => {
		const { provider } = ctx
		try {
			const manager = provider.getCurrentWorkspaceCodeIndexManager()
			if (!manager) {
				logger.warn("Cannot clear index data: No workspace folder open")
				provider.postMessageToWebview({
					type: "indexCleared",
					values: {
						success: false,
						error: t("embeddings:orchestrator.indexingRequiresWorkspace"),
					},
				})
				return
			}
			await manager.clearIndexData()
			provider.postMessageToWebview({ type: "indexCleared", values: { success: true } })
		} catch (error) {
			logger.error(`Error clearing index data: ${error instanceof Error ? error.message : String(error)}`)
			provider.postMessageToWebview({
				type: "indexCleared",
				values: {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
			})
		}
	},
}
