import * as vscode from "vscode"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"

import type { McpServer } from "@roo-code/types"

import { t } from "../../i18n"

import { injectVariables } from "../../utils/config"
import { sanitizeMcpName, toolNamesMatch } from "../../utils/mcp-name"

import { type McpConfigSource, type McpServerConfig, validateServerConfig } from "./mcpConfigSchema"

export type McpTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: McpTransport
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}

/** What a freshly connected server reports about itself (see McpToolCatalog.fetchCapabilities). */
export type McpServerCapabilities = Pick<McpServer, "tools" | "resources" | "resourceTemplates">

export interface McpConnectionManagerDeps {
	/** The version the MCP client reports to servers. */
	clientVersion: () => string
	isMcpEnabled: () => Promise<boolean>
	/** Push the current server list to the webview. */
	notifyServerChanges: () => Promise<void>
	fetchCapabilities: (name: string, source: McpConfigSource) => Promise<McpServerCapabilities>
}

/** Logs an MCP failure; the hub, the manager and the catalog report errors the same way. */
export function logMcpError(message: string, error: unknown): void {
	console.error(`${message}:`, error)
}

/**
 * The live MCP connections: building transports, connecting, restarting and
 * deleting servers, and the file watchers that restart a stdio server when
 * its code changes.
 *
 * `connections` is replaced (never mutated in place) when a server goes, and
 * pushed to when one comes; callers that keep a reference see a snapshot.
 */
export class McpConnectionManager {
	connections: McpConnection[] = []
	isConnecting: boolean = false
	private sanitizedNameRegistry: Map<string, string> = new Map()
	/** File watchers per server, keyed by `fileWatcherKey(source, name)`. */
	private fileWatchers: Map<string, FSWatcher[]> = new Map()
	private disposed = false

	constructor(private readonly deps: McpConnectionManagerDeps) {}

	/**
	 * Helper method to find a connection by server name and source
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 * @returns The matching connection or undefined if not found
	 */
	findConnection(serverName: string, source?: McpConfigSource): McpConnection | undefined {
		// If source is specified, only find servers with that source
		if (source !== undefined) {
			return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source)
		}

		// If no source is specified, first look for project servers, then global servers
		// This ensures that when servers have the same name, project servers are prioritized
		const projectConn = this.connections.find(
			(conn) => conn.server.name === serverName && conn.server.source === "project",
		)
		if (projectConn) return projectConn

		// If no project server is found, look for global servers
		return this.connections.find(
			(conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source),
		)
	}

	/**
	 * Find a connection by sanitized server name.
	 * This is used when parsing MCP tool responses where the server name has been
	 * sanitized (e.g., hyphens replaced with underscores) for API compliance.
	 * Uses fuzzy matching to handle cases where models convert hyphens to underscores.
	 * @param sanitizedServerName The sanitized server name from the API tool call
	 * @returns The original server name if found, or null if no match
	 */
	findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		// First, check for an exact match
		const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName)
		if (exactMatch) {
			return exactMatch.server.name
		}

		// Check the registry for sanitized name mapping
		const registryMatch = this.sanitizedNameRegistry.get(sanitizedServerName)
		if (registryMatch) {
			return registryMatch
		}

		// Use fuzzy matching: treat hyphens and underscores as equivalent
		const fuzzyMatch = this.connections.find((conn) => toolNamesMatch(conn.server.name, sanitizedServerName))
		if (fuzzyMatch) {
			return fuzzyMatch.server.name
		}

		return null
	}

	getServers(): McpServer[] {
		// Only return enabled servers, deduplicating by name with project servers taking priority
		const enabledConnections = this.connections.filter((conn) => !conn.server.disabled)

		// Deduplicate by server name: project servers take priority over global servers
		const serversByName = new Map<string, McpServer>()
		for (const conn of enabledConnections) {
			const existing = serversByName.get(conn.server.name)
			if (!existing) {
				serversByName.set(conn.server.name, conn.server)
			} else if (conn.server.source === "project" && existing.source !== "project") {
				// Project server overrides global server with the same name
				serversByName.set(conn.server.name, conn.server)
			}
			// If existing is project and current is global, keep existing (project wins)
		}

		return Array.from(serversByName.values())
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	/**
	 * Creates a placeholder connection for disabled servers, when MCP is globally disabled,
	 * or for a server whose transport failed before its connection was registered
	 * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled);
	 * omitted for a server that failed to start
	 */
	private createPlaceholderConnection(
		name: string,
		config: McpServerConfig,
		source: McpConfigSource,
		reason?: DisableReason,
	): DisconnectedMcpConnection {
		return {
			type: "disconnected",
			server: {
				name,
				config: JSON.stringify(config),
				status: "disconnected",
				disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
				source,
				projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
				errorHistory: [],
			},
			client: null,
			transport: null,
		}
	}

	/**
	 * After dispose, an in-flight connect must leave nothing behind: close what
	 * it built and drop the file watchers it set up.
	 */
	private abandonIfDisposed(name: string, source: McpConfigSource, transport?: McpTransport): boolean {
		if (!this.disposed) {
			return false
		}
		this.removeFileWatchersForServer(name, source)
		transport?.close().catch((error) => logMcpError(`Failed to close transport for ${name}`, error))
		return true
	}

	async connectToServer(name: string, config: McpServerConfig, source: McpConfigSource = "global"): Promise<void> {
		// Remove existing connection if it exists with the same source
		await this.deleteConnection(name, source)

		// Register the sanitized name for O(1) lookup
		const sanitizedName = sanitizeMcpName(name)
		this.sanitizedNameRegistry.set(sanitizedName, name)

		// Check if MCP is globally enabled
		const mcpEnabled = await this.deps.isMcpEnabled()
		if (this.abandonIfDisposed(name, source)) {
			return
		}
		if (!mcpEnabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.MCP_DISABLED)
			this.connections.push(connection)
			return
		}

		// Skip connecting to disabled servers
		if (config.disabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
			this.connections.push(connection)
			return
		}

		// Set up file watchers for enabled servers
		this.setupFileWatcher(name, config, source)

		try {
			const client = new Client(
				{
					name: "Roo Code",
					version: this.deps.clientVersion(),
				},
				{
					capabilities: {},
				},
			)

			// Inject variables to the config (environment, magic variables,...)
			const configInjected = await this.injectConfigVariables(config)
			const transport = await this.createTransport(name, source, configInjected)
			if (this.abandonIfDisposed(name, source, transport)) {
				return
			}

			// Create a connected connection
			const connection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name,
					config: JSON.stringify(configInjected),
					status: "connecting",
					disabled: configInjected.disabled,
					source,
					projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
					errorHistory: [],
				},
				client,
				transport,
			}
			this.connections.push(connection)

			// Connect (this will automatically start the transport)
			await client.connect(transport)
			// dispose() closed and removed this connection while it was connecting
			if (this.abandonIfDisposed(name, source)) {
				return
			}
			connection.server.status = "connected"
			connection.server.error = ""
			connection.server.instructions = client.getInstructions()

			// Initial fetch of tools and resources
			Object.assign(connection.server, await this.deps.fetchCapabilities(name, source))
		} catch (error) {
			if (this.abandonIfDisposed(name, source)) {
				return
			}
			// Update status with error. A stdio server whose process cannot start
			// (command not found) fails in transport.start(), before its connection
			// is registered; without a placeholder it vanished from the server list,
			// with its error, and could not be restarted either.
			let connection = this.findConnection(name, source)
			if (!connection) {
				connection = this.createPlaceholderConnection(name, config, source)
				this.connections.push(connection)
			}
			connection.server.status = "disconnected"
			this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			throw error
		}
	}

	/**
	 * Builds the transport for a server's (variable-injected) config and
	 * installs the shared error and close handlers. A stdio transport is
	 * started here, so its stderr is captured from the first byte, and its
	 * start() becomes a no-op for the client's connect().
	 */
	async createTransport(name: string, source: McpConfigSource, config: McpServerConfig): Promise<McpTransport> {
		let transport: SSEClientTransport | StreamableHTTPClientTransport

		if (config.type === "stdio") {
			// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
			// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
			// commands as PowerShell scripts rather than executables.
			// Note: This adds a small overhead as commands go through an additional shell layer.
			const isWindows = process.platform === "win32"

			// Check if command is already cmd.exe to avoid double-wrapping
			const isAlreadyWrapped =
				config.command.toLowerCase() === "cmd.exe" || config.command.toLowerCase() === "cmd"

			const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : config.command
			const args = isWindows && !isAlreadyWrapped ? ["/c", config.command, ...(config.args || [])] : config.args

			const stdioTransport = new StdioClientTransport({
				command,
				args,
				cwd: config.cwd,
				env: {
					...getDefaultEnvironment(),
					...(config.env || {}),
				},
				stderr: "pipe",
			})
			this.installTransportHandlers(stdioTransport, name, source, "")
			await this.startStdioTransport(stdioTransport, name, source)
			return stdioTransport
		} else if (config.type === "streamable-http") {
			transport = new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: {
					headers: config.headers,
				},
			})
		} else if (config.type === "sse") {
			const sseOptions = {
				requestInit: {
					headers: config.headers,
				},
			}
			// Options for the EventSource the SDK creates itself (it imports it from
			// the `eventsource` package, so no global override is needed).
			const eventSourceInit = {
				withCredentials: config.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
				fetch: (url: string | URL, init: RequestInit) => {
					const headers = new Headers({ ...(init?.headers || {}), ...(config.headers || {}) })
					return fetch(url, {
						...init,
						headers,
					})
				},
			}
			transport = new SSEClientTransport(new URL(config.url), {
				...sseOptions,
				eventSourceInit,
			})
		} else {
			// Should not happen if validateServerConfig is correct
			throw new Error(`Unsupported MCP server type: ${(config as any).type}`)
		}

		this.installTransportHandlers(
			transport,
			name,
			source,
			config.type === "streamable-http" ? " (streamable-http)" : "",
		)
		return transport
	}

	/** The one error and close handler every transport type gets. */
	private installTransportHandlers(
		transport: McpTransport,
		name: string,
		source: McpConfigSource,
		logSuffix: string,
	): void {
		transport.onerror = async (error) => {
			console.error(`Transport error for "${name}"${logSuffix}:`, error)
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			}
			await this.deps.notifyServerChanges()
		}

		transport.onclose = async () => {
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
			}
			await this.deps.notifyServerChanges()
		}
	}

	private async startStdioTransport(
		transport: StdioClientTransport,
		name: string,
		source: McpConfigSource,
	): Promise<void> {
		// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
		// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
		await transport.start()
		const stderrStream = transport.stderr
		if (stderrStream) {
			stderrStream.on("data", async (data: Buffer) => {
				const output = data.toString()
				// Check if output contains INFO level log
				const isInfoLog = /INFO/i.test(output)

				if (isInfoLog) {
					// Log normal informational messages
					console.log(`Server "${name}" info:`, output)
				} else {
					// Treat as error log
					console.error(`Server "${name}" stderr:`, output)
					const connection = this.findConnection(name, source)
					if (connection) {
						this.appendErrorMessage(connection, output)
						if (connection.server.status === "disconnected") {
							await this.deps.notifyServerChanges()
						}
					}
				}
			})
		} else {
			console.error(`No stderr stream for ${name}`)
		}
		transport.start = async () => {}
	}

	private appendErrorMessage(connection: McpConnection, error: string, level: "error" | "warn" | "info" = "error") {
		const MAX_ERROR_LENGTH = 1000
		const truncatedError =
			error.length > MAX_ERROR_LENGTH
				? `${error.substring(0, MAX_ERROR_LENGTH)}...(error message truncated)`
				: error

		// Add to error history
		if (!connection.server.errorHistory) {
			connection.server.errorHistory = []
		}

		connection.server.errorHistory.push({
			message: truncatedError,
			timestamp: Date.now(),
			level,
		})

		// Keep only the last 100 errors
		if (connection.server.errorHistory.length > 100) {
			connection.server.errorHistory = connection.server.errorHistory.slice(-100)
		}

		// Update current error display
		connection.server.error = truncatedError
	}

	async deleteConnection(name: string, source?: McpConfigSource): Promise<void> {
		// Clean up file watchers for this server
		this.removeFileWatchersForServer(name, source)

		// If source is provided, only delete connections from that source
		const connections = source
			? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
			: this.connections.filter((conn) => conn.server.name === name)

		for (const connection of connections) {
			try {
				if (connection.type === "connected") {
					await connection.transport.close()
					await connection.client.close()
				}
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
		}

		// Remove the connections from the array
		this.connections = this.connections.filter((conn) => {
			if (conn.server.name !== name) return true
			if (source && conn.server.source !== source) return true
			return false
		})

		// Remove from sanitized name registry if no more connections with this name exist
		const remainingConnections = this.connections.filter((conn) => conn.server.name === name)
		if (remainingConnections.length === 0) {
			const sanitizedName = sanitizeMcpName(name)
			this.sanitizedNameRegistry.delete(sanitizedName)
		}
	}

	async updateServerConnections(
		newServers: Record<string, any>,
		source: McpConfigSource = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		if (manageConnectingState) {
			this.isConnecting = true
		}
		try {
			// Filter connections by source
			const currentConnections = this.connections.filter(
				(conn) => conn.server.source === source || (!conn.server.source && source === "global"),
			)
			const currentNames = new Set(currentConnections.map((conn) => conn.server.name))
			const newNames = new Set(Object.keys(newServers))

			// Delete removed servers (their file watchers go with them)
			for (const name of currentNames) {
				if (!newNames.has(name)) {
					await this.deleteConnection(name, source)
				}
			}

			// Update or add servers. connectToServer sets up the file watchers of
			// enabled servers; unchanged servers keep theirs.
			for (const [name, config] of Object.entries(newServers)) {
				// Only consider connections that match the current source
				const currentConnection = this.findConnection(name, source)

				// Validate and transform the config
				let validatedConfig: McpServerConfig
				try {
					validatedConfig = validateServerConfig(config, name)
				} catch (error) {
					logMcpError(`Invalid configuration for MCP server "${name}"`, error)
					continue
				}

				if (!currentConnection) {
					// New server
					try {
						await this.connectToServer(name, validatedConfig, source)
					} catch (error) {
						logMcpError(`Failed to connect to new MCP server ${name}`, error)
					}
				} else if (!(await this.isSameStoredConfig(currentConnection.server.config, validatedConfig))) {
					// Existing server with changed config
					try {
						await this.deleteConnection(name, source)
						await this.connectToServer(name, validatedConfig, source)
					} catch (error) {
						logMcpError(`Failed to reconnect MCP server ${name}`, error)
					}
				}
				// If server exists with same config, do nothing
			}
			await this.deps.notifyServerChanges()
		} finally {
			if (manageConnectingState) {
				this.isConnecting = false
			}
		}
	}

	/**
	 * Whether a connection's stored config describes the same server as a
	 * freshly validated config. A connected server stores its config with
	 * defaults applied and variables injected, a placeholder (disabled) server
	 * with defaults only, so the validated config is compared in both forms.
	 */
	private async isSameStoredConfig(storedConfig: string, validatedConfig: McpServerConfig): Promise<boolean> {
		const stored = JSON.parse(storedConfig)
		const asJson = (value: unknown) => JSON.parse(JSON.stringify(value))
		return (
			deepEqual(stored, asJson(validatedConfig)) ||
			deepEqual(stored, asJson(await this.injectConfigVariables(validatedConfig)))
		)
	}

	/** Inject environment and magic variables (e.g. `${env:TOKEN}`, `${workspaceFolder}`) into a config. */
	private async injectConfigVariables(config: McpServerConfig): Promise<McpServerConfig> {
		return (await injectVariables(config, {
			env: process.env,
			workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
		})) as typeof config
	}

	async restartConnection(serverName: string, source?: McpConfigSource): Promise<void> {
		this.isConnecting = true
		try {
			// Check if MCP is globally enabled
			const mcpEnabled = await this.deps.isMcpEnabled()
			if (!mcpEnabled) {
				return
			}

			// Get existing connection and update its status
			const connection = this.findConnection(serverName, source)
			const config = connection?.server.config
			if (config) {
				vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
				connection.server.status = "connecting"
				connection.server.error = ""
				await this.deps.notifyServerChanges()
				await delay(500) // artificial delay to show user that server is restarting
				try {
					await this.deleteConnection(serverName, connection.server.source)
					// Parse the config to validate it
					const parsedConfig = JSON.parse(config)
					try {
						// Validate the config
						const validatedConfig = validateServerConfig(parsedConfig, serverName)

						// Try to connect again using validated config
						await this.connectToServer(serverName, validatedConfig, connection.server.source || "global")
						vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }))
					} catch (validationError) {
						logMcpError(`Invalid configuration for MCP server "${serverName}"`, validationError)
					}
				} catch (error) {
					logMcpError(`Failed to restart ${serverName} MCP server connection`, error)
				}
			}

			await this.deps.notifyServerChanges()
		} finally {
			this.isConnecting = false
		}
	}

	/** Disconnect every server (all sources); used before re-reading both settings files. */
	async deleteAllConnections(): Promise<void> {
		const existingConnections = [...this.connections]
		for (const conn of existingConnections) {
			await this.deleteConnection(conn.server.name, conn.server.source)
		}
	}

	private setupFileWatcher(name: string, config: McpServerConfig, source: McpConfigSource = "global") {
		// Replace any watchers this server already has, so a reconnect never
		// leaves two watchers that each restart the server.
		this.removeFileWatchersForServer(name, source)
		const key = fileWatcherKey(source, name)
		const watchers: FSWatcher[] = []

		// Only stdio type has args
		if (config.type === "stdio") {
			// Setup watchers for custom watchPaths if defined
			if (config.watchPaths && config.watchPaths.length > 0) {
				const watchPathsWatcher = chokidar.watch(config.watchPaths, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true,
				})

				watchPathsWatcher.on("change", async (changedPath) => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error)
					}
				})

				watchers.push(watchPathsWatcher)
			}

			// Also setup the fallback build/index.js watcher if applicable
			const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
			if (filePath) {
				// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
				const indexJsWatcher = chokidar.watch(filePath, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true, // This helps with atomic writes
				})

				indexJsWatcher.on("change", async () => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${filePath}:`, error)
					}
				})

				watchers.push(indexJsWatcher)
			}

			// Update the fileWatchers map with all watchers for this server
			if (watchers.length > 0) {
				this.fileWatchers.set(key, watchers)
			}
		}
	}

	/** Close a server's file watchers; without a source, those of both sources. */
	private removeFileWatchersForServer(serverName: string, source?: McpConfigSource) {
		const sources = source ? [source] : (["global", "project"] as const)
		for (const s of sources) {
			const key = fileWatcherKey(s, serverName)
			const watchers = this.fileWatchers.get(key)
			if (watchers) {
				watchers.forEach((watcher) => watcher.close())
				this.fileWatchers.delete(key)
			}
		}
	}

	/**
	 * Close every file watcher and connection. A connect still in flight
	 * notices on its next step and leaves nothing behind (abandonIfDisposed).
	 */
	async dispose(): Promise<void> {
		this.disposed = true

		this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()))
		this.fileWatchers.clear()

		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name, connection.server.source)
			} catch (error) {
				console.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}

		this.connections = []
	}
}

function fileWatcherKey(source: McpConfigSource, name: string): string {
	return `${source}:${name}`
}
