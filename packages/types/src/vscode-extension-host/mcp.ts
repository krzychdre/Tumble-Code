/*
 * Extension host channel, mcp domain: the webview requests handled by
 * src/core/webview/messageHandlers/mcp.ts and the host to view
 * messages of the same domain.
 */

/** MCP server settings and control. */
export type McpWebviewMessageType =
	| "openMcpSettings"
	| "openProjectMcpSettings"
	| "deleteMcpServer"
	| "restartMcpServer"
	| "toggleToolAlwaysAllow"
	| "toggleToolEnabledForPrompt"
	| "toggleMcpServer"
	| "refreshAllMcpServers"
	| "updateMcpTimeout"

/** MCP server list and tool execution status. */
export type McpExtensionMessageType = "mcpServers" | "mcpExecutionStatus"
