// npx vitest run src/core/prompts/sections/__tests__/deferred-tools.spec.ts
import type { McpHub } from "../../../../services/mcp/McpHub"
import type { McpServer } from "@roo-code/types"

import { getDeferredToolsSection } from "../deferred-tools"

const mcpHub = (servers: McpServer[]): McpHub =>
	({
		getServers: () => servers,
	}) as unknown as McpHub

const server = (name: string, tools: Array<{ name: string; description: string }>): McpServer => ({
	name,
	config: "",
	status: "connected",
	tools: tools.map((t) => ({
		name: t.name,
		description: t.description,
		enabledForPrompt: true,
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	})),
})

describe("getDeferredToolsSection", () => {
	it("returns empty string when the deferredTools experiment is off", () => {
		const text = getDeferredToolsSection({
			experiments: { deferredTools: false },
			mcpHub: mcpHub([server("weather", [{ name: "get_current", description: "Get current." }])]),
		})
		expect(text).toBe("")
	})

	it("returns empty string when there are no MCP and no custom tools", () => {
		const text = getDeferredToolsSection({
			experiments: { deferredTools: true },
			mcpHub: undefined,
			customTools: [],
		})
		expect(text).toBe("")
	})

	it("renders deferred MCP tools grouped by server", () => {
		const text = getDeferredToolsSection({
			experiments: { deferredTools: true },
			mcpHub: mcpHub([
				server("weather", [
					{ name: "get_current", description: "Get current weather." },
					{ name: "get_forecast", description: "Get N-day forecast." },
				]),
				server("jira", [{ name: "search", description: "Search Jira via JQL." }]),
			]),
			customTools: [],
		})
		expect(text).toContain("Deferred tools")
		expect(text).toContain("## mcp:weather")
		expect(text).toContain("## mcp:jira")
		expect(text).toContain("mcp--weather--get_current")
		expect(text).toContain("mcp--jira--search")
	})

	it("omits an MCP tool from the catalog once it has been materialized", () => {
		const text = getDeferredToolsSection({
			experiments: { deferredTools: true },
			mcpHub: mcpHub([
				server("weather", [
					{ name: "get_current", description: "Get current." },
					{ name: "get_forecast", description: "Get forecast." },
				]),
			]),
			customTools: [],
			materializedDeferredTools: new Set(["mcp--weather--get_current"]),
		})
		expect(text).toContain("mcp--weather--get_forecast")
		expect(text).not.toContain("mcp--weather--get_current")
	})
})
