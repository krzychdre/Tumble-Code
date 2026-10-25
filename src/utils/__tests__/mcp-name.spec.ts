import {
	sanitizeMcpName,
	buildMcpToolName,
	parseMcpToolName,
	normalizeMcpToolName,
	normalizeForComparison,
	toolNamesMatch,
	isMcpTool,
} from "../mcp-name"

describe("mcp-name", () => {
	it.each([
		["get-user-profile", "get_user_profile"],
		["get_user_profile", "get_user_profile"],
		["tool", "tool"],
		["get-user_profile", "get_user_profile"],
		["mcp--server--tool", "mcp__server__tool"],
	])("normalizeForComparison(%j) is %j", (name, expected) => {
		expect(normalizeForComparison(name)).toBe(expected)
	})

	it.each([
		["mcp--server--tool", true],
		["mcp--my_server--get_forecast", true],
		["mcp--server--get-user-profile", true],
		["mcp__server__tool", true],
		["mcp__my_server__get_forecast", true],
		["server--tool", false],
		["tool", false],
		["read_file", false],
		["", false],
		["mcp_server_tool", false],
		["mcp-server", false],
		["mcp", false],
	])("isMcpTool(%j) is %j", (name, expected) => {
		expect(isMcpTool(name)).toBe(expected)
	})

	it.each([
		["", "_"],
		["my server", "my_server"],
		["server name here", "server_name_here"],
		["server@name!", "servername"],
		["test#$%^&*()", "test"],
		["server_name", "server_name"],
		["server-name", "server-name"],
		["Server123", "Server123"],
		["server.name", "servername"],
		["server:name", "servername"],
		["awslabs.aws-documentation-mcp-server", "awslabsaws-documentation-mcp-server"],
		["123server", "_123server"],
		["-server", "_-server"],
		[".server", "server"],
		["server", "server"],
		["_server", "_server"],
		["Server", "Server"],
		["server--name", "server-name"],
		["test---server", "test-server"],
		["my----tool", "my-tool"],
		["My Server @ Home!", "My_Server__Home"],
		["123-test server", "_123-test_server"],
		["@#$%", "_unnamed"],
		["   ", "_"],
		["atlassian-jira_search", "atlassian-jira_search"],
		["atlassian-confluence_search", "atlassian-confluence_search"],
	])("sanitizeMcpName(%j) is %j", (name, expected) => {
		expect(sanitizeMcpName(name)).toBe(expected)
	})

	it.each([
		["mcp__server__tool", "mcp--server--tool"],
		["mcp--server--tool", "mcp--server--tool"],
		["read_file", "read_file"],
		["some__tool", "some__tool"],
		["mcp__my_server__get_user_profile", "mcp--my_server--get_user_profile"],
		["mcp__server__get_user_profile", "mcp--server--get_user_profile"],
	])("normalizeMcpToolName(%j) is %j", (name, expected) => {
		expect(normalizeMcpToolName(name)).toBe(expected)
	})

	it.each([
		[
			"mcp--server--tool",
			{
				serverName: "server",
				toolName: "tool",
			},
		],
		[
			"mcp__server__tool",
			{
				serverName: "server",
				toolName: "tool",
			},
		],
		["server--tool", null],
		["tool", null],
		["mcp_server_tool", null],
		[
			"mcp--server--tool_name",
			{
				serverName: "server",
				toolName: "tool_name",
			},
		],
		[
			"mcp--my_server--tool",
			{
				serverName: "my_server",
				toolName: "tool",
			},
		],
		[
			"mcp--my_server--get_forecast",
			{
				serverName: "my_server",
				toolName: "get_forecast",
			},
		],
		[
			"mcp--onellm--atlassian-jira_search",
			{
				serverName: "onellm",
				toolName: "atlassian-jira_search",
			},
		],
		["mcp--", null],
		["mcp--server", null],
	])("parseMcpToolName(%j) is %j", (name, expected) => {
		expect(parseMcpToolName(name)).toEqual(expected)
	})

	it.each([
		["get_user", "get_user", true],
		["get-user", "get-user", true],
		["get-user", "get_user", true],
		["get_user", "get-user", true],
		["mcp--server--get-user-profile", "mcp__server__get_user_profile", true],
		["get_user", "get_profile", false],
	])("toolNamesMatch(%j, %j) is %j", (a, b, expected) => {
		expect(toolNamesMatch(a, b)).toBe(expected)
	})

	it.each([
		["server", "tool", "mcp--server--tool"],
		["my server", "my tool", "mcp--my_server--my_tool"],
		["server@name", "tool!name", "mcp--servername--toolname"],
		["123server", "456tool", "mcp--_123server--_456tool"],
		["my_server", "my_tool", "mcp--my_server--my_tool"],
		["onellm", "atlassian-jira_search", "mcp--onellm--atlassian-jira_search"],
		["server", "get-user-profile", "mcp--server--get-user-profile"],
	])("buildMcpToolName(%j, %j) is %j", (a, b, expected) => {
		expect(buildMcpToolName(a, b)).toBe(expected)
	})

	it("cuts a built name to 64 characters that still parse", () => {
		const built = buildMcpToolName("very-long-server-name-that-exceeds", "very-long-tool-name-that-also-exceeds")

		expect(built).toHaveLength(64)
		expect(parseMcpToolName(built)?.serverName).toBe("very-long-server-name-that-exceeds")
	})

	// What a model sends back for a name we built, and what we find with it.
	it.each([
		["as built", "onellm", "atlassian-jira_search", "mcp--onellm--atlassian-jira_search", "atlassian-jira_search"],
		[
			"with __ separators",
			"onellm",
			"atlassian-jira_search",
			"mcp__onellm__atlassian-jira_search",
			"atlassian-jira_search",
		],
		[
			"with every hyphen turned into _",
			"onellm",
			"atlassian-jira_search",
			"mcp__onellm__atlassian_jira_search",
			"atlassian_jira_search",
		],
		["with a hyphenated server, all _", "my-server", "get-user", "mcp__my_server__get_user", "get_user"],
	])("finds the tool when the model sends the name %s", (_, server, tool, modelOutput, parsedTool) => {
		const parsed = parseMcpToolName(modelOutput)!

		expect(parsed.toolName).toBe(parsedTool)
		expect(toolNamesMatch(server, parsed.serverName)).toBe(true)
		expect(toolNamesMatch(tool, parsed.toolName)).toBe(true)
		expect(parseMcpToolName(buildMcpToolName(server, tool))).toEqual({ serverName: server, toolName: tool })
	})
})
