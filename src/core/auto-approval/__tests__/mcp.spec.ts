import type { McpServer } from "@tumble-code/types"

import { isMcpToolAlwaysAllowed } from "../mcp"

const server = (source: "global" | "project", alwaysAllow: boolean): McpServer => ({
	name: "github",
	config: "{}",
	status: "connected",
	source,
	tools: [{ name: "create_issue", alwaysAllow }],
})

const call = { type: "use_mcp_tool" as const, serverName: "github", toolName: "create_issue" }

describe("isMcpToolAlwaysAllowed", () => {
	it("reads the setting of the server the call runs on: the project's, when both have the name", () => {
		// The global server allows the tool; the project's server of the same
		// name, which the call goes to, does not.
		expect(isMcpToolAlwaysAllowed(call, [server("global", true), server("project", false)])).toBe(false)
		expect(isMcpToolAlwaysAllowed(call, [server("project", false), server("global", true)])).toBe(false)
	})

	it("allows by the project server's own setting", () => {
		expect(isMcpToolAlwaysAllowed(call, [server("global", false), server("project", true)])).toBe(true)
	})

	it("reads the global server when it is the only one", () => {
		expect(isMcpToolAlwaysAllowed(call, [server("global", true)])).toBe(true)
		expect(isMcpToolAlwaysAllowed(call, [server("global", false)])).toBe(false)
	})

	it("allows nothing for an unknown server or tool", () => {
		expect(isMcpToolAlwaysAllowed({ ...call, serverName: "other" }, [server("global", true)])).toBe(false)
		expect(isMcpToolAlwaysAllowed({ ...call, toolName: "delete_repo" }, [server("global", true)])).toBe(false)
	})
})
