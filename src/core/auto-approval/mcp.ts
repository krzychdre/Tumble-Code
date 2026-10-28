import type { McpServerUse, McpServer, McpTool } from "@tumble-code/types"

/**
 * The server a call to `serverName` reaches: like McpConnectionManager's
 * findConnection without a source, the project's server when one has the
 * name, else the global one.
 */
function serverCalled(serverName: string, mcpServers: McpServer[] | undefined): McpServer | undefined {
	const named = mcpServers?.filter((server) => server.name === serverName) ?? []
	return named.find((server) => server.source === "project") ?? named[0]
}

/**
 * Whether the tool is set to always allow on the server the call will run on.
 * Read from that same server: with a global and a project server of one name,
 * the first match used to be the global one, so a project server took the
 * global server's "always allow" for a tool of the same name.
 */
export function isMcpToolAlwaysAllowed(mcpServerUse: McpServerUse, mcpServers: McpServer[] | undefined): boolean {
	if (mcpServerUse.type === "use_mcp_tool" && mcpServerUse.toolName) {
		const server = serverCalled(mcpServerUse.serverName, mcpServers)
		const tool = server?.tools?.find((t: McpTool) => t.name === mcpServerUse.toolName)
		return tool?.alwaysAllow || false
	}

	return false
}
