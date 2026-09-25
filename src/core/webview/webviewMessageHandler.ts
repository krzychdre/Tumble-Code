import type { WebviewMessage } from "@roo-code/types"

import type { MarketplaceManager } from "../../services/marketplace"

import type { ClineProvider } from "./ClineProvider"
import { createHandlerContext, messageHandlers } from "./messageHandlers"

/**
 * Routes one message from the webview to the handler registered for its type
 * in `./messageHandlers` (one module per domain). Types without a handler are
 * ignored, as the old `default:` branch of the switch did.
 */
export const webviewMessageHandler = async (
	provider: ClineProvider,
	message: WebviewMessage,
	marketplaceManager?: MarketplaceManager,
) => {
	const handler = messageHandlers[message.type]

	if (!handler) {
		return
	}

	await handler(createHandlerContext(provider, marketplaceManager), message)
}
