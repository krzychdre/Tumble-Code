// Prompt enhancement, system prompt preview and the commit and file search pickers.

import * as vscode from "vscode"
import { t } from "../../../i18n"
import { searchWorkspaceFiles } from "../../../services/search/file-search"
import { searchCommits } from "../../../utils/git"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { generateSystemPrompt } from "../generateSystemPrompt"
import { MessageEnhancer } from "../messageEnhancer"
import { logAndToast } from "./context"
import type { MessageHandlerMap } from "./types"

export const enhanceAndSearchHandlers: MessageHandlerMap = {
	enhancePrompt: async (ctx, message) => {
		const { provider } = ctx
		if (message.text) {
			try {
				const state = await provider.getState()

				const {
					apiConfiguration,
					customSupportPrompts,
					listApiConfigMeta = [],
					enhancementApiConfigId,
					includeTaskHistoryInEnhance,
				} = state

				const currentCline = provider.getCurrentTask()

				const result = await MessageEnhancer.enhanceMessage({
					text: message.text,
					apiConfiguration,
					customSupportPrompts,
					listApiConfigMeta,
					enhancementApiConfigId,
					includeTaskHistoryInEnhance,
					currentClineMessages: currentCline?.clineMessages,
					providerSettingsManager: provider.providerSettingsManager,
					taskId: currentCline?.taskId,
				})

				if (result.success && result.enhancedText) {
					MessageEnhancer.captureTelemetry(currentCline?.taskId, includeTaskHistoryInEnhance)
					await provider.postMessageToWebview({ type: "enhancedPrompt", text: result.enhancedText })
				} else {
					throw new Error(result.error || "Unknown error")
				}
			} catch (error) {
				logAndToast(ctx, "Error enhancing prompt: ", error, "common:errors.enhance_prompt")
				await provider.postMessageToWebview({ type: "enhancedPrompt" })
			}
		}
	},

	getSystemPrompt: async (ctx, message) => {
		const { provider } = ctx
		try {
			const systemPrompt = await generateSystemPrompt(provider, message)

			await provider.postMessageToWebview({
				type: "systemPrompt",
				text: systemPrompt,
				mode: message.mode,
			})
		} catch (error) {
			logAndToast(ctx, "Error getting system prompt:  ", error, "common:errors.get_system_prompt")
		}
	},

	copySystemPrompt: async (ctx, message) => {
		const { provider } = ctx
		try {
			const systemPrompt = await generateSystemPrompt(provider, message)

			await vscode.env.clipboard.writeText(systemPrompt)
			await vscode.window.showInformationMessage(t("common:info.clipboard_copy"))
		} catch (error) {
			logAndToast(ctx, "Error getting system prompt:  ", error, "common:errors.get_system_prompt")
		}
	},

	searchCommits: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		const cwd = getCurrentCwd()
		if (cwd) {
			try {
				const commits = await searchCommits(message.query || "", cwd)
				await provider.postMessageToWebview({
					type: "commitSearchResults",
					commits,
				})
			} catch (error) {
				logAndToast(ctx, "Error searching commits: ", error, "common:errors.search_commits")
			}
		}
	},

	searchFiles: async (ctx, message) => {
		const { provider, getCurrentCwd } = ctx
		const workspacePath = getCurrentCwd()

		if (!workspacePath) {
			// Handle case where workspace path is not available
			await provider.postMessageToWebview({
				type: "fileSearchResults",
				results: [],
				requestId: message.requestId,
				error: "No workspace path available",
			})
			return
		}
		try {
			// Call file search service with query from message
			const results = await searchWorkspaceFiles(
				message.query || "",
				workspacePath,
				20, // Use default limit, as filtering is now done in the backend
			)

			// Get the RooIgnoreController from the current task, or create a new one
			const currentTask = provider.getCurrentTask()
			let rooIgnoreController = currentTask?.rooIgnoreController
			let tempController: RooIgnoreController | undefined

			// If no current task or no controller, create a temporary one
			if (!rooIgnoreController) {
				tempController = new RooIgnoreController(workspacePath)
				await tempController.initialize()
				rooIgnoreController = tempController
			}

			try {
				// Get showRooIgnoredFiles setting from state
				const { showRooIgnoredFiles = false } = (await provider.getState()) ?? {}

				// Filter results using RooIgnoreController if showRooIgnoredFiles is false
				let filteredResults = results
				if (!showRooIgnoredFiles && rooIgnoreController) {
					const allowedPaths = rooIgnoreController.filterPaths(results.map((r) => r.path))
					filteredResults = results.filter((r) => allowedPaths.includes(r.path))
				}

				// Send results back to webview
				await provider.postMessageToWebview({
					type: "fileSearchResults",
					results: filteredResults,
					requestId: message.requestId,
				})
			} finally {
				// Dispose temporary controller to prevent resource leak
				tempController?.dispose()
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Send error response to webview
			await provider.postMessageToWebview({
				type: "fileSearchResults",
				results: [],
				error: errorMessage,
				requestId: message.requestId,
			})
		}
	},
}
