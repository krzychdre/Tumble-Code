import type { Mock } from "vitest"

import { McpConnectionManager, type McpConnectionManagerDeps } from "../McpConnectionManager"
import type { McpServerConfig } from "../mcpConfigSchema"
import { logger } from "../../../utils/logging"

vi.mock("vscode", () => ({
	workspace: { workspaceFolders: [] },
	window: { showInformationMessage: vi.fn(), showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
}))

vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(),
	getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: "/usr/bin" }),
}))
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: vi.fn() }))
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: vi.fn() }))
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: vi.fn() }))

vi.mock("chokidar", () => ({
	default: { watch: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), close: vi.fn() }) },
}))

const fakeTransport = () => ({
	start: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined),
	stderr: { on: vi.fn() },
	onerror: undefined as undefined | ((error: unknown) => Promise<void>),
	onclose: undefined as undefined | (() => Promise<void>),
})

const fakeClient = () => ({
	connect: vi.fn().mockResolvedValue(undefined),
	close: vi.fn().mockResolvedValue(undefined),
	getInstructions: vi.fn().mockReturnValue("be nice"),
	request: vi.fn(),
})

describe("McpConnectionManager", () => {
	let deps: { [K in keyof McpConnectionManagerDeps]: Mock }
	let manager: McpConnectionManager
	let transport: ReturnType<typeof fakeTransport>
	let constructors: Record<string, Mock>

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.spyOn(logger, "error").mockImplementation(() => {})
		transport = fakeTransport()
		constructors = {
			stdio: (await import("@modelcontextprotocol/sdk/client/stdio.js")).StdioClientTransport as any,
			sse: (await import("@modelcontextprotocol/sdk/client/sse.js")).SSEClientTransport as any,
			"streamable-http": (await import("@modelcontextprotocol/sdk/client/streamableHttp.js"))
				.StreamableHTTPClientTransport as any,
		}
		for (const ctor of Object.values(constructors))
			ctor.mockImplementation(function () {
				return transport
			})
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
		vi.mocked(Client).mockImplementation(function () {
			return fakeClient() as any
		})

		deps = {
			clientVersion: vi.fn().mockReturnValue("9.9.9"),
			isMcpEnabled: vi.fn().mockResolvedValue(true),
			notifyServerChanges: vi.fn().mockResolvedValue(undefined),
			fetchCapabilities: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
		}
		manager = new McpConnectionManager(deps)
	})

	const configs: Record<string, McpServerConfig> = {
		stdio: { type: "stdio", command: "node", args: ["s.js"] } as unknown as McpServerConfig,
		sse: { type: "sse", url: "https://mcp.example.com/sse", headers: { A: "1" } } as unknown as McpServerConfig,
		"streamable-http": {
			type: "streamable-http",
			url: "https://mcp.example.com/mcp",
		} as unknown as McpServerConfig,
	}

	describe.each(["stdio", "sse", "streamable-http"])("createTransport(%s)", (type) => {
		it("builds the transport of that type", async () => {
			const created = await manager.createTransport("t", "global", configs[type])

			expect(created).toBe(transport)
			expect(constructors[type]).toHaveBeenCalledTimes(1)
			for (const other of Object.keys(constructors).filter((key) => key !== type)) {
				expect(constructors[other]).not.toHaveBeenCalled()
			}
		})

		it("installs the one shared error and close handler", async () => {
			await manager.connectToServer("t", configs[type], "global")
			const connection = manager.findConnection("t", "global")!
			deps.notifyServerChanges.mockClear()

			await transport.onerror!(new Error("reset by peer"))
			expect(connection.server.status).toBe("disconnected")
			expect(connection.server.error).toBe("reset by peer")
			expect(deps.notifyServerChanges).toHaveBeenCalledTimes(1)

			connection.server.status = "connected"
			await transport.onclose!()
			expect(connection.server.status).toBe("disconnected")
			expect(deps.notifyServerChanges).toHaveBeenCalledTimes(2)
		})

		it("keys the handlers on name and source", async () => {
			await manager.connectToServer("t", configs[type], "project")
			const projectConnection = manager.findConnection("t", "project")!
			manager.connections.push({
				type: "disconnected",
				server: { name: "t", config: "{}", status: "connected", source: "global" },
				client: null,
				transport: null,
			})

			await transport.onclose!()

			expect(projectConnection.server.status).toBe("disconnected")
			expect(manager.findConnection("t", "global")!.server.status).toBe("connected")
		})
	})

	it("starts a stdio transport itself, then makes start() a no-op for the client", async () => {
		const start = transport.start
		await manager.connectToServer("t", configs.stdio, "global")

		expect(start).toHaveBeenCalledTimes(1)
		expect(transport.start).not.toBe(start)
		await transport.start()
		expect(start).toHaveBeenCalledTimes(1)
	})

	it("does not start sse or streamable-http transports itself", async () => {
		const start = transport.start
		await manager.createTransport("t", "global", configs.sse)
		await manager.createTransport("t", "global", configs["streamable-http"])

		expect(start).not.toHaveBeenCalled()
		expect(transport.start).toBe(start)
	})

	it("rejects an unknown transport type", async () => {
		await expect(manager.createTransport("t", "global", { type: "carrier-pigeon" } as any)).rejects.toThrow(
			"Unsupported MCP server type: carrier-pigeon",
		)
	})

	it("connects a server and stores its capabilities and instructions", async () => {
		deps.fetchCapabilities.mockResolvedValue({ tools: [{ name: "x" }], resources: [], resourceTemplates: [] })

		await manager.connectToServer("t", configs.stdio, "global")

		const connection = manager.findConnection("t", "global")!
		expect(connection.type).toBe("connected")
		expect(connection.server).toMatchObject({
			status: "connected",
			error: "",
			instructions: "be nice",
			tools: [{ name: "x" }],
		})
		expect(deps.fetchCapabilities).toHaveBeenCalledWith("t", "global")
	})

	it("tracks a server as a placeholder while MCP is disabled", async () => {
		deps.isMcpEnabled.mockResolvedValue(false)

		await manager.connectToServer("t", configs.stdio, "global")

		expect(manager.connections).toHaveLength(1)
		expect(manager.connections[0]).toMatchObject({ type: "disconnected", client: null, transport: null })
		expect(constructors.stdio).not.toHaveBeenCalled()
	})

	it("deleteConnection closes the transport and the client and replaces the array", async () => {
		await manager.connectToServer("t", configs.sse, "global")
		const connection = manager.connections[0]
		const before = manager.connections

		await manager.deleteConnection("t", "global")

		expect(transport.close).toHaveBeenCalled()
		expect((connection.client as any).close).toHaveBeenCalled()
		expect(manager.connections).not.toBe(before)
		expect(manager.connections).toEqual([])
		expect(manager.findServerNameBySanitizedName("t")).toBeNull()
	})

	it("after dispose, a connect registers nothing and closes what it built", async () => {
		let release!: () => void
		transport.start.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
		const connecting = manager.connectToServer("t", configs.stdio, "global")
		await vi.waitFor(() => expect(transport.start).toHaveBeenCalled())

		await manager.dispose()
		release()
		await connecting

		expect(manager.connections).toEqual([])
		expect(transport.close).toHaveBeenCalled()
	})

	it("connects sse with the configured headers and leaves the global EventSource alone", async () => {
		const globalRef = globalThis as { EventSource?: unknown }
		const originalEventSource = globalRef.EventSource
		const sentinel = function SentinelEventSource() {}
		globalRef.EventSource = sentinel
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""))
		try {
			await manager.createTransport("t", "global", {
				type: "sse",
				url: "https://mcp.example.com/sse",
				headers: { Authorization: "Bearer secret" },
			} as unknown as McpServerConfig)

			expect(globalRef.EventSource).toBe(sentinel)
			const [url, options] = constructors.sse.mock.calls[0]
			expect(String(url)).toBe("https://mcp.example.com/sse")
			expect(options.requestInit.headers).toEqual({ Authorization: "Bearer secret" })
			expect(options.eventSourceInit.withCredentials).toBe(true)

			await options.eventSourceInit.fetch("https://mcp.example.com/sse", {
				headers: { Accept: "text/event-stream" },
			})
			const sentHeaders = fetchSpy.mock.calls[0][1]!.headers as Headers
			expect(sentHeaders.get("Authorization")).toBe("Bearer secret")
			expect(sentHeaders.get("Accept")).toBe("text/event-stream")
		} finally {
			globalRef.EventSource = originalEventSource
			fetchSpy.mockRestore()
		}
	})

	describe("stdio command on each platform", () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!
		afterEach(() => Object.defineProperty(process, "platform", originalPlatform))

		it.each([
			["win32", "npx", ["-y", "pkg"], "cmd.exe", ["/c", "npx", "-y", "pkg"]],
			["darwin", "npx", ["-y", "pkg"], "npx", ["-y", "pkg"]],
			["win32", "cmd.exe", ["/c", "echo"], "cmd.exe", ["/c", "echo"]],
			["win32", "CMD", ["/c", "echo"], "CMD", ["/c", "echo"]],
		])("on %s runs %s %j as %s %j", async (platform, command, args, expectedCommand, expectedArgs) => {
			Object.defineProperty(process, "platform", { value: platform, configurable: true })

			await manager.createTransport("t", "global", {
				type: "stdio",
				command,
				args,
				env: { FNM_DIR: "C:\\fnm" },
			} as unknown as McpServerConfig)

			expect(constructors.stdio).toHaveBeenCalledWith(
				expect.objectContaining({
					command: expectedCommand,
					args: expectedArgs,
					env: { PATH: "/usr/bin", FNM_DIR: "C:\\fnm" },
					stderr: "pipe",
				}),
			)
		})
	})

	describe("transport handler details", () => {
		it("logs the transport type of a streamable-http server and records a non-Error as text", async () => {
			await manager.connectToServer("t", configs["streamable-http"], "global")

			await transport.onerror!("plain failure")

			expect(logger.error).toHaveBeenCalledWith('Transport error for "t" (streamable-http):', "plain failure")
			expect(manager.findConnection("t", "global")!.server.error).toBe("plain failure")
		})

		it("still pushes the state when its server is already gone", async () => {
			await manager.connectToServer("t", configs.sse, "global")
			manager.connections = []
			deps.notifyServerChanges.mockClear()

			await transport.onerror!(new Error("late"))
			await transport.onclose!()

			expect(deps.notifyServerChanges).toHaveBeenCalledTimes(2)
		})

		it("truncates a long error and keeps the last 100 in the history", async () => {
			await manager.connectToServer("t", configs.sse, "global")
			const server = manager.findConnection("t", "global")!.server

			for (let i = 0; i < 101; i++) {
				await transport.onerror!(new Error(`e${i}`))
			}
			await transport.onerror!(new Error("x".repeat(1001)))

			expect(server.errorHistory).toHaveLength(100)
			expect(server.errorHistory![0].message).toBe("e2")
			expect(server.error).toBe(`${"x".repeat(1000)}...(error message truncated)`)
		})
	})

	it("restarts a stdio server when a watched path or its build/index.js changes", async () => {
		const chokidar = (await import("chokidar")).default
		await manager.connectToServer(
			"t",
			{ ...configs.stdio, args: ["build/index.js"], watchPaths: ["/w"] } as McpServerConfig,
			"global",
		)
		expect(vi.mocked(chokidar.watch).mock.calls.map(([paths]) => paths)).toEqual([["/w"], "build/index.js"])
		const restart = vi.spyOn(manager, "restartConnection").mockRejectedValue(new Error("busy"))

		const watcher = vi.mocked(chokidar.watch).mock.results[0].value
		for (const [, onChange] of watcher.on.mock.calls) {
			await onChange("/w/changed.js")
		}

		expect(restart.mock.calls).toEqual([
			["t", "global"],
			["t", "global"],
		])
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to restart server t after change in /w/changed.js:",
			expect.any(Error),
		)
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to restart server t after change in build/index.js:",
			expect.any(Error),
		)
	})

	describe("server lookup", () => {
		const server = (name: string, source: "global" | "project", disabled = false) =>
			({
				type: "disconnected",
				server: { name, config: "{}", status: "connected", source, disabled },
				client: null,
				transport: null,
			}) as const

		it("getServers drops disabled servers and lets a project server hide a global one", () => {
			manager.connections = [
				server("shared", "global"),
				server("shared", "project"),
				server("global-only", "global"),
				server("off", "global", true),
			]

			expect(manager.getServers().map((s) => `${s.source}:${s.name}`)).toEqual([
				"project:shared",
				"global:global-only",
			])
		})

		it("finds a server by a sanitized name with underscores for hyphens", () => {
			manager.connections = [server("my-server", "global")]

			expect(manager.findServerNameBySanitizedName("my-server")).toBe("my-server")
			expect(manager.findServerNameBySanitizedName("my_server")).toBe("my-server")
			expect(manager.findServerNameBySanitizedName("other")).toBeNull()
		})
	})

	// DEF-C13: every API request waits up to 10 s while isConnecting is true.
	it.each([
		[
			"updating the connections",
			async (m: McpConnectionManager) => {
				await m.connectToServer("gone", configs.stdio, "global")
				vi.spyOn(m, "deleteConnection").mockRejectedValue(new Error("close failed"))
				return m.updateServerConnections({}, "global")
			},
		],
		[
			"a restart",
			(m: McpConnectionManager) => {
				deps.isMcpEnabled.mockRejectedValue(new Error("state unavailable"))
				return m.restartConnection("t", "global")
			},
		],
	])("resets isConnecting when %s throws", async (_label, run) => {
		await expect(run(manager)).rejects.toThrow()

		expect(manager.isConnecting).toBe(false)
	})
})
