import { z } from "zod"

import { formatSchemaIssues, McpSettingsSchema, validateServerConfig } from "../mcpConfigSchema"

describe("validateServerConfig", () => {
	it("infers stdio and applies the defaults", () => {
		const input: any = { command: "node", args: ["a.js"] }

		const config = validateServerConfig(input, "a")

		expect(config).toMatchObject({
			type: "stdio",
			command: "node",
			args: ["a.js"],
			timeout: 60,
			alwaysAllow: [],
			disabledTools: [],
		})
		expect(config.type === "stdio" && typeof config.cwd).toBe("string")
		// The caller's object gets the inferred type too.
		expect(input.type).toBe("stdio")
	})

	it.each([
		[
			"stdio and url fields mixed",
			{ command: "node", url: "http://localhost" },
			"Cannot mix 'stdio' and ('sse' or 'streamable-http') fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse'/'streamable-http' use 'url' and 'headers'",
		],
		[
			"a url without a type",
			{ url: "http://localhost" },
			"Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.",
		],
		[
			"an unknown type",
			{ type: "ws", command: "node" },
			"Server type must be 'stdio', 'sse', or 'streamable-http'",
		],
		[
			"stdio without a command",
			{ type: "stdio" },
			"For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'",
		],
		[
			"sse without a url",
			{ type: "sse" },
			"For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'",
		],
		[
			"streamable-http without a url",
			{ type: "streamable-http" },
			"For 'streamable-http' type servers, you must provide a 'url' field and can optionally include 'headers'",
		],
		[
			"neither a command nor a url",
			{},
			"Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http) and a corresponding 'type' if 'url' is used.",
		],
	])("rejects %s", (_label, config, message) => {
		expect(() => validateServerConfig(config, "x")).toThrow(message)
	})

	it("names the server and joins the schema problems with semicolons", () => {
		expect(() => validateServerConfig({ command: "node", timeout: 0 }, "slow")).toThrow(
			'Invalid configuration for server "slow": ',
		)
		expect(() => validateServerConfig({ command: "node", timeout: 0 })).toThrow("Invalid server configuration: ")
	})
})

describe("formatSchemaIssues", () => {
	it("writes each problem as path: message, joined by the separator", () => {
		const result = McpSettingsSchema.safeParse({ mcpServers: { a: { command: "" }, b: { command: "" } } })
		expect(result.success).toBe(false)

		const error = (result as z.SafeParseError<unknown>).error
		expect(formatSchemaIssues(error, "\n")).toBe("mcpServers.a: Invalid input\nmcpServers.b: Invalid input")
		expect(formatSchemaIssues(error, "; ")).toBe("mcpServers.a: Invalid input; mcpServers.b: Invalid input")
	})
})
