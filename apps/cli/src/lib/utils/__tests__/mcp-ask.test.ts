import { parseMcpAsk } from "../mcp-ask.js"

describe("parseMcpAsk", () => {
	it("reads a tool ask as the core writes it (camelCase, arguments as a JSON string)", () => {
		const text = JSON.stringify({
			type: "use_mcp_tool",
			serverName: "searxNcrawl",
			toolName: "search",
			arguments: JSON.stringify({ query: "tumble", limit: 5 }),
		})

		expect(parseMcpAsk(text)).toEqual({
			kind: "tool",
			serverName: "searxNcrawl",
			toolName: "search",
			argumentLines: ["{", '  "query": "tumble",', '  "limit": 5', "}"],
		})
	})

	it("drops empty arguments", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t", arguments: "{}" })
		expect(parseMcpAsk(text)?.argumentLines).toEqual([])

		const withoutArguments = JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t" })
		expect(parseMcpAsk(withoutArguments)?.argumentLines).toEqual([])
	})

	it("keeps arguments that are not JSON as they are", () => {
		const text = JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t", arguments: "a\nb" })
		expect(parseMcpAsk(text)?.argumentLines).toEqual(["a", "b"])
	})

	it("reads a resource ask", () => {
		const text = JSON.stringify({ type: "access_mcp_resource", serverName: "docs", uri: "docs://readme" })

		expect(parseMcpAsk(text)).toEqual({
			kind: "resource",
			serverName: "docs",
			uri: "docs://readme",
			argumentLines: [],
		})
	})

	it("returns undefined for text that is not an MCP ask", () => {
		expect(parseMcpAsk(undefined)).toBeUndefined()
		expect(parseMcpAsk("not json")).toBeUndefined()
		expect(parseMcpAsk("null")).toBeUndefined()
		expect(parseMcpAsk(JSON.stringify({ server_name: "old-shape" }))).toBeUndefined()
		expect(parseMcpAsk(JSON.stringify({ type: "other", serverName: "s" }))).toBeUndefined()
	})
})
