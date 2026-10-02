import { ExtensionClient } from "../extension-client.js"
import type { WebviewMessage } from "@tumble-code/types"

/**
 * Create a client for testing: it captures every message it sends.
 */
export function createMockClient(): {
	client: ExtensionClient
	sentMessages: WebviewMessage[]
	clearMessages: () => void
} {
	const sentMessages: WebviewMessage[] = []

	const client = new ExtensionClient({
		sendMessage: (message) => sentMessages.push(message),
		debug: false,
	})

	return {
		client,
		sentMessages,
		clearMessages: () => {
			sentMessages.length = 0
		},
	}
}
