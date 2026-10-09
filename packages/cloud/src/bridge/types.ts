import type { AutoApprovalSettings, TokenUsage, ClineMessage } from "@tumble-code/types"

/**
 * The minimal control surface the bridge needs from a live Task. Declared as a
 * structural interface (not the concrete `Task`) so the command dispatcher is
 * unit-testable with a plain mock and `@tumble-code/cloud` stays free of a runtime
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
	/**
	 * The live task with this id, in whichever panel, editor tab or subagent
	 * slot runs it. Tasks run in parallel, so a command names its task and
	 * never means "the sidebar's current task".
	 */
	findTask(taskId: string): BridgeTask | undefined
	/** Stops the live task with this id; false when nothing runs it. */
	stopTask(taskId: string): Promise<boolean>
	/**
	 * Resumes a stopped task by id: shows it and answers its resume_task ask,
	 * as the panel's Resume Task button does; false when it never asks that.
	 */
	resumeTask(taskId: string): Promise<boolean>
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
