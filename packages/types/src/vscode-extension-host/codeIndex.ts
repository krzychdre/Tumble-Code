/*
 * Extension host channel, codeIndex domain: the webview requests handled by
 * src/core/webview/messageHandlers/codeIndex.ts and the host to view
 * messages of the same domain.
 */

/** Codebase indexing settings and control. */
export type CodeIndexWebviewMessageType =
	| "saveCodeIndexSettingsAtomic"
	| "requestIndexingStatus"
	| "requestCodeIndexSecretStatus"
	| "startIndexing"
	| "stopIndexing"
	| "toggleWorkspaceIndexing"
	| "setAutoEnableDefault"
	| "clearIndexData"

/** Codebase indexing status and settings replies. */
export type CodeIndexExtensionMessageType =
	| "indexingStatusUpdate"
	| "indexCleared"
	| "codeIndexSettingsSaved"
	| "codeIndexSecretStatus"

export interface IndexingStatusPayload {
	state: "Standby" | "Indexing" | "Indexed" | "Error" | "Stopping"
	message: string
}

export interface IndexClearedPayload {
	success: boolean
	error?: string
}

export interface IndexingStatus {
	systemStatus: string
	message?: string
	processedItems: number
	totalItems: number
	currentItemUnit?: string
	workspacePath?: string
	workspaceEnabled?: boolean
	autoEnableDefault?: boolean
}

export interface IndexingStatusUpdateMessage {
	type: "indexingStatusUpdate"
	values: IndexingStatus
}
