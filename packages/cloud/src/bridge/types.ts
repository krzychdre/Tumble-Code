import type { AutoApprovalSettings, TokenUsage, ClineMessage } from "@roo-code/types"

/**
 * The minimal control surface the bridge needs from a live Task. Declared as a
 * structural interface (not the concrete `Task`) so the command dispatcher is
 * unit-testable with a plain mock and `@roo-code/cloud` stays free of a runtime
 * dependency on the extension host `src/` tree.
 */
export interface BridgeTask {
	taskId: string
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
	handleWebviewAskResponse(
		askResponse: "yesButtonClicked" | "noButtonClicked" | "messageResponse",
		text?: string,
		images?: string[],
	): void
}

/**
 * The minimal control surface the bridge needs from the ClineProvider.
 */
export interface BridgeProvider {
	getCurrentTask(): BridgeTask | undefined
	cancelTask(): Promise<void>
	showTaskWithId(id: string): Promise<unknown>
	postStateToWebview(): Promise<void>
	contextProxy: {
		setValue(key: string, value: unknown): Promise<void> | void
	}
}

/** The live header/control snapshot pushed to the web cockpit. */
export interface InstanceStatePayload {
	mode?: string
	isRunning?: boolean
	autoApproval?: AutoApprovalSettings
	tokenUsage?: TokenUsage
	contextTokens?: number
	contextWindow?: number
	currentAsk?: ClineMessage
}

export interface BridgeConfig {
	userId: string
	socketBridgeUrl: string
	socketBridgePath?: string
	token: string
}
