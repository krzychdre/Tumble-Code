/**
 * Pins the exact text of MCP configuration errors (DEP-8, zod 3 to zod 4).
 *
 * These strings reach the user: McpHub shows them for a broken server entry, and
 * McpConfigStore reports them for an invalid mcp_settings.json or .roo/mcp.json.
 * Part of the text comes from our own messages, part from zod's defaults.
 */

import { McpSettingsSchema, formatSchemaIssues, validateServerConfig } from "../mcpConfigSchema"

const thrownMessage = (config: unknown): string => {
	try {
		validateServerConfig(config, "srv")
	} catch (error) {
		return (error as Error).message
	}
	return "no error"
}

const settingsFileIssues = (raw: unknown): string => {
	const result = McpSettingsSchema.safeParse(raw)
	return result.success ? "valid" : formatSchemaIssues(result.error, "\n")
}

describe("MCP configuration error text (characterization)", () => {
	it.each([
		[
			"timeout below the minimum",
			{ command: "node", timeout: 0 },
			'Invalid configuration for server "srv": : Invalid input',
		],
		[
			"timeout above the maximum",
			{ command: "node", timeout: 5000 },
			'Invalid configuration for server "srv": : Invalid input',
		],
		["an empty command", { command: "" }, 'Invalid configuration for server "srv": : Invalid input'],
		[
			"args that are not an array",
			{ command: "node", args: "a.js" },
			'Invalid configuration for server "srv": : Invalid input',
		],
		[
			"an env value that is not a string",
			{ command: "node", env: { A: 1 } },
			'Invalid configuration for server "srv": : Invalid input',
		],
		[
			"an invalid sse url",
			{ type: "sse", url: "not a url" },
			'Invalid configuration for server "srv": : Invalid input',
		],
		[
			"a header value that is not a string",
			{ type: "streamable-http", url: "http://h", headers: { A: 1 } },
			'Invalid configuration for server "srv": : Invalid input',
		],
		[
			"alwaysAllow that is not an array",
			{ command: "node", alwaysAllow: "x" },
			'Invalid configuration for server "srv": : Invalid input',
		],
	])("%s", (_label, config, expected) => {
		expect(thrownMessage(config)).toBe(expected)
	})

	it("accepts a valid remote server and fills the defaults", () => {
		expect(validateServerConfig({ type: "sse", url: "http://localhost:3000/sse" }, "srv")).toEqual({
			type: "sse",
			url: "http://localhost:3000/sse",
			timeout: 60,
			alwaysAllow: [],
			disabledTools: [],
		})
	})

	it.each([
		["missing mcpServers", {}, "mcpServers: Required"],
		["mcpServers that is not an object", { mcpServers: [] }, "mcpServers: Expected object, received array"],
		["a server entry that is a string", { mcpServers: { a: "node" } }, "mcpServers.a: Invalid input"],
		[
			"a server entry with a bad timeout",
			{ mcpServers: { a: { command: "node", timeout: -1 } } },
			"mcpServers.a: Invalid input",
		],
		["a valid file", { mcpServers: { a: { command: "node" } } }, "valid"],
	])("settings file with %s", (_label, raw, expected) => {
		expect(settingsFileIssues(raw)).toBe(expected)
	})
})
