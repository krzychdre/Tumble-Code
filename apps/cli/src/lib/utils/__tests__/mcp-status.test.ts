import type { ExtensionMessage, McpServer } from "@roo-code/types"

import { isFailedMcpServer, lastMcpErrorLine, mcpServersFromMessage, takeNewMcpFailures } from "../mcp-status.js"

function server(overrides: Partial<McpServer> = {}): McpServer {
	return { name: "s", config: "{}", status: "connected", source: "global", ...overrides }
}

describe("mcpServersFromMessage", () => {
	it("reads McpHub's mcpServers push", () => {
		const servers = [server()]
		expect(mcpServersFromMessage({ type: "mcpServers", mcpServers: servers } as ExtensionMessage)).toBe(servers)
		expect(mcpServersFromMessage({ type: "mcpServers" } as ExtensionMessage)).toEqual([])
	})

	it("reads a full state push", () => {
		const servers = [server()]
		expect(mcpServersFromMessage({ type: "state", state: { mcpServers: servers } } as never)).toBe(servers)
	})

	it("ignores a partial state push and unrelated messages", () => {
		expect(mcpServersFromMessage({ type: "state", state: { storageErrorMessage: "x" } } as never)).toBeUndefined()
		expect(mcpServersFromMessage({ type: "commands", commands: [] } as never)).toBeUndefined()
	})
})

describe("isFailedMcpServer", () => {
	it("is a disconnected, enabled server with an error", () => {
		expect(isFailedMcpServer(server({ status: "disconnected", error: "spawn x ENOENT" }))).toBe(true)
	})

	it("is not a disabled, connecting, connected or error-free server", () => {
		expect(isFailedMcpServer(server({ status: "disconnected", error: "e", disabled: true }))).toBe(false)
		expect(isFailedMcpServer(server({ status: "connecting", error: "e" }))).toBe(false)
		expect(isFailedMcpServer(server({ status: "connected", error: "stderr noise" }))).toBe(false)
		expect(isFailedMcpServer(server({ status: "disconnected" }))).toBe(false)
	})
})

describe("lastMcpErrorLine", () => {
	it("returns the last non-empty line", () => {
		expect(lastMcpErrorLine(server({ error: "Traceback\n  at x\nModuleNotFoundError: foo\n\n" }))).toBe(
			"ModuleNotFoundError: foo",
		)
		expect(lastMcpErrorLine(server())).toBe("")
	})
})

describe("takeNewMcpFailures", () => {
	it("reports a failure once and a new error of the same server again", () => {
		const reported = new Set<string>()
		const failed = server({ name: "broken", status: "disconnected", error: "spawn x ENOENT" })

		expect(takeNewMcpFailures([failed, server()], reported)).toEqual([failed])
		expect(takeNewMcpFailures([failed], reported)).toEqual([])

		const failedAgain = { ...failed, error: "Connection closed" }
		expect(takeNewMcpFailures([failedAgain], reported)).toEqual([failedAgain])
	})

	it("tells a project server from a global one of the same name", () => {
		const reported = new Set<string>()
		const globalFailure = server({ name: "x", status: "disconnected", error: "e" })
		const projectFailure = { ...globalFailure, source: "project" as const }

		expect(takeNewMcpFailures([globalFailure, projectFailure], reported)).toEqual([globalFailure, projectFailure])
	})
})
