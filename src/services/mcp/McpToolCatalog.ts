import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"

import type {
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpTool,
	McpToolCallResponse,
} from "@roo-code/types"

import { type McpConfigSource, ServerConfigSchema } from "./mcpConfigSchema"
import type { McpConfigStore } from "./McpConfigStore"
import { logMcpError, type McpConnection, type McpServerCapabilities } from "./McpConnectionManager"

export interface McpToolCatalogDeps {
	findConnection: (serverName: string, source?: McpConfigSource) => McpConnection | undefined
	configStore: Pick<McpConfigStore, "readServerEntries" | "readForUpdate" | "write">
	/** Push the current server list to the webview. */
	notifyServerChanges: () => Promise<void>
}

/**
 * What the connected servers offer: listing tools, resources and resource
 * templates, the per-tool alwaysAllow and disabledTools settings, and calling
 * a tool or reading a resource.
 */
export class McpToolCatalog {
	constructor(private readonly deps: McpToolCatalogDeps) {}

	/** Tools, resources and templates of a server, fetched in that order. */
	async fetchCapabilities(serverName: string, source?: McpConfigSource): Promise<McpServerCapabilities> {
		const tools = await this.fetchToolsList(serverName, source)
		const resources = await this.fetchResourcesList(serverName, source)
		const resourceTemplates = await this.fetchResourceTemplatesList(serverName, source)
		return { tools, resources, resourceTemplates }
	}

	async fetchToolsList(serverName: string, source?: McpConfigSource): Promise<McpTool[]> {
		try {
			const connection = this.deps.findConnection(serverName, source)

			if (!connection || connection.type !== "connected") {
				return []
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)

			// Read the tool settings from the file the server comes from
			const actualSource = connection.server.source || "global"
			let alwaysAllowConfig: string[] = []
			let disabledToolsList: string[] = []
			try {
				const serverEntry = (await this.deps.configStore.readServerEntries(actualSource))[serverName]
				alwaysAllowConfig = serverEntry?.alwaysAllow || []
				disabledToolsList = serverEntry?.disabledTools || []
			} catch (error) {
				console.error(`Failed to read tool configuration for ${serverName}:`, error)
				// Continue with empty configs
			}

			// Check if wildcard "*" is in the alwaysAllow config
			const hasWildcard = alwaysAllowConfig.includes("*")

			// Mark tools as always allowed and enabled for prompt based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: hasWildcard || alwaysAllowConfig.includes(tool.name),
				enabledForPrompt: !disabledToolsList.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	async fetchResourcesList(serverName: string, source?: McpConfigSource): Promise<McpResource[]> {
		try {
			const connection = this.deps.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch (error) {
			return []
		}
	}

	async fetchResourceTemplatesList(serverName: string, source?: McpConfigSource): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.deps.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch (error) {
			return []
		}
	}

	async readResource(serverName: string, uri: string, source?: McpConfigSource): Promise<McpResourceResponse> {
		const connection = this.deps.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: McpConfigSource,
	): Promise<McpToolCallResponse> {
		const connection = this.deps.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(
				`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout: number
		try {
			const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
			timeout = (parsedConfig.timeout ?? 60) * 1000
		} catch (error) {
			console.error("Failed to parse server config for timeout:", error)
			// Default to 60 seconds if parsing fails
			timeout = 60 * 1000
		}

		return await connection.client.request(
			{
				method: "tools/call",
				params: {
					name: toolName,
					arguments: toolArguments,
				},
			},
			CallToolResultSchema,
			{
				timeout,
			},
		)
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: McpConfigSource,
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		try {
			await this.updateServerToolList(serverName, source, toolName, "alwaysAllow", shouldAllow)
		} catch (error) {
			logMcpError(
				`Failed to toggle always allow for tool "${toolName}" on server "${serverName}" with source "${source}"`,
				error,
			)
			throw error
		}
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: McpConfigSource,
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		try {
			// When isEnabled is true, we want to remove the tool from the disabledTools list.
			// When isEnabled is false, we want to add the tool to the disabledTools list.
			const addToolToDisabledList = !isEnabled
			await this.updateServerToolList(serverName, source, toolName, "disabledTools", addToolToDisabledList)
		} catch (error) {
			logMcpError(`Failed to update settings for tool ${toolName}`, error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	/**
	 * Helper method to update a specific tool list (alwaysAllow or disabledTools)
	 * in the appropriate settings file.
	 * @param serverName The name of the server to update
	 * @param source Whether to update the global or project config
	 * @param toolName The name of the tool to add or remove
	 * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
	 * @param addTool Whether to add (true) or remove (false) the tool from the list
	 */
	private async updateServerToolList(
		serverName: string,
		source: McpConfigSource,
		toolName: string,
		listName: "alwaysAllow" | "disabledTools",
		addTool: boolean,
	): Promise<void> {
		// Find the connection with matching name and source
		const connection = this.deps.findConnection(serverName, source)

		if (!connection) {
			throw new Error(`Server ${serverName} with source ${source} not found`)
		}

		const { path: configPath, config } = await this.deps.configStore.readForUpdate(source)

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {
				type: "stdio",
				command: "node",
				args: [], // Default to an empty array; can be set later if needed
			}
		}

		if (!config.mcpServers[serverName][listName]) {
			config.mcpServers[serverName][listName] = []
		}

		const targetList = config.mcpServers[serverName][listName]
		const toolIndex = targetList.indexOf(toolName)

		if (addTool && toolIndex === -1) {
			targetList.push(toolName)
		} else if (!addTool && toolIndex !== -1) {
			targetList.splice(toolIndex, 1)
		}

		await this.deps.configStore.write(configPath, config)

		connection.server.tools = await this.fetchToolsList(serverName, source)
		await this.deps.notifyServerChanges()
	}
}
