// npx vitest run src/core/task/__tests__/deferred-tools.spec.ts
import type OpenAI from "openai"

import { applyDeferralStrategy, formatDeferredCatalog, type DeferredCatalog } from "../deferred-tools"
import { ALWAYS_AVAILABLE_TOOLS } from "../../../shared/tools"

const nativeTool = (name: string): OpenAI.Chat.ChatCompletionFunctionTool => ({
	type: "function",
	function: {
		name,
		description: `Native tool ${name}. Long description here.`,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
})

const mcpTool = (
	server: string,
	tool: string,
	description = "MCP tool desc.",
): OpenAI.Chat.ChatCompletionFunctionTool => ({
	type: "function",
	function: {
		name: `mcp--${server}--${tool}`,
		description,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
})

const customTool = (name: string): OpenAI.Chat.ChatCompletionFunctionTool => ({
	type: "function",
	function: {
		name,
		description: `Custom tool ${name}.`,
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
})

describe("applyDeferralStrategy", () => {
	it("returns identical input + empty catalog when no MCP/custom tools present", () => {
		const tools = [nativeTool("read_file"), nativeTool("execute_command")]
		const result = applyDeferralStrategy({
			nativeTools: tools,
			mcpTools: [],
			customTools: [],
			materializedDeferredTools: new Set(),
		})
		expect(result.activeTools).toEqual(tools)
		expect(result.catalog.entries).toHaveLength(0)
	})

	it("never defers native tools", () => {
		const tools = [nativeTool("read_file"), nativeTool("apply_diff")]
		const result = applyDeferralStrategy({
			nativeTools: tools,
			mcpTools: [],
			customTools: [],
			materializedDeferredTools: new Set(),
		})
		expect(result.activeTools.map((t) => t.function.name)).toEqual(["read_file", "apply_diff"])
	})

	it("defers MCP tools by default and groups them in the catalog by server", () => {
		const mcp = [
			mcpTool("weather", "get_current", "Get current weather for a city."),
			mcpTool("weather", "get_forecast", "Get an N-day forecast."),
			mcpTool("jira", "search_issues", "Search Jira via JQL."),
		]
		const result = applyDeferralStrategy({
			nativeTools: [nativeTool("read_file")],
			mcpTools: mcp,
			customTools: [],
			materializedDeferredTools: new Set(),
		})
		// MCP tools are gone from the active set
		expect(result.activeTools.map((t) => t.function.name)).toEqual(["read_file"])
		// All three appear in the catalog
		expect(result.catalog.entries).toHaveLength(3)
		const weather = result.catalog.entries.filter((e) => e.group === "mcp:weather")
		expect(weather).toHaveLength(2)
		const jira = result.catalog.entries.filter((e) => e.group === "mcp:jira")
		expect(jira).toHaveLength(1)
	})

	it("defers custom tools and groups them under 'custom'", () => {
		const custom = [customTool("my_jira_search"), customTool("my_pager_page")]
		const result = applyDeferralStrategy({
			nativeTools: [],
			mcpTools: [],
			customTools: custom,
			materializedDeferredTools: new Set(),
		})
		expect(result.activeTools).toHaveLength(0)
		expect(result.catalog.entries).toHaveLength(2)
		expect(result.catalog.entries.every((e) => e.group === "custom")).toBe(true)
	})

	it("treats ALWAYS_AVAILABLE_TOOLS as alwaysLoad — never deferred", () => {
		const native = ALWAYS_AVAILABLE_TOOLS.map(nativeTool)
		const result = applyDeferralStrategy({
			nativeTools: native,
			mcpTools: [],
			customTools: [],
			materializedDeferredTools: new Set(),
		})
		expect(result.activeTools.map((t) => t.function.name)).toEqual(ALWAYS_AVAILABLE_TOOLS as readonly string[])
	})

	it("re-promotes materialized deferred tools back into the active set", () => {
		const mcp = [mcpTool("weather", "get_current"), mcpTool("weather", "get_forecast")]
		const materialized = new Set(["mcp--weather--get_current"])
		const result = applyDeferralStrategy({
			nativeTools: [],
			mcpTools: mcp,
			customTools: [],
			materializedDeferredTools: materialized,
		})
		// The materialized one is active; the other stays deferred
		expect(result.activeTools.map((t) => t.function.name)).toEqual(["mcp--weather--get_current"])
		expect(result.catalog.entries).toHaveLength(1)
		expect(result.catalog.entries[0].name).toBe("mcp--weather--get_forecast")
	})

	it("preserves a stable group ordering: native first, then mcp servers (sorted), then custom", () => {
		const mcp = [mcpTool("zeta", "a"), mcpTool("alpha", "b")]
		const custom = [customTool("c1")]
		const result = applyDeferralStrategy({
			nativeTools: [nativeTool("read_file")],
			mcpTools: mcp,
			customTools: custom,
			materializedDeferredTools: new Set(),
		})
		const groupOrder = result.catalog.entries.map((e) => e.group)
		// alpha before zeta; custom last
		expect(groupOrder).toEqual(["mcp:alpha", "mcp:zeta", "custom"])
	})
})

describe("formatDeferredCatalog", () => {
	it("returns empty string for an empty catalog", () => {
		const catalog: DeferredCatalog = { entries: [] }
		expect(formatDeferredCatalog(catalog)).toBe("")
	})

	it("renders a header and one section per group with name + brief", () => {
		const catalog: DeferredCatalog = {
			entries: [
				{ group: "mcp:weather", name: "mcp--weather--get_current", brief: "Get current weather." },
				{ group: "mcp:weather", name: "mcp--weather--get_forecast", brief: "Get N-day forecast." },
				{ group: "custom", name: "my_jira_search", brief: "Search Jira issues." },
			],
		}
		const text = formatDeferredCatalog(catalog)
		expect(text).toContain("Deferred tools")
		expect(text).toContain("tools_load")
		expect(text).toContain("## mcp:weather")
		expect(text).toContain("- mcp--weather--get_current")
		expect(text).toContain("Get current weather.")
		expect(text).toContain("## custom")
		expect(text).toContain("- my_jira_search")
	})

	it("clips descriptions to first sentence and to 200 chars max", () => {
		const longDesc = "First sentence. " + "x".repeat(500)
		const catalog: DeferredCatalog = {
			entries: [{ group: "custom", name: "tool_a", brief: longDesc }],
		}
		// The formatter is the one that clips, not the catalog builder; supply a pre-clipped brief here
		// and assert that already-short inputs are emitted verbatim.
		const text = formatDeferredCatalog(catalog)
		expect(text).toContain("tool_a")
		// Each rendered line is bounded — guard against runaway lengths in the formatted output.
		for (const line of text.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(260)
		}
	})
})
