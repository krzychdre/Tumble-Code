/*
 * Extension host channel, marketplace domain: the webview requests handled by
 * src/core/webview/messageHandlers/marketplace.ts and the host to view
 * messages of the same domain.
 */

import { z } from "zod"

import { marketplaceItemSchema } from "../marketplace.js"

/** Marketplace browsing, install and removal. */
export type MarketplaceWebviewMessageType =
	| "filterMarketplaceItems"
	| "fetchMarketplaceData"
	| "installMarketplaceItem"
	| "removeInstalledMarketplaceItem"

/** Marketplace data and install or removal results. */
export type MarketplaceExtensionMessageType = "marketplaceInstallResult" | "marketplaceRemoveResult" | "marketplaceData"

export const installMarketplaceItemWithParametersPayloadSchema = z.object({
	item: marketplaceItemSchema,
	parameters: z.record(z.string(), z.any()),
})

export type InstallMarketplaceItemWithParametersPayload = z.infer<
	typeof installMarketplaceItemWithParametersPayloadSchema
>
