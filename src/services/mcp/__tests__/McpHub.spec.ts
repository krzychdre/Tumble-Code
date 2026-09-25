import fs from "fs/promises"
import path from "path"

import type { Mock } from "vitest"
import type { ExtensionContext, Uri } from "vscode"
import type { McpServer } from "@roo-code/types"

import type { ClineProvider } from "../../../core/webview/ClineProvider"

import type { McpHub as McpHubType, McpConnection, ConnectedMcpConnection, DisconnectedMcpConnection } from "../McpHub"
import { McpHub } from "../McpHub"
import { ServerConfigSchema } from "../mcpConfigSchema"
import type { McpFileListeners, McpWatcherFactory } from "../McpConfigWatcher"

// Mock fs/promises before importing anything that uses it
vi.mock("fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("{}"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
		lstat: vi.fn().mockImplementation(() =>
			Promise.resolve({
				isDirectory: () => true,
			}),
		),
		mkdir: vi.fn().mockResolvedValue(undefined),
	},
	access: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	unlink: vi.fn().mockResolvedValue(undefined),
	rename: vi.fn().mockResolvedValue(undefined),
	lstat: vi.fn().mockImplementation(() =>
		Promise.resolve({
			isDirectory: () => true,
		}),
	),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Import safeWriteJson to use in mocks
import { safeWriteJson } from "../../../utils/safeWriteJson"

// Mock safeWriteJson
vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath, data) => {
		// Instead of trying to write to the file system, just call fs.writeFile mock
		// This avoids the complex file locking and temp file operations
		const fs = await import("fs/promises")
		return fs.writeFile(filePath, JSON.stringify(data), "utf8")
	}),
}))

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
		onDidSaveTextDocument: vi.fn(),
		onDidChangeWorkspaceFolders: vi.fn(),
		workspaceFolders: [],
	},
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn().mockReturnValue({
			dispose: vi.fn(),
		}),
	},
	Disposable: {
		from: vi.fn(),
	},
}))
vi.mock("fs/promises")
vi.mock("../../../core/webview/ClineProvider")

// Echo the key and its options, so a test can see what a message would say.
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}))

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(),
	getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: "/usr/bin" }),
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(),
}))

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: vi.fn(),
}))

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: vi.fn(),
}))

// Mock chokidar
vi.mock("chokidar", () => ({
	default: {
		watch: vi.fn().mockReturnValue({
			on: vi.fn().mockReturnThis(),
			close: vi.fn(),
		}),
	},
}))

/**
 * Stands in for the VS Code file watchers: records what the hub watches and
 * lets a test fire the events a real watcher would.
 */
function createFakeWatcherFactory() {
	const watches: { file: string; listeners: McpFileListeners; disposed: boolean }[] = []
	const folderListeners: (() => void)[] = []
	const factory: McpWatcherFactory = {
		watchFile(baseDirectory, relativePattern, listeners) {
			const watch = { file: path.join(baseDirectory, relativePattern), listeners, disposed: false }
			watches.push(watch)
			return {
				dispose: () => {
					watch.disposed = true
				},
			}
		},
		onDidChangeWorkspaceFolders(listener) {
			folderListeners.push(listener)
			return { dispose: () => folderListeners.splice(folderListeners.indexOf(listener), 1) }
		},
	}
	const fire = (event: "change" | "create" | "delete", filePath: string) => {
		for (const watch of watches.filter((w) => !w.disposed && w.file === filePath)) {
			if (event === "change") watch.listeners.onChange(filePath)
			else if (event === "create") watch.listeners.onCreate(filePath)
			else watch.listeners.onDelete?.(filePath)
		}
	}
	const changeWorkspaceFolders = () => folderListeners.forEach((listener) => listener())
	return { factory, watches, fire, changeWorkspaceFolders }
}

let fakeWatchers: ReturnType<typeof createFakeWatcherFactory>

describe("McpHub", () => {
	let mcpHub: McpHubType
	let mockProvider: Partial<ClineProvider>

	// Store original console methods
	const originalConsoleError = console.error
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")

	beforeEach(() => {
		vi.clearAllMocks()
		fakeWatchers = createFakeWatcherFactory()

		// Mock console.error to suppress error messages during tests
		console.error = vi.fn()

		const mockUri: Uri = {
			scheme: "file",
			authority: "",
			path: "/test/path",
			query: "",
			fragment: "",
			fsPath: "/test/path",
			with: vi.fn(),
			toJSON: vi.fn(),
		}

		mockProvider = {
			ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
			ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
			postMessageToWebview: vi.fn(),
			getState: vi.fn().mockResolvedValue({ mcpEnabled: true }),
			context: {
				subscriptions: [],
				workspaceState: {} as any,
				globalState: {} as any,
				secrets: {} as any,
				extensionUri: mockUri,
				extensionPath: "/test/path",
				storagePath: "/test/storage",
				globalStoragePath: "/test/global-storage",
				environmentVariableCollection: {} as any,
				extension: {
					id: "test-extension",
					extensionUri: mockUri,
					extensionPath: "/test/path",
					extensionKind: 1,
					isActive: true,
					packageJSON: {
						version: "1.0.0",
					},
					activate: vi.fn(),
					exports: undefined,
				} as any,
				asAbsolutePath: (path: string) => path,
				storageUri: mockUri,
				globalStorageUri: mockUri,
				logUri: mockUri,
				extensionMode: 1,
				logPath: "/test/path",
				languageModelAccessInformation: {} as any,
			} as ExtensionContext,
		}

		// Mock fs.readFile for initial settings
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["allowed-tool"],
						disabledTools: ["disabled-tool"],
					},
				},
			}),
		)

		mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
	})

	afterEach(() => {
		// Restore original console methods
		console.error = originalConsoleError
		// Restore original platform
		if (originalPlatform) {
			Object.defineProperty(process, "platform", originalPlatform)
		}
	})

	describe("Discriminated union type handling", () => {
		it("should create connected connections with proper type", async () => {
			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"union-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create McpHub and let it initialize
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "union-test-server")
			expect(connection).toBeDefined()

			// Type guard check - connected connections should have client and transport
			if (connection && connection.type === "connected") {
				expect(connection.client).toBeDefined()
				expect(connection.transport).toBeDefined()
				expect(connection.server.status).toBe("connected")
			} else {
				throw new Error("Connection should be of type 'connected'")
			}
		})

		it("should create disconnected connections for disabled servers", async () => {
			// Mock the config file read with a disabled server
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"disabled-union-server": {
							command: "node",
							args: ["test.js"],
							disabled: true,
						},
					},
				}),
			)

			// Create McpHub and let it initialize
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "disabled-union-server")
			expect(connection).toBeDefined()

			// Type guard check - disconnected connections should have null client and transport
			if (connection && connection.type === "disconnected") {
				expect(connection.client).toBeNull()
				expect(connection.transport).toBeNull()
				expect(connection.server.status).toBe("disconnected")
				expect(connection.server.disabled).toBe(true)
			} else {
				throw new Error("Connection should be of type 'disconnected'")
			}
		})

		it("should handle type narrowing correctly in callTool", async () => {
			// Mock fs.readFile to return empty config so no servers are initialized
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {},
				}),
			)

			// Create a mock McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Clear any connections that might have been created
			mcpHub.connections = []

			// Directly set up a connected connection
			const connectedConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					config: JSON.stringify({ command: "node", args: ["test.js"] }),
					status: "connected",
					source: "global",
					errorHistory: [],
				} as any,
				client: {
					request: vi.fn().mockResolvedValue({ result: "success" }),
				} as any,
				transport: {} as any,
			}

			// Add the connected connection
			mcpHub.connections = [connectedConnection]

			// Call tool should work with connected server
			const result = await mcpHub.callTool("test-server", "test-tool", {})
			expect(result).toEqual({ result: "success" })
			expect(connectedConnection.client.request).toHaveBeenCalled()

			// Now test with a disconnected connection
			const disconnectedConnection: DisconnectedMcpConnection = {
				type: "disconnected",
				server: {
					name: "disabled-server",
					config: JSON.stringify({ command: "node", args: ["test.js"], disabled: true }),
					status: "disconnected",
					disabled: true,
					source: "global",
					errorHistory: [],
				} as any,
				client: null,
				transport: null,
			}

			// Replace connections with disconnected one
			mcpHub.connections = [disconnectedConnection]

			// Call tool should fail with disconnected server
			await expect(mcpHub.callTool("disabled-server", "test-tool", {})).rejects.toThrow(
				"No connection found for server: disabled-server",
			)
		})
	})

	describe("SSE transport", () => {
		it("connects without replacing the global EventSource and forwards the configured headers", async () => {
			// The MCP SDK's SSEClientTransport imports its own EventSource from the
			// `eventsource` package, so the extension has no reason to touch the global.
			const globalRef = globalThis as { EventSource?: unknown }
			const originalEventSource = globalRef.EventSource
			const sentinel = function SentinelEventSource() {}
			globalRef.EventSource = sentinel

			const originalFetch = globalThis.fetch
			const fetchSpy = vi.fn().mockResolvedValue(new Response(""))
			globalThis.fetch = fetchSpy as unknown as typeof fetch

			try {
				const sseModule = await import("@modelcontextprotocol/sdk/client/sse.js")
				const SSEClientTransport = sseModule.SSEClientTransport as unknown as ReturnType<typeof vi.fn>
				SSEClientTransport.mockImplementation(() => ({
					start: vi.fn().mockResolvedValue(undefined),
					close: vi.fn().mockResolvedValue(undefined),
					onerror: null,
					onclose: null,
				}))

				const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
				const Client = clientModule.Client as ReturnType<typeof vi.fn>
				Client.mockImplementation(() => ({
					connect: vi.fn().mockResolvedValue(undefined),
					close: vi.fn().mockResolvedValue(undefined),
					getInstructions: vi.fn().mockReturnValue(undefined),
					request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
				}))

				vi.mocked(fs.readFile).mockResolvedValue(
					JSON.stringify({
						mcpServers: {
							"sse-server": {
								type: "sse",
								url: "https://mcp.example.com/sse",
								headers: { Authorization: "Bearer secret" },
							},
						},
					}),
				)

				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await new Promise((resolve) => setTimeout(resolve, 100))

				const connection = hub.connections.find((conn) => conn.server.name === "sse-server")
				expect(connection?.type).toBe("connected")
				expect(globalRef.EventSource).toBe(sentinel)

				expect(SSEClientTransport).toHaveBeenCalledTimes(1)
				const [url, options] = SSEClientTransport.mock.calls[0]
				expect(String(url)).toBe("https://mcp.example.com/sse")
				expect(options.requestInit.headers).toEqual({ Authorization: "Bearer secret" })
				expect(options.eventSourceInit.withCredentials).toBe(true)

				await options.eventSourceInit.fetch("https://mcp.example.com/sse", {
					headers: { Accept: "text/event-stream" },
				})
				const sentHeaders = fetchSpy.mock.calls[0][1].headers as Headers
				expect(sentHeaders.get("Authorization")).toBe("Bearer secret")
				expect(sentHeaders.get("Accept")).toBe("text/event-stream")
			} finally {
				globalRef.EventSource = originalEventSource
				globalThis.fetch = originalFetch
			}
		})
	})

	describe("global settings file location", () => {
		const originalOverride = process.env.ROO_MCP_SETTINGS_PATH

		afterEach(() => {
			if (originalOverride === undefined) {
				delete process.env.ROO_MCP_SETTINGS_PATH
			} else {
				process.env.ROO_MCP_SETTINGS_PATH = originalOverride
			}
		})

		it("uses mcp_settings.json in the settings directory without an override", async () => {
			delete process.env.ROO_MCP_SETTINGS_PATH

			expect(await mcpHub.getMcpSettingsFilePath()).toBe(path.join("/mock/settings/path", "mcp_settings.json"))
		})

		it("uses the file named by ROO_MCP_SETTINGS_PATH (the CLI's ~/.roo/mcp.json)", async () => {
			const override = path.resolve("/home/user/.roo/mcp.json")
			process.env.ROO_MCP_SETTINGS_PATH = override

			expect(await mcpHub.getMcpSettingsFilePath()).toBe(override)
		})

		it("creates a missing override file together with its directory", async () => {
			const override = path.resolve("/home/user/.roo/mcp.json")
			process.env.ROO_MCP_SETTINGS_PATH = override
			// Let the constructor's own settings-file checks finish, so they do not take the rejection below.
			await new Promise((resolve) => setTimeout(resolve, 50))
			vi.mocked(fs.access).mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))

			await mcpHub.getMcpSettingsFilePath()

			expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(override), { recursive: true })
			expect(fs.writeFile).toHaveBeenCalledWith(override, expect.stringContaining('"mcpServers"'), { flag: "wx" })
		})
	})

	describe("File watcher cleanup", () => {
		it("should clean up file watchers when server is disabled", async () => {
			// Get the mocked chokidar
			const chokidar = (await import("chokidar")).default
			const mockWatcher = {
				on: vi.fn().mockReturnThis(),
				close: vi.fn(),
			}
			vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)

			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			// Create server with watchPaths
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"watcher-test-server": {
							command: "node",
							args: ["test.js"],
							watchPaths: ["/path/to/watch"],
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Verify watcher was created
			expect(chokidar.watch).toHaveBeenCalledWith(["/path/to/watch"], expect.any(Object))

			// Now disable the server
			await mcpHub.toggleServerDisabled("watcher-test-server", true)

			// Verify watcher was closed
			expect(mockWatcher.close).toHaveBeenCalled()
		})

		it("should clean up all file watchers when server is deleted", async () => {
			// Get the mocked chokidar
			const chokidar = (await import("chokidar")).default
			const mockWatcher1 = {
				on: vi.fn().mockReturnThis(),
				close: vi.fn(),
			}
			const mockWatcher2 = {
				on: vi.fn().mockReturnThis(),
				close: vi.fn(),
			}

			// Return different watchers for different paths
			let watcherIndex = 0
			vi.mocked(chokidar.watch).mockImplementation(() => {
				return (watcherIndex++ === 0 ? mockWatcher1 : mockWatcher2) as any
			})

			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			// Create server with multiple watchPaths
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"multi-watcher-server": {
							command: "node",
							args: ["test.js", "build/index.js"], // This will create a watcher for build/index.js
							watchPaths: ["/path/to/watch1", "/path/to/watch2"],
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Verify watchers were created
			expect(chokidar.watch).toHaveBeenCalled()

			// Delete the connection (this should clean up all watchers)
			await mcpHub.deleteConnection("multi-watcher-server")

			// Verify all watchers were closed
			expect(mockWatcher1.close).toHaveBeenCalled()
			expect(mockWatcher2.close).toHaveBeenCalled()
		})

		it("should not create file watchers for disabled servers on initialization", async () => {
			// Get the mocked chokidar
			const chokidar = (await import("chokidar")).default

			// Create disabled server with watchPaths
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"disabled-watcher-server": {
							command: "node",
							args: ["test.js"],
							watchPaths: ["/path/to/watch"],
							disabled: true,
						},
					},
				}),
			)

			vi.mocked(chokidar.watch).mockClear()

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Verify no watcher was created for disabled server
			expect(chokidar.watch).not.toHaveBeenCalled()
		})
	})

	describe("DisableReason enum usage", () => {
		it("should use MCP_DISABLED reason when MCP is globally disabled", async () => {
			// Mock provider with mcpEnabled: false
			mockProvider.getState = vi.fn().mockResolvedValue({ mcpEnabled: false })

			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"mcp-disabled-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "mcp-disabled-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")
			expect(connection?.server.status).toBe("disconnected")

			// The server should not be marked as disabled individually
			expect(connection?.server.disabled).toBeUndefined()
		})

		it("should use SERVER_DISABLED reason when server is individually disabled", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"server-disabled-server": {
							command: "node",
							args: ["test.js"],
							disabled: true,
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "server-disabled-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")
			expect(connection?.server.status).toBe("disconnected")
			expect(connection?.server.disabled).toBe(true)
		})

		it("should handle both disable reasons correctly", async () => {
			// First test with MCP globally disabled
			mockProvider.getState = vi.fn().mockResolvedValue({ mcpEnabled: false })

			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"both-reasons-server": {
							command: "node",
							args: ["test.js"],
							disabled: true, // Server is also individually disabled
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "both-reasons-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")

			// When MCP is globally disabled, it takes precedence
			// The server's individual disabled state should be preserved
			expect(connection?.server.disabled).toBe(true)
		})
	})

	describe("Null safety improvements", () => {
		it("should handle null client safely in disconnected connections", async () => {
			// Mock fs.readFile to return a disabled server config
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"null-safety-server": {
							command: "node",
							args: ["test.js"],
							disabled: true,
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// The server should be created as a disconnected connection with null client/transport
			const connection = mcpHub.connections.find((conn) => conn.server.name === "null-safety-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")

			// Type guard to ensure it's a disconnected connection
			if (connection?.type === "disconnected") {
				expect(connection.client).toBeNull()
				expect(connection.transport).toBeNull()
			}

			// Try to call tool on disconnected server
			await expect(mcpHub.callTool("null-safety-server", "test-tool", {})).rejects.toThrow(
				"No connection found for server: null-safety-server",
			)

			// Try to read resource on disconnected server
			await expect(mcpHub.readResource("null-safety-server", "test-uri")).rejects.toThrow(
				"No connection found for server: null-safety-server",
			)
		})

		it("should handle connection type checks safely", async () => {
			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"type-check-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Get the connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "type-check-server")
			expect(connection).toBeDefined()

			// Safe type checking
			if (connection?.type === "connected") {
				expect(connection.client).toBeDefined()
				expect(connection.transport).toBeDefined()
			} else if (connection?.type === "disconnected") {
				expect(connection.client).toBeNull()
				expect(connection.transport).toBeNull()
			}
		})

		it("should handle missing connections safely", async () => {
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Try operations on non-existent server
			await expect(mcpHub.callTool("non-existent-server", "test-tool", {})).rejects.toThrow(
				"No connection found for server: non-existent-server",
			)

			await expect(mcpHub.readResource("non-existent-server", "test-uri")).rejects.toThrow(
				"No connection found for server: non-existent-server",
			)
		})

		it("should handle connection deletion safely", async () => {
			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"delete-safety-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Delete the connection
			await mcpHub.deleteConnection("delete-safety-server")

			// Verify connection is removed
			const connection = mcpHub.connections.find((conn) => conn.server.name === "delete-safety-server")
			expect(connection).toBeUndefined()

			// Verify transport and client were closed
			expect(mockTransport.close).toHaveBeenCalled()
			expect(mockClient.close).toHaveBeenCalled()
		})
	})

	describe("toggleToolAlwaysAllow", () => {
		it("should add tool to always allow list when enabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: [],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection without alwaysAllow
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "new-tool", true)

			// Verify the config was updated correctly
			const writeCalls = vi.mocked(fs.writeFile).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].alwaysAllow)).toBe(true)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toContain("new-tool")
		})

		it("should remove tool from always allow list when disabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["existing-tool"],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					alwaysAllow: ["existing-tool"],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "existing-tool", false)

			// Verify the config was updated correctly
			const writeCalls = vi.mocked(fs.writeFile).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].alwaysAllow)).toBe(true)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).not.toContain("existing-tool")
		})

		it("should initialize alwaysAllow if it does not exist", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					alwaysAllow: [],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "new-tool", true)

			// Verify the config was updated with initialized alwaysAllow
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = vi.mocked(fs.writeFile).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toContain("new-tool")
		})

		it("should mark all tools as always allowed when wildcard is present", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["*"],
					},
				},
			}

			// Mock reading config - needs to return for every read
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

			// Set up mock connection with tools
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					source: "global",
				} as any,
				client: {
					request: vi.fn().mockResolvedValue({
						tools: [
							{ name: "tool1", description: "Tool 1" },
							{ name: "tool2", description: "Tool 2" },
							{ name: "tool3", description: "Tool 3" },
						],
					}),
				} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Fetch tools list to test wildcard matching
			const tools = await mcpHub["toolCatalog"].fetchToolsList("test-server", "global")

			// All tools should be marked as always allowed
			expect(tools.length).toBe(3)
			expect(tools[0].alwaysAllow).toBe(true)
			expect(tools[1].alwaysAllow).toBe(true)
			expect(tools[2].alwaysAllow).toBe(true)
		})

		it("should support both wildcard and specific tool names in alwaysAllow", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["*", "specific-tool"],
					},
				},
			}

			// Mock reading config - needs to return for every read
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

			// Set up mock connection with tools
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					source: "global",
				} as any,
				client: {
					request: vi.fn().mockResolvedValue({
						tools: [
							{ name: "tool1", description: "Tool 1" },
							{ name: "specific-tool", description: "Specific Tool" },
						],
					}),
				} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Fetch tools list
			const tools = await mcpHub["toolCatalog"].fetchToolsList("test-server", "global")

			// All tools should be marked as always allowed due to wildcard
			expect(tools.length).toBe(2)
			expect(tools[0].alwaysAllow).toBe(true)
			expect(tools[1].alwaysAllow).toBe(true)
		})

		it("should only allow specific tools when no wildcard is present", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["allowed-tool"],
					},
				},
			}

			// Mock reading config - needs to return for every read
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig))

			// Set up mock connection with tools
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					source: "global",
				} as any,
				client: {
					request: vi.fn().mockResolvedValue({
						tools: [
							{ name: "allowed-tool", description: "Allowed Tool" },
							{ name: "not-allowed-tool", description: "Not Allowed Tool" },
						],
					}),
				} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Fetch tools list
			const tools = await mcpHub["toolCatalog"].fetchToolsList("test-server", "global")

			// Only the specifically allowed tool should be marked as always allowed
			expect(tools.length).toBe(2)
			expect(tools[0].alwaysAllow).toBe(true) // allowed-tool
			expect(tools[1].alwaysAllow).toBe(false) // not-allowed-tool
		})
	})

	describe("toggleToolEnabledForPrompt", () => {
		it("should add tool to disabledTools list when enabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabledTools: [],
					},
				},
			}

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "new-tool", false)

			// Verify the config was updated correctly
			const writeCalls = (fs.writeFile as Mock).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].enabledForPrompt)).toBe(false)
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toContain("new-tool")
		})

		it("should remove tool from disabledTools list when disabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabledTools: ["existing-tool"],
					},
				},
			}

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "existing-tool", true)

			// Verify the config was updated correctly
			const writeCalls = (fs.writeFile as Mock).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].enabledForPrompt)).toBe(false)
			expect(writtenConfig.mcpServers["test-server"].disabledTools).not.toContain("existing-tool")
		})

		it("should initialize disabledTools if it does not exist", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
					},
				},
			}

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Call with false because of "true" is default value
			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "new-tool", false)

			// Verify the config was updated with initialized disabledTools
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = (fs.writeFile as Mock).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toContain("new-tool")
		})
	})

	describe("server disabled state", () => {
		it("should toggle server disabled state", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabled: false,
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					disabled: false,
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleServerDisabled("test-server", true)

			// Verify the config was updated correctly
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = vi.mocked(fs.writeFile).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers["test-server"].disabled).toBe(true)
		})

		it("should filter out disabled servers from getServers", () => {
			const mockConnections: McpConnection[] = [
				{
					type: "connected",
					server: {
						name: "enabled-server",
						config: "{}",
						status: "connected",
						disabled: false,
					},
					client: {} as any,
					transport: {} as any,
				} as ConnectedMcpConnection,
				{
					type: "disconnected",
					server: {
						name: "disabled-server",
						config: "{}",
						status: "disconnected",
						disabled: true,
					},
					client: null,
					transport: null,
				} as DisconnectedMcpConnection,
			]

			mcpHub.connections = mockConnections
			const servers = mcpHub.getServers()

			expect(servers.length).toBe(1)
			expect(servers[0].name).toBe("enabled-server")
		})

		it("should deduplicate servers by name with project servers taking priority", () => {
			const mockConnections: McpConnection[] = [
				{
					type: "connected",
					server: {
						name: "shared-server",
						config: '{"source":"global"}',
						status: "connected",
						disabled: false,
						source: "global",
					},
					client: {} as any,
					transport: {} as any,
				} as ConnectedMcpConnection,
				{
					type: "connected",
					server: {
						name: "shared-server",
						config: '{"source":"project"}',
						status: "connected",
						disabled: false,
						source: "project",
					},
					client: {} as any,
					transport: {} as any,
				} as ConnectedMcpConnection,
				{
					type: "connected",
					server: {
						name: "unique-global-server",
						config: "{}",
						status: "connected",
						disabled: false,
						source: "global",
					},
					client: {} as any,
					transport: {} as any,
				} as ConnectedMcpConnection,
			]

			mcpHub.connections = mockConnections
			const servers = mcpHub.getServers()

			// Should have 2 servers: deduplicated "shared-server" + "unique-global-server"
			expect(servers.length).toBe(2)

			// Find the shared-server - it should be the project version
			const sharedServer = servers.find((s) => s.name === "shared-server")
			expect(sharedServer).toBeDefined()
			expect(sharedServer!.source).toBe("project")
			expect(sharedServer!.config).toBe('{"source":"project"}')

			// The unique global server should also be present
			const uniqueServer = servers.find((s) => s.name === "unique-global-server")
			expect(uniqueServer).toBeDefined()
		})

		it("should keep global server when no project server with same name exists", () => {
			const mockConnections: McpConnection[] = [
				{
					type: "connected",
					server: {
						name: "global-only-server",
						config: "{}",
						status: "connected",
						disabled: false,
						source: "global",
					},
					client: {} as any,
					transport: {} as any,
				} as ConnectedMcpConnection,
			]

			mcpHub.connections = mockConnections
			const servers = mcpHub.getServers()

			expect(servers.length).toBe(1)
			expect(servers[0].name).toBe("global-only-server")
			expect(servers[0].source).toBe("global")
		})

		it("should prevent calling tools on disabled servers", async () => {
			// Mock fs.readFile to return a disabled server config
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"disabled-server": {
							command: "node",
							args: ["test.js"],
							disabled: true,
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// The server should be created as a disconnected connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "disabled-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")
			expect(connection?.server.disabled).toBe(true)

			// Try to call tool on disabled server
			await expect(mcpHub.callTool("disabled-server", "some-tool", {})).rejects.toThrow(
				"No connection found for server: disabled-server",
			)
		})

		it("should prevent reading resources from disabled servers", async () => {
			// Mock fs.readFile to return a disabled server config
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"disabled-server": {
							command: "node",
							args: ["test.js"],
							disabled: true,
						},
					},
				}),
			)

			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// The server should be created as a disconnected connection
			const connection = mcpHub.connections.find((conn) => conn.server.name === "disabled-server")
			expect(connection).toBeDefined()
			expect(connection?.type).toBe("disconnected")
			expect(connection?.server.disabled).toBe(true)

			// Try to read resource from disabled server
			await expect(mcpHub.readResource("disabled-server", "some/uri")).rejects.toThrow(
				"No connection found for server: disabled-server",
			)
		})
	})

	describe("callTool", () => {
		it("should execute tool successfully", async () => {
			// Mock the connection with a minimal client implementation
			const mockConnection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name: "test-server",
					config: JSON.stringify({}),
					status: "connected" as const,
				},
				client: {
					request: vi.fn().mockResolvedValue({ result: "success" }),
				} as any,
				transport: {
					start: vi.fn(),
					close: vi.fn(),
					stderr: { on: vi.fn() },
				} as any,
			}

			mcpHub.connections = [mockConnection]

			await mcpHub.callTool("test-server", "some-tool", {})

			// Verify the request was made with correct parameters
			expect(mockConnection.client!.request).toHaveBeenCalledWith(
				{
					method: "tools/call",
					params: {
						name: "some-tool",
						arguments: {},
					},
				},
				expect.any(Object),
				expect.objectContaining({ timeout: 60000 }), // Default 60 second timeout
			)
		})

		it("should throw error if server not found", async () => {
			await expect(mcpHub.callTool("non-existent-server", "some-tool", {})).rejects.toThrow(
				"No connection found for server: non-existent-server",
			)
		})

		describe("timeout configuration", () => {
			it("should validate timeout values", () => {
				// Test valid timeout values
				const validConfig = {
					type: "stdio",
					command: "test",
					timeout: 60,
				}
				expect(() => ServerConfigSchema.parse(validConfig)).not.toThrow()

				// Test invalid timeout values
				const invalidConfigs = [
					{ type: "stdio", command: "test", timeout: 0 }, // Too low
					{ type: "stdio", command: "test", timeout: 3601 }, // Too high
					{ type: "stdio", command: "test", timeout: -1 }, // Negative
				]

				invalidConfigs.forEach((config) => {
					expect(() => ServerConfigSchema.parse(config)).toThrow()
				})
			})

			it("should use default timeout of 60 seconds if not specified", async () => {
				const mockConnection: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						config: JSON.stringify({ type: "stdio", command: "test" }), // No timeout specified
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnection]
				await mcpHub.callTool("test-server", "test-tool")

				expect(mockConnection.client!.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 60000 }), // 60 seconds in milliseconds
				)
			})

			it("should apply configured timeout to tool calls", async () => {
				const mockConnection: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						config: JSON.stringify({ type: "stdio", command: "test", timeout: 120 }), // 2 minutes
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnection]
				await mcpHub.callTool("test-server", "test-tool")

				expect(mockConnection.client!.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 120000 }), // 120 seconds in milliseconds
				)
			})
		})

		describe("updateServerTimeout", () => {
			it("should update server timeout in settings file", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				// Mock reading initial config
				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				await mcpHub.updateServerTimeout("test-server", 120)

				// Verify the config was updated correctly
				// Find the write call with the normalized path
				const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
				const writeCalls = vi.mocked(fs.writeFile).mock.calls

				// Find the write call with the normalized path
				const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
				const callToUse = writeCall || writeCalls[0]

				const writtenConfig = JSON.parse(callToUse[1] as string)
				expect(writtenConfig.mcpServers["test-server"].timeout).toBe(120)
			})

			it("should fallback to default timeout when config has invalid timeout", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				// Mock initial read
				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection before updating
				const mockConnectionInitial: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnectionInitial]

				// Update with invalid timeout
				await mcpHub.updateServerTimeout("test-server", 3601)

				// Config is written
				expect(fs.writeFile).toHaveBeenCalled()

				// Setup connection with invalid timeout
				const mockConnectionInvalid: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						config: JSON.stringify({
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 3601, // Invalid timeout
						}),
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnectionInvalid]

				// Call tool - should use default timeout
				await mcpHub.callTool("test-server", "test-tool")

				// Verify default timeout was used
				expect(mockConnectionInvalid.client!.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 60000 }), // Default 60 seconds
				)
			})

			it("should accept valid timeout values", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				// Test valid timeout values
				const validTimeouts = [1, 60, 3600]
				for (const timeout of validTimeouts) {
					await mcpHub.updateServerTimeout("test-server", timeout)
					expect(fs.writeFile).toHaveBeenCalled()
					vi.clearAllMocks() // Reset for next iteration
					;(fs.readFile as any).mockResolvedValueOnce(JSON.stringify(mockConfig))
				}
			})

			it("should notify webview after updating timeout", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: ConnectedMcpConnection = {
					type: "connected",
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				await mcpHub.updateServerTimeout("test-server", 120)

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "mcpServers",
					}),
				)
			})
		})
	})

	describe("MCP global enable/disable", () => {
		beforeEach(() => {
			// Clear all mocks before each test
			vi.clearAllMocks()
		})

		it("should disconnect all servers when MCP is toggled from enabled to disabled", async () => {
			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}

			Client.mockImplementation(() => mockClient)

			// Start with MCP enabled
			mockProvider.getState = vi.fn().mockResolvedValue({ mcpEnabled: true })

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"toggle-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create McpHub and let it initialize with MCP enabled
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Verify server is connected
			const connectedServer = mcpHub.connections.find((conn) => conn.server.name === "toggle-test-server")
			expect(connectedServer).toBeDefined()
			expect(connectedServer!.server.status).toBe("connected")
			expect(connectedServer!.client).toBeDefined()
			expect(connectedServer!.transport).toBeDefined()

			// Now simulate toggling MCP to disabled
			mockProvider.getState = vi.fn().mockResolvedValue({ mcpEnabled: false })

			// Manually trigger what would happen when MCP is disabled
			// (normally this would be triggered by the webview message handler)
			const existingConnections = [...mcpHub.connections]
			for (const conn of existingConnections) {
				await mcpHub.deleteConnection(conn.server.name, conn.server.source)
			}
			await mcpHub.refreshAllConnections()

			// Verify server is now tracked but disconnected
			const disconnectedServer = mcpHub.connections.find((conn) => conn.server.name === "toggle-test-server")
			expect(disconnectedServer).toBeDefined()
			expect(disconnectedServer!.server.status).toBe("disconnected")
			expect(disconnectedServer!.client).toBeNull()
			expect(disconnectedServer!.transport).toBeNull()

			// Verify close was called on the original client and transport
			expect(mockClient.close).toHaveBeenCalled()
			expect(mockTransport.close).toHaveBeenCalled()
		})

		it("should not connect to servers when MCP is globally disabled", async () => {
			// Mock provider with mcpEnabled: false
			const disabledMockProvider = {
				ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				postMessageToWebview: vi.fn(),
				getState: vi.fn().mockResolvedValue({ mcpEnabled: false }),
				context: mockProvider.context,
			}

			// Mock the config file read with a different server name to avoid conflicts
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"disabled-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create a new McpHub instance with disabled MCP
			const mcpHub = new McpHub(disabledMockProvider as unknown as ClineProvider, {
				watcherFactory: fakeWatchers.factory,
			})

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the disabled-test-server
			const disabledServer = mcpHub.connections.find((conn) => conn.server.name === "disabled-test-server")

			// Verify that the server is tracked but not connected
			expect(disabledServer).toBeDefined()
			expect(disabledServer!.server.status).toBe("disconnected")
			expect(disabledServer!.client).toBeNull()
			expect(disabledServer!.transport).toBeNull()
		})

		it("should connect to servers when MCP is globally enabled", async () => {
			// Clear all mocks
			vi.clearAllMocks()

			// Mock StdioClientTransport
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>

			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation(() => mockTransport)

			// Mock Client
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>

			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Mock provider with mcpEnabled: true
			const enabledMockProvider = {
				ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				postMessageToWebview: vi.fn(),
				getState: vi.fn().mockResolvedValue({ mcpEnabled: true }),
				context: mockProvider.context,
			}

			// Mock the config file read with a different server name
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"enabled-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create a new McpHub instance with enabled MCP
			const mcpHub = new McpHub(enabledMockProvider as unknown as ClineProvider, {
				watcherFactory: fakeWatchers.factory,
			})

			// Wait for initialization
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Find the enabled-test-server
			const enabledServer = mcpHub.connections.find((conn) => conn.server.name === "enabled-test-server")

			// Verify that the server is connected
			expect(enabledServer).toBeDefined()
			expect(enabledServer!.server.status).toBe("connected")
			expect(enabledServer!.client).toBeDefined()
			expect(enabledServer!.transport).toBeDefined()

			// Verify StdioClientTransport was called
			expect(StdioClientTransport).toHaveBeenCalled()
		})

		it("should handle refreshAllConnections when MCP is disabled", async () => {
			// Mock provider with mcpEnabled: false
			const disabledMockProvider = {
				ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				postMessageToWebview: vi.fn(),
				getState: vi.fn().mockResolvedValue({ mcpEnabled: false }),
				context: mockProvider.context,
			}

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"refresh-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create McpHub with disabled MCP
			const mcpHub = new McpHub(disabledMockProvider as unknown as ClineProvider, {
				watcherFactory: fakeWatchers.factory,
			})
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Clear previous calls
			vi.clearAllMocks()

			// Call refreshAllConnections
			await mcpHub.refreshAllConnections()

			// Verify that servers are tracked but not connected
			const server = mcpHub.connections.find((conn) => conn.server.name === "refresh-test-server")
			expect(server).toBeDefined()
			expect(server!.server.status).toBe("disconnected")
			expect(server!.client).toBeNull()
			expect(server!.transport).toBeNull()

			// Verify postMessageToWebview was called to update the UI
			expect(disabledMockProvider.postMessageToWebview).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "mcpServers",
				}),
			)
		})

		it("should skip restarting connection when MCP is disabled", async () => {
			// Mock provider with mcpEnabled: false
			const disabledMockProvider = {
				ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
				postMessageToWebview: vi.fn(),
				getState: vi.fn().mockResolvedValue({ mcpEnabled: false }),
				context: mockProvider.context,
			}

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"restart-test-server": {
							command: "node",
							args: ["test.js"],
						},
					},
				}),
			)

			// Create McpHub with disabled MCP
			const mcpHub = new McpHub(disabledMockProvider as unknown as ClineProvider, {
				watcherFactory: fakeWatchers.factory,
			})
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Set isConnecting to false to ensure it's properly reset
			mcpHub.isConnecting = false

			// Try to restart a connection
			await mcpHub.restartConnection("restart-test-server")

			// Verify that isConnecting was reset to false
			expect(mcpHub.isConnecting).toBe(false)

			// Verify that the server remains disconnected
			const server = mcpHub.connections.find((conn) => conn.server.name === "restart-test-server")
			expect(server).toBeDefined()
			expect(server!.server.status).toBe("disconnected")
			expect(server!.client).toBeNull()
			expect(server!.transport).toBeNull()
		})
	})

	describe("a stdio server whose process cannot start", () => {
		it("stays listed as disconnected with the spawn error, so it can be seen and restarted", async () => {
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const spawnError = Object.assign(new Error("spawn /nonexistent/bin/xyz ENOENT"), { code: "ENOENT" })

			// What StdioClientTransport.start() does when the command does not
			// exist: the child process emits "error" and start() rejects.
			;(stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>).mockImplementation(() => ({
				start: vi.fn().mockRejectedValue(spawnError),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: undefined,
				onerror: null,
				onclose: null,
			}))
			;(clientModule.Client as ReturnType<typeof vi.fn>).mockImplementation(() => ({
				connect: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
			}))
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({ mcpServers: { broken: { command: "/nonexistent/bin/xyz" } } }),
			)

			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await hub.waitUntilReady()

			const broken = hub.connections.find((conn) => conn.server.name === "broken")
			expect(broken).toBeDefined()
			expect(broken!.server.status).toBe("disconnected")
			expect(broken!.server.error).toBe("spawn /nonexistent/bin/xyz ENOENT")
			expect(broken!.server.disabled).toBeFalsy()
			expect(JSON.parse(broken!.server.config)).toMatchObject({ command: "/nonexistent/bin/xyz" })

			// A restart tries to start the process again and keeps the server listed.
			const starts = (stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>).mock.calls.length
			await hub.restartConnection("broken", "global")
			expect((stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>).mock.calls.length).toBe(starts + 1)
			expect(hub.connections.filter((conn) => conn.server.name === "broken")).toHaveLength(1)
			expect(hub.connections.find((conn) => conn.server.name === "broken")!.server.error).toBe(
				"spawn /nonexistent/bin/xyz ENOENT",
			)
		})
	})

	describe("Windows command wrapping", () => {
		let StdioClientTransport: ReturnType<typeof vi.fn>
		let Client: ReturnType<typeof vi.fn>

		beforeEach(async () => {
			// Reset mocks
			vi.clearAllMocks()

			// Get references to the mocked constructors
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>
			Client = clientModule.Client as ReturnType<typeof vi.fn>

			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})
		})

		it("should wrap commands with cmd.exe on Windows", async () => {
			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that cmd.exe wrapping is applied
				expect(config.command).toBe("cmd.exe")
				expect(config.args).toEqual([
					"/c",
					"npx",
					"-y",
					"@modelcontextprotocol/server-filesystem",
					"/test/path",
				])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called with wrapped command
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
				}),
			)
		})

		it("should not wrap commands on non-Windows platforms", async () => {
			// Mock non-Windows platform
			Object.defineProperty(process, "platform", {
				value: "darwin",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that no cmd.exe wrapping is applied
				expect(config.command).toBe("npx")
				expect(config.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/test/path"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
				}),
			)
		})

		it("should not double-wrap commands that are already cmd.exe", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that cmd.exe is not double-wrapped
				expect(config.command).toBe("cmd.exe")
				expect(config.args).toEqual(["/c", "echo", "test"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Mock the config file read with cmd.exe already as command
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-cmd-server": {
							command: "cmd.exe",
							args: ["/c", "echo", "test"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without double-wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "echo", "test"],
				}),
			)
		})

		it("should handle npx.ps1 scenario from node version managers", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport to simulate the ENOENT error without wrapping
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			let callCount = 0
			StdioClientTransport.mockImplementation((config: any) => {
				callCount++
				// First call would fail with ENOENT if not wrapped
				// Second call should be wrapped with cmd.exe
				if (callCount === 1) {
					// This simulates what would happen without wrapping
					expect(config.command).toBe("cmd.exe")
					expect(config.args[0]).toBe("/c")
					expect(config.args[1]).toBe("npx")
				}
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Mock the config file read - simulating fnm/nvm-windows scenario
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-fnm-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-example"],
							env: {
								// Simulate fnm environment
								FNM_DIR: "C:\\Users\\test\\.fnm",
								FNM_NODE_DIST_MIRROR: "https://nodejs.org/dist",
								FNM_ARCH: "x64",
							},
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify that the command was wrapped with cmd.exe
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx", "-y", "@modelcontextprotocol/server-example"],
					env: expect.objectContaining({
						FNM_DIR: "C:\\Users\\test\\.fnm",
						FNM_NODE_DIST_MIRROR: "https://nodejs.org/dist",
						FNM_ARCH: "x64",
					}),
				}),
			)
		})

		it("should handle case-insensitive cmd command check", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that CMD (uppercase) is not double-wrapped
				expect(config.command).toBe("CMD")
				expect(config.args).toEqual(["/c", "echo", "test"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })

			// Mock the config file read with CMD (uppercase) as command
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-cmd-uppercase-server": {
							command: "CMD",
							args: ["/c", "echo", "test"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without double-wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "CMD",
					args: ["/c", "echo", "test"],
				}),
			)
		})
	})

	// DEF-C13: a failed connect must not leave isConnecting true (every API
	// request waits up to 10 s for it), an unrelated settings change must not
	// drop other servers' file watchers, and an unchanged server must not restart.
	describe("connection bookkeeping (DEF-C13)", () => {
		const serverA = { command: "node", args: ["a.js"], watchPaths: ["/watch/a"] }
		const serverB = { command: "node", args: ["b.js"], watchPaths: ["/watch/b"] }
		let watchersByPath: Map<string, { on: Mock; close: Mock }[]>
		let transportCount: () => number

		const settleHub = () => new Promise((resolve) => setTimeout(resolve, 100))

		beforeEach(async () => {
			const chokidar = (await import("chokidar")).default
			watchersByPath = new Map()
			vi.mocked(chokidar.watch).mockImplementation((paths: any) => {
				const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
				const key = ([] as string[]).concat(paths).join(",")
				watchersByPath.set(key, [...(watchersByPath.get(key) ?? []), watcher])
				return watcher as any
			})

			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>
			StdioClientTransport.mockImplementation(() => ({
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: { on: vi.fn() },
				onerror: null,
				onclose: null,
			}))
			transportCount = () => StdioClientTransport.mock.calls.length

			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue(""),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: { a: serverA, b: serverB } }))
		})

		it("resets isConnecting when updating connections throws", async () => {
			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()
			vi.mocked(fs.readFile).mockResolvedValue("not json")

			await hub.updateServerConnections({ a: { ...serverA, args: ["changed.js"] } }, "global").catch(() => {})

			expect(hub.isConnecting).toBe(false)
		})

		it("resets isConnecting when a restart throws", async () => {
			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()
			vi.mocked(fs.readFile).mockResolvedValue("not json")

			await hub.restartConnection("a", "global").catch(() => {})

			expect(hub.isConnecting).toBe(false)
		})

		it("creates each server's file watcher once", async () => {
			new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()

			expect(watchersByPath.get("/watch/a")).toHaveLength(1)
			expect(watchersByPath.get("/watch/b")).toHaveLength(1)
		})

		it("does not restart a server whose configuration did not change", async () => {
			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()
			const before = transportCount()

			await hub.updateServerConnections({ a: { ...serverA }, b: { ...serverB } }, "global")

			expect(transportCount()).toBe(before)
		})

		it("keeps an unchanged server's watcher when another server changes", async () => {
			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()

			await hub.updateServerConnections({ a: { ...serverA }, b: { ...serverB, args: ["b2.js"] } }, "global")

			const [watcherA] = watchersByPath.get("/watch/a")!
			expect(watcherA.close).not.toHaveBeenCalled()
			const watchersB = watchersByPath.get("/watch/b")!
			expect(watchersB[0].close).toHaveBeenCalled()
			expect(watchersB.at(-1)!.close).not.toHaveBeenCalled()
		})

		it("restarts none of the other servers when one server is deleted", async () => {
			const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
			await settleHub()
			const before = transportCount()

			await hub.deleteServer("b", "global")

			expect(transportCount()).toBe(before)
			expect(hub.connections.map((c) => c.server.name)).toEqual(["a"])
			expect(watchersByPath.get("/watch/a")![0].close).not.toHaveBeenCalled()
		})
	})

	describe("config files, watching and the write guard (SVC-8)", () => {
		// Built with path.join like the product code, so the keys match on Windows too.
		const globalPath = path.join("/mock/settings/path", "mcp_settings.json")
		const workspaceDir = path.resolve("/workspace")
		const projectPath = path.join(workspaceDir, ".roo", "mcp.json")
		let files: Record<string, string>
		let watchersByPath: Map<string, { on: Mock; close: Mock }[]>
		let transportCount: () => number

		const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
		// setImmediate stays real under the fake timers below, so this drains every pending promise.
		const flush = () => new Promise((resolve) => setImmediate(resolve))
		const writeFiles = (next: { global?: object; project?: object }) => {
			files = {}
			if (next.global) files[globalPath] = JSON.stringify(next.global)
			if (next.project) files[projectPath] = JSON.stringify(next.project)
		}
		// What the settings-file watcher reports when the file changes on disk.
		const fireConfigChange = (filePath: string) => fakeWatchers.fire("change", filePath)

		beforeEach(async () => {
			const chokidar = (await import("chokidar")).default
			watchersByPath = new Map()
			vi.mocked(chokidar.watch).mockImplementation((paths: any) => {
				const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
				const key = ([] as string[]).concat(paths).join(",")
				watchersByPath.set(key, [...(watchersByPath.get(key) ?? []), watcher])
				return watcher as any
			})

			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>
			StdioClientTransport.mockImplementation(() => ({
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: { on: vi.fn() },
				onerror: null,
				onclose: null,
			}))
			transportCount = () => StdioClientTransport.mock.calls.length

			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			const Client = clientModule.Client as ReturnType<typeof vi.fn>
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue(""),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// A workspace folder, so the hub watches the project file too.
			const vscode = await import("vscode")
			;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceDir } }]
			Object.assign(mockProvider, { cwd: workspaceDir })

			writeFiles({ global: { mcpServers: { a: { command: "node", args: ["a.js"] } } } })
			const missing = (filePath: string) => Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" })
			vi.mocked(fs.readFile).mockImplementation((async (filePath: string) => {
				if (filePath in files) return files[filePath]
				throw missing(filePath)
			}) as any)
			vi.mocked(fs.access).mockImplementation(async (filePath: any) => {
				if (!(filePath in files)) throw missing(filePath)
			})
		})

		afterEach(async () => {
			vi.useRealTimers()
			const vscode = await import("vscode")
			;(vscode.workspace as any).workspaceFolders = []
		})

		describe("updateServerConnections diff", () => {
			it("keeps a disabled server's placeholder when its raw config did not change", async () => {
				writeFiles({ global: { mcpServers: { off: { command: "node", args: ["off.js"], disabled: true } } } })
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				const placeholder = hub.connections.find((c) => c.server.name === "off")

				await hub.updateServerConnections({ off: { command: "node", args: ["off.js"], disabled: true } })

				expect(placeholder?.type).toBe("disconnected")
				expect(hub.connections.find((c) => c.server.name === "off")).toBe(placeholder)
			})

			it("does not restart a server whose config uses variables that did not change", async () => {
				process.env.SVC8_TOKEN = "secret"
				try {
					const server = { command: "node", args: ["${env:SVC8_TOKEN}"] }
					writeFiles({ global: { mcpServers: { v: server } } })
					const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
					await settle()
					const before = transportCount()
					const connection = hub.connections.find((c) => c.server.name === "v")
					expect(JSON.parse(connection!.server.config).args).toEqual(["secret"])

					await hub.updateServerConnections({ v: { ...server } })

					expect(transportCount()).toBe(before)
					expect(hub.connections.find((c) => c.server.name === "v")).toBe(connection)
				} finally {
					delete process.env.SVC8_TOKEN
				}
			})

			it("still starts the valid servers of a global file that fails the schema", async () => {
				writeFiles({
					global: { mcpServers: { good: { command: "node", args: ["good.js"] }, bad: { command: "" } } },
				})
				const vscode = await import("vscode")

				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				expect(hub.connections.map((c) => `${c.server.source}:${c.server.name}:${c.server.status}`)).toEqual([
					"global:good:connected",
				])
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					`mcp:errors.invalid_settings_validation ${JSON.stringify({ errorMessages: "mcpServers.bad: Invalid input" })}`,
				)
			})
		})

		describe("config-file watching", () => {
			it("debounces a burst of changes into one update 500 ms after the last one", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(300)
				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(499)
				await flush()
				expect(update).not.toHaveBeenCalled()

				await vi.advanceTimersByTimeAsync(1)
				await flush()
				expect(update).toHaveBeenCalledTimes(1)
				expect(update).toHaveBeenCalledWith(
					{ a: expect.objectContaining({ command: "node", args: ["a.js"] }) },
					"global",
				)
			})

			it("debounces the global and the project file separately", async () => {
				writeFiles({
					global: { mcpServers: { a: { command: "node", args: ["a.js"] } } },
					project: { mcpServers: { p: { command: "node", args: ["p.js"] } } },
				})
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				fireConfigChange(projectPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update.mock.calls.map(([, source]) => source).sort()).toEqual(["global", "project"])
			})

			it("reports invalid JSON in a changed file and changes nothing", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				const vscode = await import("vscode")
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				const update = vi.spyOn(hub, "updateServerConnections")
				files[globalPath] = "{ not json"

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("mcp:errors.invalid_settings_syntax")
			})

			it("lists every schema problem of a changed file, one per line, and changes nothing", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				const vscode = await import("vscode")
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				const update = vi.spyOn(hub, "updateServerConnections")
				files[globalPath] = JSON.stringify({ mcpServers: { a: { command: "" }, b: { command: "" } } })

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					`mcp:errors.invalid_settings_validation ${JSON.stringify({
						errorMessages: "mcpServers.a: Invalid input\nmcpServers.b: Invalid input",
					})}`,
				)
			})

			it("removes the project servers when the project file is gone", async () => {
				writeFiles({
					global: { mcpServers: { a: { command: "node", args: ["a.js"] } } },
					project: { mcpServers: { p: { command: "node", args: ["p.js"] } } },
				})
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				expect(hub.connections.map((c) => `${c.server.source}:${c.server.name}`).sort()).toEqual([
					"global:a",
					"project:p",
				])
				const vscode = await import("vscode")
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				delete files[projectPath]

				fireConfigChange(projectPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(hub.connections.map((c) => `${c.server.source}:${c.server.name}`)).toEqual(["global:a"])
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("mcp:info.project_config_deleted")
			})
		})

		describe("watchers from the injected factory", () => {
			const projectFiles = (project: object) =>
				writeFiles({ global: { mcpServers: { a: { command: "node", args: ["a.js"] } } }, project })
			const serverKeys = (hub: McpHub) => hub.connections.map((c) => `${c.server.source}:${c.server.name}`).sort()
			const liveWatches = () => fakeWatchers.watches.filter((w) => !w.disposed).map((w) => w.file)

			it("watches the global file and, with a workspace folder, the project file", async () => {
				fakeWatchers = createFakeWatcherFactory()
				new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				expect(liveWatches().sort()).toEqual([globalPath, projectPath].sort())
			})

			it("does not watch a project file without a workspace folder", async () => {
				const vscode = await import("vscode")
				;(vscode.workspace as any).workspaceFolders = []
				fakeWatchers = createFakeWatcherFactory()
				new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				expect(liveWatches()).toEqual([globalPath])
			})

			it("removes the project servers at once when the project file is deleted", async () => {
				projectFiles({ mcpServers: { p: { command: "node", args: ["p.js"] } } })
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				const vscode = await import("vscode")

				fakeWatchers.fire("delete", projectPath)
				await flush()

				expect(serverKeys(hub)).toEqual(["global:a"])
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("mcp:info.project_config_deleted")
			})

			it("re-reads and re-watches the project file when the workspace folders change", async () => {
				projectFiles({ mcpServers: { p: { command: "node", args: ["p.js"] } } })
				fakeWatchers = createFakeWatcherFactory()
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				const [firstProjectWatch] = fakeWatchers.watches.filter((w) => w.file === projectPath)
				projectFiles({ mcpServers: { q: { command: "node", args: ["q.js"] } } })

				fakeWatchers.changeWorkspaceFolders()
				await settle()

				expect(serverKeys(hub)).toEqual(["global:a", "project:q"])
				expect(firstProjectWatch.disposed).toBe(true)
				expect(liveWatches().filter((file) => file === projectPath)).toHaveLength(1)
			})

			it("stops watching and drops a pending change on dispose", async () => {
				fakeWatchers = createFakeWatcherFactory()
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				await hub.dispose()
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update).not.toHaveBeenCalled()
				expect(liveWatches()).toEqual([])
			})
		})

		describe("write guard", () => {
			it("ignores file changes for 600 ms after its own write, then handles them again", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				await hub.updateServerTimeout("a", 30, "global")
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(599)
				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()
				expect(update).not.toHaveBeenCalled()

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()
				expect(update).toHaveBeenCalledTimes(1)
			})

			it("guards the write of a tool-list toggle", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				await hub.toggleToolAlwaysAllow("a", "global", "tool", true)
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update).not.toHaveBeenCalled()
			})

			it("guards the write of deleteServer, so its own change event does not update the servers again", async () => {
				writeFiles({
					global: {
						mcpServers: { a: { command: "node", args: ["a.js"] }, b: { command: "node", args: ["b.js"] } },
					},
				})
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
				await hub.deleteServer("b", "global")
				const update = vi.spyOn(hub, "updateServerConnections")

				fireConfigChange(globalPath)
				await vi.advanceTimersByTimeAsync(500)
				await flush()

				expect(update).not.toHaveBeenCalled()
			})
		})

		describe("file watchers of a global and a project server with the same name", () => {
			beforeEach(() => {
				writeFiles({
					global: {
						mcpServers: { same: { command: "node", args: ["g.js"], watchPaths: ["/watch/global"] } },
					},
					project: {
						mcpServers: { same: { command: "node", args: ["p.js"], watchPaths: ["/watch/project"] } },
					},
				})
			})

			it("gives each server its own watcher", async () => {
				new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				expect(watchersByPath.get("/watch/global")).toHaveLength(1)
				expect(watchersByPath.get("/watch/project")).toHaveLength(1)
			})

			it("closes only the project server's watcher when the project server goes", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				await hub.deleteConnection("same", "project")

				expect(watchersByPath.get("/watch/project")![0].close).toHaveBeenCalled()
				expect(watchersByPath.get("/watch/global")![0].close).not.toHaveBeenCalled()
			})

			it("leaves the global server's watcher open when the project server restarts", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await settle()

				await hub.updateServerConnections(
					{ same: { command: "node", args: ["p2.js"], watchPaths: ["/watch/project"] } },
					"project",
				)

				expect(watchersByPath.get("/watch/global")![0].close).not.toHaveBeenCalled()
				expect(watchersByPath.get("/watch/project")![0].close).toHaveBeenCalled()
				expect(watchersByPath.get("/watch/project")!.at(-1)!.close).not.toHaveBeenCalled()
			})
		})
	})

	// SVC-8 part 3: McpHub became a facade over McpConnectionManager and
	// McpToolCatalog. These pin what callers and the webview see.
	describe("facade contract (SVC-8 part 3)", () => {
		const globalPath = path.join("/mock/settings/path", "mcp_settings.json")
		const workspaceDir = path.resolve("/workspace")
		let files: Record<string, string>
		let watchers: { paths: string; close: Mock }[]
		let StdioClientTransport: ReturnType<typeof vi.fn>
		let Client: ReturnType<typeof vi.fn>
		let postMessage: Mock

		const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
		const deferred = <T = void>() => {
			let resolve!: (value: T) => void
			let reject!: (error: unknown) => void
			const promise = new Promise<T>((res, rej) => {
				resolve = res
				reject = rej
			})
			return { promise, resolve, reject }
		}
		const stdioTransport = () => ({
			start: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			stderr: { on: vi.fn() },
			onerror: null as null | ((error: unknown) => Promise<void>),
			onclose: null as null | (() => Promise<void>),
		})
		const connectedClient = () => ({
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			getInstructions: vi.fn().mockReturnValue(""),
			request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
		})
		const serverKeys = (hub: McpHub) => hub.connections.map((c) => `${c.server.source}:${c.server.name}`)

		beforeEach(async () => {
			// The hub of the outer beforeEach would otherwise share these mocks.
			await Promise.race([mcpHub.waitUntilReady(), settle()])
			await mcpHub.dispose()
			vi.clearAllMocks()

			const chokidar = (await import("chokidar")).default
			watchers = []
			vi.mocked(chokidar.watch).mockImplementation((paths: any) => {
				const watcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
				watchers.push({ paths: ([] as string[]).concat(paths).join(","), close: watcher.close })
				return watcher as any
			})

			StdioClientTransport = (await import("@modelcontextprotocol/sdk/client/stdio.js"))
				.StdioClientTransport as ReturnType<typeof vi.fn>
			StdioClientTransport.mockImplementation(stdioTransport)
			Client = (await import("@modelcontextprotocol/sdk/client/index.js")).Client as ReturnType<typeof vi.fn>
			Client.mockImplementation(connectedClient)

			Object.assign(mockProvider, { cwd: workspaceDir })
			postMessage = mockProvider.postMessageToWebview as Mock

			files = { [globalPath]: JSON.stringify({ mcpServers: { a: { command: "node", args: ["a.js"] } } }) }
			const missing = (filePath: string) => Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" })
			vi.mocked(fs.readFile).mockImplementation((async (filePath: string) => {
				if (filePath in files) return files[filePath]
				throw missing(filePath)
			}) as any)
			vi.mocked(fs.access).mockImplementation(async (filePath: any) => {
				if (!(filePath in files)) throw missing(filePath)
			})
		})

		describe("restartConnection", () => {
			let events: string[]
			let hub: McpHub

			beforeEach(async () => {
				events = []
				StdioClientTransport.mockImplementation(() => {
					events.push(`new transport, isConnecting=${hub?.isConnecting}`)
					const transport = stdioTransport()
					transport.close.mockImplementation(async () => {
						events.push("close transport")
					})
					return transport
				})
				const vscode = await import("vscode")
				vi.mocked(vscode.window.showInformationMessage).mockImplementation((message: string) => {
					events.push(`info ${message}`)
					return undefined as any
				})
				postMessage.mockImplementation(async (message: any) => {
					const statuses = message.mcpServers.map((s: McpServer) => `${s.name}=${s.status}`).join(",")
					events.push(`push ${statuses}, isConnecting=${hub.isConnecting}`)
				})

				hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				events.length = 0
			})

			it("shows the restart, pushes 'connecting', closes the old transport, then connects a new one", async () => {
				await hub.restartConnection("a", "global")

				expect(events).toEqual([
					'info mcp:info.server_restarting {"serverName":"a"}',
					"push a=connecting, isConnecting=true",
					"close transport",
					"new transport, isConnecting=true",
					'info mcp:info.server_connected {"serverName":"a"}',
					"push a=connected, isConnecting=true",
				])
				expect(hub.isConnecting).toBe(false)
				expect(serverKeys(hub)).toEqual(["global:a"])
			})

			it("resets isConnecting and keeps the server listed with its error when the reconnect fails", async () => {
				Client.mockImplementation(() => ({
					...connectedClient(),
					connect: vi.fn().mockRejectedValue(new Error("connection refused")),
				}))

				await hub.restartConnection("a", "global")

				expect(events).toEqual([
					'info mcp:info.server_restarting {"serverName":"a"}',
					"push a=connecting, isConnecting=true",
					"close transport",
					"new transport, isConnecting=true",
					"push a=disconnected, isConnecting=true",
				])
				expect(hub.isConnecting).toBe(false)
				expect(serverKeys(hub)).toEqual(["global:a"])
				expect(hub.connections[0].server.error).toBe("connection refused")
			})

			it("does nothing but reset isConnecting for an unknown server", async () => {
				await hub.restartConnection("nope", "global")

				expect(events).toEqual(["push a=connected, isConnecting=true"])
				expect(hub.isConnecting).toBe(false)
			})
		})

		describe("dispose during an in-flight connect", () => {
			const serverWithWatcher = { command: "node", args: ["slow.js"], watchPaths: ["/watch/slow"] }

			beforeEach(() => {
				files[globalPath] = JSON.stringify({ mcpServers: { slow: serverWithWatcher } })
			})

			const expectNothingLeftBehind = (hub: McpHub, pushesAtDispose: number) => {
				expect(hub.connections).toEqual([])
				expect(hub.getAllServers()).toEqual([])
				expect(postMessage).toHaveBeenCalledTimes(pushesAtDispose)
				for (const watcher of watchers) {
					expect(watcher.close, `watcher of ${watcher.paths}`).toHaveBeenCalled()
				}
			}

			it("while the MCP-enabled check is pending: no connection, no watcher, no push", async () => {
				const state = deferred<{ mcpEnabled: boolean }>()
				mockProvider.getState = vi.fn().mockReturnValue(state.promise)
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await vi.waitFor(() => expect(mockProvider.getState).toHaveBeenCalled())

				await hub.dispose()
				const pushes = postMessage.mock.calls.length
				state.resolve({ mcpEnabled: true })
				await hub.waitUntilReady()
				await settle()

				expect(StdioClientTransport).not.toHaveBeenCalled()
				expectNothingLeftBehind(hub, pushes)
			})

			it("while the stdio process is starting: the new transport is closed and never registered", async () => {
				const started = deferred()
				const transport = stdioTransport()
				transport.start.mockReturnValue(started.promise)
				StdioClientTransport.mockImplementation(() => transport)
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await vi.waitFor(() => expect(transport.start).toHaveBeenCalled())

				await hub.dispose()
				const pushes = postMessage.mock.calls.length
				started.resolve()
				await hub.waitUntilReady()
				await settle()

				expect(transport.close).toHaveBeenCalled()
				expect(Client.mock.results[0]?.value.connect).not.toHaveBeenCalled()
				expectNothingLeftBehind(hub, pushes)
			})

			it("while the client handshake is pending: closed by dispose, nothing pushed afterwards", async () => {
				const handshake = deferred()
				const client = { ...connectedClient(), connect: vi.fn().mockReturnValue(handshake.promise) }
				Client.mockImplementation(() => client)
				const transport = stdioTransport()
				StdioClientTransport.mockImplementation(() => transport)
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await vi.waitFor(() => expect(client.connect).toHaveBeenCalled())

				await hub.dispose()
				const pushes = postMessage.mock.calls.length
				handshake.resolve()
				await hub.waitUntilReady()
				await settle()

				expect(transport.close).toHaveBeenCalled()
				expect(client.close).toHaveBeenCalled()
				expect(client.request).not.toHaveBeenCalled()
				expectNothingLeftBehind(hub, pushes)
			})

			it("when the pending handshake fails after dispose: no placeholder is left behind", async () => {
				const handshake = deferred()
				const client = { ...connectedClient(), connect: vi.fn().mockReturnValue(handshake.promise) }
				Client.mockImplementation(() => client)
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await vi.waitFor(() => expect(client.connect).toHaveBeenCalled())

				await hub.dispose()
				const pushes = postMessage.mock.calls.length
				handshake.reject(new Error("Connection closed"))
				await hub.waitUntilReady()
				await settle()

				expectNothingLeftBehind(hub, pushes)
			})

			it("a transport closing during dispose pushes no state", async () => {
				const transport = stdioTransport()
				transport.close.mockImplementation(async () => {
					await transport.onclose?.()
				})
				StdioClientTransport.mockImplementation(() => transport)
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				const pushes = postMessage.mock.calls.length

				await hub.dispose()
				await settle()

				expect(transport.close).toHaveBeenCalled()
				expectNothingLeftBehind(hub, pushes)
			})
		})

		describe("the connections array", () => {
			it("is replaced, not mutated, when a server is deleted", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				const before = hub.connections

				await hub.deleteConnection("a", "global")

				expect(hub.connections).not.toBe(before)
				expect(hub.connections).toEqual([])
				expect(before.map((c) => c.server.name)).toEqual(["a"])
			})

			it("is replaced when a server is added, and the old array is left as it was", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				const before = hub.connections

				await hub.updateServerConnections({ a: { command: "node", args: ["a.js"] }, b: { command: "node" } })

				expect(hub.connections).not.toBe(before)
				expect(before.map((c) => c.server.name)).toEqual(["a"])
				expect(serverKeys(hub)).toEqual(["global:a", "global:b"])
				// The unchanged server keeps its connection object.
				expect(hub.connections[0]).toBe(before[0])
			})

			it("assigned from outside is the array the hub reads and updates", async () => {
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				const request = vi.fn().mockResolvedValue({ content: [] })
				const assigned: McpConnection[] = [
					{
						type: "connected",
						server: {
							name: "x",
							config: JSON.stringify({ command: "node" }),
							status: "connected",
							source: "global",
						},
						client: { request } as any,
						transport: {} as any,
					},
				]

				hub.connections = assigned

				expect(hub.connections).toBe(assigned)
				expect(hub.getAllServers().map((s) => s.name)).toEqual(["x"])
				expect(hub.getServers().map((s) => s.name)).toEqual(["x"])
				expect(hub.findServerNameBySanitizedName("x")).toBe("x")
				await hub.callTool("x", "tool", {}, "global")
				expect(request).toHaveBeenCalledTimes(1)
			})

			it("hands the webview a fresh array of the live server objects, project servers first", async () => {
				const projectPath = path.join(workspaceDir, ".roo", "mcp.json")
				files[globalPath] = JSON.stringify({
					mcpServers: { g2: { command: "node" }, g1: { command: "node" } },
				})
				files[projectPath] = JSON.stringify({ mcpServers: { p1: { command: "node" } } })
				const hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				postMessage.mockClear()

				await hub.restartConnection("g1", "global")

				const { type, mcpServers } = postMessage.mock.calls.at(-1)![0]
				expect(type).toBe("mcpServers")
				expect(mcpServers.map((s: McpServer) => `${s.source}:${s.name}`)).toEqual([
					"project:p1",
					"global:g2",
					"global:g1",
				])
				expect(mcpServers).not.toBe(hub.connections)
				for (const server of mcpServers) {
					expect(hub.connections.some((c) => c.server === server)).toBe(true)
				}
			})
		})

		describe.each([
			{ type: "stdio", config: { command: "node", args: ["t.js"] }, label: "" },
			{ type: "sse", config: { type: "sse", url: "https://mcp.example.com/sse" }, label: "" },
			{
				type: "streamable-http",
				config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
				label: " (streamable-http)",
			},
		])("$type transport handlers", ({ type, config, label }) => {
			let transport: ReturnType<typeof stdioTransport>
			let start: Mock
			let hub: McpHub

			beforeEach(async () => {
				transport = stdioTransport()
				// The hub replaces a started stdio transport's start() with a no-op.
				start = transport.start
				const sse = (await import("@modelcontextprotocol/sdk/client/sse.js")).SSEClientTransport
				const http = (await import("@modelcontextprotocol/sdk/client/streamableHttp.js"))
					.StreamableHTTPClientTransport
				for (const ctor of [StdioClientTransport, sse, http]) {
					vi.mocked(ctor as any).mockImplementation(() => transport)
				}
				files[globalPath] = JSON.stringify({ mcpServers: { t: config } })
				hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				expect(hub.connections[0].transport).toBe(transport)
				expect(hub.connections[0].server.status).toBe("connected")
				postMessage.mockClear()
			})

			it("onerror marks the server disconnected, records the error and pushes the state", async () => {
				await transport.onerror!(new Error("socket hang up"))

				const server = hub.connections[0].server
				expect(server.status).toBe("disconnected")
				expect(server.error).toBe("socket hang up")
				expect(server.errorHistory!.at(-1)).toMatchObject({ message: "socket hang up", level: "error" })
				expect(postMessage).toHaveBeenCalledTimes(1)
				expect(console.error).toHaveBeenCalledWith(`Transport error for "t"${label}:`, expect.any(Error))
			})

			it("onerror with a non-Error records its string form", async () => {
				await transport.onerror!("plain failure")

				expect(hub.connections[0].server.error).toBe("plain failure")
			})

			it("onclose marks the server disconnected without an error and pushes the state", async () => {
				await transport.onclose!()

				const server = hub.connections[0].server
				expect(server.status).toBe("disconnected")
				expect(server.error).toBe("")
				expect(postMessage).toHaveBeenCalledTimes(1)
			})

			it("still pushes the state when its server is already gone", async () => {
				hub.connections = []

				await transport.onerror!(new Error("late"))
				await transport.onclose!()

				expect(postMessage).toHaveBeenCalledTimes(2)
			})

			it(`${type === "stdio" ? "is" : "is not"} started before the client connects`, () => {
				const client = Client.mock.results.at(-1)!.value
				if (type === "stdio") {
					expect(start).toHaveBeenCalledTimes(1)
					expect(start.mock.invocationCallOrder[0]).toBeLessThan(client.connect.mock.invocationCallOrder[0])
				} else {
					expect(start).not.toHaveBeenCalled()
				}
			})
		})

		describe("stdio stderr", () => {
			let onStderr: (data: Buffer) => Promise<void>
			let hub: McpHub

			beforeEach(async () => {
				const transport = stdioTransport()
				transport.stderr.on.mockImplementation((_event: string, listener: any) => {
					onStderr = listener
				})
				StdioClientTransport.mockImplementation(() => transport)
				hub = new McpHub(mockProvider as ClineProvider, { watcherFactory: fakeWatchers.factory })
				await hub.waitUntilReady()
				postMessage.mockClear()
			})

			it("records a non-INFO line as an error, pushing only for a disconnected server", async () => {
				await onStderr(Buffer.from("boom"))
				expect(hub.connections[0].server.error).toBe("boom")
				expect(postMessage).not.toHaveBeenCalled()

				hub.connections[0].server.status = "disconnected"
				await onStderr(Buffer.from("boom again"))
				expect(hub.connections[0].server.error).toBe("boom again")
				expect(postMessage).toHaveBeenCalledTimes(1)
			})

			it("does not record INFO lines", async () => {
				await onStderr(Buffer.from("[info] listening"))
				expect(hub.connections[0].server.error).toBe("")
			})
		})
	})
})
