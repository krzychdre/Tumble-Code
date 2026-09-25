// Marketplace browsing, install and removal.

import * as vscode from "vscode"
import type { MarketplaceItemType } from "../../../services/marketplace"
import type { MessageHandlerMap } from "./types"

export const marketplaceHandlers: MessageHandlerMap = {
	filterMarketplaceItems: async (ctx, message) => {
		const { provider, marketplaceManager } = ctx
		if (marketplaceManager && message.filters) {
			try {
				await marketplaceManager.updateWithFilteredItems({
					type: message.filters.type as MarketplaceItemType | undefined,
					search: message.filters.search,
					tags: message.filters.tags,
				})
				await provider.postStateToWebview()
			} catch (error) {
				console.error("Marketplace: Error filtering items:", error)
				vscode.window.showErrorMessage("Failed to filter marketplace items")
			}
		}
	},

	fetchMarketplaceData: async (ctx) => {
		const { provider } = ctx
		// Fetch marketplace data on demand
		await provider.fetchMarketplaceData()
	},

	installMarketplaceItem: async (ctx, message) => {
		const { provider, marketplaceManager } = ctx
		if (marketplaceManager && message.mpItem && message.mpInstallOptions) {
			try {
				const configFilePath = await marketplaceManager.installMarketplaceItem(
					message.mpItem,
					message.mpInstallOptions,
				)
				await provider.postStateToWebview()
				console.log(`Marketplace item installed and config file opened: ${configFilePath}`)

				// Send success message to webview
				provider.postMessageToWebview({
					type: "marketplaceInstallResult",
					success: true,
					slug: message.mpItem.id,
				})
			} catch (error) {
				console.error(`Error installing marketplace item: ${error}`)
				// Send error message to webview
				provider.postMessageToWebview({
					type: "marketplaceInstallResult",
					success: false,
					error: error instanceof Error ? error.message : String(error),
					slug: message.mpItem.id,
				})
			}
		}
	},

	removeInstalledMarketplaceItem: async (ctx, message) => {
		const { provider, marketplaceManager } = ctx
		if (marketplaceManager && message.mpItem && message.mpInstallOptions) {
			try {
				await marketplaceManager.removeInstalledMarketplaceItem(message.mpItem, message.mpInstallOptions)
				await provider.postStateToWebview()

				// Send success message to webview
				provider.postMessageToWebview({
					type: "marketplaceRemoveResult",
					success: true,
					slug: message.mpItem.id,
				})
			} catch (error) {
				console.error(`Error removing marketplace item: ${error}`)

				// Show error message to user
				vscode.window.showErrorMessage(
					`Failed to remove marketplace item: ${error instanceof Error ? error.message : String(error)}`,
				)

				// Send error message to webview
				provider.postMessageToWebview({
					type: "marketplaceRemoveResult",
					success: false,
					error: error instanceof Error ? error.message : String(error),
					slug: message.mpItem.id,
				})
			}
		} else {
			// MarketplaceManager not available or missing required parameters
			const errorMessage = !marketplaceManager
				? "Marketplace manager is not available"
				: "Missing required parameters for marketplace item removal"
			console.error(errorMessage)

			vscode.window.showErrorMessage(errorMessage)

			if (message.mpItem?.id) {
				provider.postMessageToWebview({
					type: "marketplaceRemoveResult",
					success: false,
					error: errorMessage,
					slug: message.mpItem.id,
				})
			}
		}
	},
}
