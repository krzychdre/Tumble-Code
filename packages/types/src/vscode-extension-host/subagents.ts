/*
 * Extension host channel, subagents domain: the webview requests handled by
 * src/core/webview/messageHandlers/subagents.ts and the host to view
 * messages of the same domain.
 */

/** Parallel background subagents. */
export type SubagentsWebviewMessageType =
	| "subscribeSubagentMessages"
	| "unsubscribeSubagentMessages"
	| "cancelSubagent"
	| "queueSubagentMessage"

/** Subagent summaries and message snapshots. */
export type SubagentsExtensionMessageType = "subagentsUpdated" | "subagentMessages"
