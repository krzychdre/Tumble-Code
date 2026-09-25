import type { Mock } from "vitest"

import type { McpConnection } from "../McpConnectionManager"
import { McpToolCatalog } from "../McpToolCatalog"

function connected(request: Mock, overrides: Record<string, unknown> = {}): McpConnection {
	return {
		type: "connected",
		server: { name: "srv", config: JSON.stringify({ command: "node" }), status: "connected", source: "global" },
		client: { request } as any,
		transport: {} as any,
		...overrides,
	} as McpConnection
}

describe("McpToolCatalog", () => {
	let connections: McpConnection[]
	let entries: Record<string, any>
	let written: { path: string; config: any }[]
	let notify: Mock
	let catalog: McpToolCatalog

	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		connections = []
		entries = {}
		written = []
		notify = vi.fn().mockResolvedValue(undefined)
		catalog = new McpToolCatalog({
			findConnection: (name, source) =>
				connections.find((c) => c.server.name === name && (!source || c.server.source === source)),
			configStore: {
				readServerEntries: vi.fn(async () => entries),
				readForUpdate: vi.fn(async () => ({
					path: "/cfg.json",
					config: { mcpServers: structuredClone(entries) },
				})),
				write: vi.fn(async (path: string, config: any) => {
					written.push({ path, config })
					entries = config.mcpServers
				}),
			},
			notifyServerChanges: notify,
		})
	})

	describe("fetchToolsList", () => {
		const tools = [{ name: "a" }, { name: "b" }, { name: "c" }]

		it("marks alwaysAllow and enabledForPrompt from the server's settings entry", async () => {
			connections.push(connected(vi.fn().mockResolvedValue({ tools })))
			entries = { srv: { alwaysAllow: ["a"], disabledTools: ["c"] } }

			const result = await catalog.fetchToolsList("srv", "global")

			expect(result.map((t) => [t.name, t.alwaysAllow, t.enabledForPrompt])).toEqual([
				["a", true, true],
				["b", false, true],
				["c", false, false],
			])
		})

		it("allows every tool for the '*' wildcard", async () => {
			connections.push(connected(vi.fn().mockResolvedValue({ tools })))
			entries = { srv: { alwaysAllow: ["*"] } }

			const result = await catalog.fetchToolsList("srv", "global")

			expect(result.every((t) => t.alwaysAllow)).toBe(true)
		})

		it("still lists the tools when the settings cannot be read", async () => {
			connections.push(connected(vi.fn().mockResolvedValue({ tools })))
			catalog = new McpToolCatalog({
				findConnection: () => connections[0],
				configStore: { readServerEntries: vi.fn().mockRejectedValue(new Error("EACCES")) } as any,
				notifyServerChanges: notify,
			})

			const result = await catalog.fetchToolsList("srv", "global")

			expect(result.map((t) => [t.alwaysAllow, t.enabledForPrompt])).toEqual([
				[false, true],
				[false, true],
				[false, true],
			])
		})

		it("returns [] for an unknown or disconnected server, or a failing request", async () => {
			expect(await catalog.fetchToolsList("nope")).toEqual([])
			connections.push({ ...connected(vi.fn()), type: "disconnected", client: null, transport: null } as any)
			expect(await catalog.fetchToolsList("srv")).toEqual([])
			connections[0] = connected(vi.fn().mockRejectedValue(new Error("timeout")))
			expect(await catalog.fetchToolsList("srv")).toEqual([])
		})
	})

	it("fetchCapabilities lists tools, resources and templates in that order", async () => {
		const request = vi.fn(async ({ method }: { method: string }) => ({
			tools: method === "tools/list" ? [{ name: "t" }] : undefined,
			resources: method === "resources/list" ? [{ uri: "r://1", name: "r" }] : undefined,
			resourceTemplates:
				method === "resources/templates/list" ? [{ uriTemplate: "r://{x}", name: "x" }] : undefined,
		}))
		connections.push(connected(request))

		const capabilities = await catalog.fetchCapabilities("srv", "global")

		expect(request.mock.calls.map(([arg]) => arg.method)).toEqual([
			"tools/list",
			"resources/list",
			"resources/templates/list",
		])
		expect(capabilities.tools!.map((t) => t.name)).toEqual(["t"])
		expect(capabilities.resources).toEqual([{ uri: "r://1", name: "r" }])
		expect(capabilities.resourceTemplates).toEqual([{ uriTemplate: "r://{x}", name: "x" }])
	})

	describe("tool toggles", () => {
		beforeEach(() => {
			connections.push(connected(vi.fn().mockResolvedValue({ tools: [{ name: "a" }] })))
		})

		it("toggleToolAlwaysAllow adds the tool, refreshes the tools and pushes the state", async () => {
			entries = { srv: { command: "node" } }

			await catalog.toggleToolAlwaysAllow("srv", "global", "a", true)

			expect(written).toHaveLength(1)
			expect(written[0].config.mcpServers.srv.alwaysAllow).toEqual(["a"])
			expect(connections[0].server.tools).toEqual([{ name: "a", alwaysAllow: true, enabledForPrompt: true }])
			expect(notify).toHaveBeenCalledTimes(1)
		})

		it("toggleToolAlwaysAllow(false) removes the tool", async () => {
			entries = { srv: { command: "node", alwaysAllow: ["a", "b"] } }

			await catalog.toggleToolAlwaysAllow("srv", "global", "a", false)

			expect(written[0].config.mcpServers.srv.alwaysAllow).toEqual(["b"])
		})

		it("toggleToolEnabledForPrompt(false) adds the tool to disabledTools", async () => {
			entries = { srv: { command: "node" } }

			await catalog.toggleToolEnabledForPrompt("srv", "global", "a", false)

			expect(written[0].config.mcpServers.srv.disabledTools).toEqual(["a"])
			expect(connections[0].server.tools![0].enabledForPrompt).toBe(false)
		})

		it("creates a stdio entry for a server missing from the file", async () => {
			entries = {}

			await catalog.toggleToolAlwaysAllow("srv", "global", "a", true)

			expect(written[0].config.mcpServers.srv).toEqual({
				type: "stdio",
				command: "node",
				args: [],
				alwaysAllow: ["a"],
			})
		})

		it("rejects an unknown server without writing", async () => {
			await expect(catalog.toggleToolAlwaysAllow("nope", "global", "a", true)).rejects.toThrow(
				"Server nope with source global not found",
			)
			expect(written).toEqual([])
		})
	})

	describe("callTool and readResource", () => {
		it("calls a tool with the configured timeout", async () => {
			const request = vi.fn().mockResolvedValue({ content: [] })
			connections.push(connected(request))
			connections[0].server.config = JSON.stringify({ command: "node", timeout: 5 })

			await catalog.callTool("srv", "t", { x: 1 })

			expect(request).toHaveBeenCalledWith(
				{ method: "tools/call", params: { name: "t", arguments: { x: 1 } } },
				expect.anything(),
				{ timeout: 5000 },
			)
		})

		it("refuses a disabled server and an unknown one", async () => {
			connections.push(connected(vi.fn()))
			connections[0].server.disabled = true

			await expect(catalog.callTool("srv", "t")).rejects.toThrow('Server "srv" is disabled and cannot be used')
			await expect(catalog.readResource("srv", "r://1")).rejects.toThrow('Server "srv" is disabled')
			await expect(catalog.callTool("nope", "t")).rejects.toThrow("No connection found for server: nope")
			await expect(catalog.readResource("nope", "r://1", "project")).rejects.toThrow(
				"No connection found for server: nope with source project",
			)
		})
	})
})
