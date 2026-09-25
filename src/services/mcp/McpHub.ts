import * as vscode from "vscode"
import delay from "delay"

import type { McpResourceResponse, McpServer, McpToolCallResponse, ExtensionMessage } from "@roo-code/types"
import { SETTINGS_DEFAULTS } from "@roo-code/types"

import { t } from "../../i18n"

import { getWorkspacePath } from "../../utils/path"

import { type McpConfigSource, type McpServerConfig, validateServerConfig } from "./mcpConfigSchema"
import { McpConfigStore } from "./McpConfigStore"
import { McpConfigWatcher, type McpWatcherFactory, vscodeWatcherFactory } from "./McpConfigWatcher"
import { logMcpError, type McpConnection, McpConnectionManager } from "./McpConnectionManager"
import { McpToolCatalog } from "./McpToolCatalog"

export {
	type ConnectedMcpConnection,
	type DisconnectedMcpConnection,
	type McpConnection,
	DisableReason,
} from "./McpConnectionManager"

/**
 * The part of the provider (ClineProvider) the hub and McpServerManager use.
 * Services depend on this instead of the ClineProvider class so the MCP layer
 * does not import the webview layer.
 */
export interface McpHubProvider {
	readonly cwd: string
	readonly context: vscode.ExtensionContext
	ensureMcpServersDirectoryExists(): Promise<string>
	ensureSettingsDirectoryExists(): Promise<string>
	getState(): Promise<{ mcpEnabled?: boolean }>
	postMessageToWebview(message: ExtensionMessage): Promise<void>
}

export interface McpHubOptions {
	/** Where the settings-file watchers come from; the VS Code API by default, a fake in tests. */
	watcherFactory?: McpWatcherFactory
}

/**
 * The MCP facade the rest of the extension talks to. It reads and watches the
 * settings files (McpConfigStore, McpConfigWatcher) and pushes the server list
 * to the webview; the connections live in McpConnectionManager and what the
 * servers offer in McpToolCatalog.
 */
export class McpHub {
	private providerRef: WeakRef<McpHubProvider>
	private isDisposed: boolean = false
	private refCount: number = 0 // Reference counter for active clients
	private initializationPromise: Promise<void>
	private readonly configStore: McpConfigStore
	private readonly configWatcher: McpConfigWatcher
	private readonly connectionManager: McpConnectionManager
	private readonly toolCatalog: McpToolCatalog

	constructor(provider: McpHubProvider, options: McpHubOptions = {}) {
		this.providerRef = new WeakRef(provider)
		this.configStore = new McpConfigStore({
			settingsDirectory: async () => {
				const provider = this.providerRef.deref()
				if (!provider) {
					throw new Error("Provider not available")
				}
				return provider.ensureSettingsDirectoryExists()
			},
			workspacePath: () => this.workspacePath(),
		})
		this.connectionManager = new McpConnectionManager({
			clientVersion: () => this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
			isMcpEnabled: () => this.isMcpEnabled(),
			notifyServerChanges: () => this.notifyWebviewOfServerChanges(),
			fetchCapabilities: (name, source) => this.toolCatalog.fetchCapabilities(name, source),
		})
		this.toolCatalog = new McpToolCatalog({
			findConnection: (name, source) => this.connectionManager.findConnection(name, source),
			configStore: this.configStore,
			notifyServerChanges: () => this.notifyWebviewOfServerChanges(),
		})
		this.configWatcher = new McpConfigWatcher(
			options.watcherFactory ?? vscodeWatcherFactory,
			() => this.configStore.isWriteGuardUp(),
			{
				onConfigFileChanged: (filePath, source) => this.handleConfigFileChange(filePath, source),
				onProjectConfigDeleted: () => this.handleProjectConfigDeleted(),
				onWorkspaceFoldersChanged: async () => {
					await this.updateProjectMcpServers()
					this.watchProjectMcpFile()
				},
			},
		)
		this.watchMcpSettingsFile().catch(console.error)
		this.watchProjectMcpFile()
		this.configWatcher.watchWorkspaceFolders()
		this.initializationPromise = Promise.all([
			this.initializeGlobalMcpServers(),
			this.initializeProjectMcpServers(),
		]).then(() => {})
	}

	/**
	 * The live connections. The array is replaced, not mutated, when a server
	 * goes; assigning it (tests do) replaces the manager's array.
	 */
	get connections(): McpConnection[] {
		return this.connectionManager.connections
	}

	set connections(connections: McpConnection[]) {
		this.connectionManager.connections = connections
	}

	/** True while servers are being (re)connected. */
	get isConnecting(): boolean {
		return this.connectionManager.isConnecting
	}

	set isConnecting(isConnecting: boolean) {
		this.connectionManager.isConnecting = isConnecting
	}

	/**
	 * Waits until all MCP servers have finished their initial connection attempts.
	 * Each server individually handles its own timeout, so this will not block indefinitely.
	 */
	async waitUntilReady(): Promise<void> {
		await this.initializationPromise
	}
	/**
	 * Registers a client (e.g., ClineProvider) using this hub.
	 * Increments the reference count.
	 */
	public registerClient(): void {
		this.refCount++
		// console.log(`McpHub: Client registered. Ref count: ${this.refCount}`)
	}

	/**
	 * Unregisters a client. Decrements the reference count.
	 * If the count reaches zero, disposes the hub.
	 */
	public async unregisterClient(): Promise<void> {
		this.refCount--

		// console.log(`McpHub: Client unregistered. Ref count: ${this.refCount}`)

		if (this.refCount <= 0) {
			console.log("McpHub: Last client unregistered. Disposing hub.")
			await this.dispose()
		}
	}

	/** A settings file changed on disk (debounced by McpConfigWatcher): apply it. */
	private async handleConfigFileChange(filePath: string, source: McpConfigSource): Promise<void> {
		try {
			const servers = await this.readValidatedServers(filePath)
			if (servers) {
				await this.updateServerConnections(servers, source)
			}
		} catch (error) {
			// Check if the error is because the file doesn't exist
			if ((error as NodeJS.ErrnoException).code === "ENOENT" && source === "project") {
				await this.handleProjectConfigDeleted()
			} else {
				logMcpError(t("mcp:errors.failed_update_project"), error)
			}
		}
	}

	/** The project file is gone: disconnect and remove all project servers. */
	private async handleProjectConfigDeleted(): Promise<void> {
		await this.cleanupProjectMcpServers()
		await this.notifyWebviewOfServerChanges()
		vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
	}

	/**
	 * Reads a settings file and returns its servers. Invalid JSON or a schema
	 * failure is shown to the user and returns undefined; read errors throw.
	 */
	private async readValidatedServers(filePath: string): Promise<Record<string, McpServerConfig> | undefined> {
		const result = await this.configStore.readValidated(filePath)
		switch (result.status) {
			case "valid":
				return result.servers
			case "invalid-json": {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, result.error)
				vscode.window.showErrorMessage(errorMessage)
				return undefined
			}
			case "invalid-schema":
				console.error(`Invalid MCP settings format in ${filePath}:`, result.errorMessages)
				vscode.window.showErrorMessage(
					t("mcp:errors.invalid_settings_validation", { errorMessages: result.errorMessages }),
				)
				return undefined
		}
	}

	/** Watches the project file of the current workspace, when there is a workspace folder. */
	private watchProjectMcpFile(): void {
		this.configWatcher.watchProjectFile(
			vscode.workspace.workspaceFolders?.length ? this.workspacePath() : undefined,
		)
	}

	private workspacePath(): string {
		return this.providerRef.deref()?.cwd ?? getWorkspacePath()
	}

	private async watchMcpSettingsFile(): Promise<void> {
		this.configWatcher.watchGlobalFile(await this.configStore.getGlobalPath())
	}

	private async updateProjectMcpServers(): Promise<void> {
		try {
			const projectMcpPath = await this.configStore.getProjectPath()
			if (!projectMcpPath) return

			const servers = await this.readValidatedServers(projectMcpPath)
			if (servers) {
				await this.updateServerConnections(servers, "project")
			}
		} catch (error) {
			logMcpError(t("mcp:errors.failed_update_project"), error)
		}
	}

	private async cleanupProjectMcpServers(): Promise<void> {
		// Disconnect and remove all project MCP servers
		const projectConnections = this.connections.filter((conn) => conn.server.source === "project")

		for (const conn of projectConnections) {
			await this.deleteConnection(conn.server.name, "project")
		}

		// Clear project servers from the connections list
		await this.updateServerConnections({}, "project", false)
	}

	getServers(): McpServer[] {
		return this.connectionManager.getServers()
	}

	getAllServers(): McpServer[] {
		return this.connectionManager.getAllServers()
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	/** The global settings file; created with an empty server list when missing. */
	async getMcpSettingsFilePath(): Promise<string> {
		return this.configStore.getGlobalPath()
	}

	private async initializeMcpServers(source: McpConfigSource): Promise<void> {
		try {
			const configPath = await this.configStore.getPath(source)
			if (!configPath) {
				return
			}

			const result = await this.configStore.readValidated(configPath)
			if (result.status === "valid") {
				// Pass all servers including disabled ones - they'll be handled in updateServerConnections
				await this.updateServerConnections(result.servers, source, false)
			} else if (result.status === "invalid-schema") {
				const { errorMessages } = result
				console.error(`Invalid ${source} MCP settings format:`, errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))

				if (source === "global") {
					// Still try to connect with the raw config, but show warnings
					try {
						await this.updateServerConnections(result.raw.mcpServers || {}, source, false)
					} catch (error) {
						logMcpError(`Failed to initialize ${source} MCP servers with raw config`, error)
					}
				}
			} else {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, result.error)
				vscode.window.showErrorMessage(errorMessage)
			}
		} catch (error) {
			logMcpError(`Failed to initialize ${source} MCP servers`, error)
		}
	}

	private async initializeGlobalMcpServers(): Promise<void> {
		await this.initializeMcpServers("global")
	}

	// Initialize project-level MCP servers
	private async initializeProjectMcpServers(): Promise<void> {
		await this.initializeMcpServers("project")
	}

	/**
	 * Checks if MCP is globally enabled
	 * @returns Promise<boolean> indicating if MCP is enabled
	 */
	private async isMcpEnabled(): Promise<boolean> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return true // Default to enabled if provider is not available
		}
		const state = await provider.getState()
		return state.mcpEnabled ?? SETTINGS_DEFAULTS.mcpEnabled
	}

	/**
	 * Find a connection by sanitized server name (see McpConnectionManager).
	 * @returns The original server name if found, or null if no match
	 */
	public findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		return this.connectionManager.findServerNameBySanitizedName(sanitizedServerName)
	}

	async deleteConnection(name: string, source?: McpConfigSource): Promise<void> {
		await this.connectionManager.deleteConnection(name, source)
	}

	async updateServerConnections(
		newServers: Record<string, any>,
		source: McpConfigSource = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		await this.connectionManager.updateServerConnections(newServers, source, manageConnectingState)
	}

	async restartConnection(serverName: string, source?: McpConfigSource): Promise<void> {
		await this.connectionManager.restartConnection(serverName, source)
	}

	public async refreshAllConnections(): Promise<void> {
		if (this.isConnecting) {
			return
		}

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Clear all existing connections
			await this.connectionManager.deleteAllConnections()

			// Still initialize servers to track them, but they won't connect
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await this.notifyWebviewOfServerChanges()
			return
		}

		this.isConnecting = true

		try {
			// Clear all existing connections first
			await this.connectionManager.deleteAllConnections()

			// Re-initialize all servers from scratch
			// This ensures proper initialization including fetching tools, resources, etc.
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await delay(100)

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			logMcpError("Failed to refresh MCP servers", error)
		} finally {
			this.isConnecting = false
		}
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// A disposed hub (and the transports it closed) pushes nothing more.
		if (this.isDisposed) {
			return
		}

		// Server order as written in the settings files
		const globalServerOrder = await this.configStore.readServerOrder("global")
		const projectServerOrder = await this.configStore.readServerOrder("project")

		// Sort connections: first project servers in their defined order, then global servers in their defined order
		// This ensures that when servers have the same name, project servers are prioritized
		const sortedConnections = [...this.connections].sort((a, b) => {
			const aIsGlobal = a.server.source === "global" || !a.server.source
			const bIsGlobal = b.server.source === "global" || !b.server.source

			// If both are global or both are project, sort by their respective order
			if (aIsGlobal && bIsGlobal) {
				const indexA = globalServerOrder.indexOf(a.server.name)
				const indexB = globalServerOrder.indexOf(b.server.name)
				return indexA - indexB
			} else if (!aIsGlobal && !bIsGlobal) {
				const indexA = projectServerOrder.indexOf(a.server.name)
				const indexB = projectServerOrder.indexOf(b.server.name)
				return indexA - indexB
			}

			// Project servers come before global servers (reversed from original)
			return aIsGlobal ? 1 : -1
		})

		// Send sorted servers to webview
		const targetProvider: McpHubProvider | undefined = this.providerRef.deref()

		if (targetProvider) {
			const serversToSend = sortedConnections.map((connection) => connection.server)

			const message = {
				type: "mcpServers" as const,
				mcpServers: serversToSend,
			}

			try {
				await targetProvider.postMessageToWebview(message)
			} catch (error) {
				console.error("[McpHub] Error calling targetProvider.postMessageToWebview:", error)
			}
		} else {
			console.error(
				"[McpHub] No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview",
			)
		}
	}

	public async toggleServerDisabled(serverName: string, disabled: boolean, source?: McpConfigSource): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.connectionManager.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { disabled }, serverSource)

			// Update the connection object
			if (connection) {
				try {
					connection.server.disabled = disabled

					// If disabling a connected server, disconnect it
					if (disabled && connection.server.status === "connected") {
						// deleteConnection also closes the server's file watchers
						await this.deleteConnection(serverName, serverSource)
						// Re-add as a disabled connection
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.connectionManager.connectToServer(serverName, updatedConfig, serverSource)
					} else if (!disabled && connection.server.status === "disconnected") {
						// If enabling a disabled server, connect it
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.deleteConnection(serverName, serverSource)
						// When re-enabling, file watchers will be set up in connectToServer
						await this.connectionManager.connectToServer(serverName, updatedConfig, serverSource)
					} else if (connection.server.status === "connected") {
						// Only refresh capabilities if connected
						Object.assign(
							connection.server,
							await this.toolCatalog.fetchCapabilities(serverName, serverSource),
						)
					}
				} catch (error) {
					console.error(`Failed to refresh capabilities for ${serverName}:`, error)
				}
			}

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			logMcpError(`Failed to update server ${serverName} state`, error)
			throw error
		}
	}

	/**
	 * Helper method to read a server's configuration from the appropriate settings file
	 * @param serverName The name of the server to read
	 * @param source Whether to read from the global or project config
	 * @returns The validated server configuration
	 */
	private async readServerConfigFromFile(
		serverName: string,
		source: McpConfigSource = "global",
	): Promise<McpServerConfig> {
		const { config } = await this.configStore.readForUpdate(source)

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			throw new Error("No mcpServers section in config")
		}

		if (!config.mcpServers[serverName]) {
			throw new Error(`Server ${serverName} not found in config`)
		}

		// Validate and return the server config
		return validateServerConfig(config.mcpServers[serverName], serverName)
	}

	/**
	 * Helper method to update a server's configuration in the appropriate settings file
	 * @param serverName The name of the server to update
	 * @param configUpdate The configuration updates to apply
	 * @param source Whether to update the global or project config
	 */
	private async updateServerConfig(
		serverName: string,
		configUpdate: Record<string, any>,
		source: McpConfigSource = "global",
	): Promise<void> {
		const { path: configPath, config } = await this.configStore.readForUpdate(source)

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {}
		}

		// Create a new server config object to ensure clean structure
		const serverConfig = {
			...config.mcpServers[serverName],
			...configUpdate,
		}

		// Ensure required fields exist
		if (!serverConfig.alwaysAllow) {
			serverConfig.alwaysAllow = []
		}

		config.mcpServers[serverName] = serverConfig

		// Write the entire config back
		await this.configStore.write(configPath, { mcpServers: config.mcpServers })
	}

	public async updateServerTimeout(serverName: string, timeout: number, source?: McpConfigSource): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.connectionManager.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { timeout }, connection.server.source || "global")

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			logMcpError(`Failed to update server ${serverName} timeout settings`, error)
			throw error
		}
	}

	public async deleteServer(serverName: string, source?: McpConfigSource): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.connectionManager.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			const { path: configPath, config } = await this.configStore.readForUpdate(serverSource)

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			// Remove the server from the settings
			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]

				// Write the entire config back
				await this.configStore.write(configPath, { mcpServers: config.mcpServers })

				// Update server connections with the correct source
				await this.updateServerConnections(config.mcpServers, serverSource)

				vscode.window.showInformationMessage(t("mcp:info.server_deleted", { serverName }))
			} else {
				vscode.window.showWarningMessage(t("mcp:info.server_not_found", { serverName }))
			}
		} catch (error) {
			logMcpError(`Failed to delete MCP server ${serverName}`, error)
			throw error
		}
	}

	async readResource(serverName: string, uri: string, source?: McpConfigSource): Promise<McpResourceResponse> {
		return this.toolCatalog.readResource(serverName, uri, source)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: McpConfigSource,
	): Promise<McpToolCallResponse> {
		return this.toolCatalog.callTool(serverName, toolName, toolArguments, source)
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: McpConfigSource,
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		await this.toolCatalog.toggleToolAlwaysAllow(serverName, source, toolName, shouldAllow)
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: McpConfigSource,
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		await this.toolCatalog.toggleToolEnabledForPrompt(serverName, source, toolName, isEnabled)
	}

	/**
	 * Handles enabling/disabling MCP globally
	 * @param enabled Whether MCP should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleMcpEnabledChange(enabled: boolean): Promise<void> {
		if (!enabled) {
			// If MCP is being disabled, disconnect all servers with error handling
			const existingConnections = [...this.connections]
			const disconnectionErrors: Array<{ serverName: string; error: string }> = []

			for (const conn of existingConnections) {
				try {
					await this.deleteConnection(conn.server.name, conn.server.source)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					disconnectionErrors.push({
						serverName: conn.server.name,
						error: errorMessage,
					})
					console.error(`Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`)
				}
			}

			// If there were errors, notify the user
			if (disconnectionErrors.length > 0) {
				const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n")
				vscode.window.showWarningMessage(
					t("mcp:errors.disconnect_servers_partial", {
						count: disconnectionErrors.length,
						errors: errorSummary,
					}),
				)
			}

			// Re-initialize servers to track them in disconnected state
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after disabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"))
			}
		} else {
			// If MCP is being enabled, reconnect all servers
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after enabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"))
			}
		}
	}

	async dispose(): Promise<void> {
		// Prevent multiple disposals
		if (this.isDisposed) {
			return
		}

		this.isDisposed = true

		// Stop the settings-file watchers (and their pending debounce timers) and the write guard timer
		this.configWatcher.dispose()
		this.configStore.dispose()
		// Closes the server file watchers and every connection; a connect still
		// in flight leaves nothing behind.
		await this.connectionManager.dispose()
	}
}
