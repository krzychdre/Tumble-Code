import type { Mock } from "vitest"

import { McpConnectionManager, type McpConnectionManagerDeps } from "../McpConnectionManager"
import type { McpServerConfig } from "../mcpConfigSchema"

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
		vi.spyOn(console, "error").mockImplementation(() => {})
		transport = fakeTransport()
		constructors = {
			stdio: (await import("@modelcontextprotocol/sdk/client/stdio.js")).StdioClientTransport as any,
			sse: (await import("@modelcontextprotocol/sdk/client/sse.js")).SSEClientTransport as any,
			"streamable-http": (await import("@modelcontextprotocol/sdk/client/streamableHttp.js"))
				.StreamableHTTPClientTransport as any,
		}
		for (const ctor of Object.values(constructors)) ctor.mockImplementation(() => transport)
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
		vi.mocked(Client).mockImplementation(fakeClient as any)

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
})
